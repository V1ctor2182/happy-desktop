#!/usr/bin/env python3
"""Generate the native typed palette from Happy's authoritative theme.css."""
from pathlib import Path
import subprocess
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "happy-desktop-ui" / "src" / "theme.css"
OUTPUT = ROOT / "src" / "ui" / "theme_roles.rs"

EXPECTED_ROLE_NAMES = frozenset(
    """
    activity-elevated-line
    activity-failed-line
    agent-event-text
    agent-message-text
    box-error-background
    box-error-border
    box-error-text
    box-warning-background
    box-warning-border
    box-warning-text
    button-primary-background
    button-primary-disabled
    button-primary-ripple
    button-primary-tint
    button-secondary-tint
    code-active-line
    code-caret
    code-comment
    code-constant
    code-function
    code-gutter
    code-gutter-active
    code-keyword
    code-number
    code-operator
    code-punctuation
    code-selection
    code-string
    code-type
    code-variable
    delete-action
    diff-added-bg
    diff-added-border
    diff-added-text
    diff-context-bg
    diff-context-text
    diff-error
    diff-hunk-header-bg
    diff-hunk-header-text
    diff-inline-added-bg
    diff-inline-added-text
    diff-inline-removed-bg
    diff-inline-removed-text
    diff-leading-space-dot
    diff-line-number-bg
    diff-line-number-text
    diff-outline
    diff-removed-bg
    diff-removed-border
    diff-removed-text
    diff-success
    divider
    fab-background
    fab-background-pressed
    fab-icon
    file-archive
    file-audio
    file-code
    file-config
    file-data
    file-directory
    file-image
    file-other
    file-path-text
    file-prose
    file-secret
    file-shell
    file-style
    file-video
    git-added-text
    git-branch-text
    git-file-count-text
    git-removed-text
    git-status-deleted
    git-status-modified
    git-status-new
    git-status-renamed
    groupped-background
    groupped-chevron
    groupped-section-title
    happy-scrollbar-active-color
    happy-scrollbar-color
    happy-scrollbar-interaction-color
    happy-scrollbar-quiet-color
    happy-scrollbar-rest-color
    happy-scrollbar-surface-color
    header-background
    header-tint
    header-tint-secondary
    input-background
    input-placeholder
    input-text
    modal-border
    nl-kind-color
    nl-kind-soft
    overlay-backdrop
    overlay-panel
    page-canvas
    permission-accept-edits
    permission-button-allow-all-background
    permission-button-allow-all-text
    permission-button-allow-background
    permission-button-allow-text
    permission-button-deny-background
    permission-button-deny-text
    permission-button-inactive-background
    permission-button-inactive-border
    permission-button-inactive-text
    permission-button-selected-background
    permission-button-selected-border
    permission-button-selected-text
    permission-bypass
    permission-default
    permission-plan
    permission-read-only
    permission-safe-yolo
    permission-yolo
    radio-active
    radio-dot
    radio-inactive
    review-accent
    shadow-color
    shadow-elevated
    shadow-floating
    shadow-rail
    shadow-subtle
    status-connected
    status-connecting
    status-default
    status-disconnected
    status-error
    success
    surface
    surface-high
    surface-highest
    surface-inverse
    surface-pressed
    surface-pressed-overlay
    surface-ripple
    surface-selected
    switch-thumb-active
    switch-thumb-inactive
    switch-track-active
    switch-track-inactive
    syntax-bracket-1
    syntax-bracket-2
    syntax-bracket-3
    syntax-bracket-4
    syntax-bracket-5
    syntax-comment
    syntax-default
    syntax-function
    syntax-keyword
    syntax-number
    syntax-string
    terminal-background
    terminal-command
    terminal-empty-output
    terminal-error
    terminal-prompt
    terminal-selection
    terminal-stderr
    terminal-stdout
    text
    text-destructive
    text-inverse
    text-link
    text-secondary
    user-message-background
    user-message-text
    warning
    warning-critical
    """.split()
)

NON_COLOR_NAMES = frozenset(
    """
    happy-brand-logo-source
    happy-chat-heading-measure
    happy-chat-measure
    happy-font-emoji
    happy-font-mono
    happy-font-ui
    happy-panel-inset
    happy-panel-row-padding
    happy-radius-md
    happy-radius-pill
    happy-radius-shell
    happy-radius-sm
    happy-radius-window
    happy-scrollbar-edge-inset
    happy-scrollbar-ink
    happy-scrollbar-track
    happy-subheader-control-height
    happy-subheader-height
    happy-subheader-inset
    happy-z-overlay
    happy-z-window-chrome
    shadow-opacity
    """.split()
)
css = SOURCE.read_text()
light_text, dark_text = css.split("@media (prefers-color-scheme: dark)", 1)
light = dict(re.findall(r"--([a-z0-9-]+):\s*([^;]+);", light_text))
dark = {**light, **dict(re.findall(r"--([a-z0-9-]+):\s*([^;]+);", dark_text))}

def color(value, env, stack=()):
    value = value.strip()
    if value == "transparent": return (0, 0, 0, 0)
    if value.startswith("#"):
        value = value[1:]
        if len(value) == 6: return (*[int(value[ix:ix+2], 16) for ix in (0, 2, 4)], 255)
        if len(value) == 8: return tuple(int(value[ix:ix+2], 16) for ix in (0, 2, 4, 6))
    if value.startswith("rgb("):
        channels, *alpha = value[4:-1].split("/")
        rgb = [int(item) for item in channels.split()]
        opacity = 1.0
        if alpha:
            raw = alpha[0].strip()
            opacity = float(raw[:-1]) / 100 if raw.endswith("%") else float(raw)
        return (*rgb, round(opacity * 255))
    alias = re.fullmatch(r"var\(--([a-z0-9-]+)\)", value)
    if alias:
        name = alias.group(1)
        if name in stack: raise ValueError("recursive theme role")
        return color(env[name], env, stack + (name,))
    mix = re.fullmatch(r"color-mix\(in srgb, var\(--([a-z0-9-]+)\) (\d+)%.*, var\(--([a-z0-9-]+)\)\)", value)
    if mix:
        first = color(env[mix.group(1)], env, stack)
        second = color(env[mix.group(3)], env, stack)
        weight = int(mix.group(2)) / 100
        return tuple(round(a * weight + b * (1 - weight)) for a, b in zip(first, second))
    raise ValueError(value)

def rust_name(name):
    return "".join(part.capitalize() for part in re.split(r"[^A-Za-z0-9]+", name) if part)
def packed(value): return "".join(f"{channel:02x}" for channel in value)

if len(EXPECTED_ROLE_NAMES) != 172:
    raise RuntimeError(f"expected 172 authoritative theme roles, found {len(EXPECTED_ROLE_NAMES)}")
authoritative_role_names = set(light) - NON_COLOR_NAMES
if authoritative_role_names != EXPECTED_ROLE_NAMES:
    missing = sorted(EXPECTED_ROLE_NAMES - authoritative_role_names)
    unexpected = sorted(authoritative_role_names - EXPECTED_ROLE_NAMES)
    raise RuntimeError(
        f"authoritative theme role set drifted; missing={missing}, unexpected={unexpected}"
    )

resolved = {}
resolution_failures = []
for name in light:
    if name not in EXPECTED_ROLE_NAMES:
        continue
    values = []
    for appearance, env in (("light", light), ("dark", dark)):
        try:
            values.append(color(env[name], env))
        except (KeyError, ValueError) as error:
            resolution_failures.append(f"{name} ({appearance}): {error}")
    if len(values) == 2:
        resolved[name] = values
if resolution_failures:
    raise RuntimeError("theme role resolution failed:\n" + "\n".join(resolution_failures))

roles = [(name, *resolved[name]) for name in light if name in EXPECTED_ROLE_NAMES]
if len({rust_name(name) for name, _, _ in roles}) != len(roles): raise RuntimeError("Rust role collision")
lines = ["// Generated from packages/happy-desktop-ui/src/theme.css. Do not hand-edit.", "use gpui::{Rgba, rgba};", "", "#[derive(Clone, Copy, Debug, PartialEq, Eq)]", "pub enum ThemeRole {"]
lines += [f"    {rust_name(name)}," for name, _, _ in roles]
lines += ["}", "", "impl ThemeRole {", f"    pub const ALL: [Self; {len(roles)}] = ["]
lines += [f"        Self::{rust_name(name)}," for name, _, _ in roles]
lines += ["    ];", "    pub const fn name(self) -> &'static str {", "        match self {"]
lines += [f'            Self::{rust_name(name)} => "{name}",' for name, _, _ in roles]
lines += ["        }", "    }", "    pub fn resolve(self, dark: bool) -> Rgba {", "        let value = match (self, dark) {"]
for name, light_value, dark_value in roles:
    variant = rust_name(name)
    if light_value == dark_value: lines.append(f"            (Self::{variant}, _) => 0x{packed(light_value)},")
    else:
        lines.append(f"            (Self::{variant}, false) => 0x{packed(light_value)},")
        lines.append(f"            (Self::{variant}, true) => 0x{packed(dark_value)},")
lines += ["        };", "        rgba(value)", "    }", "}"]
OUTPUT.write_text("\n".join(lines) + "\n")
subprocess.run(["rustfmt", "--edition", "2024", str(OUTPUT)], check=True)
print(OUTPUT)

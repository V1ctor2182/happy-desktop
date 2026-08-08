import {
    RigGeneralSettings,
    RigInstructionsSettings,
    RigNodeSettings,
    RigPairing,
    RigProviderSettings,
    RigSettingsShell,
    type RigNodeRow,
    type RigNodeTransportRow,
    type RigProviderRow,
    type RigSettingsCategory,
} from "../../src";
import { ComponentPage, FullScreenSpecimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "P-012";

const categories: readonly RigSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "doc", id: "instructions", label: "Instructions" },
    { icon: "link", id: "nodes", label: "Nodes" },
    { icon: "globe", id: "providers", label: "Providers" },
];

const nodes: readonly RigNodeRow[] = [
    // Reached two ways and still one machine: the routes are listed, the row is
    // not doubled, and the whole of its work is opened over one connection.
    {
        id: "workshop",
        name: "workshop",
        peerId: "workshop",
        routes: [
            { address: "iroh:4f2a…c81b", state: "connected", transport: "iroh" },
            { address: "10.0.0.4:4919", state: "connected", transport: "direct" },
        ],
        rttMs: 18,
        state: "connected",
        workOpen: true,
    },
    {
        accessRestricted: true,
        id: "builder",
        name: "builder",
        peerId: "builder",
        routes: [{ address: "iroh:9d10…77ef", state: "connected", transport: "iroh" }],
        rttMs: 142,
        state: "connected",
    },
    // Still dialling, so it has an address and nothing to address: no identity
    // has been proved yet, and nothing of its work can be opened.
    {
        id: "iroh:0b7c…31aa",
        name: "iroh:0b7c…31aa",
        routes: [{ address: "iroh:0b7c…31aa", state: "connecting", transport: "iroh" }],
        state: "connecting",
    },
    {
        id: "attic",
        message: "No route to the node since 14:02.",
        name: "attic",
        peerId: "attic",
        routes: [{ address: "iroh:6e55…b204", state: "unreachable", transport: "iroh" }],
        state: "unreachable",
    },
];

const transports: readonly RigNodeTransportRow[] = [
    { localAddress: "iroh:2c9f…a017", state: "ready", transport: "iroh" },
];

const noPairing = {
    available: true,
    joinValue: "",
    onInvitationCreate: () => {},
    onJoinSubmit: () => {},
    onJoinValueChange: () => {},
    onReset: () => {},
    onVerificationAccept: () => {},
    onVerificationReject: () => {},
} as const;

const instructions = `# House rules

Ask before touching anything outside the working directory.

- Small commits, present tense, no ceremony.
- \`pnpm typecheck\` before you say a thing is done.
- Never force-push \`main\`.
`;

const modelOptions = [
    { label: "Codex · GPT-5.6 Sol", value: "codex:openai/gpt-5.6-sol" },
    { label: "Codex · GPT-5.6 Terra", value: "codex:openai/gpt-5.6-terra" },
    { label: "Claude · Opus 5 1M", value: "claude:anthropic/opus-5" },
    { label: "Claude · Sonnet 5", value: "claude:anthropic/sonnet-5" },
];

const effortOptions = [
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
];

const permissionModeOptions = [
    { label: "Auto", value: "auto" },
    { label: "Workspace write", value: "workspace_write" },
    { label: "Read only", value: "read_only" },
    { label: "Full access", value: "full_access" },
];

const providers: readonly RigProviderRow[] = [
    {
        id: "codex",
        models: [
            {
                contextWindow: 400_000,
                efforts: ["Low", "Medium", "High"],
                enabled: true,
                id: "codex:openai/gpt-5.6-sol",
                isDefault: true,
                modelId: "openai/gpt-5.6-sol",
                name: "GPT-5.6 Sol",
            },
            {
                contextWindow: 400_000,
                efforts: ["Medium", "High", "Max"],
                enabled: true,
                id: "codex:openai/gpt-5.6-terra",
                isDefault: false,
                modelId: "openai/gpt-5.6-terra",
                name: "GPT-5.6 Terra",
            },
            {
                efforts: ["Medium", "High"],
                enabled: false,
                id: "codex:openai/gpt-5.6-luna",
                isDefault: false,
                modelId: "openai/gpt-5.6-luna",
                name: "GPT-5.6 Luna",
            },
        ],
        name: "Codex",
        serviceTiers: ["Fast"],
        status: "ready",
    },
    {
        id: "claude",
        models: [
            {
                contextWindow: 1_000_000,
                efforts: ["Low", "Medium", "High", "Ultra"],
                enabled: true,
                id: "claude:anthropic/opus-5",
                isDefault: false,
                modelId: "anthropic/opus-5",
                name: "Opus 5 1M",
            },
            {
                contextWindow: 200_000,
                efforts: ["Low", "Medium", "High"],
                enabled: true,
                id: "claude:anthropic/sonnet-5",
                isDefault: false,
                modelId: "anthropic/sonnet-5",
                name: "Sonnet 5",
            },
        ],
        name: "Claude",
        serviceTiers: [],
        status: "ready",
    },
    {
        id: "bedrock",
        models: [
            {
                contextWindow: 200_000,
                efforts: ["Medium", "High"],
                enabled: true,
                id: "bedrock:anthropic/sonnet-5",
                isDefault: false,
                modelId: "anthropic/sonnet-5",
                name: "Sonnet 5",
            },
        ],
        name: "Bedrock",
        serviceTiers: [],
        status: "not_authenticated",
    },
    {
        id: "vertex",
        models: [],
        name: "Vertex",
        serviceTiers: [],
        status: "not_enabled",
    },
];

const noop = () => undefined;

export function RigSettingsBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number={componentNumber}
            summary="The local workspace's settings window: a permanent category column whose heading is the way back out, and one category body beside it. Every state is prop-driven, with no daemon connection or router."
            title="Rig settings"
        >
            <FullScreenSpecimen
                detail="General category: appearance and the defaults a new local session starts with"
                label="Rig settings — general"
                number="01"
            >
                <RigSettingsShell
                    activeCategoryId="general"
                    categories={categories}
                    description="How this window looks and what a new session starts with"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="General"
                >
                    <RigGeneralSettings
                        appearance="system"
                        defaultModelKey="codex:openai/gpt-5.6-sol"
                        effort="medium"
                        effortOptions={effortOptions}
                        experimentalFeaturesEnabled
                        modelOptions={modelOptions}
                        onAppearanceChange={noop}
                        onExperimentalFeaturesChange={noop}
                        onDefaultModelChange={noop}
                        onEffortChange={noop}
                        onPermissionModeChange={noop}
                        permissionMode="auto"
                        permissionModeOptions={permissionModeOptions}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Instructions category: the machine's AGENTS.md and SECURITY.md as peer editable files"
                label="Rig settings — instructions"
                number="02"
            >
                <RigSettingsShell
                    activeCategoryId="instructions"
                    categories={categories}
                    description="Machine-wide agent guidance and permission-review policy"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Instructions"
                >
                    <RigInstructionsSettings
                        documents={[
                            {
                                bytes: instructions.length,
                                description:
                                    "Given to every agent this machine starts, on top of the project's own AGENTS.md.",
                                id: "agents",
                                label: "AGENTS.md",
                                maximumBytes: 32 * 1024,
                                onRevert: noop,
                                onSave: noop,
                                onValueChange: noop,
                                path: "~/Happy/Config/AGENTS.md",
                                placeholder: "Anything every agent on this machine should know…",
                                value: instructions,
                            },
                            {
                                bytes: 0,
                                description:
                                    "Applied when this machine reviews whether an agent action is allowed.",
                                id: "security",
                                label: "SECURITY.md",
                                maximumBytes: 32 * 1024,
                                onRevert: noop,
                                onSave: noop,
                                onValueChange: noop,
                                path: "~/Happy/Config/SECURITY.md",
                                placeholder: "Rules for deciding which agent actions are allowed…",
                                value: "",
                            },
                        ]}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Nodes category: the machines this Rig is peered with, in every link state at once, the one act that adds another, and the transport it reaches them over. A connected link, open work, and a shared API are three separate facts: the first node says all three, the second is up and deliberately not sharing."
                label="Rig settings — nodes"
                number="02a"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        hostId="desk"
                        hostName="This Mac"
                        nodes={nodes}
                        pairing={<RigPairing {...noPairing} />}
                        transports={transports}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The same category with a pairing under way. Comparing the four emojis is the trust decision, and it is taken here rather than by copying a key between machines."
                label="Rig settings — pairing under way"
                number="02e"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        hostId="desk"
                        hostName="This Mac"
                        nodes={nodes}
                        pairing={
                            <RigPairing
                                {...noPairing}
                                progress={{
                                    emojis: ["🐙", "🌵", "🔔", "🚲"],
                                    peer: { instanceId: "attic", name: "attic" },
                                    phase: "verifying",
                                    role: "inviter",
                                }}
                            />
                        }
                        transports={transports}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A Rig too old to pair says so where the control would have been, and its node list is unaffected: an older Rig still reports every machine it is already peered with."
                label="Rig settings — pairing unsupported"
                number="02f"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        hostId="desk"
                        nodes={nodes}
                        pairing={<RigPairing {...noPairing} available={false} />}
                        transports={transports}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A Rig peered with nothing says so, and its transport explains whether it could peer at all"
                label="Rig settings — no nodes"
                number="02b"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        hostId="desk"
                        nodes={[]}
                        transports={[
                            {
                                message: "Iroh is disabled in this Rig's configuration.",
                                state: "unavailable",
                                transport: "iroh",
                            },
                        ]}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Before the host's first status arrives neither section is blank and neither claims emptiness: each says what it is waiting for, and swaps for the real list when it lands"
                label="Rig settings — nodes loading"
                number="02c"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings loading nodes={[]} transports={[]} />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A status feed that dropped is said once, above the last nodes it reported, because what it already told the reader did not stop being true"
                label="Rig settings — nodes feed error"
                number="02d"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        error="Lost the status feed from this Rig."
                        hostId="desk"
                        nodes={nodes}
                        transports={transports}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Providers category: connected, unauthenticated, disabled, and model-less providers together"
                label="Rig settings — providers"
                number="03"
            >
                <RigSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Rig daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <RigProviderSettings onModelEnabledChange={noop} providers={providers} />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The catalog has not arrived yet, so both the picker and the provider list say so"
                label="Rig settings — loading"
                number="04"
            >
                <RigSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Rig daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <RigProviderSettings loading onModelEnabledChange={noop} providers={[]} />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A failed catalog read is a loud alert rather than an empty provider list"
                label="Rig settings — error"
                number="05"
            >
                <RigSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Rig daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <RigProviderSettings
                        error="The Rig daemon could not read its model catalog."
                        onModelEnabledChange={noop}
                        providers={[]}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Known Rig offline: appearance remains local, retained defaults stay visible, and daemon-backed changes wait for reconnect"
                label="Rig settings — offline"
                number="06"
            >
                <RigSettingsShell
                    activeCategoryId="general"
                    categories={categories}
                    description="How this window looks and what a new session starts with"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="General"
                >
                    <RigGeneralSettings
                        appearance="system"
                        defaultModelKey="codex:openai/gpt-5.6-sol"
                        effort="medium"
                        effortOptions={effortOptions}
                        experimentalFeaturesEnabled={false}
                        modelOptions={modelOptions}
                        onAppearanceChange={noop}
                        onDefaultModelChange={noop}
                        onEffortChange={noop}
                        onExperimentalFeaturesChange={noop}
                        onPermissionModeChange={noop}
                        permissionMode="auto"
                        permissionModeOptions={permissionModeOptions}
                        unavailable="Rig is offline. Showing the last synced defaults."
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Known Rig offline: instruction drafts remain editable and visible; Save waits for reconnect"
                label="Rig settings — instructions offline"
                number="07"
            >
                <RigSettingsShell
                    activeCategoryId="instructions"
                    categories={categories}
                    description="Machine-wide agent guidance and permission-review policy"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Instructions"
                >
                    <RigInstructionsSettings
                        documents={[
                            {
                                bytes: instructions.length,
                                description:
                                    "Given to every agent this machine starts, on top of the project's own AGENTS.md.",
                                dirty: true,
                                id: "agents",
                                label: "AGENTS.md",
                                maximumBytes: 32 * 1024,
                                onRevert: noop,
                                onSave: noop,
                                onValueChange: noop,
                                path: "~/Happy/Config/AGENTS.md",
                                placeholder: "Anything every agent on this machine should know…",
                                saveDisabled: true,
                                saveDisabledReason:
                                    "Rig is offline. Draft preserved until reconnect.",
                                value: instructions,
                            },
                        ]}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
        </ComponentPage>
    );
}

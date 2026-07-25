import { expect, it } from "vitest";
import "./theme.css";
import "./styles/onboarding-screen.css";
import "./styles/title-bar.css";
import "./styles/icon.css";
import "./styles/vector-icon.css";
import "./styles/banner.css";
import "./styles/button.css";
import { RigConnectionStatus } from "./RigConnectionStatus";
import { createRenderer } from "./testing";

const frame = { width: 760, height: 520, padding: 0 } as const;

it("shows the probe loader while the transport is still connecting", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <RigConnectionStatus
                attempt={0}
                connection="connecting"
                daemon="unknown"
                onRetry={() => undefined}
            />
        ),
        frame,
    );
    await view.ready();

    expect(view.$('[data-happy2-ui="onboarding-kicker"]').element.textContent).toBe(
        "Rig connection",
    );
    expect(view.$('[data-happy2-ui="onboarding-title"]').element.textContent).toBe(
        "Connecting to Rig.",
    );
    expect(view.$('[data-happy2-ui="onboarding-loading-label"]').element.textContent).toBe(
        "Reaching your local Rig daemon…",
    );
    // A loading card owns the body slot outright: no status banner is rendered.
    expect(view.container.querySelector('[data-happy2-ui="banner"]')).toBeNull();

    await view.screenshot("RigConnectionStatus.connecting");
}, 120_000);

it("reports daemon boot as a loading state distinct from transport connection", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <RigConnectionStatus
                attempt={0}
                connection="connected"
                daemon="starting"
                onRetry={() => undefined}
                version="1.4.2"
            />
        ),
        frame,
    );
    await view.ready();

    // Transport is live, so the kicker names the daemon rather than the connection.
    expect(view.$('[data-happy2-ui="onboarding-kicker"]').element.textContent).toBe("Rig daemon");
    expect(view.$('[data-happy2-ui="onboarding-title"]').element.textContent).toBe("Starting Rig.");
    expect(view.$('[data-happy2-ui="onboarding-loading-label"]').element.textContent).toBe(
        "Waiting for the Rig daemon to become ready…",
    );
    expect(view.container.querySelector('[data-happy2-ui="banner"]')).toBeNull();
}, 120_000);

it("counts reconnect attempts and retries on demand while disconnected", async () => {
    const retries: number[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <RigConnectionStatus
                attempt={3}
                connection="disconnected"
                daemon="unknown"
                message="connect ECONNREFUSED"
                onRetry={() => retries.push(retries.length + 1)}
            />
        ),
        frame,
    );
    await view.ready();

    expect(view.$('[data-happy2-ui="onboarding-title"]').element.textContent).toBe(
        "Rig is unreachable.",
    );
    expect(view.$('[data-happy2-ui="banner"]').element.getAttribute("data-tone")).toBe("warning");
    expect(view.$('[data-happy2-ui="banner-title"]').element.textContent).toBe(
        "Reconnecting… (attempt 3)",
    );
    // The probe failure detail is surfaced verbatim, not summarised away.
    expect(view.$('[data-happy2-ui="banner-message"]').element.textContent).toBe(
        "connect ECONNREFUSED",
    );

    const retry = view.$('[data-happy2-ui="banner-actions"] button').element as HTMLButtonElement;
    expect(
        retry.querySelector('[data-happy2-ui="button-label"]')?.textContent ?? retry.textContent,
    ).toContain("Retry now");
    retry.click();
    expect(retries).toEqual([1]);

    await view.screenshot("RigConnectionStatus.disconnected");
}, 120_000);

it("uses singular reconnect copy on the first attempt", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <RigConnectionStatus
                attempt={1}
                connection="disconnected"
                daemon="unknown"
                onRetry={() => undefined}
            />
        ),
        frame,
    );
    await view.ready();

    expect(view.$('[data-happy2-ui="banner-title"]').element.textContent).toBe(
        "Reconnecting to your local Rig daemon…",
    );
    // Without a probe message the banner still explains the failure.
    expect(view.$('[data-happy2-ui="banner-message"]').element.textContent).toBe(
        "The Rig daemon did not respond.",
    );
}, 120_000);

it("offers an explicit retry control when a reachable daemon reports an error", async () => {
    let retried = 0;
    const view = createRenderer();
    view.render(
        () => (
            <RigConnectionStatus
                attempt={0}
                connection="connected"
                daemon="error"
                message="No provider is authenticated."
                onRetry={() => {
                    retried += 1;
                }}
                version="1.4.2"
            />
        ),
        frame,
    );
    await view.ready();

    expect(view.$('[data-happy2-ui="onboarding-title"]').element.textContent).toBe(
        "Rig could not start.",
    );
    expect(view.$('[data-happy2-ui="banner"]').element.getAttribute("data-tone")).toBe("danger");
    expect(view.$('[data-happy2-ui="banner-message"]').element.textContent).toBe(
        "No provider is authenticated.",
    );
    // A daemon error is not auto-retried, so the retry lives outside the banner.
    expect(view.container.querySelector('[data-happy2-ui="banner-actions"]')).toBeNull();

    const button = view.$('[data-happy2-ui="rig-connection-status-body"] button')
        .element as HTMLButtonElement;
    expect(button.querySelector('[data-happy2-ui="button-label"]')?.textContent).toBe("Try again");
    button.click();
    expect(retried).toBe(1);

    await view.screenshot("RigConnectionStatus.daemonError");
}, 120_000);

it("confirms the connected daemon version without offering a retry", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <RigConnectionStatus
                attempt={0}
                connection="connected"
                daemon="ready"
                onRetry={() => undefined}
                version="1.4.2"
            />
        ),
        frame,
    );
    await view.ready();

    expect(view.$('[data-happy2-ui="onboarding-title"]').element.textContent).toBe("Rig is ready.");
    expect(view.$('[data-happy2-ui="banner"]').element.getAttribute("data-tone")).toBe("success");
    expect(view.$('[data-happy2-ui="banner-message"]').element.textContent).toBe(
        "Connected to Rig 1.4.2.",
    );
    // A healthy connection is informational only — nothing to retry.
    expect(
        view.container.querySelector('[data-happy2-ui="rig-connection-status-body"] button'),
    ).toBeNull();

    await view.screenshot("RigConnectionStatus.ready");
}, 120_000);

import { Badge, type BadgeVariant } from "../../Badge";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { Icon } from "../../Icon";
import { TextField } from "../../TextField";
import { RigSettingsSection } from "./RigSettingsShell";

/** Where one machine's connection actually is, independent of what was asked for. */
export type RigMachineStatus = "connecting" | "connected" | "disconnected" | "error";

export interface RigMachineRow {
    readonly id: string;
    readonly label: string;
    /** The machine this window runs on, which is neither disconnectable nor removable. */
    readonly local: boolean;
    /** The address a remote machine's Rig answers on; absent for this machine. */
    readonly endpoint?: string;
    /** The reader's standing intent, which a failed connection does not change. */
    readonly connected: boolean;
    readonly status: RigMachineStatus;
    readonly message?: string;
    readonly version?: string;
    readonly projectCount: number;
}

export interface RigMachineDraft {
    readonly endpoint: string;
    readonly label: string;
    readonly token: string;
    readonly error?: string;
}

export type RigMachineSettingsProps = {
    machines: readonly RigMachineRow[];
    draft: RigMachineDraft;
    /** Set while the add form is being submitted, so it says so and cannot resubmit. */
    adding?: boolean;
    onEndpointChange: (value: string) => void;
    onLabelChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onAdd: () => void;
    onConnect: (id: string) => void;
    onDisconnect: (id: string) => void;
    onForget: (id: string) => void;
};

const STATUS_LABELS: Record<RigMachineStatus, string> = {
    connecting: "Connecting",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Not reachable",
};

const STATUS_VARIANTS: Record<RigMachineStatus, BadgeVariant> = {
    connecting: "neutral",
    connected: "success",
    disconnected: "neutral",
    error: "warning",
};

/**
 * The Machines category: every Rig this window can work in, and the form that
 * adds another one. A machine is reached with an endpoint and a token and
 * nothing else, so that pair is the whole form.
 *
 * Connecting and disconnecting live here rather than in the sidebar because they
 * are deliberate, infrequent acts about a machine rather than about the work in
 * it — the sidebar shows what each connected machine currently holds. This
 * machine is listed alongside the rest so the set reads as one place, but it has
 * no controls: it is where the window is running.
 */
export function RigMachineSettings(props: RigMachineSettingsProps) {
    const submittable =
        !props.adding &&
        props.draft.endpoint.trim().length > 0 &&
        props.draft.token.trim().length > 0;
    return (
        <>
            <RigSettingsSection
                description="Each machine runs its own Rig. Its projects appear in the sidebar beside this machine's."
                rows="cards"
                title="Machines"
            >
                {props.machines.map((machine) => (
                    <article
                        className="happy2-rig-machine"
                        data-happy2-ui="rig-machine"
                        data-status={machine.status}
                        key={machine.id}
                    >
                        <header className="happy2-rig-machine__header">
                            <Box className="happy2-rig-machine__identity">
                                <span
                                    className="happy2-rig-machine__glyph"
                                    data-happy2-ui="rig-machine-glyph"
                                >
                                    <Icon name={machine.local ? "home" : "link"} size={16} />
                                </span>
                                <Box className="happy2-rig-machine__naming">
                                    <span
                                        className="happy2-rig-machine__name"
                                        data-happy2-ui="rig-machine-name"
                                    >
                                        {machine.label}
                                    </span>
                                    <span
                                        className="happy2-rig-machine__meta"
                                        data-happy2-ui="rig-machine-meta"
                                    >
                                        {machineMeta(machine)}
                                    </span>
                                </Box>
                            </Box>
                            <Badge
                                label={STATUS_LABELS[machine.status]}
                                variant={STATUS_VARIANTS[machine.status]}
                            />
                        </header>
                        {machine.message ? (
                            <p
                                className="happy2-rig-machine__message"
                                data-happy2-ui="rig-machine-message"
                            >
                                {machine.message}
                            </p>
                        ) : null}
                        {machine.local ? null : (
                            <Box className="happy2-rig-machine__actions">
                                <Button
                                    onClick={() =>
                                        machine.connected
                                            ? props.onDisconnect(machine.id)
                                            : props.onConnect(machine.id)
                                    }
                                    size="small"
                                    variant={machine.connected ? "ghost" : "primary"}
                                >
                                    {machine.connected ? "Disconnect" : "Connect"}
                                </Button>
                                <Button
                                    onClick={() => props.onForget(machine.id)}
                                    size="small"
                                    variant="ghost"
                                >
                                    Forget
                                </Button>
                            </Box>
                        )}
                    </article>
                ))}
            </RigSettingsSection>
            <RigSettingsSection
                description="A remote Rig is reached with the address it answers on and the token it accepts."
                rows="cards"
                title="Connect a remote Rig"
            >
                <Box className="happy2-rig-machine__form" data-happy2-ui="rig-machine-form">
                    {props.draft.error ? <Banner tone="danger">{props.draft.error}</Banner> : null}
                    <TextField
                        autoComplete="off"
                        fullWidth
                        hint="The address the other machine's Rig answers on."
                        label="Endpoint"
                        leadingIcon="link"
                        onSubmit={() => (submittable ? props.onAdd() : undefined)}
                        onValueChange={props.onEndpointChange}
                        placeholder="http://desk.local:4711"
                        value={props.draft.endpoint}
                    />
                    <TextField
                        autoComplete="off"
                        fullWidth
                        hint="The token that Rig accepts."
                        label="Token"
                        leadingIcon="lock"
                        onSubmit={() => (submittable ? props.onAdd() : undefined)}
                        onValueChange={props.onTokenChange}
                        type="password"
                        value={props.draft.token}
                    />
                    <TextField
                        autoComplete="off"
                        fullWidth
                        hint="What this machine is called in the sidebar."
                        label="Name"
                        leadingIcon="inbox"
                        onSubmit={() => (submittable ? props.onAdd() : undefined)}
                        onValueChange={props.onLabelChange}
                        placeholder="Optional"
                        value={props.draft.label}
                    />
                    <Box className="happy2-rig-machine__form-actions">
                        <Button disabled={!submittable} onClick={props.onAdd} variant="primary">
                            {props.adding ? "Connecting…" : "Connect"}
                        </Button>
                    </Box>
                </Box>
            </RigSettingsSection>
        </>
    );
}

function machineMeta(machine: RigMachineRow): string {
    const projects = `${machine.projectCount} ${machine.projectCount === 1 ? "project" : "projects"}`;
    const parts = [machine.local ? "This machine" : (machine.endpoint ?? "")].filter(Boolean);
    if (machine.version) parts.push(`Rig ${machine.version}`);
    parts.push(projects);
    return parts.join("  —  ");
}

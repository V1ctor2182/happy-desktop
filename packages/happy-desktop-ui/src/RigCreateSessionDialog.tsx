import type { CSSProperties, KeyboardEvent } from "react";
import { useCallback } from "react";
import type {
    RigMenusSnapshot,
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigThinkingLevel,
} from "happy-desktop-state";
import { Banner } from "./Banner";
import { KeyCap } from "./Badge";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Modal } from "./Modal";
import { ModalOverlay } from "./ModalOverlay";
import { Select, type SelectOption } from "./Select";

/**
 * Separator between provider and model in a select option value. A space is
 * safe: neither a provider nor a model identifier contains one.
 */
const MODEL_VALUE_SEP = " ";
/** Stands for "no tier chosen", which a select cannot express as undefined. */
const SERVICE_TIER_OFF = "__rig_service_tier_off__";

/** One place a session can be started: a project, or a worktree inside one. */
export interface RigCreateSessionDestination {
    readonly id: string;
    readonly label: string;
    /**
     * The project a worktree belongs to. Absent on a project itself, so the
     * list can say "happy2 · review-fixes" rather than a bare worktree name
     * that means nothing on its own.
     */
    readonly parentLabel?: string;
    /** Where a session started here runs, as the host presents the path. */
    readonly displayPath: string;
}

export type RigCreateSessionDialogProps = {
    /** Every project and worktree offered, in the order the sidebar lists them. */
    destinations: readonly RigCreateSessionDestination[];
    /** The one chosen; absent while the machine has offered nothing to choose. */
    destinationId?: string;
    /** True while the machine's project list is still being read. */
    destinationsLoading?: boolean;
    /** The task. Owned by the caller, so it survives this being re-rendered. */
    text: string;
    /** Model, effort, access, and speed options; absent until the catalog is read. */
    menus?: RigMenusSnapshot;
    /** Whether the dialog stays open, cleared, after a session starts. */
    keepOpen: boolean;
    /** True while a session is being started: the surface stays up and inert. */
    submitting?: boolean;
    /** A failed start, stated here rather than thrown away. */
    error?: string;
    /** Why the draft cannot currently be submitted to its Rig. */
    submitDisabledReason?: string;
    onDestinationSelect: (id: string) => void;
    onTextChange: (text: string) => void;
    onKeepOpenChange: (keepOpen: boolean) => void;
    onModelChange: (selection: RigModelSelection) => void;
    onEffortChange: (effort?: RigThinkingLevel) => void;
    onPermissionModeChange: (mode: RigPermissionMode) => void;
    onServiceTierChange: (tier?: RigServiceTier) => void;
    onSubmit: () => void;
    onClose: () => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/** A destination's full name: the worktree under the project that holds it. */
function destinationLabel(destination: RigCreateSessionDestination): string {
    return destination.parentLabel
        ? `${destination.parentLabel} · ${destination.label}`
        : destination.label;
}

/** What sits under the destination once one is chosen, or in place of one. */
function destinationDetail(
    chosen: RigCreateSessionDestination | undefined,
    loading: boolean,
): string {
    if (chosen) return chosen.displayPath;
    return loading
        ? "Reading this machine's projects…"
        : "This machine has no project to start a session in.";
}

/**
 * C-238 RigCreateSessionDialog — the window's global "Create": what to do, where
 * to do it, and how the session that does it is configured, all decided in one
 * place before anything is started.
 *
 * It is a command surface rather than a form. The task takes the full width and
 * eight reading lines at the top, because writing it is the whole reason the
 * dialog is open; where it runs and how it is configured are two quiet rows
 * beneath it, and the commit sits in the footer with its chord beside it. The
 * large (640px) card is what makes that possible — a task worth starting a
 * session for rarely fits on one line.
 *
 * Every choice is a native select rather than a popover menu. This card is a
 * clipping boundary — the modal body is a scrollport and the dialog hides its
 * own overflow — so a popover long enough to hold a model catalog would be cut
 * off by the surface it opens in, while a native list is drawn by the platform
 * and can always be read.
 *
 * Props only, and every state is directly renderable: empty, written, a task too
 * long for the field, a machine still reading its projects, a machine with none,
 * a start in flight, and a start that failed. The draft belongs to the caller,
 * so neither a re-render nor the surface behind this one can take it away.
 */
export function RigCreateSessionDialog(props: RigCreateSessionDialogProps) {
    // Opening puts the caret in the field, and behind whatever is already
    // written: a task offered back from a previous open is one to carry on with,
    // not one to type in front of. A stable callback rather than an inline one
    // so React runs it when the field appears rather than on every render.
    const promptMount = useCallback((node: HTMLTextAreaElement | null) => {
        if (!node) return;
        node.focus();
        node.setSelectionRange(node.value.length, node.value.length);
    }, []);
    const submitting = props.submitting === true;
    const loading = props.destinationsLoading === true;
    const menus = props.menus;
    const chosen = props.destinations.find((destination) => destination.id === props.destinationId);
    // A task with nothing written and nowhere to run is not a session waiting to
    // start, and the commit says so by staying inert rather than failing when used.
    const submittable =
        props.text.trim().length > 0 &&
        chosen !== undefined &&
        !submitting &&
        props.submitDisabledReason === undefined;
    const destinationOptions: SelectOption[] = props.destinations.map((destination) => ({
        label: destinationLabel(destination),
        value: destination.id,
    }));
    const modelOptions: SelectOption[] = (menus?.modelOptions ?? []).map((option) => ({
        label: option.name,
        value: `${option.providerId}${MODEL_VALUE_SEP}${option.modelId}`,
        ...(option.disabled ? { disabled: true } : {}),
    }));
    const effortOptions: SelectOption[] = (menus?.effortOptions ?? []).map((option) => ({
        label: option.isDefault ? `${option.label} (default)` : option.label,
        value: option.level,
    }));
    const permissionOptions: SelectOption[] = (menus?.permissionModeOptions ?? []).map(
        (option) => ({
            label: option.label,
            value: option.mode,
        }),
    );
    const tierOptions: SelectOption[] = (menus?.serviceTierOptions ?? []).map((option) => ({
        label: option.label,
        value: option.tier ?? SERVICE_TIER_OFF,
    }));
    const currentModel = menus?.modelOptions.find((option) => option.current);
    const currentEffort = menus?.effortOptions.find((option) => option.current);
    const currentTier = menus?.serviceTierOptions.find((option) => option.current);
    const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        // Enter writes a new line — a task is prose — so starting the session
        // takes the deliberate chord, the same one the composer sends with.
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (submittable) props.onSubmit();
    };
    return (
        <ModalOverlay onDismiss={() => props.onClose()}>
            <Modal
                className={props.className}
                data-testid={props["data-testid"]}
                footer={
                    <div
                        className="happy2-rig-create-session__footer"
                        data-happy-desktop-ui="rig-create-session-footer"
                    >
                        {/* Filing several tasks at once should not mean reopening
                            this between each one, so the setting sits with the
                            commit whose outcome it changes. */}
                        <Checkbox
                            checked={props.keepOpen}
                            disabled={submitting}
                            label="Keep open for the next task"
                            onChange={(checked) => props.onKeepOpenChange(checked)}
                        />
                        <div
                            className="happy2-rig-create-session__actions"
                            data-happy-desktop-ui="rig-create-session-actions"
                        >
                            <span
                                className="happy2-rig-create-session__chord"
                                data-happy-desktop-ui="rig-create-session-chord"
                            >
                                <KeyCap keys="⌘ENTER" />
                            </span>
                            {/* Not inert while starting: the close in the header
                                and the backdrop both still dismiss, and the task
                                is kept whichever one is used, so a Cancel that
                                went inert beside them would be the odd one out. */}
                            <Button onClick={() => props.onClose()} variant="ghost">
                                Cancel
                            </Button>
                            <Button
                                disabled={!submittable}
                                onClick={() => props.onSubmit()}
                                title={props.submitDisabledReason}
                                variant="primary"
                            >
                                {submitting ? "Starting…" : "Create"}
                            </Button>
                        </div>
                    </div>
                }
                icon="spark"
                onClose={() => props.onClose()}
                size="large"
                style={props.style}
                title="New session"
            >
                <div
                    className="happy2-rig-create-session"
                    data-happy-desktop-ui="rig-create-session"
                >
                    {props.submitDisabledReason ? (
                        <Banner tone="neutral" title="Rig reconnecting">
                            {props.submitDisabledReason}
                        </Banner>
                    ) : null}
                    <div
                        className="happy2-rig-create-session__prompt"
                        data-happy-desktop-ui="rig-create-session-prompt"
                    >
                        <textarea
                            aria-label="Task"
                            className="happy2-rig-create-session__input"
                            data-happy-desktop-ui="rig-create-session-input"
                            onInput={(event) => props.onTextChange(event.currentTarget.value)}
                            onKeyDown={onPromptKeyDown}
                            placeholder="What should the agent do?"
                            // Read-only rather than disabled while a start is in
                            // flight: the task stays selectable and the caret
                            // stays in it, so a start that fails is carried on
                            // with rather than found again.
                            readOnly={submitting}
                            ref={promptMount}
                            value={props.text}
                        />
                    </div>
                    <div
                        className="happy2-rig-create-session__where"
                        data-happy-desktop-ui="rig-create-session-where"
                    >
                        <Select
                            className="happy2-rig-create-session__destination"
                            data-testid="rig-create-session-destination"
                            disabled={submitting || destinationOptions.length === 0}
                            label="Project"
                            onValueChange={(value) => props.onDestinationSelect(value)}
                            options={destinationOptions}
                            placeholder={loading ? "Reading projects…" : "Choose a project"}
                            size="small"
                            {...(props.destinationId === undefined
                                ? {}
                                : { value: props.destinationId })}
                        />
                        <span
                            className="happy2-rig-create-session__path"
                            data-happy-desktop-ui="rig-create-session-path"
                            title={chosen?.displayPath}
                        >
                            {destinationDetail(chosen, loading)}
                        </span>
                    </div>
                    <div
                        className="happy2-rig-create-session__how"
                        data-happy-desktop-ui="rig-create-session-how"
                    >
                        <Select
                            className="happy2-rig-create-session__model"
                            data-testid="rig-create-session-model"
                            disabled={submitting || modelOptions.length === 0}
                            label="Model"
                            onValueChange={(value) => {
                                const [providerId, modelId] = value.split(MODEL_VALUE_SEP);
                                if (modelId) props.onModelChange({ providerId, modelId });
                            }}
                            options={modelOptions}
                            placeholder="Reading models…"
                            size="small"
                            {...(currentModel
                                ? {
                                      value: `${currentModel.providerId}${MODEL_VALUE_SEP}${currentModel.modelId}`,
                                  }
                                : {})}
                        />
                        <Select
                            data-testid="rig-create-session-effort"
                            disabled={submitting || effortOptions.length === 0}
                            label="Effort"
                            onValueChange={(value) =>
                                props.onEffortChange(value as RigThinkingLevel)
                            }
                            options={effortOptions}
                            placeholder="—"
                            size="small"
                            {...(currentEffort ? { value: currentEffort.level } : {})}
                        />
                        <Select
                            data-testid="rig-create-session-permission"
                            disabled={submitting || permissionOptions.length === 0}
                            label="Access"
                            onValueChange={(value) =>
                                props.onPermissionModeChange(value as RigPermissionMode)
                            }
                            options={permissionOptions}
                            placeholder="—"
                            size="small"
                            {...(menus ? { value: menus.currentPermissionMode } : {})}
                        />
                        {/* Speed is a choice only where the provider offers a fast
                            tier. On a standard-only model the list would hold one
                            unchangeable row, so the control is absent rather than
                            shown as a decision nobody can make. */}
                        {tierOptions.length > 1 ? (
                            <Select
                                data-testid="rig-create-session-tier"
                                disabled={submitting}
                                label="Speed"
                                onValueChange={(value) =>
                                    props.onServiceTierChange(
                                        value === SERVICE_TIER_OFF
                                            ? undefined
                                            : (value as RigServiceTier),
                                    )
                                }
                                options={tierOptions}
                                size="small"
                                value={currentTier?.tier ?? SERVICE_TIER_OFF}
                            />
                        ) : null}
                    </div>
                    {props.error ? <Banner tone="danger">{props.error}</Banner> : null}
                </div>
            </Modal>
        </ModalOverlay>
    );
}

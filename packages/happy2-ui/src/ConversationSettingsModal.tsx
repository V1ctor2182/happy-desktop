import { type CSSProperties, type ReactNode } from "react";
import { Modal } from "./Modal";
import { ModalOverlay } from "./ModalOverlay";
import { Switch } from "./Switch";

export type ConversationSettingsModalProps = {
    /** Whether thinking/reasoning entries are visible in the transcript. */
    showReasoning: boolean;
    onShowReasoningChange: (value: boolean) => void;
    /** Whether completed turns collapse to their summary line. */
    compactTurns: boolean;
    onCompactTurnsChange: (value: boolean) => void;
    /** Whether the token-usage panel replaces the transcript. */
    usageOpen: boolean;
    onUsageOpenChange: (value: boolean) => void;
    /** Whether the goal/tasks/subagents activity panel replaces the transcript. */
    activityOpen: boolean;
    onActivityOpenChange: (value: boolean) => void;
    /**
     * Session controls the owning surface still holds — the access and speed
     * pickers for a local session. Supplied as a slot so this dialog stays free
     * of any one stack's menu vocabulary.
     */
    controls?: ReactNode;
    onClose: () => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * ConversationSettingsModal — the per-conversation settings dialog: the
 * transcript view toggles, the two replaceable panels, and an owner-supplied
 * slot for the session's own pickers.
 *
 * These controls are session preferences, not primary actions, so they live one
 * click away behind a composer affordance instead of occupying a permanent row
 * of header buttons. It is props-only: the open decision, every current value,
 * and every change belong to the surface that hosts it.
 */
export function ConversationSettingsModal(props: ConversationSettingsModalProps) {
    return (
        <ModalOverlay data-testid={props["data-testid"]} onDismiss={props.onClose}>
            <Modal
                className={props.className}
                icon="settings"
                onClose={props.onClose}
                size="medium"
                style={props.style}
                title="Session settings"
            >
                <div
                    className="happy2-conversation-settings"
                    data-happy2-ui="conversation-settings"
                >
                    <div
                        className="happy2-conversation-settings__group"
                        data-happy2-ui="conversation-settings-group"
                    >
                        <span
                            className="happy2-conversation-settings__label"
                            data-happy2-ui="conversation-settings-label"
                        >
                            Transcript
                        </span>
                        <Switch
                            checked={props.showReasoning}
                            data-testid="conversation-settings-reasoning"
                            description="Show the agent's thinking blocks inline."
                            label="Thinking"
                            onChange={props.onShowReasoningChange}
                        />
                        <Switch
                            checked={props.compactTurns}
                            data-testid="conversation-settings-compact"
                            description="Collapse a finished turn to its summary line."
                            label="Compact turns"
                            onChange={props.onCompactTurnsChange}
                        />
                    </div>
                    <div
                        className="happy2-conversation-settings__group"
                        data-happy2-ui="conversation-settings-group"
                    >
                        <span
                            className="happy2-conversation-settings__label"
                            data-happy2-ui="conversation-settings-label"
                        >
                            Panels
                        </span>
                        <Switch
                            checked={props.usageOpen}
                            data-testid="conversation-settings-usage"
                            description="Token and cost usage for this session."
                            label="Usage"
                            onChange={props.onUsageOpenChange}
                        />
                        <Switch
                            checked={props.activityOpen}
                            data-testid="conversation-settings-activity"
                            description="Goal, tasks, subagents, and background processes."
                            label="Activity"
                            onChange={props.onActivityOpenChange}
                        />
                    </div>
                    {props.controls ? (
                        <div
                            className="happy2-conversation-settings__group"
                            data-happy2-ui="conversation-settings-group"
                        >
                            <span
                                className="happy2-conversation-settings__label"
                                data-happy2-ui="conversation-settings-label"
                            >
                                Session
                            </span>
                            {props.controls}
                        </div>
                    ) : null}
                </div>
            </Modal>
        </ModalOverlay>
    );
}

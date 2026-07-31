import { type CSSProperties, type ReactNode } from "react";
import type { ComposerSnapshot } from "happy2-state";
import { Banner } from "./Banner";
import { commandPickerItems } from "./CommandPicker";
import { Composer, type ContextItem, type Mentionable } from "./Composer";

export type ConversationDockProps = {
    className?: string;
    /** The composer surface snapshot; the draft never lives in this component. */
    composer: ComposerSnapshot;
    /** Controls rendered inside the composer toolbar, beside the send control. */
    composerControls?: ReactNode;
    /** Accessory rendered below the composer card. */
    composerFooterControl?: ReactNode;
    composerPlaceholder?: string;
    /** Makes this composer the last resort for typing; see `Composer.focusOnType`. */
    composerFocusOnType?: boolean;
    "data-testid"?: string;
    /** Stops the current run; the send control becomes this while running. */
    onAbort?: () => void;
    onCommandInvoke?: (commandId: string) => void;
    onComposerAttachmentRemove?: (attachmentId: string) => void;
    onComposerAttachmentsSelect?: (files: File[]) => void;
    onComposerFocusChange?: (focused: boolean) => void;
    onComposerSend: () => void;
    onComposerValueChange: (value: string) => void;
    running?: boolean;
    style?: CSSProperties;
};

/** The draft's attachments as composer chips; an image chip carries its size. */
function contextItemsOf(composer: ComposerSnapshot): ContextItem[] {
    return composer.attachments.map((attachment) => ({
        id: attachment.id,
        kind: "file",
        label: attachment.name,
        detail: attachmentSizeFormat(attachment.size),
    }));
}

function attachmentSizeFormat(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mentionsOf(composer: ComposerSnapshot): Mentionable[] {
    return composer.mentionCandidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.label,
        initials: candidate.label.slice(0, 1).toUpperCase(),
        kind: "document",
        ...(candidate.detail ? { description: candidate.detail } : {}),
    }));
}

/**
 * The write end of a conversation: the failed-submission banner and the
 * `Composer` itself, stacked in one measure-width column.
 *
 * It is its own component because a conversation is not the only place one is
 * written from. The expanded workspace panel floats the same dock over whatever
 * it is showing, and it must be the identical control — same draft bindings, same
 * command picker, same attachment chips — rather than a second composer that
 * drifts.
 */
export function ConversationDock(props: ConversationDockProps) {
    const composer = props.composer;
    /*
     * The draft is the query: the store hands over a command query only while the
     * whole draft is one command word that something still matches, so the list
     * below is either the commands being chosen between or empty.
     */
    const commandItems =
        composer.commandQuery === undefined || props.onCommandInvoke === undefined
            ? []
            : commandPickerItems(composer.capabilities.commands).filter((item) =>
                  item.slash
                      .slice(1)
                      .toLowerCase()
                      .startsWith(composer.commandQuery!.toLowerCase()),
              );
    const sendEnabled = composer.text.trim().length > 0 || composer.attachments.length > 0;
    return (
        <div
            className={["happy2-conversation__dock", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="conversation-dock"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            {composer.submission.status === "failed" ? (
                <Banner
                    action={{ label: "Retry", onClick: props.onComposerSend }}
                    data-testid="conversation-submission-error"
                    tone="danger"
                    title="Message not sent"
                >
                    {composer.submission.error.message}
                </Banner>
            ) : null}
            <div className="happy2-conversation__dock-inner">
                <Composer
                    attachmentMultiple
                    commands={commandItems}
                    contextItems={contextItemsOf(composer)}
                    focusOnType={props.composerFocusOnType}
                    hint={composer.shellCommand !== undefined ? "Enter to run" : "Enter to send"}
                    mentions={mentionsOf(composer)}
                    footerControl={props.composerFooterControl}
                    modelControl={props.composerControls}
                    onAttachmentsSelect={props.onComposerAttachmentsSelect}
                    onCommandSelect={(commandId) => props.onCommandInvoke?.(commandId)}
                    onContextRemove={props.onComposerAttachmentRemove}
                    onFocusChange={props.onComposerFocusChange}
                    onSend={props.onComposerSend}
                    onStop={props.onAbort}
                    onValueChange={props.onComposerValueChange}
                    pending={composer.submission.status === "pending"}
                    placeholder={props.composerPlaceholder ?? "Message the agent…"}
                    running={props.running}
                    sendEnabled={sendEnabled}
                    value={composer.text}
                />
            </div>
        </div>
    );
}

export type FloatingConversationDockProps = {
    children: ReactNode;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * Floats a `ConversationDock` over a surface that owns its own scrolling — the
 * expanded workspace panel, whose body is a file tree, a diff, or a live
 * terminal.
 *
 * The dock leaves the flow deliberately: the surface underneath keeps its full
 * height, so it neither reflows nor loses its last lines as the dock appears. A
 * gradient carries the surface colour up behind the dock so content passing under
 * it fades out instead of being sliced by a hard edge, and only the dock itself
 * takes pointer input — the faded band above it stays the surface's own.
 */
export function FloatingConversationDock(props: FloatingConversationDockProps) {
    return (
        <div
            className={["happy2-floating-dock", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="floating-dock"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div
                aria-hidden="true"
                className="happy2-floating-dock__scrim"
                data-happy2-ui="floating-dock-scrim"
            />
            <div className="happy2-floating-dock__measure" data-happy2-ui="floating-dock-measure">
                {props.children}
            </div>
        </div>
    );
}

export type ComposerFooterBarProps = {
    className?: string;
    "data-testid"?: string;
    /** Sits at the start of the row: the session's own controls. */
    leading?: ReactNode;
    style?: CSSProperties;
    /** Sits at the end of the row: what the message is being written into. */
    trailing?: ReactNode;
};

/**
 * Splits the composer's footer accessory row in two. The controls that shape the
 * message lead; the control that names where it is going trails, at the far edge,
 * because it answers a different question and must not be mistaken for one more
 * setting in the run.
 */
export function ComposerFooterBar(props: ComposerFooterBarProps) {
    return (
        <div
            className={["happy2-composer-footer-bar", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="composer-footer-bar"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-composer-footer-bar__group">{props.leading}</div>
            <div className="happy2-composer-footer-bar__group">{props.trailing}</div>
        </div>
    );
}

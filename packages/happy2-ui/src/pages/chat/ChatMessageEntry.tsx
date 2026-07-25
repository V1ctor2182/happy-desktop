import { type ReactNode } from "react";
import type { InfoPanelProfile, MenuItem, MessageImage } from "./ChatPageComponents.js";
import {
    AgentActivityRow,
    AgentTraceRow,
    DayDivider,
    FileAttachment,
    Message,
    SystemNotice,
} from "./ChatPageComponents.js";
import { emojiItems, type LiveChatMessage, type WorkspaceEntry } from "./chatPageModels.js";
export interface ChatMessageEntryProps {
    entry: WorkspaceEntry;
    /** Layout class for this row's place in the transcript, e.g. prose resuming under tool steps. */
    className?: string;
    grouped: boolean;
    /** The entry is the viewer's own message → right-aligned accent bubble. */
    own?: boolean;
    audienceLabel?: string;
    avatarUrl?: string;
    images: MessageImage[];
    menuItems: MenuItem[];
    profile?: InfoPanelProfile;
    files: Array<{
        name: string;
        kind: "file" | "photo" | "video" | "gif";
        size: string;
        onOpen: () => void;
    }>;
    /** This turn's steps are listed above the message right now. */
    traceOpen?: boolean;
    /**
     * Interactive MCP App surfaces attached to this assistant message, supplied
     * by the application because each owns its own materialized surface store.
     */
    appNodes?: ReactNode;
    /**
     * Native plugin message-menu contribution triggers for this message, supplied
     * by the application and bound to this message's id.
     */
    menuContributions?: ReactNode;
    onProfileOpen(profile: InfoPanelProfile): void;
    onImageOpen(message: LiveChatMessage, imageId: string): void;
    onMenuSelect(message: LiveChatMessage, action: string): void;
    onReactionSelect(message: LiveChatMessage, emoji: string): void;
    onTraceSelect?(message: LiveChatMessage): void;
}
export function ChatMessageEntry(props: ChatMessageEntryProps): ReactNode {
    const entry = props.entry;
    if (entry.kind === "divider") return <DayDivider label={entry.label} />;
    if (entry.kind === "notice") return <SystemNotice icon={entry.icon} text={entry.text} />;
    if (entry.kind === "traceStep")
        return <AgentActivityRow activity={entry.activity} className={props.className} />;
    /* A running turn needs no status row of its own: its steps are listed in the
       transcript as it works. Once the turn ends they fold away behind the
       compact "View traces" link on the line that opened the turn, which toggles
       the same steps back into place. A turn that did no work anyone can open —
       it only answered — carries no link at all. */
    const trace = entry.agentTrace;
    const traceCollapsible =
        trace !== undefined &&
        trace.status !== "pending" &&
        trace.status !== "running" &&
        trace.entryCount > 0;
    const traceToggle = props.onTraceSelect ? () => props.onTraceSelect!(entry) : undefined;
    return (
        <Message
            agent={entry.agent}
            className={props.className}
            audienceLabel={props.audienceLabel}
            author={entry.author}
            automated={entry.automated}
            body={entry.body}
            contributions={props.menuContributions}
            deliveryState={entry.delivery ?? (entry.id.startsWith("local:") ? "sending" : "sent")}
            generationStatus={entry.generationStatus}
            grouped={props.grouped}
            gutterTime={entry.gutterTime}
            imageUrl={props.avatarUrl}
            images={props.images}
            initials={entry.initials}
            menuItems={props.menuItems}
            metaAccessory={
                traceCollapsible && trace ? (
                    <AgentTraceRow
                        entryCount={trace.entryCount}
                        onOpen={traceToggle}
                        open={props.traceOpen}
                        status={trace.status === "failed" ? "failed" : "complete"}
                        toggles
                        toolCallCount={trace.toolCallCount}
                        totalTokens={trace.totalTokens}
                        variant="meta"
                    />
                ) : undefined
            }
            onAuthorSelect={props.profile ? () => props.onProfileOpen(props.profile!) : undefined}
            onImageOpen={(id) => props.onImageOpen(entry, id)}
            onMenuSelect={(action) => props.onMenuSelect(entry, action)}
            onReactionSelect={(emoji) => props.onReactionSelect(entry, emoji)}
            own={props.own}
            /* An agent turn is a transcript of work, not a post: it carries no
               reaction picker and no message menu, so hovering a step or a reply
               never offers to react to the machine. */
            reactionOptions={entry.agent ? undefined : emojiItems}
            reactions={entry.agent ? undefined : entry.reactions}
            time={entry.time}
            tone={entry.tone}
        >
            {props.files.map((file) => (
                <FileAttachment
                    aria-label={`Download ${file.name}`}
                    key={file.name}
                    kind={file.kind}
                    name={file.name}
                    onOpen={file.onOpen}
                    size={file.size}
                    variant="chat"
                />
            ))}
            {props.appNodes}
        </Message>
    );
}

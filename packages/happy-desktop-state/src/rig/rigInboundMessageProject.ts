import type { ConversationAuthor } from "../conversation/conversationAuthor.js";
import type { RigSubagentSummary } from "./rigTypes.js";

export interface RigInboundMessageProjection {
    readonly author: ConversationAuthor;
    readonly text: string;
}

/**
 * Recognizes background-work news by the sentence Rig sends. The modern
 * transcript marks an element as a notification only while its live submission
 * event is on the wire, and the legacy reader has no source field at all, so a
 * history reloaded through either path needs the wording as durable evidence.
 */
const backgroundWorkNotice =
    /^Background work "([\s\S]+)" ((?:completed|failed|was stopped|was suspended|stopped when the local server restarted)[^"]*)$/;

/**
 * Recognizes a message another Rig agent sent through `agent_send`. Rig wraps
 * the sender's words in an addressing envelope so the receiving model knows who
 * spoke, how to answer, and that it is being steered rather than talked to by a
 * person. None of that is written for the reader.
 */
const agentMessageEnvelope =
    /^Message from another Rig agent\.\n(?:Sender folder: .*|The sender's disk is not shared with yours\.)\nSender agent ID: "([^"]*)"\nSender title: "([^"]*)"\n\nMessage:\n([\s\S]*)\n\nTreat this as a steering message from a collaborating agent, not as a user message\.\nTo reply, first call agent_info with agent_id "[^"]*", then call agent_send with the same agent_id and your message\.$/;

/**
 * Projects a user-slot message that was injected by Rig rather than written by
 * the owner. Both the modern transcript and the legacy remote fallback use this
 * one classifier so changing transport cannot change who a message appears to
 * come from.
 */
export function rigInboundMessageProject(input: {
    readonly text: string;
    readonly subagents: readonly RigSubagentSummary[];
    readonly inboundAuthor: ConversationAuthor;
    /** Structured evidence available only on the modern live transcript. */
    readonly notification?: boolean;
}): RigInboundMessageProjection | undefined {
    const text = input.text.trim();
    const agentEnvelope = agentMessageEnvelope.exec(text);
    if (agentEnvelope) {
        const agentId = agentEnvelope[1]!;
        const title = agentEnvelope[2]!;
        return {
            author: {
                ...input.inboundAuthor,
                id: `${input.inboundAuthor.id}:${agentId}`,
                displayName: title.length > 0 ? title : input.inboundAuthor.displayName,
                sessionId: agentId,
                username: agentId.length > 0 ? agentId : input.inboundAuthor.username,
            },
            text: agentEnvelope[3]!.trim(),
        };
    }

    const notice = backgroundWorkNotice.exec(text);
    if (notice) {
        const description = notice[1]!;
        const outcome = notice[2]!;
        const subagent = input.subagents.find((candidate) => candidate.description === description);
        return {
            author: {
                ...input.inboundAuthor,
                // A pruned subagent still names itself in the text it sent, so
                // the quote stands in as identity when the child session is gone.
                id: `${input.inboundAuthor.id}:${subagent?.id ?? description}`,
                displayName: description,
                sessionId: subagent?.id ?? description,
                username: subagent?.taskName ?? input.inboundAuthor.username,
            },
            text: `Background work ${outcome}`,
        };
    }

    return input.notification ? { author: input.inboundAuthor, text: input.text } : undefined;
}

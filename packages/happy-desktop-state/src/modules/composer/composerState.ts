import { createStore, type StoreApi } from "zustand/vanilla";
import { type MessageAudience, type UserError } from "../../types.js";

/** One slash command a composer may offer while the draft begins with `/`. */
export interface ComposerCommand {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
}

/** One `@`-mention candidate offered for the active mention token. */
export interface ComposerMention {
    readonly id: string;
    readonly label: string;
    readonly detail?: string;
}

/**
 * What this composer can do beyond sending a message, as a closed capability
 * set rather than optional escape hatches. A capability that is off contributes
 * no derived state and no output: a `!` draft in a composer without shell mode
 * is just text.
 */
export interface ComposerCapabilities {
    /** A `!`-prefixed draft runs a workspace command instead of sending a message. */
    readonly shellMode: boolean;
    /** Commands offered while the draft begins with `/`; empty disables the palette. */
    readonly commands: readonly ComposerCommand[];
    /** A trailing `@token` opens mention candidates supplied by the owner. */
    readonly mentions: boolean;
}

export const composerCapabilitiesNone: ComposerCapabilities = {
    shellMode: false,
    commands: [],
    mentions: false,
};

/** One local file or image attachment waiting with its draft. */
export type ComposerAttachment =
    | {
          readonly kind: "inlineImage";
          /** Client-minted; unique within this draft only. */
          readonly id: string;
          readonly name: string;
          readonly size: number;
          readonly mediaType: string;
          /** Browser-owned source bytes, encoded only when the draft is submitted. */
          readonly file: File;
          /** Object URL for the thumbnail; owned by the workspace store. */
          readonly previewUrl?: string;
      }
    | {
          /**
           * A file the agent should read rather than look at. Only an image can be
           * handed to a model inline, so anything else travels as a copy written
           * into the session's working directory, and the turn names that copy by
           * path. The original browser file waits in the draft because a group
           * composer has no session to write into until its own send creates one.
           * Keeping the file instead of eager base64 avoids multiplying a video's
           * bytes through the state tree before anyone has asked to send it.
           */
          readonly kind: "workspaceFile";
          /** Client-minted; unique within this draft only. */
          readonly id: string;
          readonly name: string;
          readonly size: number;
          readonly mediaType: string;
          /** Browser-owned source bytes, encoded only when the draft is submitted. */
          readonly file: File;
          /** Object URL for image/video thumbnails; owned by the workspace store. */
          readonly previewUrl?: string;
      };

export type ComposerSubmission =
    | { readonly status: "idle" }
    | { readonly status: "pending"; readonly revision: number }
    | { readonly status: "failed"; readonly revision: number; readonly error: UserError };

export interface ComposerSnapshot {
    readonly scopeId: string;
    readonly text: string;
    readonly attachments: readonly ComposerAttachment[];
    readonly revision: number;
    readonly submission: ComposerSubmission;
    /** Whether the editable text control currently owns browser focus. */
    readonly focused: boolean;
    /** Client time of the most recent local text edit. */
    readonly textUpdatedAt?: number;
    /**
     * Who the next send addresses. New composers address agents by default;
     * callers may explicitly select people for a human-directed message.
     */
    readonly audience?: MessageAudience;
    /** Additional agents explicitly selected beyond the chat's default agent. */
    readonly agentUserIds: readonly string[];
    readonly capabilities: ComposerCapabilities;
    /**
     * The active slash-command query (the text after `/`), derived from the
     * draft. Present only while the whole draft is one leading `/` and a command
     * word that some offered command still matches, so a pasted path is ordinary
     * text. While it is present the draft sends nothing, which is what keeps an
     * accidental Enter from posting `/model`.
     */
    readonly commandQuery?: string;
    /** The active `@`-mention token (the text after `@`), derived from the draft. */
    readonly mentionQuery?: string;
    /** Candidates for the active mention query, reconciled by the owner. */
    readonly mentionCandidates: readonly ComposerMention[];
    /** The command a `!`-prefixed draft would run, when shell mode applies. */
    readonly shellCommand?: string;
}

export type ComposerOutput =
    | { readonly type: "textUpdated"; readonly scopeId: string; readonly text: string }
    | { readonly type: "focusUpdated"; readonly scopeId: string; readonly focused: boolean }
    | {
          readonly type: "attachmentAdded";
          readonly scopeId: string;
          readonly attachment: ComposerAttachment;
      }
    | {
          readonly type: "attachmentRemoved";
          readonly scopeId: string;
          readonly attachmentId: string;
      }
    | {
          readonly type: "audienceUpdated";
          readonly scopeId: string;
          readonly audience: MessageAudience;
      }
    | { readonly type: "agentUserAdded"; readonly scopeId: string; readonly agentUserId: string }
    | { readonly type: "agentUserRemoved"; readonly scopeId: string; readonly agentUserId: string }
    | {
          readonly type: "mentionQueryUpdated";
          readonly scopeId: string;
          readonly query?: string;
      }
    | { readonly type: "commandInvoked"; readonly scopeId: string; readonly commandId: string }
    | {
          readonly type: "shellCommandSubmitted";
          readonly scopeId: string;
          readonly command: string;
          readonly revision: number;
      }
    | {
          readonly type: "textSubmitted";
          readonly scopeId: string;
          readonly text: string;
          readonly attachments: readonly ComposerAttachment[];
          readonly revision: number;
          readonly audience?: MessageAudience;
          readonly agentUserIds: readonly string[];
      };

export type ComposerInput =
    | { readonly type: "textReconciled"; readonly text: string }
    | {
          readonly type: "mentionCandidatesReconciled";
          readonly query: string;
          readonly candidates: readonly ComposerMention[];
      }
    | { readonly type: "agentUsersReconciled"; readonly agentUserIds: readonly string[] }
    | { readonly type: "submissionConfirmed"; readonly revision: number }
    | { readonly type: "submissionFailed"; readonly revision: number; readonly error: UserError };

export interface ComposerState extends ComposerSnapshot {
    textUpdate(text: string): void;
    focusUpdate(focused: boolean): void;
    attachmentAdd(attachment: ComposerAttachment): void;
    attachmentRemove(attachmentId: string): void;
    audienceUpdate(audience: MessageAudience): void;
    audienceToggle(): void;
    agentUserAdd(agentUserId: string): void;
    agentUserRemove(agentUserId: string): void;
    /** Runs one offered slash command and clears the draft that opened it. */
    commandInvoke(commandId: string): void;
    textSubmit(): void;
    composerInput(event: ComposerInput): void;
}

export type ComposerStore = StoreApi<ComposerState>;

export interface ComposerStoreOptions {
    readonly capabilities?: ComposerCapabilities;
    readonly text?: string;
    readonly attachments?: readonly ComposerAttachment[];
    readonly audience?: MessageAudience;
    readonly agentUserIds?: readonly string[];
    readonly now?: () => number;
    readonly output?: (event: ComposerOutput) => void;
}

/**
 * Finds the active `@`-mention token at the end of a draft: the run of
 * non-whitespace after the last `@` that starts a token (at string start or
 * after whitespace). A trailing space closes the mention, so `@src/a.ts ` has
 * no active token.
 */
function mentionTokenOf(text: string): string | undefined {
    const match = /(?:^|\s)@(\S*)$/.exec(text);
    return match ? match[1]! : undefined;
}

/**
 * The active slash-command query, if this draft is one.
 *
 * A draft is a command only while it is nothing but a leading `/` and a single
 * command word, and only while some offered command still matches it. Anything
 * else — `/Users/steve/project`, `/ two words`, `/nonsense` — is ordinary text
 * that must send normally. Treating every leading slash as a command is what
 * left a pasted path stuck behind a palette that would not close and would not
 * let the message go.
 */
function commandQueryOf(text: string, commands: readonly ComposerCommand[]): string | undefined {
    if (commands.length === 0) return undefined;
    const match = /^\/([\w-]*)$/.exec(text);
    if (!match) return undefined;
    const query = match[1]!;
    const needle = query.toLowerCase();
    return commands.some((command) => commandMatches(command, needle)) ? query : undefined;
}

/** Whether one offered command answers a typed query, by id or by label. */
function commandMatches(command: ComposerCommand, needle: string): boolean {
    if (needle.length === 0) return true;
    return (
        command.id.toLowerCase().includes(needle) || command.label.toLowerCase().includes(needle)
    );
}

/** The derived command/mention/shell reading of one draft under one capability set. */
function draftDerive(
    text: string,
    capabilities: ComposerCapabilities,
): {
    commandQuery?: string;
    mentionQuery?: string;
    shellCommand?: string;
} {
    const commandQuery = commandQueryOf(text, capabilities.commands);
    const shellCommand =
        capabilities.shellMode && text.trimStart().startsWith("!")
            ? text.trim().slice(1).trim()
            : undefined;
    const mentionQuery =
        capabilities.mentions && commandQuery === undefined ? mentionTokenOf(text) : undefined;
    return { commandQuery, mentionQuery, shellCommand };
}

/** Creates one self-contained composer store; every local mutation updates first and then emits. */
export function composerStoreCreate(
    scopeId: string,
    options: ComposerStoreOptions = {},
): ComposerStore {
    const output = options.output ?? (() => undefined);
    const now = options.now ?? Date.now;
    return createStore<ComposerState>()((set, get) => ({
        scopeId,
        text: options.text ?? "",
        attachments: options.attachments?.map((attachment) => ({ ...attachment })) ?? [],
        revision: 0,
        submission: { status: "idle" },
        focused: false,
        audience: options.audience ?? "agents",
        agentUserIds: [...(options.agentUserIds ?? [])],
        capabilities: options.capabilities ?? composerCapabilitiesNone,
        mentionCandidates: [],
        ...draftDerive(options.text ?? "", options.capabilities ?? composerCapabilitiesNone),

        textUpdate(text): void {
            const previous = get();
            if (previous.text === text) return;
            const derived = draftDerive(text, previous.capabilities);
            const mentionClosed = derived.mentionQuery !== previous.mentionQuery;
            set({
                text,
                revision: previous.revision + 1,
                submission: { status: "idle" },
                textUpdatedAt: now(),
                ...derived,
                ...(mentionClosed ? { mentionCandidates: [] } : {}),
            });
            output({ type: "textUpdated", scopeId, text });
            if (mentionClosed)
                output({ type: "mentionQueryUpdated", scopeId, query: derived.mentionQuery });
        },

        focusUpdate(focused): void {
            if (get().focused === focused) return;
            set({ focused });
            output({ type: "focusUpdated", scopeId, focused });
        },

        attachmentAdd(attachment): void {
            const previous = get();
            if (previous.attachments.some((item) => item.id === attachment.id)) return;
            const storedAttachment = { ...attachment };
            set({
                attachments: [...previous.attachments, storedAttachment],
                revision: previous.revision + 1,
                submission: { status: "idle" },
            });
            output({ type: "attachmentAdded", scopeId, attachment: storedAttachment });
        },

        attachmentRemove(attachmentId): void {
            const previous = get();
            if (!previous.attachments.some((item) => item.id === attachmentId)) return;
            set({
                attachments: previous.attachments.filter((item) => item.id !== attachmentId),
                revision: previous.revision + 1,
                submission: { status: "idle" },
            });
            output({ type: "attachmentRemoved", scopeId, attachmentId });
        },

        audienceUpdate(audience): void {
            const previous = get();
            if (previous.audience === audience) return;
            set({ audience, revision: previous.revision + 1, submission: { status: "idle" } });
            output({ type: "audienceUpdated", scopeId, audience });
        },

        audienceToggle(): void {
            get().audienceUpdate(get().audience === "agents" ? "people" : "agents");
        },

        agentUserAdd(agentUserId): void {
            const previous = get();
            if (previous.agentUserIds.includes(agentUserId)) return;
            set({
                agentUserIds: [...previous.agentUserIds, agentUserId],
                revision: previous.revision + 1,
                submission: { status: "idle" },
            });
            output({ type: "agentUserAdded", scopeId, agentUserId });
        },

        agentUserRemove(agentUserId): void {
            const previous = get();
            if (!previous.agentUserIds.includes(agentUserId)) return;
            set({
                agentUserIds: previous.agentUserIds.filter((id) => id !== agentUserId),
                revision: previous.revision + 1,
                submission: { status: "idle" },
            });
            output({ type: "agentUserRemoved", scopeId, agentUserId });
        },

        commandInvoke(commandId): void {
            const previous = get();
            if (!previous.capabilities.commands.some((command) => command.id === commandId)) return;
            const textUpdatedAt = now();
            set({
                text: "",
                revision: previous.revision + 1,
                submission: { status: "idle" },
                textUpdatedAt,
                commandQuery: undefined,
                mentionQuery: undefined,
                shellCommand: undefined,
                mentionCandidates: [],
            });
            // The command draft is persisted by the same output as ordinary
            // text. Clearing only this in-memory store lets a later durable
            // draft reconciliation restore `/agents` and reopen its picker.
            output({ type: "textUpdated", scopeId, text: "" });
            output({ type: "commandInvoked", scopeId, commandId });
        },

        textSubmit(): void {
            const previous = get();
            if (
                previous.submission.status === "pending" ||
                (previous.text.length === 0 && previous.attachments.length === 0)
            )
                return;
            // An open command palette is an affordance, not a message: Enter picks
            // nothing and sends nothing until the caller invokes a command.
            if (previous.commandQuery !== undefined) return;
            if (previous.shellCommand !== undefined) {
                if (previous.shellCommand.length === 0) return;
                set({ submission: { status: "pending", revision: previous.revision } });
                output({
                    type: "shellCommandSubmitted",
                    scopeId,
                    command: previous.shellCommand,
                    revision: previous.revision,
                });
                return;
            }
            set({ submission: { status: "pending", revision: previous.revision } });
            output({
                type: "textSubmitted",
                scopeId,
                text: previous.text,
                attachments: previous.attachments,
                revision: previous.revision,
                audience: previous.audience,
                agentUserIds: previous.audience === "agents" ? previous.agentUserIds : [],
            });
        },

        composerInput(event): void {
            const snapshot = get();
            switch (event.type) {
                case "textReconciled":
                    if (snapshot.text !== event.text)
                        set({
                            text: event.text,
                            revision: snapshot.revision + 1,
                            submission: { status: "idle" },
                            ...draftDerive(event.text, snapshot.capabilities),
                        });
                    return;
                case "mentionCandidatesReconciled":
                    // A response for a token the reader has already left is stale.
                    if (snapshot.mentionQuery === event.query)
                        set({ mentionCandidates: event.candidates });
                    return;
                case "agentUsersReconciled": {
                    const allowed = new Set(event.agentUserIds);
                    const agentUserIds = snapshot.agentUserIds.filter((id) => allowed.has(id));
                    if (
                        agentUserIds.length === snapshot.agentUserIds.length &&
                        agentUserIds.every((id, index) => id === snapshot.agentUserIds[index])
                    )
                        return;
                    if (snapshot.submission.status === "pending") set({ agentUserIds });
                    else
                        set({
                            agentUserIds,
                            revision: snapshot.revision + 1,
                            submission: { status: "idle" },
                        });
                    return;
                }
                case "submissionConfirmed":
                    if (
                        snapshot.submission.status === "pending" &&
                        snapshot.submission.revision === event.revision &&
                        snapshot.revision === event.revision
                    )
                        set({
                            text: "",
                            attachments: [],
                            submission: { status: "idle" },
                            commandQuery: undefined,
                            mentionQuery: undefined,
                            shellCommand: undefined,
                            mentionCandidates: [],
                        });
                    return;
                case "submissionFailed":
                    if (
                        snapshot.submission.status === "pending" &&
                        snapshot.submission.revision === event.revision &&
                        snapshot.revision === event.revision
                    )
                        set({
                            submission: {
                                status: "failed",
                                revision: event.revision,
                                error: event.error,
                            },
                        });
            }
        },
    }));
}

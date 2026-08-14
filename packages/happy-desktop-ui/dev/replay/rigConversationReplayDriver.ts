import {
    ChatStore,
    type SessionEvent,
    type SessionStreamHello,
    type UserInputRequest,
} from "@slopus/rig-connect";
import {
    rigChatStoreCreate,
    type RigAnsweredUserInput,
    type RigChatSnapshot,
    type RigChatStore,
    type RigChatTranscriptConnect,
    type RigModelCatalog,
    type RigSessionId,
} from "happy-desktop-state";
import { createFakeRigTransport, type FakeRigTransport } from "happy-desktop-state/testing";

export type RigConversationReplaySource =
    | "ask-user-overlay"
    | "provider-switch"
    | "sol-followup"
    | "steering-core"
    | "subagent-overlay"
    | "subagent-lifecycle";

export interface RigConversationReplayFrame {
    readonly atMs: number;
    readonly event: SessionEvent;
    readonly seq: number;
    readonly source: RigConversationReplaySource;
    readonly sourceLine: number;
}

export interface RigConversationReplayRecording {
    readonly version: 1;
    readonly id: string;
    readonly label: string;
    readonly durationMs: number;
    readonly startedAt: number;
    readonly manifest: {
        readonly exactArrivalDeltas: true;
        readonly notes: string;
        readonly sanitizer: number;
        readonly sources: readonly string[];
    };
    readonly catalog: RigModelCatalog;
    readonly hello: SessionStreamHello & {
        readonly session: NonNullable<SessionStreamHello["session"]>;
    };
    readonly frames: readonly RigConversationReplayFrame[];
}

export function rigConversationReplayRecordingParse(raw: string): RigConversationReplayRecording {
    const recording = JSON.parse(raw) as RigConversationReplayRecording;
    if (recording.version !== 1) throw new Error("Unsupported conversation replay version.");
    if (recording.frames.some((frame, index) => frame.seq !== index))
        throw new Error("Conversation replay frames must have contiguous sequence numbers.");
    return recording;
}

interface ReplayHarness {
    readonly core: ChatStore;
    readonly fake: FakeRigTransport;
    readonly store: RigChatStore;
    unsubscribe: () => void;
    cursor: number;
    emit?: () => void;
}

/**
 * Drives the same two stores as a live conversation:
 *
 * captured protocol frames → rig-connect ChatStore → rigChatStore projection.
 *
 * The wrapper gives React one stable external-store identity even when a
 * backward seek has to replace both inner stores. Forward playback applies only
 * newly crossed frames; a backward seek rebuilds deterministically from hello.
 */
export class RigConversationReplayDriver {
    readonly #listeners = new Set<() => void>();
    readonly #recording: RigConversationReplayRecording;
    #harness!: ReplayHarness;
    #snapshot!: RigChatSnapshot;
    #sourceMs = 0;
    #disposed = false;
    #rebuilding = false;
    #pendingUserInputs = new Map<
        string,
        { readonly createdAt: number; readonly request: UserInputRequest }
    >();
    #answeredUserInputs = new Map<string, RigAnsweredUserInput>();

    constructor(recording: RigConversationReplayRecording) {
        this.#recording = recording;
        this.#rebuild(0);
    }

    readonly get = (): RigChatSnapshot => this.#snapshot;

    readonly subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    };

    get sourceMs(): number {
        return this.#sourceMs;
    }

    get protocolSession() {
        return this.#harness.core.session();
    }

    seek(sourceMs: number): void {
        if (this.#disposed) return;
        const next = Math.min(Math.max(sourceMs, 0), this.#recording.durationMs);
        if (next < this.#sourceMs) {
            this.#rebuild(next);
            return;
        }
        this.#sourceMs = next;
        let changed = false;
        while (
            this.#harness.cursor < this.#recording.frames.length &&
            this.#recording.frames[this.#harness.cursor]!.atMs <= next
        ) {
            const frame = this.#recording.frames[this.#harness.cursor]!;
            this.#userInputApply(frame.event);
            changed = this.#harness.core.apply(frame.event).length > 0 || changed;
            this.#harness.cursor += 1;
        }
        if (changed) this.#harness.emit?.();
    }

    turnTraceToggle(turnId: string): void {
        this.#harness.store.turnTraceToggle(turnId);
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#harness.unsubscribe();
        this.#harness.store[Symbol.dispose]();
        this.#listeners.clear();
    }

    #rebuild(sourceMs: number): void {
        this.#rebuilding = true;
        if (this.#harness) {
            this.#harness.unsubscribe();
            this.#harness.store[Symbol.dispose]();
        }
        this.#sourceMs = sourceMs;
        this.#pendingUserInputs = new Map();
        this.#answeredUserInputs = new Map();
        const core = new ChatStore(this.#recording.hello.session.id);
        core.setConnection("live");
        core.applyHello(this.#recording.hello);

        let cursor = 0;
        while (
            cursor < this.#recording.frames.length &&
            this.#recording.frames[cursor]!.atMs <= sourceMs
        ) {
            const frame = this.#recording.frames[cursor]!;
            this.#userInputApply(frame.event);
            core.apply(frame.event);
            cursor += 1;
        }

        const fake = createFakeRigTransport();
        fake.catalogSet(this.#recording.catalog);
        let emit: (() => void) | undefined;
        const transcriptConnect: RigChatTranscriptConnect = ({ onChange }) => {
            emit = () =>
                onChange(
                    core.elements(),
                    core.session(),
                    [...this.#answeredUserInputs.values()].sort(
                        (left, right) => left.createdAt - right.createdAt,
                    ),
                );
            emit();
            return {
                close: () => {
                    emit = undefined;
                },
                loadMore: () => undefined,
            };
        };
        const store = rigChatStoreCreate(this.#recording.hello.session.id as RigSessionId, {
            catalog: this.#recording.catalog,
            now: () => this.#recording.startedAt + this.#sourceMs,
            transcriptConnect,
            transport: fake.transport,
        });
        const harness: ReplayHarness = {
            core,
            cursor,
            emit: undefined,
            fake,
            store,
            unsubscribe: () => undefined,
        };
        this.#harness = harness;
        harness.unsubscribe = store.subscribe(() => {
            this.#snapshot = store.get();
            if (!this.#rebuilding) this.#notify();
        });
        harness.emit = emit;
        this.#snapshot = store.get();
        this.#rebuilding = false;
        this.#notify();
    }

    #notify(): void {
        for (const listener of this.#listeners) listener();
    }

    /** Reconstructs the durable answered-question feed ChatStore intentionally omits. */
    #userInputApply(event: SessionEvent): void {
        if (event.type === "user_input_requested") {
            const request = event.data as UserInputRequest;
            this.#pendingUserInputs.set(request.requestId, {
                createdAt: event.createdAt,
                request,
            });
            return;
        }
        if (event.type !== "user_input_resolved") return;
        const resolution = event.data as {
            readonly answers?: Readonly<Record<string, readonly string[]>>;
            readonly requestId: string;
            readonly status: string;
        };
        const pending = this.#pendingUserInputs.get(resolution.requestId);
        this.#pendingUserInputs.delete(resolution.requestId);
        if (resolution.status !== "answered" || pending === undefined) return;
        this.#answeredUserInputs.set(resolution.requestId, {
            answers: resolution.answers ?? {},
            createdAt: pending.createdAt,
            questions: pending.request.questions.map((question) => ({
                id: question.id,
                header: question.header,
                multiSelect: question.multiSelect,
                options: question.options,
                question: question.question,
                required: question.required ?? false,
            })),
            requestId: resolution.requestId,
            resolvedAt: event.createdAt,
        });
    }
}

export interface RigConversationSilentWindow {
    readonly sourceStartMs: number;
    readonly sourceEndMs: number;
    readonly displayStartMs: number;
    readonly displayEndMs: number;
    readonly savedMs: number;
}

export interface RigConversationReplayTimeline {
    readonly displayDurationMs: number;
    readonly sourceDurationMs: number;
    readonly windows: readonly RigConversationSilentWindow[];
    displayAt(sourceMs: number): number;
    sourceAt(displayMs: number): number;
}

/** A silent source gap must be unmistakably long before the toggle touches it. */
const SILENT_GAP_MIN_MS = 8_000;
/** A skipped gap still gets a short visible beat instead of becoming a teleport. */
const SILENT_GAP_DISPLAY_MS = 2_000;

export function rigConversationReplayTimeline(
    recording: RigConversationReplayRecording,
    skipSilence: boolean,
): RigConversationReplayTimeline {
    if (!skipSilence) {
        return {
            displayAt: (sourceMs) => sourceMs,
            displayDurationMs: recording.durationMs,
            sourceAt: (displayMs) => displayMs,
            sourceDurationMs: recording.durationMs,
            windows: [],
        };
    }

    const windows: RigConversationSilentWindow[] = [];
    let savedBefore = 0;
    for (let index = 0; index < recording.frames.length - 1; index += 1) {
        const sourceStartMs = recording.frames[index]!.atMs;
        const sourceEndMs = recording.frames[index + 1]!.atMs;
        const duration = sourceEndMs - sourceStartMs;
        if (duration < SILENT_GAP_MIN_MS) continue;
        const displayStartMs = sourceStartMs - savedBefore;
        const displayEndMs = displayStartMs + SILENT_GAP_DISPLAY_MS;
        const savedMs = duration - SILENT_GAP_DISPLAY_MS;
        windows.push({
            displayEndMs,
            displayStartMs,
            savedMs,
            sourceEndMs,
            sourceStartMs,
        });
        savedBefore += savedMs;
    }

    const displayAt = (sourceMs: number): number => {
        let saved = 0;
        for (const window of windows) {
            if (sourceMs >= window.sourceEndMs) {
                saved += window.savedMs;
                continue;
            }
            if (sourceMs <= window.sourceStartMs) break;
            const sourceProgress =
                (sourceMs - window.sourceStartMs) / (window.sourceEndMs - window.sourceStartMs);
            return window.displayStartMs + sourceProgress * SILENT_GAP_DISPLAY_MS;
        }
        return sourceMs - saved;
    };
    const sourceAt = (displayMs: number): number => {
        let saved = 0;
        for (const window of windows) {
            if (displayMs >= window.displayEndMs) {
                saved += window.savedMs;
                continue;
            }
            if (displayMs <= window.displayStartMs) break;
            const displayProgress =
                (displayMs - window.displayStartMs) / (window.displayEndMs - window.displayStartMs);
            return (
                window.sourceStartMs + displayProgress * (window.sourceEndMs - window.sourceStartMs)
            );
        }
        return displayMs + saved;
    };

    return {
        displayAt,
        displayDurationMs: recording.durationMs - savedBefore,
        sourceAt,
        sourceDurationMs: recording.durationMs,
        windows,
    };
}

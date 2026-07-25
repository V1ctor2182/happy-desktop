import type {
    RigEventId,
    RigEventObserver,
    RigFileSearchResult,
    RigGlobalEvent,
    RigModelCatalog,
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigSession,
    RigSessionCreateInput,
    RigSessionEvent,
    RigSessionId,
    RigSessionSummary,
    RigSessionUsage,
    RigShellCommandResult,
    RigSubagentSummary,
    RigThinkingLevel,
    RigTransport,
    RigUserInputAnswers,
} from "happy2-state";

/**
 * The renderer-side `RigTransport`: a thin fetch + `EventSource` client over the
 * main process's loopback Rig proxy (`rigHttpUrl`). Every route already returns
 * `happy2-state` projections, so this file performs no protocol mapping and imports
 * no `@slopus` wire types — it just parses JSON/SSE straight into the state package.
 * Reconnect/backfill is owned by the stores; the SSE subscriptions here close on the
 * first stream error and surface it so the store can recover.
 */
export function rigRendererTransportCreate(baseUrl: string): RigTransport {
    const base = baseUrl.replace(/\/$/, "");

    const url = (path: string, params?: Record<string, string | undefined>): string => {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params ?? {}))
            if (value !== undefined) query.set(key, value);
        const suffix = query.toString();
        return `${base}${path}${suffix ? `?${suffix}` : ""}`;
    };

    const getJson = async <T>(
        path: string,
        params?: Record<string, string | undefined>,
    ): Promise<T> => {
        const response = await fetch(url(path, params));
        return readJson<T>(response);
    };

    const postJson = async <T>(path: string, body?: unknown): Promise<T> => {
        const response = await fetch(url(path), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {}),
        });
        return readJson<T>(response);
    };

    const subscribe = <Event>(
        streamPath: string,
        params: Record<string, string | undefined>,
        observer: RigEventObserver<Event>,
    ): (() => void) => {
        const source = new EventSource(url(streamPath, params));
        let closed = false;
        source.onmessage = (message) => {
            if (closed) return;
            try {
                observer.event(JSON.parse(message.data) as Event);
            } catch {
                // A malformed frame is ignored; the store reconciles durable state.
            }
        };
        source.onerror = () => {
            if (closed) return;
            closed = true;
            source.close();
            observer.error(new Error("The Rig event stream was interrupted."));
        };
        return () => {
            if (closed) return;
            closed = true;
            source.close();
        };
    };

    return {
        modelsRead: () => getJson<RigModelCatalog>("/models"),
        sessionsRead: () => getJson<readonly RigSessionSummary[]>("/sessions"),
        sessionRead: (sessionId) => getJson<RigSession>(`/sessions/${sessionId}`),
        subagentsRead: (sessionId) =>
            getJson<readonly RigSubagentSummary[]>(`/sessions/${sessionId}/subagents`),
        filesSearch: (sessionId, query, limit) =>
            getJson<readonly RigFileSearchResult[]>(`/sessions/${sessionId}/files`, {
                q: query,
                limit: limit === undefined ? undefined : String(limit),
            }),
        usageGet: (sessionId) => getJson<RigSessionUsage>(`/sessions/${sessionId}/usage`),

        sessionCreate: (input: RigSessionCreateInput) => postJson<RigSession>("/sessions", input),
        sessionFork: (sessionId) => postJson<RigSession>(`/sessions/${sessionId}/fork`),
        sessionReset: (sessionId) => postJson<RigSession>(`/sessions/${sessionId}/reset`),
        sessionArchive: async (sessionId) => {
            await postJson<Record<string, never>>(`/sessions/${sessionId}/archive`);
        },
        sessionsReorder: async (cwd, sessionIds) => {
            await postJson<Record<string, never>>("/sessions/order", { cwd, sessionIds });
        },

        messageSubmit: async (sessionId, text, idempotencyKey) => {
            await postJson(`/sessions/${sessionId}/messages`, { text, idempotencyKey });
        },
        messageSteer: async (sessionId, text, idempotencyKey, expectedRunId) => {
            await postJson(`/sessions/${sessionId}/steer`, { text, idempotencyKey, expectedRunId });
        },
        runAbort: async (sessionId, expectedRunId) => {
            await postJson(`/sessions/${sessionId}/abort`, { expectedRunId });
        },
        compact: async (sessionId) => {
            await postJson(`/sessions/${sessionId}/compact`);
        },
        rewind: (sessionId, messageId) =>
            postJson<RigSession>(`/sessions/${sessionId}/rewind`, { messageId }),
        shellRun: (sessionId, command, commandId) =>
            postJson<RigShellCommandResult>(`/sessions/${sessionId}/shell`, { command, commandId }),
        backgroundProcessStop: async (sessionId, processId) => {
            await postJson(`/sessions/${sessionId}/stopBackgroundProcess`, { processId });
        },

        changeModel: (sessionId, input: RigModelSelection) =>
            postJson<RigSession>(`/sessions/${sessionId}/model`, input),
        changeEffort: (sessionId, effort?: RigThinkingLevel) =>
            postJson<RigSession>(`/sessions/${sessionId}/effort`, { effort }),
        changePermissionMode: (sessionId, permissionMode: RigPermissionMode) =>
            postJson<RigSession>(`/sessions/${sessionId}/permissionMode`, { permissionMode }),
        changeServiceTier: (sessionId, serviceTier?: RigServiceTier) =>
            postJson<RigSession>(`/sessions/${sessionId}/serviceTier`, { serviceTier }),

        answerUserInput: (sessionId, input: RigUserInputAnswers) =>
            postJson<RigSession>(`/sessions/${sessionId}/answerInput`, input),

        sessionEventsSubscribe: (sessionId: RigSessionId, observer, afterEventId?: RigEventId) =>
            subscribe(`/sessions/${sessionId}/events/stream`, { after: afterEventId }, observer),
        globalEventsSubscribe: (observer: RigEventObserver<RigGlobalEvent>, afterCursor?: number) =>
            subscribe(
                "/events/stream",
                { after: afterCursor === undefined ? undefined : String(afterCursor) },
                observer,
            ),
        sessionEventsBackfill: (sessionId, afterEventId) =>
            getJson<readonly RigSessionEvent[]>(`/sessions/${sessionId}/events`, {
                after: afterEventId,
            }),
    };
}

async function readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
        let detail = `The Rig request failed (${response.status}).`;
        try {
            const body = (await response.json()) as { error?: string };
            if (body.error) detail = body.error;
        } catch {
            // Non-JSON error body; keep the status-based message.
        }
        throw new Error(detail);
    }
    return (await response.json()) as T;
}

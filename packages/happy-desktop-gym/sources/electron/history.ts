import { appendFile, writeFile } from "node:fs/promises";

import type {
    GymCatalogSnapshot,
    GymDurableCounts,
    GymManifest,
    GymProject,
    GymRunPaths,
} from "./types.js";
import type { RigProtocolClient } from "./rigProtocol.js";
import type { StartedRigRuntime } from "./rigRuntime.js";
import type { GymInferenceServer } from "./types.js";
import { rigRuntimeCreate } from "./rigRuntime.js";

const historyCompactionInterval = 16;
// Rig's PersistentSessionStore querySessionSummaries uses LIMIT 500 for the
// normal (non-active) session list. Durable per-session reads are unbounded.
const rigSessionCatalogLimit = 500;

export interface SeededHistory {
    readonly runtime: StartedRigRuntime;
    readonly sessionIds: readonly string[];
    readonly clusterWorkspaceId: string;
    readonly clusterSessionIds: readonly string[];
    readonly seededTurns: number;
    readonly durableCounts: GymDurableCounts;
    readonly persistedAfterRestart: boolean;
}

export async function durableHistorySeed(
    paths: GymRunPaths,
    manifest: GymManifest,
    projects: readonly GymProject[],
    runtime: StartedRigRuntime,
    inference: GymInferenceServer,
): Promise<SeededHistory> {
    const checkouts = await readyCheckouts(projects, runtime.client);
    if (checkouts.length === 0)
        throw new Error("No ready Rig checkout exists for session seeding.");
    const clusterCheckout =
        checkouts.find(
            (checkout) =>
                checkout.workspaceId !== undefined && checkout.cwd === paths.rigWorkspacePath,
        ) ?? checkouts.find((checkout) => checkout.workspaceId !== undefined);
    if (clusterCheckout?.workspaceId === undefined) {
        throw new Error("No ready managed workspace exists for the durable session cluster.");
    }
    const sessionIds: string[] = [];
    const clusterSessionCount = Math.min(
        Math.max(1, manifest.seed.clusterSessionCount),
        manifest.target.sessions,
    );
    const clusterSessions = await Promise.all(
        Array.from({ length: clusterSessionCount }, () =>
            runtime.client.createSession({
                cwd: clusterCheckout.cwd,
                workspaceId: clusterCheckout.workspaceId,
            }),
        ),
    );
    const clusterSessionIds = clusterSessions.map((created) => created.session.id);
    sessionIds.push(...clusterSessionIds);
    const target = manifest.target.sessions;
    for (let index = sessionIds.length; index < target; index += 1) {
        const checkout = checkouts[index % checkouts.length];
        const created = await runtime.client.createSession(checkout);
        sessionIds.push(created.session.id);
        if ((index + 1) % 50 === 0 || index + 1 === target) {
            console.log(`Gym seeded ${index + 1}/${target} durable sessions.`);
        }
    }

    let seededTurns = 0;
    const turnsBySession = new Map<string, number>();
    const historySessionCount = Math.min(manifest.seed.historySessions, sessionIds.length);
    const targetTurns = Math.max(0, manifest.target.turns);
    for (
        let sessionIndex = 0;
        sessionIndex < historySessionCount && seededTurns < targetTurns;
        sessionIndex += 1
    ) {
        const sessionId = sessionIds[sessionIndex];
        if (sessionId === undefined) break;
        const turnLimit =
            sessionIndex < manifest.seed.longChatSessionCount
                ? Math.max(
                      manifest.seed.longChatTurnsPerSession,
                      manifest.seed.clusterTurnsPerSession,
                  )
                : manifest.seed.historyTurnsPerSession;
        for (let turn = 0; turn < turnLimit && seededTurns < targetTurns; turn += 1) {
            const mode = seededTurns < manifest.seed.toolHeavyTurns ? "tool-heavy" : "compact";
            const longChatMarker =
                sessionIndex < manifest.seed.longChatSessionCount ? " [gym-long-chat-session]" : "";
            const submission = await runtime.client.submitMessage(
                sessionId,
                `Gym history turn ${turn + 1} for session ${sessionIndex + 1}. ` +
                    `Use the deterministic ${mode} response lane and keep the response stable.` +
                    `${longChatMarker} [gym-history-session-${sessionIndex + 1}-turn-${turn + 1}]`,
            );
            await runtime.client.waitForSessionIdle(sessionId, submission.runId, 90_000);
            seededTurns += 1;
            const sessionTurns = (turnsBySession.get(sessionId) ?? 0) + 1;
            turnsBySession.set(sessionId, sessionTurns);
            if (sessionTurns % historyCompactionInterval === 0) {
                // Keep the visible durable transcript long while bounding the
                // provider context used for the next inference. This exercises
                // the same public compaction path as a user, rather than
                // fabricating or deleting transcript rows.
                await runtime.client.compact(sessionId);
            }
        }
    }
    const durableCounts = await durableCountsRead(sessionIds, runtime.client, seededTurns);
    await appendFile(
        paths.inferenceLog,
        `${JSON.stringify({
            kind: "history-seeded",
            sessions: sessionIds.length,
            turns: seededTurns,
            durableCounts,
            limitation: manifest.seed.limitation,
        })}\n`,
        "utf8",
    );
    await appendFile(paths.streamLog, "", "utf8");
    await writeClusterArtifact(paths.cluster, clusterCheckout.workspaceId, clusterSessionIds);

    const persistedSessionId = sessionIds[0];
    if (persistedSessionId === undefined) {
        throw new Error("Rig did not create a session for persistence verification.");
    }
    const beforeRestart = await runtime.client.events(persistedSessionId);
    if (beforeRestart.events.length === 0) {
        throw new Error("The seeded Rig session has no durable events before restart.");
    }

    await runtime.stop();
    await inference.start();
    const restarted = await rigRuntimeCreate(paths, inference);
    const afterRestart = await restarted.client.getSession(persistedSessionId);
    const afterEvents = await restarted.client.events(persistedSessionId);
    const persistedAfterRestart =
        afterRestart.session.id === persistedSessionId &&
        afterEvents.events.length >= beforeRestart.events.length;
    if (!persistedAfterRestart) {
        throw new Error("Rig durable history did not survive daemon restart.");
    }
    return {
        runtime: restarted,
        sessionIds,
        clusterWorkspaceId: clusterCheckout.workspaceId,
        clusterSessionIds,
        seededTurns,
        durableCounts,
        persistedAfterRestart,
    };
}

async function writeClusterArtifact(
    path: string,
    workspaceId: string,
    sessionIds: readonly string[],
): Promise<void> {
    await writeFile(
        path,
        `${JSON.stringify(
            {
                schemaVersion: 1,
                workspaceId,
                sessionIds,
            },
            null,
            2,
        )}\n`,
        "utf8",
    );
}

async function durableCountsRead(
    sessionIds: readonly string[],
    client: RigProtocolClient,
    turns: number,
): Promise<GymDurableCounts> {
    let events = 0;
    let messages = 0;
    const batchSize = 32;
    let previousTotal = -1;
    let stableReads = 0;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        events = 0;
        messages = 0;
        for (let offset = 0; offset < sessionIds.length; offset += batchSize) {
            const batch = sessionIds.slice(offset, offset + batchSize);
            const results = await Promise.all(batch.map((sessionId) => client.events(sessionId)));
            for (const result of results) {
                events += result.events.length;
                messages += result.events.filter(eventMessageCount).length;
            }
        }
        if (events === previousTotal) stableReads += 1;
        else stableReads = 0;
        previousTotal = events;
        if (stableReads >= 2) break;
        await delay(100);
    }
    if (events < 0) {
        throw new Error("Rig returned no durable event count.");
    }
    return {
        events,
        messages,
        sessions: sessionIds.length,
        turns,
    };
}

function eventMessageCount(event: Record<string, unknown>): boolean {
    const type = typeof event.type === "string" ? event.type : "";
    return (
        type === "message_submitted" ||
        type === "agent_message" ||
        type === "tool_call" ||
        type === "tool_result" ||
        type === "agent_activity"
    );
}

export async function catalogSnapshotRead(
    client: RigProtocolClient,
    expectedSessionIds?: readonly string[],
): Promise<GymCatalogSnapshot> {
    const registeredProjects = await client.projects();
    const workspaceLists = await Promise.all(
        registeredProjects.projects.map((project) => client.listWorkspaces(project.id)),
    );
    const workspaces = workspaceLists.flatMap((result) => result.workspaces);
    const visibleSessions = await client.sessions();
    if (expectedSessionIds !== undefined) {
        await persistedSessionIdsVerify(client, expectedSessionIds);
    }
    return {
        // The Home project is implicit and intentionally omitted by Rig's
        // /projects route; count it so the manifest matches the desktop
        // catalog shape measured from the durable store.
        projectCount: registeredProjects.projects.length + 1,
        worktreeCount: workspaces.length,
        readyWorktreeCount: workspaces.filter((workspace) => workspace.status === "ready").length,
        archivedWorktreeCount: workspaces.filter(
            (workspace) => workspace.status === "archived" || workspace.archivedAt !== undefined,
        ).length,
        sessionCount: visibleSessions.sessions.length,
        sessionCatalogLimit: rigSessionCatalogLimit,
        sessionCatalogTruncated:
            expectedSessionIds !== undefined &&
            visibleSessions.sessions.length < expectedSessionIds.length,
    };
}

async function persistedSessionIdsVerify(
    client: RigProtocolClient,
    sessionIds: readonly string[],
): Promise<void> {
    const batchSize = 32;
    for (let offset = 0; offset < sessionIds.length; offset += batchSize) {
        const batch = sessionIds.slice(offset, offset + batchSize);
        await Promise.all(batch.map((sessionId) => client.getSession(sessionId)));
    }
}

async function readyCheckouts(
    projects: readonly GymProject[],
    client: RigProtocolClient,
): Promise<readonly { readonly cwd: string; readonly workspaceId?: string }[]> {
    const result: Array<{ readonly cwd: string; readonly workspaceId?: string }> = [];
    for (const project of projects) {
        result.push({ cwd: project.path });
        const workspaces = await client.listWorkspaces(project.id);
        for (const workspace of workspaces.workspaces) {
            if (workspace.status === "ready") {
                result.push({ cwd: workspace.path, workspaceId: workspace.id });
            }
        }
    }
    return result;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}

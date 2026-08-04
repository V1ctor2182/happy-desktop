import type { RigInboxItem, RigInboxItemId, RigInboxSubmission } from "happy-desktop-state";
import { RigInboxPage } from "../../src/pages/inbox/RigInboxPage";
import { ComponentPage, FullScreenSpecimen } from "../kit";

const item = (
    id: string,
    overrides: Partial<RigInboxItem> & Pick<RigInboxItem, "questions" | "status">,
): RigInboxItem =>
    ({
        id,
        sessionId: `session-${id}`,
        requestId: `req-${id}`,
        projectId: "project-1",
        createdAt: 1_700_000_000_000,
        ...overrides,
    }) as RigInboxItem;

const pending: readonly RigInboxItem[] = [
    item("one", {
        sessionTitle: "Migrate the plugin permission table",
        status: "pending",
        questions: [
            {
                id: "approach",
                header: "Approach",
                question: "How should the migration run?",
                multiSelect: false,
                required: true,
                options: [
                    {
                        label: "In one transaction",
                        description: "Atomic but locks the table longer.",
                    },
                    {
                        label: "In batches",
                        description: "Lower lock contention, slower overall.",
                    },
                ],
            },
            {
                id: "notify",
                header: "Notify",
                question: "Who should hear about it when it lands?",
                multiSelect: true,
                required: false,
                options: [
                    { label: "On-call", description: "Pages whoever is holding the rota." },
                    { label: "Release channel", description: "Posts once, after the migration." },
                ],
            },
        ],
    }),
    item("two", {
        sessionTitle: "Rewrite the changed-files header",
        status: "pending",
        questions: [
            {
                id: "scope",
                header: "Scope",
                question: "Which surfaces should adopt the new header?",
                multiSelect: true,
                required: true,
                options: [
                    { label: "Changed files", description: "The diff listing." },
                    { label: "All files", description: "The full tree." },
                    { label: "Search results", description: "Shares the row rhythm." },
                ],
            },
        ],
    }),
];

const answered: readonly RigInboxItem[] = [
    item("three", {
        sessionTitle: "Add the remote Rig connect flow",
        status: "answered",
        resolvedAt: 1_700_000_500_000,
        answers: { transport: ["Over SSH"] },
        questions: [
            {
                id: "transport",
                header: "Transport",
                question: "How should the token be resolved?",
                multiSelect: false,
                required: true,
                options: [
                    { label: "Over SSH", description: "Reuses existing machine access." },
                    { label: "Pasted by hand", description: "Copied from the daemon." },
                ],
            },
        ],
    }),
    item("four", {
        sessionTitle: "Vendor the Octicons glyphmap",
        status: "answered",
        resolvedAt: 1_700_000_200_000,
        answers: { source: ["Regenerate from upstream", "Check the map into the repo"] },
        questions: [
            {
                id: "source",
                header: "Source",
                question: "Where should the name map come from?",
                multiSelect: true,
                required: true,
                options: [
                    { label: "Regenerate from upstream", description: "Matches Happy exactly." },
                    { label: "Check the map into the repo", description: "No build-time step." },
                ],
            },
        ],
    }),
];

const submissions: ReadonlyMap<RigInboxItemId, RigInboxSubmission> = new Map([
    ["two" as RigInboxItemId, { type: "pending" } as RigInboxSubmission],
]);

const failed: ReadonlyMap<RigInboxItemId, RigInboxSubmission> = new Map([
    [
        "one" as RigInboxItemId,
        {
            type: "failed",
            error: { name: "UserError", message: "The Rig refused the answer: the session ended." },
        } as RigInboxSubmission,
    ],
]);

/** A reply part-written into the first question, so the input shows its filled state. */
const messages: ReadonlyMap<RigInboxItemId, string> = new Map([
    ["one" as RigInboxItemId, "Neither — split the table first and migrate each half."],
]);

const location = (candidate: RigInboxItem): string =>
    candidate.worktreeId ? "happy2 · feature worktree" : "happy2";

const time = (candidate: RigInboxItem): string =>
    candidate.status === "answered" ? "Answered 8m ago" : "Asked 3m ago";

export function RigInboxBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-013"
            summary="The queue of questions a Rig's agents are waiting on: pending first in the order they were asked, answered below as a record. A waiting question is one outlined block headed by the session that asked; a settled one drops the outline and keeps only what was decided."
            title="RigInboxPage"
        >
            <FullScreenSpecimen
                detail="Two waiting questions and two answered; the second answer is in flight, the first question carries a required and an optional part, and each waiting question also takes a written reply for when no option fits."
                label="Queue with history"
                number="01"
            >
                <RigInboxPage
                    answered={answered}
                    itemLocation={location}
                    itemTime={time}
                    messages={messages}
                    onAnswer={() => undefined}
                    onMessageChange={() => undefined}
                    onMessageSubmit={() => undefined}
                    onOpenSession={() => undefined}
                    pending={pending}
                    submissions={submissions}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Everything asked has an answer, so the queue says so inline and leaves the record reachable."
                label="Caught up"
                number="02"
            >
                <RigInboxPage
                    answered={answered}
                    itemLocation={location}
                    itemTime={time}
                    onAnswer={() => undefined}
                    onOpenSession={() => undefined}
                    pending={[]}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen detail="No agent has asked anything yet." label="Empty" number="03">
                <RigInboxPage answered={[]} onAnswer={() => undefined} pending={[]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The feed failed; retained questions stay readable beneath the banner."
                label="Feed error"
                number="04"
            >
                <RigInboxPage
                    answered={[]}
                    error={{ name: "UserError", message: "The Rig stopped reporting questions." }}
                    itemLocation={location}
                    itemTime={time}
                    onAnswer={() => undefined}
                    pending={pending}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="An answer the Rig refused; the selections are retained inside the question so the retry sends the same thing."
                label="Answer not sent"
                number="05"
            >
                <RigInboxPage
                    answered={[]}
                    itemLocation={location}
                    itemTime={time}
                    onAnswer={() => undefined}
                    onOpenSession={() => undefined}
                    pending={pending}
                    submissions={failed}
                />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}

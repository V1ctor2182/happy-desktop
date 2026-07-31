import type { RigInboxItem, RigInboxItemId, RigInboxSubmission } from "happy2-state";
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
];

const submissions: ReadonlyMap<RigInboxItemId, RigInboxSubmission> = new Map([
    ["two" as RigInboxItemId, { type: "pending" } as RigInboxSubmission],
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
            summary="The queue of questions a Rig's agents are waiting on: pending first in the order they were asked, answered below as a record. Answers are given in place."
            title="RigInboxPage"
        >
            <FullScreenSpecimen
                detail="Two waiting questions and one answered; the second answer is in flight."
                label="Queue with history"
                number="01"
            >
                <RigInboxPage
                    answered={answered}
                    itemLocation={location}
                    itemTime={time}
                    onAnswer={() => undefined}
                    onOpenSession={() => undefined}
                    pending={pending}
                    submissions={submissions}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Everything asked has an answer, so the queue reads as caught up."
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
        </ComponentPage>
    );
}

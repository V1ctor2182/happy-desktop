import { useState, type CSSProperties } from "react";
import type { ConversationRequest, UserError } from "happy-desktop-state";
import { ApprovalCard, type ApprovalRequest, type ApprovalResolution } from "./ApprovalCard";
import { RigUserInputPrompt, type RigUserInputAnswerMap } from "./RigUserInputPrompt";

export type ConversationRequestDecision = "approve" | "deny";

export type ConversationRequestViewProps = {
    request: ConversationRequest;
    /** Answers a structured question request. */
    onAnswer?: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /** Options ticked into this question so far, when the owner keeps them. */
    selection?: Readonly<Record<string, readonly string[]>>;
    /** Reports each tick to an owner that keeps the selection. */
    onSelectionChange?: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /** Approves or denies a permission review. */
    onDecide?: (requestId: string, decision: ConversationRequestDecision) => void;
    /** Disables controls while a prior submission for this surface is in flight. */
    pending?: boolean;
    /** Request-scoped submission failure shown with an in-place retry. */
    error?: UserError;
    /** Renders the gate body expanded from the first paint (blueprint/tests). */
    defaultExpanded?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * ConversationRequestView — renders anything a conversation is waiting on a
 * human for. Structured questions get the input prompt; a paused tool review
 * uses the shared `ApprovalCard`.
 */
export function ConversationRequestView(props: ConversationRequestViewProps) {
    const request = props.request;
    if (request.kind === "userInput")
        return (
            <RigUserInputPrompt
                className={props.className}
                data-testid={props["data-testid"]}
                error={props.error}
                onAnswer={(requestId, answers) => props.onAnswer?.(requestId, answers)}
                {...(props.onSelectionChange ? { onSelectionChange: props.onSelectionChange } : {})}
                pending={props.pending}
                request={request}
                {...(props.selection ? { selection: props.selection } : {})}
                style={props.style}
            />
        );
    return (
        <ConversationGate
            className={props.className}
            data-testid={props["data-testid"]}
            defaultExpanded={props.defaultExpanded}
            onDecide={props.onDecide}
            pending={props.pending}
            request={request}
            style={props.style}
        />
    );
}

type GateRequest = Exclude<ConversationRequest, { kind: "userInput" }>;

function ConversationGate(props: {
    request: GateRequest;
    onDecide?: (requestId: string, decision: ConversationRequestDecision) => void;
    pending?: boolean;
    defaultExpanded?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}) {
    // Expansion is this card's own presentation, not product state: it must not
    // survive in a store, and collapsing one gate never affects another.
    const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
    const request = props.request;
    return (
        <ApprovalCard
            className={props.className}
            data-testid={props["data-testid"]}
            decisionDisabled={props.pending || props.onDecide === undefined}
            expanded={expanded}
            onExpandedChange={setExpanded}
            onResolutionChange={(resolution) => {
                if (props.pending || resolution === "pending") return;
                props.onDecide?.(request.requestId, resolution === "approved" ? "approve" : "deny");
            }}
            request={approvalRequestOf(request)}
            resolution={resolutionOf(request)}
            style={props.style}
        />
    );
}

function resolutionOf(_request: GateRequest): ApprovalResolution {
    return "pending";
}

function approvalRequestOf(request: GateRequest): ApprovalRequest {
    if (request.kind === "permissionReview")
        return {
            action: request.tool.display ?? request.tool.toolName,
            agent: "Agent",
            impact: `${request.review.risk} risk`,
            initials: "AG",
            reason: request.review.reason,
            resources: [request.tool.toolName],
            title: request.review.action,
            tone: request.review.risk === "high" ? "rose" : "amber",
            typeLabel: "Permission",
        };
    return {
        action: request.tool.display ?? request.tool.toolName,
        agent: "Agent",
        impact: `${request.review.risk} risk`,
        initials: "AG",
        reason: request.review.reason,
        resources: [request.tool.toolName],
        title: request.review.action,
        tone: request.review.risk === "high" ? "rose" : "amber",
        typeLabel: "Permission",
    };
}

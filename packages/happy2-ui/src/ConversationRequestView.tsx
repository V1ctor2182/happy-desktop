import { useState, type CSSProperties } from "react";
import type { ConversationRequest, ConversationRequestStatus, UserError } from "happy2-state";
import { ApprovalCard, type ApprovalRequest, type ApprovalResolution } from "./ApprovalCard";
import { RigUserInputPrompt, type RigUserInputAnswerMap } from "./RigUserInputPrompt";

export type ConversationRequestDecision = "approve" | "deny";

export type ConversationRequestViewProps = {
    request: ConversationRequest;
    /** Answers a structured question request. */
    onAnswer?: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /** Approves or denies a gate request (permission, plugin, document write). */
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
 * human for. Structured questions get the input prompt; every gate variant
 * (a paused tool, plugin management, a document write) is the same idea to a
 * reader — "an agent wants to do something, decide" — so they share one
 * `ApprovalCard` rather than each stack growing its own approval surface.
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
                pending={props.pending}
                request={request}
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
            decisionDisabled={
                props.pending ||
                props.onDecide === undefined ||
                (request.kind !== "permissionReview" && request.status === "processing")
            }
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

/** A gate's resolution: only `pending` still awaits the reader. */
function resolutionOf(request: GateRequest): ApprovalResolution {
    if (request.kind === "permissionReview") return "pending";
    return approvalResolution(request.status);
}

function approvalResolution(status: ConversationRequestStatus): ApprovalResolution {
    if (status === "approved") return "approved";
    if (status === "pending" || status === "processing") return "pending";
    // Denied, failed, and expired all mean "this will not happen"; the card's
    // denied treatment is the honest rendering for each of them.
    return "denied";
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
    if (request.kind === "pluginManagement")
        return {
            action: `${request.action} ${request.shortName}`,
            agent: "Agent",
            impact: request.lastError ?? request.description,
            initials: initialsOf(request.displayName),
            reason: request.reason ?? request.description,
            resources: [request.shortName],
            title: request.displayName,
            typeLabel: "Plugin",
        };
    return {
        action: `write ${request.documentTitle}`,
        agent: "Agent",
        impact: request.lastError ?? `Expires ${request.expiresAt}`,
        initials: initialsOf(request.documentTitle),
        reason: "An agent wants to write to this document.",
        resources: [request.documentTitle],
        title: request.documentTitle,
        typeLabel: "Document write",
    };
}

function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "?";
    const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return `${first}${second}`.toUpperCase();
}

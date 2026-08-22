/**
 * Classifies a user-slot message that may have been injected by Happy Agent rather than written
 * by the owner. Every Happy Agent transcript uses this one classifier so
 * reconnecting cannot change whether an event reads as dialogue or as
 * transport-only state.
 *
 * Classification uses structured evidence only. Happy Agent's injected text is
 * model-facing prose it is free to reword, so matching sentences would silently
 * misfile messages the day the wording changes.
 */
export function happyAgentInboundMessageOmit(input: {
    /**
     * The daemon marked this element as injected by Happy Agent rather than typed by
     * the owner.
     */
    readonly notification: boolean;
    /**
     * Happy Agent's native encrypted collaboration deliberately gives clients no
     * plaintext, so its visible message has neither text nor attachments.
     * Happy itself cannot submit that shape; its composer requires one or the
     * other. This is therefore an incoming agent message whose content this
     * client is not allowed to read, not an empty owner message.
     */
    readonly opaqueAgent: boolean;
}): boolean {
    /*
     * A lifecycle notification's durable reader-facing state lives on the row
     * that owns it — a delegated child on its own spawn call, a workflow in the
     * Activity surface — so repeating the model-facing sentence as authored
     * dialogue would turn transport plumbing into a content-free chat bubble.
     *
     * An opaque collaboration slot has no reader-visible payload at all.
     */
    if (input.notification || input.opaqueAgent) return true;

    /*
     * A message another agent addressed to this one arrives here too, wrapped
     * in an addressing envelope written for the receiving model. `UserMessage`
     * carries structured provenance, but the transcript projection currently
     * drops it when building `ChatElement`, so this client has no
     * marker separating that envelope from a message the owner typed. It
     * therefore renders normally, envelope and all, until the protocol exposes
     * the signal.
     */
    return false;
}

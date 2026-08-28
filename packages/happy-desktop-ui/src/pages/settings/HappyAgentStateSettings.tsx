import { Box } from "../../Box";
import { CopyButton } from "../../CopyButton";
import { ScrollArea } from "../../Scrollbar";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

/** One named store snapshot, already serialized by whoever owns it. */
export interface HappyAgentStateDocument {
    /** What the snapshot is, in the words its owner uses. */
    readonly description: string;
    readonly id: string;
    readonly label: string;
    /** The snapshot as text. Pretty-printed JSON is what every caller sends. */
    readonly value: string;
}

export interface HappyAgentStateSettingsProps {
    readonly documents: readonly HappyAgentStateDocument[];
}

/**
 * Every live store snapshot this window can see, printed verbatim.
 *
 * It exists so a state question can be answered by reading rather than by
 * guessing from what the ordinary screens happen to render. Nothing here is
 * summarized, relabelled, or filtered: each document is one store's own
 * snapshot serialized by its owner, so what appears is exactly what the surfaces
 * are rendering from. Each one is copyable whole, because the useful thing to do
 * with it is paste it into a bug report.
 *
 * It updates the way every other surface does — through its stores — so a value
 * that changes while this page is open changes here too.
 */
export function HappyAgentStateSettings(props: HappyAgentStateSettingsProps) {
    return (
        <HappyAgentSettingsSection
            description="Every live store snapshot this window holds, exactly as its surfaces read it."
            rows="cards"
            title="Raw state"
        >
            {props.documents.map((document) => (
                <section
                    className="happy-agent-raw-state"
                    data-happy-desktop-ui="happy-agent-raw-state"
                    key={document.id}
                >
                    <header className="happy-agent-raw-state__header">
                        <span className="happy-agent-raw-state__title">{document.label}</span>
                        <span className="happy-agent-raw-state__detail">
                            {document.description}
                        </span>
                        <CopyButton label={`Copy ${document.label} state`} text={document.value} />
                    </header>
                    <ScrollArea
                        axes="both"
                        className="happy-agent-raw-state__scrollport"
                        viewportClassName="happy-agent-raw-state__viewport"
                        viewportProps={{
                            "aria-label": `${document.label} state`,
                            tabIndex: 0,
                        }}
                    >
                        <Box className="happy-agent-raw-state__content">
                            <pre className="happy-agent-raw-state__value">
                                <code>{document.value}</code>
                            </pre>
                        </Box>
                    </ScrollArea>
                </section>
            ))}
        </HappyAgentSettingsSection>
    );
}

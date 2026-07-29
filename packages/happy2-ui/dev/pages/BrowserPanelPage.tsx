import { BrowserPanel, type BrowserContentProps } from "../../src/BrowserPanel";
import { ComponentPage, Specimen } from "../kit";

function BrowserPreview(_props: BrowserContentProps) {
    return (
        <div style={preview}>
            <div style={previewMark}>H</div>
            <div style={previewTitle}>Happy Browser</div>
            <div style={previewCopy}>
                A real Chromium guest occupies this region in the Electron desktop app.
            </div>
        </div>
    );
}

export function BrowserPanelPage() {
    return (
        <ComponentPage
            number="C-161"
            summary="Desktop browser chrome hosting an isolated Chromium page renderer."
            title="Browser panel"
        >
            <Specimen
                detail="active tab · secure address · host-supplied browser content"
                label="Browsing"
                number="01"
                stage="app"
            >
                <div style={frame}>
                    <BrowserPanel
                        active
                        initialUrl="https://happy.engineering/"
                        renderContent={BrowserPreview}
                    />
                </div>
            </Specimen>
            <Specimen
                detail="no native content renderer · honest desktop-only fallback"
                label="Unavailable host"
                number="02"
                stage="app"
            >
                <div style={frame}>
                    <BrowserPanel active initialUrl="about:blank" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}

const frame = {
    display: "flex",
    flexDirection: "column" as const,
    height: "520px",
    width: "760px",
};

const preview = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    flexDirection: "column" as const,
    gap: "12px",
    color: "var(--text)",
    background: "var(--groupped-background)",
};

const previewMark = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "52px",
    height: "52px",
    color: "var(--button-primary-tint)",
    fontSize: "24px",
    fontWeight: 700,
    background: "var(--button-primary-background)",
    borderRadius: "14px",
};

const previewTitle = {
    fontSize: "20px",
    fontWeight: 650,
};

const previewCopy = {
    maxWidth: "360px",
    color: "var(--text-secondary)",
    fontSize: "13px",
    lineHeight: "20px",
    textAlign: "center" as const,
};

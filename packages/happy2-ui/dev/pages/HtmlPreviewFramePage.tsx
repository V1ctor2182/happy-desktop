import { type ReactNode } from "react";
import { FilePreview } from "../../src/FilePreview";
import { HtmlPreviewFrame } from "../../src/HtmlPreviewFrame";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/* The product mounts an Electron guest here. Blueprint mounts a data-URL iframe
   instead: it is the same box with the same sizing, drawn without a network
   fetch, an engine, or anything that renders differently twice. */
const page = `<!doctype html>
<html>
<head><style>
  body { margin: 0; font: 16px/1.5 -apple-system, system-ui, sans-serif; color: #1b1f24; }
  header { padding: 20px 24px; background: #10161c; color: #f6f8fa; }
  h1 { margin: 0; font-size: 20px; }
  main { padding: 20px 24px; }
  .card { border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; }
</style></head>
<body>
  <header><h1>Release notes</h1></header>
  <main>
    <p>The stylesheet, the script, and the images beside this file load from its
       own directory, exactly as they do when it is opened anywhere else.</p>
    <div class="card">A page renders as a page.</div>
  </main>
</body>
</html>`;

const guest = (
    <iframe
        sandbox=""
        src={`data:text/html;charset=utf-8,${encodeURIComponent(page)}`}
        title="Release notes"
    />
);

function frame(children: ReactNode, height = 420, width = 720) {
    return (
        <div
            style={{
                background: "var(--surface)",
                border: "1px solid var(--divider)",
                borderRadius: "10px",
                height: `${height}px`,
                overflow: "hidden",
                width: `${width}px`,
            }}
        >
            {children}
        </div>
    );
}

export function HtmlPreviewFramePage() {
    return (
        <ComponentPage
            number="C-173"
            summary="Where a rendered HTML file sits. The page itself is drawn by the host's engine; this owns the box it fills, the white canvas under it, and what the region says before the page has an address to load from."
            title="HTML preview frame"
        >
            <Specimen
                detail="Guest fills the region · white canvas under a page that sets no background"
                label="Rendered page"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {frame(<HtmlPreviewFrame>{guest}</HtmlPreviewFrame>)}
                    <DimensionRule label="720 × 420 px region · page fills it whole" />
                </div>
            </Specimen>

            <Specimen
                detail="No address yet — the file is open, the page is not served"
                label="Preparing"
                number="02"
                stage="surface"
            >
                {frame(<HtmlPreviewFrame />, 220)}
            </Specimen>

            <Specimen
                detail="Inside FilePreview: Rendered and Source are the two faces of one file"
                label="As a file's rendered face"
                number="03"
                stage="surface"
            >
                {frame(
                    <FilePreview
                        content={{ type: "text", text: page }}
                        path="docs/release-notes.html"
                        rendered={<HtmlPreviewFrame>{guest}</HtmlPreviewFrame>}
                        size="1.1 KB"
                    />,
                    480,
                )}
            </Specimen>
        </ComponentPage>
    );
}

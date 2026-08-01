import { request as httpRequest } from "node:http";
import { htmlPreviewProxyCreate } from "../packages/happy2-desktop/sources/main/htmlPreviewProxy";

const files: Record<string, string> = {
    "site/index.html": "<h1>hello</h1>",
    "site/style.css": "body{color:red}",
    "site/assets/app.js": "console.log(1)",
    "site/logo.png": "PNGDATA",
    "site/.env": "SECRET=1",
    "site/notes.ts": "export const a = 1;",
    "site/sub/index.html": "<p>sub</p>",
    "top-secret.env": "TOP=2",
};
const client = {
    listCatalog: async () => ({ projects: [], workspaces: [] }),
    readFile: async (_s: string, p: string) => {
        const content = files[p];
        if (content === undefined) throw new Error("no such file");
        return { content: Buffer.from(content).toString("base64"), hash: "h" };
    },
} as never;

const proxy = await htmlPreviewProxyCreate();
const previewUrl = proxy.register(client);
const entry = previewUrl("session-1", "site/index.html");
console.log("entry:", entry, "\n");

const auth = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`;

/** Speaks the proxy protocol the way Chromium does: absolute-form request line. */
function via(
    target: string,
    options: { method?: string; headers?: Record<string, string>; noAuth?: boolean } = {},
): Promise<void> {
    const url = new URL(target);
    return new Promise((resolve) => {
        const request = httpRequest(
            {
                host: "127.0.0.1",
                port: proxy.port,
                method: options.method ?? "GET",
                path: url.href,
                headers: {
                    host: url.host,
                    ...(options.noAuth ? {} : { "proxy-authorization": auth }),
                    ...options.headers,
                },
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => chunks.push(chunk));
                response.on("end", () => {
                    const body = Buffer.concat(chunks).toString().slice(0, 26);
                    const type = response.headers["content-type"] ?? "-";
                    const extra = response.headers["content-range"]
                        ? ` range=${String(response.headers["content-range"])}`
                        : response.headers["proxy-authenticate"]
                          ? ` auth=${String(response.headers["proxy-authenticate"])}`
                          : "";
                    console.log(
                        `${String(response.statusCode).padEnd(4)}${(options.method ?? "GET").padEnd(5)}${target}\n     ${type}${extra} ${JSON.stringify(body)}`,
                    );
                    resolve();
                });
            },
        );
        request.on("error", (error) => {
            console.log(`ERR  ${target} ${error.message}`);
            resolve();
        });
        request.end();
    });
}

const origin = new URL(entry).origin;
console.log("=== served from the document's folder ===");
await via(`${origin}/index.html`);
await via(`${origin}/style.css`);
await via(`${origin}/assets/app.js`);
await via(`${origin}/logo.png`);
await via(`${origin}/sub/`);
console.log("\n=== range request (video seeking) ===");
await via(`${origin}/assets/app.js`, { headers: { range: "bytes=0-3" } });
console.log("\n=== refused ===");
await via(`${origin}/.env`);
await via(`${origin}/notes.ts`);
await via(`${origin}/../top-secret.env`);
await via(`${origin}/%2e%2e/top-secret.env`);
await via(`${origin}/index.html`, { method: "POST" });
await via("http://example.com/tracker.js");
await via("http://evil.localhost/index.html");
console.log("\n=== without proxy credentials ===");
await via(`${origin}/index.html`, { noAuth: true });
console.log("\n=== same folder keeps its origin ===");
console.log(previewUrl("session-1", "site/other.html"));
console.log(previewUrl("session-1", "site/sub/index.html"), "(different folder)");

proxy.close();

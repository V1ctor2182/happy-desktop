import { createRoot } from "react-dom/client";
import { App } from "happy2-app";

const platform = new URLSearchParams(window.location.search).has("desktop") ? "desktop" : "web";
// Every web mode authenticates product requests with same-origin cookies: the
// configured sign-in mints one bearer, `/v0/auth/web/session` turns it into the
// HttpOnly cookie, and no token is handled in JavaScript afterwards.
createRoot(document.getElementById("root")!).render(
    <App cookieAuth platform={platform} serverUrl="/" />,
);

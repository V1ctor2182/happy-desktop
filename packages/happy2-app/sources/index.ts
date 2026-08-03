import "./styles.css";

export { App, type AppDesktopRuntime, type AppProps } from "./App";
export {
    AppRigView,
    type AppRigDirectorySnapshot,
    type AppRigDirectoryStore,
    type AppRigEntry,
    type AppRigSession,
    type AppRigUpdate,
    type AppRigViewProps,
} from "./AppRigView";
export { appMemoryHistoryCreate, appRouterCreate, type AppRouter } from "./navigation/appRouter";
export {
    rigMemoryHistoryCreate,
    rigRouterConversationOpen,
    rigRouterGroupOpen,
    rigRouterListOpen,
    rigRouterCreate,
    type RigRouter,
    type RigRouterContext,
} from "./navigation/rigRouter";
export type { AuthCredentialStore } from "./components/AuthGate";
export {
    type DesktopInstanceStatus,
    type DesktopInstanceTarget,
    type DesktopInstanceUpdate,
    DesktopStartupScreen,
    type DesktopStartupValues,
} from "happy2-ui";
export {
    BrowserTerminalConnection,
    TERMINAL_PROTOCOL,
    terminalSocketUrl,
} from "./browserTerminalConnection";
export { terminalDriverCreate } from "./terminalDriver";
export { createServerClient, ServerError } from "./server";
export type { AuthMethods, User } from "./server";

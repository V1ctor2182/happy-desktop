import {
    useLayoutEffect,
    useRef,
    useSyncExternalStore,
    type CSSProperties,
    type FormEvent,
    type ReactNode,
} from "react";
import { happyStateCreate, type HappyState } from "happy2-state";
import {
    Banner,
    Button,
    Fade,
    OnboardingScreen,
    SplashScreen,
    TextField,
    WindowDragRegion,
} from "happy2-ui";
import { createServerClient, ServerError, type AuthMethods, type User } from "../server";
import { authStoreCreate, type AuthStore } from "../authStore";
import { createAuthenticatedTransport } from "../stateTransport";
import { terminalDriverCreate } from "../terminalDriver";
import { portShareAccessCreate } from "../portShareAccess";
import { preAuthOnboardingStep } from "../onboarding/onboardingRoute";
export type AuthSession = {
    state: HappyState;
    user: User;
    /** Deployment capability discovered before authentication; no Settings re-fetch is needed. */
    devTokensEnabled: boolean;
    updateUser: (user: User) => void;
    /**
     * Adopt a freshly uploaded avatar file as the current user's photo. Owns the
     * displayable object URL (revoking the previous one) so the change shows live
     * everywhere the session user is rendered.
     */
    setAvatar: (photoFileId: string) => Promise<void>;
};
/** Async bearer persistence supplied by native hosts such as macOS Keychain. */
export interface AuthCredentialStore {
    get(): Promise<string | undefined>;
    set(value?: string): Promise<void>;
}
type AuthGateProps = {
    serverUrl: string;
    children: (session: AuthSession) => ReactNode;
    showWindowDragRegion?: boolean;
    /** When provided, the pre-application onboarding step is reflected into the URL. */
    /**
     * Cookie deployments (the web gateway) authenticate every request through a
     * same-origin HttpOnly cookie the gateway issues on the first successful bearer
     * request. When true the gate persists no bearer in `localStorage`, keeps the
     * establishing bearer only in memory, and builds a bearer-free workspace
     * transport so subsequent state requests ride the cookie. Header deployments
     * (native) leave it unset and behave exactly as before.
     */
    cookieAuth?: boolean;
    credentialStore?: AuthCredentialStore;
};
const tokenKey = "happy2.session-token";
/* The <form> is a single child of the OnboardingScreen form slot, so the slot's gap
   can't reach its fields — space them here so the last field never butts up
   against the submit button. */
const formStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
};
export function AuthGate(props: AuthGateProps) {
    const clientRef = useRef<ReturnType<typeof createServerClient> | undefined>(undefined);
    clientRef.current ??= createServerClient(props.serverUrl);
    const client = clientRef.current;
    const authStoreRef = useRef<AuthStore | undefined>(undefined);
    authStoreRef.current ??= authStoreCreate();
    const authStore = authStoreRef.current;
    const model = useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get);
    const update = authStore.authUpdate;
    const {
        mode,
        methods,
        user,
        state,
        isRegistering,
        email,
        password,
        firstName,
        username,
        devToken,
        usingDevToken,
        error,
        pending,
        hasBearer,
        loadingMessage,
    } = model;
    const stateRef = useRef<HappyState | undefined>(undefined);
    const methodsRef = useRef<AuthMethods | undefined>(undefined);
    const avatarUrlRef = useRef<string | undefined>(undefined);
    const cookieAuth = props.cookieAuth === true;
    /* Cookie mode keeps the establishing bearer only in memory: it authorizes the
       one `/v0/me`/`createProfile` request that makes the gateway set the cookie,
       and is never written to `localStorage`. Header mode persists it as before. */
    const bearerRef = useRef<string | undefined>(undefined);
    const token = () => bearerRef.current;
    const loadToken = async () => {
        if (cookieAuth) return bearerRef.current;
        const value = props.credentialStore
            ? await props.credentialStore.get()
            : (localStorage.getItem(tokenKey) ?? undefined);
        bearerRef.current = value;
        return value;
    };
    const persistToken = async (value?: string) => {
        bearerRef.current = value;
        update({ hasBearer: value !== undefined });
        if (cookieAuth) {
            return;
        }
        if (props.credentialStore) await props.credentialStore.set(value);
        else if (value) localStorage.setItem(tokenKey, value);
        else localStorage.removeItem(tokenKey);
    };
    async function resolveSession(
        value?: string,
        options: {
            profileRequired?: boolean;
            allowRefresh?: boolean;
        } = {},
    ) {
        const { profileRequired = false, allowRefresh = true } = options;
        await persistToken(value);
        /* A freshly issued token can already tell us the account has no active
         * profile. Enter onboarding on the saved bearer without probing the
         * protected /v0/me route, which intentionally answers 401 until a
         * profile exists. */
        if (profileRequired) {
            update({ mode: "onboarding" });
            return;
        }
        update({ loadingMessage: "Loading your profile.", mode: "loading" });
        let nextState: HappyState | undefined;
        try {
            /* Cookie bootstrap (a bearer in hand) verifies through the gateway's
               `/v0/auth/web/session`, the only request that mints the cookie. A
               cookie-only resume (no bearer) reads the normal `/v0/me`, which the
               browser authenticates with the already-set cookie and which never
               mints one. Header mode keeps its bearer `/v0/me`. */
            const response =
                cookieAuth && value !== undefined
                    ? await client.webSession(value)
                    : await client.me(cookieAuth ? undefined : value);
            nextState = happyStateCreate({
                initialPermissions: response.permissions,
                // Cookie mode rides the HttpOnly cookie the verification above just
                // established, so its transport carries no Authorization header.
                transport: createAuthenticatedTransport(
                    props.serverUrl,
                    cookieAuth ? undefined : value,
                ),
                terminalDriverCreate,
                portShareAccess: portShareAccessCreate(),
            });
            await nextState.syncStart();
            const profile = await loadAvatar(response.user, nextState);
            stateRef.current?.[Symbol.dispose]();
            stateRef.current = nextState;
            update({ state: nextState, user: profile, mode: "ready" });
        } catch (reason) {
            nextState?.[Symbol.dispose]();
            if (!(reason instanceof ServerError) || reason.status !== 401) throw reason;
            // A local capability is desktop-owned, cannot be refreshed, and has no
            // account sign-in fallback. Let the probe surface an unavailable server
            // if the native host and server ever disagree about the capability.
            if (methodsRef.current?.method === "local") throw reason;
            if (value && allowRefresh) {
                try {
                    const refreshed = await client.refresh(value);
                    return resolveSession(refreshed.token, {
                        profileRequired: refreshed.profileRequired,
                        allowRefresh: false,
                    });
                } catch (refreshReason) {
                    if (!(refreshReason instanceof ServerError) || refreshReason.status !== 401)
                        throw refreshReason;
                    await persistToken(undefined);
                    if (methodsRef.current?.method === "cloudflare_access")
                        return resolveSession(undefined, { allowRefresh: false });
                    update({ mode: "sign-in" });
                    return;
                }
            }
            update({
                mode: methodsRef.current?.method === "cloudflare_access" ? "onboarding" : "sign-in",
            });
        }
    }
    async function loadAvatar(profile: User, model: HappyState): Promise<User> {
        if (!profile.photoFileId) return profile;
        try {
            if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
            const contents = await model.fileDownload(profile.photoFileId);
            avatarUrlRef.current = URL.createObjectURL(new Blob([contents]));
            return { ...profile, avatarUrl: avatarUrlRef.current };
        } catch {
            return profile;
        }
    }
    async function setAvatar(photoFileId: string): Promise<void> {
        const current = user;
        const model = state;
        if (!current || !model) return;
        const contents = await model.fileDownload(photoFileId);
        if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
        avatarUrlRef.current = URL.createObjectURL(new Blob([contents]));
        update({ user: { ...current, photoFileId, avatarUrl: avatarUrlRef.current } });
    }
    // eslint-disable-next-line happy2-react/no-layout-effect -- the authenticated HappyState and avatar object URL are imperative resources owned by this mounted gate and both are released completely on unmount
    useLayoutEffect(
        () => () => {
            stateRef.current?.[Symbol.dispose]();
            if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
        },
        [],
    );
    /* Probes the server for its authentication method and public setup phase, then
     * routes to the first pre-application step. It is the single entry the mount
     * and the unavailable-screen retry both call, so recovery happens in place —
     * no remount and no location.reload — and the email/password/profile fields
     * keep whatever the user has already typed. The public setup status is
     * required for canonical fresh-install routing, so a failure surfaces the
     * unavailable screen instead of silently guessing sign-in. */
    async function probeServer(): Promise<void> {
        update({
            error: undefined,
            pending: true,
            loadingMessage: "Checking the server and your saved session.",
            mode: "loading",
        });
        try {
            const [supported, setupStatus] = await Promise.all([
                client.methods(),
                client.setupStatus(),
            ]);
            methodsRef.current = supported;
            update({
                methods: supported,
                phase: setupStatus.phase,
                registration: setupStatus.registration,
            });
            /* Open the password screen on first-account creation only while
             * registration actually permits bootstrap creation. A provisional
             * bootstrap account whose registration has closed must default to
             * sign-in so it can authenticate and resume profile creation. */
            if (
                supported.method === "password" &&
                preAuthOnboardingStep(setupStatus.phase, setupStatus.registration) ===
                    "bootstrap-account"
            )
                update({ isRegistering: true });
            const saved = await loadToken();
            if (supported.method === "local") {
                if (!props.credentialStore || !saved)
                    throw new Error("The desktop local capability is unavailable.");
                await resolveSession(saved, { allowRefresh: false });
            } else if (saved) await resolveSession(saved);
            else if (supported.method === "cloudflare_access") {
                update({ loadingMessage: "Checking your Cloudflare Access session." });
                await resolveSession(undefined, { allowRefresh: false });
            } else if (cookieAuth) {
                /* An existing HttpOnly cookie can't be read from JavaScript, so
                   probe it directly with a bearer-free `/v0/me`: a live cookie
                   resumes the workspace, and its absence falls through to sign-in. */
                update({ loadingMessage: "Checking your saved session." });
                await resolveSession(undefined, { allowRefresh: false });
            } else update({ mode: "sign-in" });
        } catch {
            /* The probe reason is deliberately dropped: it carries raw upstream
               and network detail (hosts, ports, exception text) that must never
               reach the product-safe unavailable screen. */
            update({ error: undefined, mode: "unavailable" });
        } finally {
            update({ pending: false });
        }
    }
    const initialProbeStarted = useRef(false);
    // eslint-disable-next-line happy2-react/no-layout-effect -- the first server capability and saved-session probe is a mount-scoped asynchronous integration that must start only after the gate commits
    useLayoutEffect(() => {
        if (initialProbeStarted.current) return;
        initialProbeStarted.current = true;
        void probeServer();
    });
    async function submitCredentials(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        update({ pending: true, error: undefined });
        try {
            const response = isRegistering
                ? await client.register(email, password)
                : await client.login(email, password);
            await resolveSession(response.token, { profileRequired: response.profileRequired });
        } catch (reason) {
            update({ error: message(reason), mode: "sign-in" });
        } finally {
            update({ pending: false });
        }
    }
    async function submitProfile(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const saved = token();
        if (!saved && methods?.method !== "cloudflare_access") {
            update({ mode: "sign-in" });
            return;
        }
        update({ pending: true, error: undefined });
        try {
            await client.createProfile({ firstName: firstName, username: username }, saved);
            await resolveSession(saved, { allowRefresh: false });
        } catch (reason) {
            update({ error: message(reason) });
        } finally {
            update({ pending: false });
        }
    }
    /* A development token is an ordinary bearer, so cookie mode can bootstrap the
       HttpOnly cookie from one exactly the way it bootstraps from a password login.
       Offered only when the server says it will accept one, because anywhere else
       the token is rejected and the option would be a dead end. It is an
       alternative to the configured method, never a replacement for it. */
    async function submitDevToken(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const value = devToken.trim();
        if (!value || pending) return;
        update({ pending: true, error: undefined, loadingMessage: "Checking your token." });
        try {
            /* Spend the token once on the only request that mints the cookie. A
               development token carries no refresh grant, so it is validated here
               rather than through resolveSession's bearer path, which would try to
               refresh it on rejection. */
            await client.webSession(value);
        } catch (reason) {
            update({ pending: false, error: devTokenError(reason), mode: "sign-in" });
            return;
        }
        /* The cookie now exists, so resume exactly like any other cookie session:
           bearer-free, refresh-free, and holding no copy of the token. */
        try {
            update({ devToken: "" });
            await resolveSession(undefined, { allowRefresh: false });
        } catch (reason) {
            update({ error: message(reason), mode: "sign-in" });
        } finally {
            update({ pending: false });
        }
    }
    const isPasswordSignIn = () =>
        mode === "sign-in" && methods?.method === "password" && !usingDevToken;
    /* Development tokens reach the workspace through the same cookie the configured
       sign-in mints, so they are only useful in cookie deployments. */
    const devTokenOffered = () =>
        mode === "sign-in" && cookieAuth && methods?.devTokensEnabled === true;
    const isDevTokenSignIn = () => devTokenOffered() && usingDevToken;
    const loadingHeadline = { kicker: "Connecting to your workspace", title: "One moment." };
    const headline = (): {
        kicker?: string;
        title: string;
        copy?: string;
    } => {
        switch (mode) {
            case "loading":
                return loadingHeadline;
            case "unavailable":
                return {
                    kicker: "Connection needed",
                    title: "Can't reach your workspace.",
                    copy: "We couldn't connect to your workspace. Check your connection and try again.",
                };
            case "onboarding":
                return {
                    kicker: "Profile required",
                    title: "Make it yours.",
                    copy: "A profile activates your account and unlocks the workspace.",
                };
            case "sign-in":
                if (isDevTokenSignIn())
                    return {
                        kicker: "Development access",
                        title: "Sign in to Happy (2).",
                        copy: "Enter a development token to open this workspace.",
                    };
                if (methods?.method === "password")
                    return {
                        kicker: isRegistering ? "Create your account" : "Welcome back",
                        title: isRegistering ? "Set up Happy Place." : "Sign in to Happy Place.",
                        copy: isRegistering
                            ? "Your profile comes next."
                            : "Use the account you already created.",
                    };
                return {
                    kicker: "Authentication configured",
                    title:
                        methods?.method === "magic_link"
                            ? "Check your email."
                            : "Continue in your browser.",
                    copy: `This workspace currently uses ${methods?.method?.replace("_", " ") ?? "no"} authentication. Password sign-in is unavailable.`,
                };
            default:
                return { title: "One moment." };
        }
    };
    const submitLabel = () => (pending ? "Working…" : isRegistering ? "Create account" : "Sign in");
    /* Both toggles are optional, so the footer stays absent rather than rendering an
       empty slot when neither applies. */
    const gateFooter = (): ReactNode => {
        const registerToggle = isPasswordSignIn() && methods?.signupEnabled;
        if (!registerToggle && !devTokenOffered()) return null;
        return (
            <>
                {registerToggle ? (
                    <Button
                        onClick={() => {
                            update({ isRegistering: !isRegistering, error: undefined });
                        }}
                        size="small"
                        type="button"
                        variant="ghost"
                    >
                        {isRegistering ? "I already have an account" : "Create a new account"}
                    </Button>
                ) : null}
                {devTokenOffered() ? (
                    <Button
                        onClick={() => {
                            update({ usingDevToken: !usingDevToken, error: undefined });
                        }}
                        size="small"
                        type="button"
                        variant="ghost"
                    >
                        {usingDevToken ? "Back to sign in" : "Use a development token"}
                    </Button>
                ) : null}
            </>
        );
    };
    // Loading, sign-in, and profile activation update inside one stable gate
    // layer. Only the body scrollport remounts when the mode lifetime changes.
    const renderGate = () => (
        <>
            {props.showWindowDragRegion ? <WindowDragRegion /> : null}
            <OnboardingScreen
                bodyKey={mode}
                brand={{ name: "Happy Place" }}
                copy={mode === "loading" ? undefined : headline().copy}
                data-testid="auth-onboarding-screen"
                kicker={mode === "loading" ? loadingHeadline.kicker : headline().kicker}
                loadingLabel={loadingMessage}
                state={mode === "loading" ? "loading" : "form"}
                title={mode === "loading" ? loadingHeadline.title : headline().title}
                footer={gateFooter()}
            >
                {mode === "unavailable" ? (
                    /* The fixed headline/copy plus this retry are the complete
                       unavailable state. No error Banner: the probe failure carries
                       raw upstream/network detail (hosts, ports, exception text) that
                       must never render, and it is dropped in probeServer's catch. */
                    <Button disabled={pending} onClick={() => void probeServer()} type="button">
                        Try again
                    </Button>
                ) : isDevTokenSignIn() ? (
                    <form onSubmit={submitDevToken} style={formStyle}>
                        <TextField
                            autoComplete="off"
                            data-testid="development-token-field"
                            fullWidth
                            label="Development token"
                            onValueChange={(value) => update({ devToken: value })}
                            required
                            value={devToken}
                        />
                        {error
                            ? ((reason) => (
                                  <Banner tone="danger" title="Sign-in failed">
                                      {reason}
                                  </Banner>
                              ))(error)
                            : null}
                        <Button
                            disabled={pending || devToken.trim().length === 0}
                            fullWidth
                            type="submit"
                        >
                            {pending ? "Working…" : "Sign in"}
                        </Button>
                    </form>
                ) : isPasswordSignIn() ? (
                    <form onSubmit={submitCredentials} style={formStyle}>
                        <TextField
                            autoComplete="email"
                            fullWidth
                            label="Email"
                            onValueChange={(value) => update({ email: value })}
                            required
                            type="email"
                            value={email}
                        />
                        <TextField
                            autoComplete="current-password"
                            fullWidth
                            label="Password"
                            onValueChange={(value) => update({ password: value })}
                            required
                            type="password"
                            value={password}
                        />
                        {error
                            ? ((reason) => (
                                  <Banner tone="danger" title="Sign-in failed">
                                      {reason}
                                  </Banner>
                              ))(error)
                            : null}
                        <Button disabled={pending} fullWidth type="submit">
                            {submitLabel()}
                        </Button>
                    </form>
                ) : mode === "onboarding" ? (
                    <form onSubmit={submitProfile} style={formStyle}>
                        <TextField
                            autoComplete="given-name"
                            fullWidth
                            label="First name"
                            onValueChange={(value) => update({ firstName: value })}
                            required
                            value={firstName}
                        />
                        <TextField
                            autoComplete="username"
                            fullWidth
                            label="Username"
                            onValueChange={(value) => update({ username: value })}
                            required
                            value={username}
                        />
                        {error
                            ? ((reason) => (
                                  <Banner tone="danger" title="Could not activate">
                                      {reason}
                                  </Banner>
                              ))(error)
                            : null}
                        <Button disabled={pending} fullWidth type="submit">
                            {pending ? "Activating…" : "Activate workspace"}
                        </Button>
                    </form>
                ) : null}
            </OnboardingScreen>
        </>
    );
    /* One stable session object whose `state`/`user` are getters, so every
       consumer reactively tracks profile and avatar changes instead of holding
       the snapshot captured when the gate first opened. */
    const session: AuthSession = {
        get state() {
            return state!;
        },
        get user() {
            return user!;
        },
        get devTokensEnabled() {
            return methods?.devTokensEnabled === true;
        },
        updateUser: (nextUser) => update({ user: nextUser }),
        setAvatar,
    };
    /* The first probe has nothing to say yet — it either resolves into a form or
       straight into the workspace — so the window holds the mark until it does
       and dissolves from there, instead of flashing a card that is about to be
       replaced. Later loading (signing in, loading a profile) has a message worth
       reading, so it stays in the card. */
    const booting = () => mode === "loading" && methods === undefined;
    /* True once the session is fully resolved and the workspace can take over. */
    const sessionReady = () =>
        mode === "ready" &&
        !!user &&
        (cookieAuth || hasBearer || methods?.method === "cloudflare_access") &&
        !!state;
    // Fade covers the splash → gate and gate → app dissolves. Probe resolution
    // within the gate and every form-mode transition retain the same card DOM
    // node, so only these two boundaries crossfade.
    const screenKey = (): "splash" | "gate" | "app" =>
        sessionReady() ? "app" : booting() ? "splash" : "gate";
    const renderScreen = (key: string | number) => {
        if (key === "app") return props.children(session);
        if (key === "splash") return renderSplash();
        return renderGate();
    };
    function renderSplash() {
        return (
            <>
                {props.showWindowDragRegion ? <WindowDragRegion /> : null}
                <SplashScreen data-testid="auth-splash-screen" label="Happy Place" />
            </>
        );
    }
    return <Fade active={screenKey()} data-testid="auth-gate" render={renderScreen} />;
}
function message(reason: unknown): string {
    return reason instanceof Error ? reason.message : "Something went wrong.";
}
/* A rejected token is distinct from an unreachable origin, but neither may leak
   raw upstream or network detail into the product surface. */
function devTokenError(reason: unknown): string {
    if (reason instanceof ServerError && reason.status !== 0)
        return "That development token wasn't accepted. Check it and try again.";
    return "We couldn't reach your workspace. Check your connection and try again.";
}

import type { RigConnection } from "@slopus/rig-connect";
import type {
    RigFriendAnswer,
    RigFriendsSource,
    RigFriendsSourceProfile,
    RigFriendsSourceReading,
    RigFriendsSignupInput,
} from "happy-desktop-state";

/**
 * How often the daemon is asked again while someone is looking at Friends. The
 * daemon has no stream for this yet, so the surface is kept current by reading
 * it — often enough that a request arriving feels immediate, rarely enough that
 * a machine is not interrogated. Nothing is read at all while the surface is
 * closed or the window is hidden.
 */
const POLL_INTERVAL_MS = 4_000;

/** Options every Murmur call on the daemon accepts. */
interface MurmurCallOptions {
    signal?: AbortSignal;
}

interface MurmurPhoto {
    readonly data: string;
    readonly mediaType: string;
}

interface MurmurProfile {
    readonly firstName: string;
    readonly lastName: string;
    readonly photo?: MurmurPhoto;
}

interface MurmurAccount {
    readonly id: string;
    readonly profile: MurmurProfile;
    readonly token: string;
}

interface MurmurServiceState {
    readonly status: "running" | "stopped";
}

interface MurmurAccountResponse {
    readonly account?: MurmurAccount;
    readonly service: MurmurServiceState;
}

interface MurmurFriendRequest {
    readonly id: string;
    readonly profile: MurmurProfile;
    readonly receivedAt: number;
    readonly senderId: string;
}

interface MurmurContact {
    readonly addedAt: number;
    readonly id: string;
    readonly profile: MurmurProfile;
}

/**
 * The daemon's Murmur calls, named structurally rather than imported.
 *
 * `rig-connect` grows these methods in the release that carries the Murmur
 * protocol, so this window has to work against a daemon client that has them and
 * one that does not: the shape below is exactly the upstream signatures, and the
 * probe underneath decides at runtime which of the two is connected. When the
 * published client has them this interface is satisfied by it unchanged; until
 * then Friends reports that the machine cannot do it rather than failing on a
 * call that is not there.
 */
interface MurmurCalls {
    getMurmurAccount(options?: MurmurCallOptions): Promise<MurmurAccountResponse>;
    signupMurmurAccount(
        request: { firstName: string; lastName: string; photo?: MurmurPhoto },
        options?: MurmurCallOptions,
    ): Promise<MurmurAccountResponse>;
    startMurmurService(
        request?: { relayUrls?: readonly string[] },
        options?: MurmurCallOptions,
    ): Promise<unknown>;
    listMurmurFriendRequests(
        options?: MurmurCallOptions,
    ): Promise<{ requests: readonly MurmurFriendRequest[] }>;
    answerMurmurFriendRequest(
        requestId: string,
        answer: RigFriendAnswer,
        options?: MurmurCallOptions,
    ): Promise<unknown>;
    sendMurmurFriendRequest(token: string, options?: MurmurCallOptions): Promise<unknown>;
    listMurmurContacts(
        options?: MurmurCallOptions,
    ): Promise<{ contacts: readonly MurmurContact[] }>;
}

const MURMUR_METHODS = [
    "getMurmurAccount",
    "signupMurmurAccount",
    "startMurmurService",
    "listMurmurFriendRequests",
    "answerMurmurFriendRequest",
    "sendMurmurFriendRequest",
    "listMurmurContacts",
] as const satisfies readonly (keyof MurmurCalls)[];

/** The connection's Murmur calls, or nothing when this daemon client has none. */
function murmurCalls(rig: RigConnection): MurmurCalls | undefined {
    const candidate = rig as unknown as Partial<Record<keyof MurmurCalls, unknown>>;
    return MURMUR_METHODS.every((method) => typeof candidate[method] === "function")
        ? (rig as unknown as MurmurCalls)
        : undefined;
}

/**
 * Adapts the daemon's Murmur calls to the friends store's source contract, or
 * reports that this daemon has none.
 *
 * Friends is the second thing the daemon does not stream. The read cycle
 * therefore starts when the store's first subscriber arrives and stops when its
 * last one leaves, and a decision — signing up, answering a request — reads again
 * as soon as the daemon confirms it, so the surface catches up with what was
 * just done instead of waiting out an interval.
 *
 * Receiving a request at all requires the machine's Murmur service to be
 * running, so an account whose service is stopped is started here: it is a
 * condition of the reading rather than something to ask a person to do.
 */
export function rigConnectFriendsSourceCreate(rig: RigConnection): RigFriendsSource | undefined {
    const calls = murmurCalls(rig);
    if (!calls) return undefined;
    const refreshers = new Set<() => void>();
    const refresh = (): void => {
        for (const refresher of refreshers) refresher();
    };
    return {
        subscribe(listener, onError) {
            let closed = false;
            let reading = false;
            let refreshQueued = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const controller = new AbortController();
            const finish = (): void => {
                reading = false;
                if (closed) return;
                if (refreshQueued && !documentHidden()) {
                    refreshQueued = false;
                    read();
                    return;
                }
                schedule();
            };
            const read = (): void => {
                if (closed) return;
                if (timer !== undefined) clearTimeout(timer);
                timer = undefined;
                // A hidden window is not a window anyone is reading. Its
                // visibility listener resumes the cycle, so no timer needs to
                // wake while the application is in the background.
                if (documentHidden()) return;
                // An action can ask for an immediate refresh while the regular
                // reading is still in flight. Queue exactly one follow-up so an
                // older response can never arrive after a newer one.
                if (reading) {
                    refreshQueued = true;
                    return;
                }
                reading = true;
                readingRead(calls, controller.signal).then(
                    (reading) => {
                        if (closed) return;
                        listener(reading);
                        finish();
                    },
                    (error: unknown) => {
                        if (closed) return;
                        onError(error);
                        finish();
                    },
                );
            };
            const schedule = (): void => {
                if (closed || timer !== undefined || documentHidden()) return;
                timer = setTimeout(read, POLL_INTERVAL_MS);
            };
            const visibilityChanged = (): void => {
                if (closed) return;
                if (documentHidden()) {
                    if (timer !== undefined) clearTimeout(timer);
                    timer = undefined;
                    return;
                }
                read();
            };
            refreshers.add(read);
            if (typeof document !== "undefined")
                document.addEventListener("visibilitychange", visibilityChanged);
            read();
            return () => {
                if (closed) return;
                closed = true;
                refreshers.delete(read);
                if (typeof document !== "undefined")
                    document.removeEventListener("visibilitychange", visibilityChanged);
                if (timer !== undefined) clearTimeout(timer);
                controller.abort();
            };
        },
        async signup(input: RigFriendsSignupInput) {
            await calls.signupMurmurAccount(signupRequest(input));
            // A new account's service is not running yet. Failing to start it
            // does not undo the profile that now exists, so the signup still
            // succeeded: the next reading finds the service stopped, tries
            // again, and states the failure there rather than on a form whose
            // work is done.
            await serviceStart(calls).catch(() => undefined);
            refresh();
        },
        async requestAnswer(requestId: string, answer: RigFriendAnswer) {
            await calls.answerMurmurFriendRequest(requestId, answer);
            refresh();
        },
        async requestSend(token: string) {
            await calls.sendMurmurFriendRequest(token);
            // An outgoing request changes nothing in this machine's own lists,
            // but the other machine may already have answered — a code exchanged
            // in person usually is — so the reading is taken again rather than
            // assuming there is nothing new to see.
            refresh();
        },
    };
}

/** Whether this window is on screen; a hidden one reads nothing. */
function documentHidden(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function signupRequest(input: RigFriendsSignupInput): {
    firstName: string;
    lastName: string;
    photo?: MurmurPhoto;
} {
    return {
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.photo
            ? { photo: { data: input.photo.data, mediaType: input.photo.mediaType } }
            : {}),
    };
}

/**
 * Starts the machine's Murmur service, which is what makes it reachable.
 *
 * Signing up persists an account and stops there, so nothing syncs until this is
 * called: it is the step that turns a stored profile into a machine other people
 * can reach.
 */
async function serviceStart(calls: MurmurCalls, signal?: AbortSignal): Promise<void> {
    await calls.startMurmurService(undefined, signal ? { signal } : undefined);
}

/**
 * One complete reading: who this machine is, who is asking for it, and who it
 * knows. A machine with no account has nothing else to read — requests and
 * contacts belong to an identity — so the reading stops there.
 */
async function readingRead(
    calls: MurmurCalls,
    signal: AbortSignal,
): Promise<RigFriendsSourceReading> {
    const { account, service } = await calls.getMurmurAccount({ signal });
    if (!account) return { requests: [], friends: [], loading: false };
    // Requests only arrive at a machine whose service is up, and an account that
    // was signed up earlier comes back stopped, so a stopped one is started
    // before its queue is believed to be empty.
    if (service.status === "stopped") await serviceStart(calls, signal);
    const [requests, contacts] = await Promise.all([
        calls.listMurmurFriendRequests({ signal }),
        calls.listMurmurContacts({ signal }),
    ]);
    return {
        account: {
            id: account.id,
            profile: profileRead(account.profile),
            token: account.token,
        },
        requests: requests.requests.map((request) => ({
            id: request.id,
            senderId: request.senderId,
            profile: profileRead(request.profile),
            receivedAt: request.receivedAt,
        })),
        friends: contacts.contacts.map((contact) => ({
            id: contact.id,
            profile: profileRead(contact.profile),
            addedAt: contact.addedAt,
        })),
        loading: false,
    };
}

/**
 * A person as the surface shows them. The daemon hands the picture over as
 * bytes, so it becomes a data URL here: a picture that is already in memory
 * should not need a second fetch to be seen.
 */
function profileRead(profile: MurmurProfile): RigFriendsSourceProfile {
    const photo = profile.photo;
    return {
        firstName: profile.firstName,
        ...(profile.lastName === "" ? {} : { lastName: profile.lastName }),
        ...(photo ? { photoUrl: `data:${photo.mediaType};base64,${photo.data}` } : {}),
    };
}

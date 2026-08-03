import type {
    DesktopPluginInventory,
    DesktopPluginInventoryFrame,
} from "../shared/desktopContract";

/**
 * A renderer, as this registry needs to know one: something that can be gone.
 * Everything else about a window belongs to whoever wired this up.
 */
export interface InventoryFollowerTarget {
    isDestroyed(): boolean;
}

export interface InventoryFollowerRegistryOptions<Target extends InventoryFollowerTarget> {
    /** The reading as it stands, projected in the same turn a follow is answered. */
    readonly inventoryRead: () => DesktopPluginInventory;
    /** Starts or stops the projection this process runs for its windows. */
    readonly followSet: (following: boolean) => void;
    /** Hands one reading to one renderer. */
    readonly send: (target: Target, frame: DesktopPluginInventoryFrame) => void;
    /**
     * Watches one renderer for the ways it can stop reading without saying so,
     * and answers with the way to stop watching it. Watching starts when a
     * renderer starts reading and stops when it stops, so a window that reads,
     * navigates, and reads again does not accumulate a second set of watches.
     */
    readonly watch: (target: Target, lost: () => void) => () => void;
}

/** One renderer that is reading, and the projection it named. */
interface Follower {
    count: number;
    readonly forget: () => void;
    token: string;
}

/**
 * Who is reading what is installed, and under which projection.
 *
 * A projection is expensive enough to be worth not running: the packages are
 * held as the daemon's own objects and only become a renderer-shaped reading
 * while somebody wants one. So it is followed rather than broadcast, and the
 * count is per renderer, so one window closing, crashing, or navigating cannot
 * cancel another window's reading and a window that dies without saying so does
 * not leave the projection running forever.
 *
 * Every reading and every stop is named with the projection it belongs to. A
 * message already handed to the channel is delivered whatever has happened
 * since, so a window that stops reading and starts again can be sent a reading
 * belonging to the projection it left, and can have its stop for that projection
 * arrive after it has opened another. Neither may be taken for current: the
 * first would be counted as the newest thing the window had been told, and the
 * second would close a projection it was never about. The name is the window's
 * own and opaque here, which is what makes it authoritative — the window is the
 * only thing that knows which of its own projections it is on.
 */
export class InventoryFollowerRegistry<Target extends InventoryFollowerTarget> {
    readonly #followers = new Map<Target, Follower>();
    readonly #options: InventoryFollowerRegistryOptions<Target>;

    constructor(options: InventoryFollowerRegistryOptions<Target>) {
        this.#options = options;
    }

    /**
     * Starts, or joins, one renderer's reading of what is installed, and answers
     * with the reading as it stands. Projecting and reading happen in this one
     * turn, so nothing the daemon says can land between them and go unreported.
     */
    follow(target: Target, token: string): DesktopPluginInventoryFrame {
        const follower = this.#followers.get(target);
        if (follower?.token === token) follower.count += 1;
        else if (follower) {
            // The window has named a new projection without this side having seen
            // the last of the old one's readers leave. The window is the authority
            // on its own reading, so the count starts again here too; the watches
            // it is already under stay exactly as they are.
            follower.token = token;
            follower.count = 1;
        } else {
            const lost = () => this.#release(target);
            this.#followers.set(target, {
                count: 1,
                forget: this.#options.watch(target, lost),
                token,
            });
            this.#sync();
        }
        // Named with the projection it was asked for, which is not always the one
        // the window is on by the time it reads the answer.
        return { inventory: this.#options.inventoryRead(), token };
    }

    /**
     * Stops one reader. A stop belongs to the projection it was sent for: one
     * that arrives after the window has started another cannot be counted against
     * it or close it.
     */
    unfollow(target: Target, token: string): void {
        const follower = this.#followers.get(target);
        if (follower?.token !== token) return;
        if (follower.count > 1) {
            follower.count -= 1;
            return;
        }
        this.#release(target);
    }

    /** Hands one reading to everybody reading, each under its own projection. */
    publish(inventory: DesktopPluginInventory): void {
        for (const [target, follower] of this.#followers) {
            if (target.isDestroyed()) continue;
            this.#options.send(target, { inventory, token: follower.token });
        }
    }

    /** How many renderers are reading. The projection runs while this is not zero. */
    get size(): number {
        return this.#followers.size;
    }

    #release(target: Target): void {
        const follower = this.#followers.get(target);
        if (!follower) return;
        this.#followers.delete(target);
        follower.forget();
        this.#sync();
    }

    #sync(): void {
        this.#options.followSet(this.#followers.size > 0);
    }
}

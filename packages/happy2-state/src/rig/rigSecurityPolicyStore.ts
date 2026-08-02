import type { RigTransport } from "./rigTransport.js";
import {
    rigGlobalDocumentStoreCreate,
    type RigGlobalDocumentSnapshot,
    type RigGlobalDocumentStore,
} from "./rigInstructionsStore.js";

/** How much security policy text one Rig will keep in its global `SECURITY.md`. */
export const RIG_SECURITY_POLICY_MAX_BYTES = 32 * 1024;

export type RigSecurityPolicySnapshot = RigGlobalDocumentSnapshot;
export type RigSecurityPolicyStore = RigGlobalDocumentStore;

export interface RigSecurityPolicyStoreDeps {
    readonly transport: Pick<
        RigTransport,
        "globalSecurityPolicyRead" | "globalSecurityPolicyWrite"
    >;
}

/** Creates the editor store for the policy used when this Rig reviews permission requests. */
export function rigSecurityPolicyStoreCreate(
    deps: RigSecurityPolicyStoreDeps,
): RigSecurityPolicyStore {
    return rigGlobalDocumentStoreCreate({
        read: (signal) => deps.transport.globalSecurityPolicyRead(signal),
        write: (value) => deps.transport.globalSecurityPolicyWrite(value),
    });
}

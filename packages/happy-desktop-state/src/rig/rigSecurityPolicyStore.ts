import type { HappyAgentClient } from "@slopus/happy-agent-client";
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
    readonly client: Pick<HappyAgentClient, "getSecurityPolicy" | "putSecurityPolicy">;
}

/** Creates the editor store for the policy used when this Rig reviews permission requests. */
export function rigSecurityPolicyStoreCreate(
    deps: RigSecurityPolicyStoreDeps,
): RigSecurityPolicyStore {
    return rigGlobalDocumentStoreCreate({
        read: async (signal) => (await deps.client.getSecurityPolicy({ signal })).policy,
        write: async (value) => (await deps.client.putSecurityPolicy(value)).policy,
    });
}

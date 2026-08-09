import { describe, expect, it, vi } from "vitest";

import {
    rigSharingStoreCreate,
    type RigSharingReading,
    type RigSharingSource,
} from "./rigSharingStore.js";
import type { RigFolderId } from "./rigTypes.js";

const BEFORE_RESET: RigSharingReading = {
    connection: "connected",
    identity: "old-identity",
    profileId: "profile-1",
    contacts: [{ identity: "contact-1", status: "active" }],
    incomingRequests: [{ id: "incoming-1", identity: "contact-2" }],
    outgoingRequests: [{ id: "outgoing-1", identity: "contact-3" }],
    folderShares: [
        {
            groupId: "group-1",
            rootFolderId: "folder-1" as RigFolderId,
            members: ["old-identity", "contact-1"],
            status: "synced",
        },
    ],
};

const AFTER_RESET: RigSharingReading = {
    connection: "connected",
    identity: "new-identity",
    profileId: "profile-1",
    contacts: [],
    incomingRequests: [],
    outgoingRequests: [],
    folderShares: [],
};

describe("rigSharingStore Murmur reset", () => {
    it("clears sharing optimistically and reconciles the replacement identity", async () => {
        let resolveReset!: (reading: RigSharingReading) => void;
        const reset = vi.fn(
            () =>
                new Promise<RigSharingReading>((resolve) => {
                    resolveReset = resolve;
                }),
        );
        const source: RigSharingSource = {
            subscribe(listener) {
                listener(BEFORE_RESET);
                return () => undefined;
            },
            invitationCreate: vi.fn(),
            contactRequest: vi.fn(),
            requestAnswer: vi.fn(),
            contactRemove: vi.fn(),
            folderShare: vi.fn(),
            reset,
        };
        const store = rigSharingStoreCreate({ source });
        const unsubscribe = store.subscribe(() => undefined);
        try {
            store.resetOpen();
            store.resetConfirm();

            expect(store.get()).toMatchObject({
                connection: "connecting",
                contacts: [],
                folderShares: [],
                incomingRequests: [],
                outgoingRequests: [],
                resetConfirming: true,
                resetting: true,
            });
            expect(store.get().identity).toBeUndefined();
            expect(reset).toHaveBeenCalledOnce();

            resolveReset(AFTER_RESET);
            await vi.waitFor(() => {
                expect(store.get()).toMatchObject({
                    identity: "new-identity",
                    resetConfirming: false,
                    resetting: false,
                });
            });
        } finally {
            unsubscribe();
            store[Symbol.dispose]();
        }
    });
});

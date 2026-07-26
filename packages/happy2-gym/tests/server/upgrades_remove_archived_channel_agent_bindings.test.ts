import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { serverSchemaMigrate } from "happy2-server";
import { describe, expect, it } from "vitest";

const ARCHIVED_BINDINGS_MIGRATION_TIMESTAMP = 1_786_320_000_000;

describe("server upgrades with archived channel agent bindings", () => {
    it("revokes archived channel trees while preserving active bindings and share history", async () => {
        const directory = await mkdtemp(join(tmpdir(), "happy2-gym-archived-binding-upgrade-"));
        const client = createClient({ url: `file:${join(directory, "happy2.db")}` });

        try {
            await serverSchemaMigrate(client);
            await client.execute({
                sql: "DELETE FROM __drizzle_migrations WHERE created_at >= ?",
                args: [ARCHIVED_BINDINGS_MIGRATION_TIMESTAMP],
            });
            await client.migrate([
                "INSERT INTO accounts (id, email, active) VALUES ('legacy-account', 'legacy-bindings@example.com', 1)",
                "INSERT INTO users (id, account_id, first_name, username) VALUES ('legacy-user', 'legacy-account', 'Legacy', 'legacy-binding-user')",
                "INSERT INTO agent_images (id, name, dockerfile, definition_hash, docker_tag, status, docker_image_id, ready_at) VALUES ('legacy-image', 'Legacy image', 'FROM scratch', 'legacy-hash', 'legacy:latest', 'ready', 'sha256:legacy', CURRENT_TIMESTAMP)",
                "INSERT INTO users (id, kind, created_by_user_id, first_name, username, agent_image_id) VALUES ('legacy-agent', 'agent', 'legacy-user', 'Legacy agent', 'legacy-binding-agent', 'legacy-image')",
                "INSERT INTO projects (id, name, is_default) VALUES ('legacy-project', 'Legacy project', 1)",
                "INSERT INTO chats (id, kind, name, slug, project_id, archived_at) VALUES ('archived-parent', 'private_channel', 'Archived parent', 'archived-parent', 'legacy-project', CURRENT_TIMESTAMP)",
                "INSERT INTO chats (id, kind, name, slug, project_id, parent_chat_id) VALUES ('archived-child', 'private_channel', 'Archived child', 'archived-child', 'legacy-project', 'archived-parent')",
                "INSERT INTO chats (id, kind, name, slug, project_id) VALUES ('active-chat', 'private_channel', 'Active chat', 'active-chat', 'legacy-project')",
                "INSERT INTO agent_rig_bindings (user_id, chat_id, image_id, session_id, container_name, cwd) VALUES ('legacy-agent', 'archived-parent', 'legacy-image', 'parent-session', 'parent-container', '/parent')",
                "INSERT INTO agent_rig_bindings (user_id, chat_id, image_id, session_id, container_name, cwd) VALUES ('legacy-agent', 'archived-child', 'legacy-image', 'child-session', 'child-container', '/child')",
                "INSERT INTO agent_rig_bindings (user_id, chat_id, image_id, session_id, container_name, cwd) VALUES ('legacy-agent', 'active-chat', 'legacy-image', 'active-session', 'active-container', '/active')",
                "INSERT INTO port_shares (id, chat_id, agent_user_id, container_name, container_port, name, subdomain, audience, created_by_user_id) VALUES ('legacy-share', 'archived-child', 'legacy-agent', 'child-container', 3000, 'Legacy share', 'legacy-share', 'internet', 'legacy-user')",
            ]);

            await serverSchemaMigrate(client);

            expect(
                (await client.execute("SELECT chat_id FROM agent_rig_bindings ORDER BY chat_id"))
                    .rows,
            ).toEqual([{ chat_id: "active-chat" }]);
            expect((await client.execute("SELECT id, disabled_at FROM port_shares")).rows).toEqual([
                { id: "legacy-share", disabled_at: expect.any(String) },
            ]);
            expect(
                (
                    await client.execute(`
                        SELECT port_shares.id
                        FROM port_shares
                        INNER JOIN agent_rig_bindings
                          ON agent_rig_bindings.user_id = port_shares.agent_user_id
                         AND agent_rig_bindings.chat_id = port_shares.chat_id
                         AND agent_rig_bindings.container_name = port_shares.container_name
                        WHERE port_shares.id = 'legacy-share'
                          AND port_shares.disabled_at IS NULL
                    `)
                ).rows,
            ).toEqual([]);
            expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
        } finally {
            client.close();
            await rm(directory, { recursive: true, force: true });
        }
    });
});

import { readFile } from "node:fs/promises";
import type { Client } from "@libsql/client";

export async function applyServerMigrations(
    client: Client,
    migrationNames: readonly string[],
): Promise<void> {
    for (const migrationName of migrationNames) {
        const migration = await readFile(
            new URL(`../../../happy2-server/drizzle/${migrationName}.sql`, import.meta.url),
            "utf8",
        );
        await client.migrate(
            migration
                .split("--> statement-breakpoint")
                .map((statement) => statement.trim())
                .filter((statement) => statement.length > 0),
        );
    }
}

import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pluginPackageLoad } from "./catalog.js";
import { PluginPackageStore } from "./packageStore.js";

describe("installed plugin skills", () => {
    it("are placed in Rig's skill tree and reconcile only Happy-owned files", async () => {
        const temporary = await mkdtemp(join(tmpdir(), "happy2-plugin-skills-"));
        try {
            const packageRoot = join(temporary, "packages");
            const agentHome = join(temporary, "home");
            const userSkill = join(agentHome, ".agents", "skills", "user-skill");
            await Promise.all([
                mkdir(packageRoot, { recursive: true }),
                mkdir(userSkill, { recursive: true }),
            ]);
            await writeFile(
                join(userSkill, "SKILL.md"),
                "---\nname: user-skill\ndescription: Keep this user-owned skill.\n---\n\nUser skill.\n",
            );
            const source = await pluginPackageLoad(
                join(process.cwd(), "..", "happy2-plugin-plugin-developer", "dist", "plugin"),
                "plugin-developer",
            );
            const store = new PluginPackageStore(packageRoot);
            const installed = await store.install(source, "pluginid");
            const ready = [
                {
                    pluginId: "pluginid",
                    shortName: source.manifest.shortName,
                    packageDigest: source.packageDigest,
                    packageDirectory: installed.packageDirectory,
                    source: source.source,
                },
            ];

            await store.syncSkills(ready, agentHome);
            const installedSkill = join(
                agentHome,
                ".agents",
                "skills",
                "happy2-plugins",
                "pluginid-happy2-plugin-development",
                "SKILL.md",
            );
            await expect(access(installedSkill)).resolves.toBeUndefined();
            await expect(access(join(userSkill, "SKILL.md"))).resolves.toBeUndefined();

            await store.syncSkills([], agentHome);
            await expect(access(installedSkill)).rejects.toThrow();
            await expect(access(join(userSkill, "SKILL.md"))).resolves.toBeUndefined();
        } finally {
            await rm(temporary, { recursive: true, force: true });
        }
    });
});

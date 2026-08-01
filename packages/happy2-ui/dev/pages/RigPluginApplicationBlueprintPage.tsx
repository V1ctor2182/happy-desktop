import { RigPluginApplicationPage } from "../../src/pages/plugins/RigPluginApplicationPage";
import { ComponentPage, FullScreenSpecimen } from "../kit";

/**
 * Stands in for a plugin's own running view. The real one is an isolated guest
 * the desktop shell mounts, which a workbench cannot and should not create; what
 * the blueprint has to prove is the frame around it — that the region is flush,
 * fills the page, and keeps its box while the states change.
 */
function ApplicationStandIn() {
    return (
        <div
            style={{
                alignItems: "center",
                background: "var(--groupped-background)",
                color: "var(--text-secondary)",
                display: "flex",
                fontFamily: "var(--happy2-font-ui)",
                fontSize: 13,
                height: "100%",
                justifyContent: "center",
                width: "100%",
            }}
        >
            The plugin&rsquo;s own view fills this region.
        </div>
    );
}

export function RigPluginApplicationBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-016"
            summary="The frame a locally installed plugin's own application is shown inside: a 56px surface header naming the application and its plugin, and one flush region beneath that the plugin fills edge to edge. Every state keeps the same geometry, so the window does not reflow while a plugin is preparing, running, or gone."
            title="RigPluginApplicationPage"
        >
            <FullScreenSpecimen
                detail="The application's code is cached and mounted; the frame contributes only the header."
                label="Running"
                number="01"
            >
                <RigPluginApplicationPage
                    content={<ApplicationStandIn />}
                    pluginLabel="Usage reporter"
                    status="ready"
                    title="Account overview"
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The bundle is still being prepared. The header is already correct, so nothing moves when it arrives."
                label="Opening"
                number="02"
            >
                <RigPluginApplicationPage
                    pluginLabel="Usage reporter"
                    status="loading"
                    title="Account overview"
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The plugin did not provide everything the application needs; the reason is the plugin's own."
                label="Failed"
                number="03"
            >
                <RigPluginApplicationPage
                    error="Rig returned a different plugin resource size than declared."
                    pluginLabel="Usage reporter"
                    status="error"
                    title="Account overview"
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The address still names an application, but its plugin is no longer running here."
                label="Removed"
                number="04"
            >
                <RigPluginApplicationPage status="missing" title="Account overview" />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}

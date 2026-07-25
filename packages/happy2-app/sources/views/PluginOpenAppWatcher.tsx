import { useLayoutEffect, useRef } from "react";
import type { OverlaysStore, PluginActionState } from "happy2-state";
import { pluginOpenAppNavigate } from "../pluginContributions";

export interface PluginOpenAppWatcherProps {
    /** The transient action states of one contribution surface (nav or chat). */
    actionStates: ReadonlyMap<string, PluginActionState>;
    onAppOpen: (instanceId: string) => void;
    overlays: OverlaysStore;
}

/**
 * Routes `openApp` invocation results to the requested existing instance. A
 * contribution invocation that succeeds may carry `openApp`; this watcher opens it
 * exactly once — tracked by action key and generation, so a later invocation of the
 * same action opens again while a re-render does not — in its requested
 * presentation. It renders nothing.
 */
export function PluginOpenAppWatcher(props: PluginOpenAppWatcherProps) {
    const handled = useRef<Set<string>>(new Set());
    // eslint-disable-next-line happy2-react/no-layout-effect -- opening a screen or overlay in response to a store transition is an imperative side effect, not rendered output
    useLayoutEffect(() => {
        for (const [key, state] of props.actionStates) {
            if (state.type !== "succeeded") continue;
            const openApp = state.result.openApp;
            if (!openApp) continue;
            const token = `${key}:${state.generation}`;
            if (handled.current.has(token)) continue;
            handled.current.add(token);
            pluginOpenAppNavigate(
                { onAppOpen: props.onAppOpen, overlays: props.overlays },
                openApp.instanceId,
                openApp.presentation,
            );
        }
    });
    return null;
}

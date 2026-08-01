import { useRef } from "react";
import {
    RigPluginAppFrame,
    type RigPluginApplicationContentProps,
    type RigPluginAppRequestOptions,
} from "happy2-ui";
import type { DesktopPluginAppRequest, HappyDesktopBridge } from "../shared/desktopContract";

export interface DesktopPluginApplicationViewProps extends RigPluginApplicationContentProps {
    readonly bridge: HappyDesktopBridge;
    /** Shown to assistive technology as the running application's name. */
    readonly title: string;
}

/**
 * Electron-side transport for one mounted plugin application.
 *
 * The MCP Apps host itself is the reusable frame: it owns the handshake, the
 * JSON-RPC dialect, and the host context. This component owns only where those
 * requests go — the main process, which is the single place that holds the
 * daemon endpoint, its token, and the application's cached bytes. Nothing here
 * learns any of that; it forwards an operation together with the origin the
 * frame read from the message event, and the main process decides which
 * application and which generation that origin is.
 *
 * A generation is a lifetime. The `key` its owner gives this component changes
 * when the generation does, so replaced code is a new frame rather than a
 * navigation inside the old one.
 */
export function DesktopPluginApplicationView(props: DesktopPluginApplicationViewProps) {
    // Each request is named so it can be withdrawn on its own. The name has to
    // survive the trip through the main process, where an abort signal cannot
    // go, so it is what carries the frame's cancellation across.
    //
    // The counter is a ref rather than a local because a name has to be unique
    // for as long as this mounted application can have work in flight, and that
    // is the whole mount rather than one render. A per-render counter starts
    // again at one whenever anything above re-renders, and a reused name is not
    // a harmless collision: the main process keys a request by its origin and
    // name, so a repeat replaces an earlier request and aborts it. The mount is
    // exactly the right lifetime — a new generation is a new frame with a new
    // origin, so names never have to be unique across generations.
    const issued = useRef(0);
    const request = (
        body: DesktopPluginAppRequest,
        options: RigPluginAppRequestOptions,
    ): Promise<unknown> => {
        const origin = originOf(props.source);
        const requestId = `${(issued.current += 1)}`;
        options.signal.addEventListener(
            "abort",
            () => void props.bridge.pluginAppCancel(origin, requestId).catch(() => undefined),
            { once: true },
        );
        return props.bridge.pluginAppRequest(origin, requestId, body);
    };
    return (
        <RigPluginAppFrame
            resourceRead={async (uri, options) =>
                (await request({ kind: "resourceRead", uri }, options)) as Record<string, unknown>
            }
            source={props.source}
            storageDelete={async (key, options) => {
                await request({ kind: "storageDelete", key }, options);
            }}
            storageGet={(key, options) => request({ kind: "storageGet", key }, options)}
            storageList={async (options) =>
                (await request({ kind: "storageList" }, options)) as readonly string[]
            }
            storageSet={async (key, value, options) => {
                await request({ kind: "storageSet", key, value }, options);
            }}
            title={props.title}
            toolCall={async (name, args, options) =>
                (await request(
                    {
                        kind: "toolCall",
                        name,
                        arguments: args,
                    },
                    options,
                )) as Record<string, unknown>
            }
        />
    );
}

function originOf(source: string): string {
    try {
        return new URL(source).origin;
    } catch {
        return "";
    }
}

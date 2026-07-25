import { CommandPalette, Modal, ModalOverlay, StoreSurface } from "happy2-ui";
import type { HappyState, OverlaysStore } from "happy2-state";
import type { AuthSession } from "./AuthGate";
import { SearchOverlay } from "../views/SearchOverlay";
import { ProfileView } from "../views/ProfileView";
import { SettingsView } from "../views/SettingsView";
import { PluginAppOverlayView } from "../views/PluginAppOverlayView";
import { DesktopFileOverlay } from "./DesktopFileOverlay";

export interface DesktopOverlaySurfaceProps {
    overlays: OverlaysStore;
    state: HappyState;
    session?: AuthSession;
    /** Navigates to a channel chosen in the search palette. */
    onChannelOpen: (chatId: string) => void;
}

/**
 * Renders the transient layer floating over whichever screen is open. The layer is
 * read from the overlays store rather than the URL, so opening or dismissing one
 * never navigates and never remounts the screen underneath.
 */
export function DesktopOverlaySurface(props: DesktopOverlaySurfaceProps) {
    const overlays = props.overlays;
    return (
        <StoreSurface store={overlays}>
            {(snapshot) => {
                const overlay = snapshot.overlay;
                const close = () => overlays.getState().overlayClose();
                if (overlay.type === "search")
                    return (
                        <ModalOverlay onDismiss={close} placement="top">
                            <CommandPalette
                                onClose={close}
                                onQueryChange={(value) =>
                                    overlays.getState().overlaySearchQueryUpdate(value)
                                }
                                placeholder="Search Happy Place…"
                                query={overlay.query}
                            >
                                <SearchOverlay
                                    onSelect={(type, id) => searchSelect(type, id)}
                                    query={overlay.query}
                                    state={props.state}
                                />
                            </CommandPalette>
                        </ModalOverlay>
                    );
                if (overlay.type === "profile")
                    return (
                        <ModalOverlay onDismiss={close}>
                            <Modal
                                icon="at"
                                onClose={close}
                                size="large"
                                title="Profile and settings"
                            >
                                {overlay.userId === "me" ||
                                overlay.userId === props.session?.user.id ? (
                                    <SettingsView session={props.session} state={props.state} />
                                ) : (
                                    <ProfileView state={props.state} userId={overlay.userId} />
                                )}
                            </Modal>
                        </ModalOverlay>
                    );
                if (overlay.type === "file")
                    return (
                        <DesktopFileOverlay
                            fileId={overlay.fileId}
                            onClose={close}
                            state={props.state}
                        />
                    );
                if (overlay.type === "app")
                    return (
                        <PluginAppOverlayView
                            instanceId={overlay.instanceId}
                            onClose={close}
                            onPresentationChange={(presentation) =>
                                overlays.getState().overlayAppPresentationUpdate(presentation)
                            }
                            presentation={overlay.presentation}
                            state={props.state}
                        />
                    );
                return null;

                /**
                 * A palette result either navigates or swaps this overlay for the
                 * matching one. Choosing a channel is a destination, so it closes
                 * the palette and routes; a user or file stays in the modal stack.
                 */
                function searchSelect(type: string, id: string) {
                    if (type === "user") overlays.getState().overlayProfileOpen(id);
                    else if (type === "file") overlays.getState().overlayFileOpen(id);
                    else if (type === "channel") {
                        close();
                        props.onChannelOpen(id);
                    } else close();
                }
            }}
        </StoreSurface>
    );
}

import { createFileRoute, useParams } from "@tanstack/react-router";
import { DocumentsView } from "../views/DocumentsView";

/**
 * The Documents screen. It is a layout route so that opening a document from the
 * list keeps one `DocumentsView` mounted: that component owns the document session
 * lease and the list beside it, both of which would otherwise be discarded and
 * refetched on every selection.
 *
 * The children carry only the addressed document and render nothing themselves.
 */
export const Route = createFileRoute("/_workspace/documents")({
    component: DocumentsScreen,
    staticData: { workspaceScreen: true },
});

function DocumentsScreen() {
    const context = Route.useRouteContext();
    const navigate = Route.useNavigate();
    const params = useParams({ strict: false });
    return (
        <DocumentsView
            documentId={params.documentId}
            onCloseDetail={() => void navigate({ to: "/documents" })}
            onFileOpen={(fileId) => context.state.overlays().getState().overlayFileOpen(fileId)}
            onOpen={(documentId) =>
                void navigate({ params: { documentId }, to: "/documents/$documentId" })
            }
            state={context.state}
            user={{
                id: context.session?.user.id ?? "",
                firstName: context.session?.user.firstName ?? "You",
            }}
        />
    );
}

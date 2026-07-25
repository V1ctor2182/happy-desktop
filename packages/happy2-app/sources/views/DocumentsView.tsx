import { DocumentDetailPane, DocumentsPage } from "happy2-ui";
import type { HappyState } from "happy2-state";
import { useDisposableLease } from "../useDisposableLease";

export interface DocumentsViewProps {
    state: HappyState;
    /** Open document, when the route addresses one; otherwise the list. */
    documentId?: string;
    user: { readonly id: string; readonly firstName: string };
    onOpen: (documentId: string) => void;
    onCloseDetail: () => void;
}

/** Owns the route-keyed document session lease for the global Documents surface. */
export function DocumentsView(props: DocumentsViewProps) {
    const state = props.state;
    const nextDocumentId = props.documentId;
    const document = useDisposableLease(nextDocumentId, () => state.documentOpen(nextDocumentId!));
    if (nextDocumentId && document) {
        return (
            <DocumentDetailPane
                directory={state.directory()}
                document={document}
                onClose={props.onCloseDetail}
                onDelete={() => {
                    void state
                        .documentDelete(nextDocumentId)
                        .then(() => props.onCloseDetail())
                        .catch(() => undefined);
                }}
                onRename={(title) => void state.documentRename(nextDocumentId, title)}
                user={props.user}
            />
        );
    }
    return (
        <DocumentsPage
            data-testid="documents-view"
            onCreate={() => {
                void state
                    .documentStandaloneCreate({ title: "" })
                    .then((document) => props.onOpen(document.id))
                    .catch(() => undefined);
            }}
            onDelete={(document) => void state.documentDelete(document.id).catch(() => undefined)}
            onOpen={(document) => props.onOpen(document.id)}
            store={state.documentCollection()}
        />
    );
}

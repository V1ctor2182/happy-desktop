import { SearchPage, type SearchResultType } from "happy2-ui";
import type { HappyState } from "happy2-state";
import { useAssetUrls } from "../assetUrls";

export interface SearchOverlayProps {
    query: string;
    state: HappyState;
    onSelect?: (type: SearchResultType, id: string) => void;
}

/** Selects the search surface and provides session-scoped avatar object URLs. */
export function SearchOverlay(props: SearchOverlayProps) {
    const avatars = useAssetUrls(props.state);
    return (
        <SearchPage
            imageUrl={avatars.imageUrl}
            onSelect={props.onSelect}
            query={props.query}
            store={props.state.search()}
            variant="flush"
        />
    );
}

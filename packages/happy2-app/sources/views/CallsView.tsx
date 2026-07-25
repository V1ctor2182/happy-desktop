import type { HappyState } from "happy2-state";
import { CallsPage } from "happy2-ui";
import { useAssetUrls } from "../assetUrls";

export interface CallsViewProps {
    state: HappyState;
}
export function CallsView(props: CallsViewProps) {
    const avatars = useAssetUrls(props.state);
    return <CallsPage imageUrl={avatars.imageUrl} store={props.state.calls()} />;
}

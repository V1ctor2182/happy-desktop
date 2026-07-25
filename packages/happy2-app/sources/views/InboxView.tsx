import type { HappyState } from "happy2-state";
import { ActivityPage } from "happy2-ui";
import { useAssetUrls } from "../assetUrls";
import { useNotificationNavigation } from "../navigation/useNotificationNavigation";

export interface InboxViewProps {
    state: HappyState;
    virtualize?: boolean;
}
export function InboxView(props: InboxViewProps) {
    const avatars = useAssetUrls(props.state);
    const notifications = useNotificationNavigation(props.state);
    return (
        <ActivityPage
            contextLabel={notifications.contextLabel}
            imageUrl={avatars.imageUrl}
            onSelect={notifications.open}
            store={props.state.notifications()}
            virtualize={props.virtualize}
        />
    );
}

import type { HappyState } from "happy2-state";
import { HomePage } from "happy2-ui";
import { useAvatarImages } from "../avatarImages";
import { useNotificationNavigation } from "../navigation/useNotificationNavigation";

export interface HomeViewProps {
    state: HappyState;
}
export function HomeView(props: HomeViewProps) {
    const avatars = useAvatarImages(props.state);
    const notifications = useNotificationNavigation(props.state);
    return (
        <HomePage
            contextLabel={notifications.contextLabel}
            imageUrl={avatars.imageUrl}
            notificationsStore={props.state.notifications()}
            onSelect={notifications.open}
        />
    );
}

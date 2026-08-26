import { HappySocialPage, type HappySocialPerson } from "../../src/HappySocialPage";
import { ComponentPage, FullScreenSpecimen } from "../kit";

export const componentNumber = "C-255";

const ada: HappySocialPerson = {
    firstName: "Ada",
    lastName: "Lovelace",
    username: "ada",
};
const grace: HappySocialPerson = {
    firstName: "Grace",
    lastName: "Hopper",
    username: "grace",
};
const alan: HappySocialPerson = {
    firstName: "Alan",
    lastName: "Turing",
    username: "alan",
};

const actions = {
    onFriendRequestAccept: () => undefined,
    onFriendRequestReject: () => undefined,
    onFriendRequestSend: () => undefined,
    onFriendUsernameChange: () => undefined,
};

export function HappySocialBlueprintPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Happy Social friends, incoming and outgoing requests, and the username request form."
            title="HappySocialPage"
        >
            <FullScreenSpecimen
                detail="720 × 480 minimum window · populated"
                label="Friends and requests"
                number={componentNumber}
            >
                <HappySocialPage
                    {...actions}
                    friendUsername=""
                    friends={[ada, grace]}
                    incomingRequests={[alan]}
                    outgoingRequests={[
                        { firstName: "Katherine", lastName: "Johnson", username: "katherine" },
                    ]}
                    status="ready"
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="720 × 480 minimum window · empty"
                label="New social profile"
                number={componentNumber}
            >
                <HappySocialPage
                    {...actions}
                    friendUsername="ada"
                    friends={[]}
                    incomingRequests={[]}
                    outgoingRequests={[]}
                    status="ready"
                />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}

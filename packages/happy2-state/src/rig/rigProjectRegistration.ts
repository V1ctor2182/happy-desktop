import {
    ProjectRegistrationError,
    ProjectRegistrationProtocolError,
    type ProjectRegistrationErrorCode,
} from "@slopus/rig-connect";
import { UserError } from "../types.js";

/**
 * Turns Rig's refusal to register a folder into something the reader can act on.
 *
 * Rig decides what may become a project and says why in a closed set of codes;
 * its own messages describe the rule it applied ("Choose the Git repository's
 * top-level folder."), which is already the right thing to say. What they do not
 * say is which folder was refused, and a picker dialog closes before the error
 * appears — so the chosen path is named here, in the one place that still knows
 * it.
 *
 * A code this build does not know is not swallowed: Rig's own message is shown,
 * because a newer daemon explaining itself is better than "something went
 * wrong". A transport failure is reported as a transport failure, since retrying
 * it is a different act from choosing a different folder.
 */
export function rigProjectAddError(error: unknown, path: string): UserError {
    const folder = folderNameOf(path);
    if (error instanceof ProjectRegistrationError) {
        return new UserError(
            registrationMessage(error.code, folder) ?? error.message,
            undefined,
            error,
        );
    }
    if (error instanceof ProjectRegistrationProtocolError) {
        return new UserError(
            error.code === "request_failed"
                ? `“${folder}” could not be added: this machine’s Rig did not answer. Try again.`
                : `“${folder}” could not be added: this machine’s Rig gave an answer Happy could not read.`,
            undefined,
            error,
        );
    }
    if (error instanceof UserError) return error;
    if (error instanceof Error) return new UserError(error.message, undefined, error);
    return new UserError(String(error), undefined, error);
}

/**
 * What each refusal means for the person who just chose a folder, said as the
 * thing to do about it. `undefined` for a code this build does not recognize,
 * which leaves Rig's own wording in place.
 */
function registrationMessage(
    code: ProjectRegistrationErrorCode,
    folder: string,
): string | undefined {
    switch (code) {
        case "path_missing":
            return `“${folder}” no longer exists.`;
        case "not_directory":
            return `“${folder}” is a file, not a folder.`;
        case "path_inaccessible":
            return `“${folder}” cannot be read. Check its permissions and try again.`;
        case "not_git_repository":
            return `“${folder}” is not a Git repository. Add a folder with a repository in it.`;
        case "not_git_top_level":
            return `“${folder}” is inside a Git repository. Choose the repository’s top-level folder instead.`;
        case "managed_workspace_unavailable":
            return `“${folder}” is a managed workspace that is not ready yet.`;
        // `invalid_request` and `project_id_conflict` are Happy asking wrongly
        // rather than the reader choosing wrongly, and Rig names the exact rule
        // it applied. There is nothing more useful to say about them here.
        default:
            return undefined;
    }
}

/** The last segment of a path, which is what the reader picked in the dialog. */
function folderNameOf(path: string): string {
    const trimmed = path.replace(/[/\\]+$/u, "");
    const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    const name = separator < 0 ? trimmed : trimmed.slice(separator + 1);
    return name.length > 0 ? name : path;
}

import type { RigFriendsPhotoDraft } from "./rigFriendsStore.js";

/** Bytes per base64 chunk; keeps the argument list of one `fromCharCode` sane. */
const CHUNK = 0x8000;

function base64Encode(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += CHUNK)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
    return btoa(binary);
}

/**
 * Reads a picked picture into the draft a profile is created from.
 *
 * The bytes are carried by the draft itself because there is no upload step
 * before signup: the daemon is handed the picture in the same call that creates
 * the account. The same bytes become the preview, so choosing a picture shows it
 * immediately without a second read or an object URL nobody would revoke.
 */
export async function rigFriendsPhotoRead(file: File): Promise<RigFriendsPhotoDraft> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const data = base64Encode(bytes);
    const mediaType = file.type || "image/png";
    return { data, mediaType, previewUrl: `data:${mediaType};base64,${data}` };
}

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { networkInterfaces as interfacesRead } from "node:os";
import { dirname } from "node:path";
import type {
    DesktopPersonalRemoteMacMountWriteRequest,
    DesktopTailnetAddress,
} from "../../shared/desktopContract";

const SETTINGS_VERSION = 1;
const MAX_LABEL_LENGTH = 80;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface PersonalRemoteMacShareSettings {
    readonly bindAddress: string;
    readonly enabled: true;
    readonly port: number;
    readonly tokenSha256: string;
}

export interface PersonalRemoteMacMountSettings {
    readonly address: string;
    readonly id: string;
    readonly label: string;
    readonly port: number;
    readonly sourceAddress: string;
    readonly token: string;
}

export interface PersonalRemoteMacSettings {
    readonly mount?: PersonalRemoteMacMountSettings;
    readonly share?: PersonalRemoteMacShareSettings;
    readonly version: typeof SETTINGS_VERSION;
}

const EMPTY_SETTINGS: PersonalRemoteMacSettings = { version: SETTINGS_VERSION };

/** All literal Tailscale IPv4 addresses currently assigned to this Mac. */
export function personalRemoteMacTailnetAddresses(): readonly DesktopTailnetAddress[] {
    const found: DesktopTailnetAddress[] = [];
    const interfaces = interfacesRead();
    for (const [name, addresses] of Object.entries(interfaces)) {
        for (const candidate of addresses ?? []) {
            if (candidate.internal || !tailnetIpv4Valid(candidate.address)) continue;
            if (candidate.family !== "IPv4") continue;
            found.push({ address: candidate.address, interface: name });
        }
    }
    return found.sort((left, right) =>
        left.address === right.address
            ? left.interface.localeCompare(right.interface)
            : left.address.localeCompare(right.address),
    );
}

export function personalRemoteMacTailnetAddressRequireLocal(value: unknown): string {
    const address = tailnetIpv4Require(value);
    if (!personalRemoteMacTailnetAddresses().some((candidate) => candidate.address === address))
        throw new Error("That Tailscale address is not currently assigned to this Mac.");
    return address;
}

export function personalRemoteMacMountRequestValidate(
    value: unknown,
): DesktopPersonalRemoteMacMountWriteRequest {
    if (!isRecord(value)) throw new Error("The remote Mac configuration is invalid.");
    const sourceAddress = personalRemoteMacTailnetAddressRequireLocal(value.sourceAddress);
    const address = tailnetIpv4Require(value.address);
    if (personalRemoteMacTailnetAddresses().some((candidate) => candidate.address === address))
        throw new Error("The remote Mac address belongs to this Mac.");
    const label = labelRequire(value.label);
    const port = portRequire(value.port);
    const token = value.token === undefined ? undefined : tokenRequire(value.token);
    return { address, label, port, sourceAddress, ...(token ? { token } : {}) };
}

export function personalRemoteMacTokenCreate(): string {
    return randomBytes(32).toString("base64url");
}

export function personalRemoteMacIdCreate(): string {
    return `remote_${randomBytes(16).toString("hex")}`;
}

export function personalRemoteMacTokenRequire(value: unknown): string {
    return tokenRequire(value);
}

export async function personalRemoteMacSettingsRead(
    path: string,
): Promise<PersonalRemoteMacSettings> {
    let source: string;
    try {
        source = await readFile(path, "utf8");
    } catch {
        // This optional feature must never turn an otherwise healthy local
        // Desktop startup into a fatal error. A later write surfaces the host
        // filesystem problem directly to the settings action.
        return EMPTY_SETTINGS;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch {
        await corruptSettingsArchive(path);
        return EMPTY_SETTINGS;
    }
    const settings = settingsParse(parsed);
    if (settings) return settings;
    await corruptSettingsArchive(path);
    return EMPTY_SETTINGS;
}

export async function personalRemoteMacSettingsWrite(
    path: string,
    settings: PersonalRemoteMacSettings,
): Promise<void> {
    const validated = settingsParse(settings);
    if (!validated) throw new Error("The remote Mac settings are invalid.");
    const parent = dirname(path);
    await mkdir(parent, { mode: 0o700, recursive: true });
    await chmod(parent, 0o700);
    const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(validated, undefined, 2)}\n`, { mode: 0o600 });
        await rename(temporary, path);
        await chmod(path, 0o600);
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}

/** Preserves an unreadable feature record before best-effort clean disable. */
async function corruptSettingsArchive(path: string): Promise<void> {
    const backup = `${path}.invalid-${new Date().toISOString().replaceAll(":", "-")}`;
    try {
        await rename(path, backup);
        await chmod(backup, 0o600).catch(() => undefined);
        await personalRemoteMacSettingsWrite(path, EMPTY_SETTINGS);
    } catch {
        // Preserve the original when it could not be moved. The in-memory
        // feature still starts disabled, and no unrelated Desktop state moves.
    }
}

function settingsParse(value: unknown): PersonalRemoteMacSettings | undefined {
    if (!isRecord(value) || value.version !== SETTINGS_VERSION) return undefined;
    if (!keysOnly(value, ["version", "share", "mount"])) return undefined;
    const share = value.share === undefined ? undefined : shareParse(value.share);
    const mount = value.mount === undefined ? undefined : mountParse(value.mount);
    if ((value.share !== undefined && !share) || (value.mount !== undefined && !mount))
        return undefined;
    return {
        version: SETTINGS_VERSION,
        ...(share ? { share } : {}),
        ...(mount ? { mount } : {}),
    };
}

function shareParse(value: unknown): PersonalRemoteMacShareSettings | undefined {
    if (!isRecord(value) || !keysOnly(value, ["enabled", "bindAddress", "port", "tokenSha256"]))
        return undefined;
    if (value.enabled !== true || !TOKEN_HASH_PATTERN.test(stringValue(value.tokenSha256)))
        return undefined;
    try {
        return {
            enabled: true,
            bindAddress: tailnetIpv4Require(value.bindAddress),
            port: portRequire(value.port),
            tokenSha256: stringValue(value.tokenSha256),
        };
    } catch {
        return undefined;
    }
}

function mountParse(value: unknown): PersonalRemoteMacMountSettings | undefined {
    if (
        !isRecord(value) ||
        !keysOnly(value, ["id", "label", "sourceAddress", "address", "port", "token"])
    )
        return undefined;
    try {
        const id = stringValue(value.id);
        if (!/^remote_[a-f0-9]{32}$/u.test(id)) return undefined;
        return {
            id,
            label: labelRequire(value.label),
            sourceAddress: tailnetIpv4Require(value.sourceAddress),
            address: tailnetIpv4Require(value.address),
            port: portRequire(value.port),
            token: tokenRequire(value.token),
        };
    } catch {
        return undefined;
    }
}

function tailnetIpv4Require(value: unknown): string {
    const address = stringValue(value);
    if (!tailnetIpv4Valid(address))
        throw new Error("A literal Tailscale IPv4 address in 100.64.0.0/10 is required.");
    return address;
}

function tailnetIpv4Valid(address: string): boolean {
    const parts = address.split(".");
    if (parts.length !== 4) return false;
    const octets = parts.map((part) => (/^(0|[1-9]\d{0,2})$/u.test(part) ? Number(part) : NaN));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
    return octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
}

function tokenRequire(value: unknown): string {
    const token = stringValue(value).trim();
    if (!TOKEN_PATTERN.test(token)) throw new Error("The remote Mac token is invalid.");
    return token;
}

function labelRequire(value: unknown): string {
    const label = stringValue(value).trim();
    if (!label || label.length > MAX_LABEL_LENGTH || label.includes("\0"))
        throw new Error("The remote Mac label is invalid.");
    return label;
}

function portRequire(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65_535)
        throw new Error("The remote Mac port is invalid.");
    return value;
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function keysOnly(value: Record<string, unknown>, allowed: readonly string[]): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}

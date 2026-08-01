import { describe, expect, it } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import schema from "@modelcontextprotocol/ext-apps/schema.json";
import {
    rigPluginAppInitializeResult,
    RIG_PLUGIN_APP_STORAGE_EXTENSION,
} from "./RigPluginAppFrame";
import { MCP_APP_PROTOCOL_VERSION } from "./mcpAppProtocol";

/**
 * Conformance of the host's handshake against the published MCP Apps schema.
 *
 * Happy is the host here, so nothing in the product imports the extension's host
 * runtime; the guarantee that matters is that what this host actually puts on
 * the wire is what the specification describes. The schema shipped by
 * `@modelcontextprotocol/ext-apps` is the specification in machine-readable
 * form, so it is what the result is checked against rather than a second reading
 * of the prose.
 */
const validator = (): ValidateFunction => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    ajv.addSchema(relaxGeneratedArtifacts(schema));
    return ajv.compile({
        $ref: `${(schema as { $id: string }).$id}#/$defs/McpUiInitializeResult`,
    });
};

/**
 * Loosens the two places where the generated JSON Schema is stricter than the
 * specification it was generated from, so everything else stays exactly as
 * strict as published.
 *
 * Both are artifacts of turning TypeScript into JSON Schema, and the schema says
 * so in its own annotations:
 *
 * - `styles.variables` lists every style key as required, while its own
 *   description reads "Individual style keys are optional - hosts may provide
 *   any subset of these values" and explains that the required list comes from
 *   modelling the type as `Record<K, string | undefined>`.
 * - `containerDimensions` is an intersection of two closed objects, so the very
 *   shape its description asks for — "Specify either width or maxWidth, and
 *   either height or maxHeight" — cannot satisfy both halves at once.
 *
 * Nothing else is touched: `hostCapabilities` in particular stays closed, which
 * is the whole point of checking the handshake against this file.
 */
function relaxGeneratedArtifacts(published: object): object {
    const copy = structuredClone(published) as {
        $defs: Record<string, Record<string, Record<string, Record<string, never>>>>;
    };
    const context = copy.$defs.McpUiInitializeResult!.properties!.hostContext! as unknown as {
        properties: {
            containerDimensions: unknown;
            styles: { properties: { variables: { required?: readonly string[] } } };
        };
    };
    context.properties.styles.properties.variables.required = [];
    context.properties.containerDimensions = { type: "object" };
    return copy;
}

/** A host context of the shape the frame builds from a mounted surface. */
const hostContext = {
    availableDisplayModes: ["fullscreen"],
    containerDimensions: { height: 720, width: 1180 },
    deviceCapabilities: { hover: true, touch: false },
    displayMode: "fullscreen",
    locale: "en-US",
    platform: "desktop",
    styles: {
        variables: {
            "--color-background-primary": "#ffffff",
            "--color-text-primary": "#101010",
            "--font-sans": "Figtree, sans-serif",
        },
    },
    theme: "light",
    timeZone: "America/Los_Angeles",
};

describe("the plugin application host's initialize result", () => {
    it("validates against the published MCP Apps schema", () => {
        const validate = validator();
        const result = rigPluginAppInitializeResult(hostContext);

        expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
    });

    it("answers with the protocol revision the host speaks and names itself", () => {
        const result = rigPluginAppInitializeResult(hostContext);

        expect(result.protocolVersion).toBe(MCP_APP_PROTOCOL_VERSION);
        // `hostInfo.name` and `hostInfo.version` are both required of a host.
        expect(result.hostInfo).toMatchObject({ name: expect.any(String), version: "1.0.0" });
    });

    it("offers exactly the standard capabilities it can honour", () => {
        const result = rigPluginAppInitializeResult(hostContext) as {
            hostCapabilities: Record<string, unknown>;
        };

        // Tool calls and resource reads are proxied to the daemon; nothing else
        // standard is claimed, because nothing else is implemented.
        expect(result.hostCapabilities).toMatchObject({ serverResources: {}, serverTools: {} });
        expect(result.hostCapabilities.openLinks).toBeUndefined();
        expect(result.hostCapabilities.sampling).toBeUndefined();
        expect(result.hostCapabilities.updateModelContext).toBeUndefined();
    });

    it("announces its storage extension where a vendor name is allowed to live", () => {
        const validate = validator();
        const result = rigPluginAppInitializeResult(hostContext) as {
            _meta: Record<string, unknown>;
            hostCapabilities: Record<string, unknown>;
        };

        // `hostCapabilities` is a closed shape, so the flag there is the
        // schema's own `experimental`, and the reverse-DNS name of what is on
        // offer goes in `_meta`, which the schema leaves open. A View detects
        // the extension by this key.
        expect(result.hostCapabilities.experimental).toEqual({});
        expect(result._meta[RIG_PLUGIN_APP_STORAGE_EXTENSION]).toEqual({ version: 1 });
        expect(validate(result), JSON.stringify(validate.errors, null, 2)).toBe(true);
    });

    it("would be rejected by the schema if the extension were named as a capability", () => {
        // This is the mistake the shape above exists to avoid: a vendor key
        // inside `hostCapabilities` is not part of the published shape, so a
        // conforming View is entitled to drop or refuse it.
        const validate = validator();
        const wrong = {
            ...rigPluginAppInitializeResult(hostContext),
            hostCapabilities: {
                extensions: { [RIG_PLUGIN_APP_STORAGE_EXTENSION]: {} },
                serverResources: {},
                serverTools: {},
            },
        };

        expect(validate(wrong)).toBe(false);
    });
});

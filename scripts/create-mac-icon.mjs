import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execute = promisify(execFile);
const workspace = resolve(import.meta.dirname, "..");
const assetDirectory = join(workspace, "packages", "happy-desktop-electron", "assets", "app-icon");
const source = join(assetDirectory, "source.png");
const generatedDirectory = join(assetDirectory, "generated");
const generatedPng = join(generatedDirectory, "app-icon.png");
const generatedIcns = join(generatedDirectory, "app-icon.icns");
const temporaryRoot = join(workspace, ".context");
await mkdir(temporaryRoot, { recursive: true });
const temporary = await mkdtemp(join(temporaryRoot, "happy-icon-"));
const iconset = join(temporary, "Happy.iconset");
const canvasSize = 1024;
const tileSize = 824;
const tileCornerRadius = 185;

try {
    await mkdir(iconset, { recursive: true });
    const macArtwork = join(temporary, "app-icon-mac.png");
    const roundedTile = Buffer.from(
        `<svg width="${tileSize}" height="${tileSize}">
            <rect width="${tileSize}" height="${tileSize}" rx="${tileCornerRadius}" fill="white"/>
        </svg>`,
    );
    const tile = await sharp(source)
        .resize(tileSize, tileSize)
        .composite([{ input: roundedTile, blend: "dest-in" }])
        .png()
        .toBuffer();

    await sharp({
        create: {
            width: canvasSize,
            height: canvasSize,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite([
            {
                input: tile,
                left: (canvasSize - tileSize) / 2,
                top: (canvasSize - tileSize) / 2,
            },
        ])
        .png()
        .toFile(macArtwork);

    for (const size of [16, 32, 128, 256, 512]) {
        await resize(macArtwork, size, join(iconset, `icon_${size}x${size}.png`));
        await resize(macArtwork, size * 2, join(iconset, `icon_${size}x${size}@2x.png`));
    }
    await execute("iconutil", [
        "--convert",
        "icns",
        "--output",
        join(temporary, "icon.icns"),
        iconset,
    ]);
    await mkdir(generatedDirectory, { recursive: true });
    await rm(generatedPng, { force: true });
    await rm(generatedIcns, { force: true });
    await rename(macArtwork, generatedPng);
    await rename(join(temporary, "icon.icns"), generatedIcns);
    console.log(`Generated ${generatedPng} and ${generatedIcns}.`);
} finally {
    await rm(temporary, { force: true, recursive: true });
}

async function resize(input, size, output) {
    await sharp(input).resize(size, size).png().toFile(output);
}

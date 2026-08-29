#!/usr/bin/env python3
"""Add GPUI/CoreText-safe cmap entries for Happy's curated Ionicons glyphs.

The source glyph outlines remain unchanged. This only adds character mappings and
uses a distinct family name so CoreText does not confuse the adapter with the
upstream font already installed or cached by another Happy surface.
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/fonts/Ionicons.ttf"
OUTPUT = ROOT / "assets/fonts/HappyIonicons.ttf"

MAPPINGS = {
    0x41: 0xF107,  # add-outline
    0x42: 0xF215,  # chatbubble-outline
    0x43: 0xF2B7,  # documents-outline
    0x44: 0xF383,  # home-outline
    0x45: 0xF4A3,  # people-outline
    0x46: 0xF56C,  # settings-outline
    0x47: 0xF5C9,  # terminal-outline
}

font = TTFont(SOURCE)
source_cmap = {}
for table in font["cmap"].tables:
    source_cmap.update(table.cmap)

# The legacy Mac Roman cmap stores one-byte glyph IDs. Subsetting keeps the
# curated upstream outlines exact while assigning them small IDs that fit.
options = subset.Options()
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 16, 17]
subsetter = subset.Subsetter(options=options)
subsetter.populate(glyphs=[".notdef", "space", *[source_cmap[source] for source in MAPPINGS.values()]])
subsetter.subset(font)

for table in font["cmap"].tables:
    for target, source in MAPPINGS.items():
        table.cmap[target] = source_cmap[source]
    # GPUI 0.2.2 refuses any custom font without an `m` mapping because its
    # editor metrics use that character. Point it at the zero-ink space glyph;
    # icons use fixed square boxes and never measure em width from this face.
    table.cmap[ord("m")] = source_cmap[0x20]

names = font["name"]
for record in names.names:
    if record.nameID == 1:
        record.string = "Happy Ionicons".encode(record.getEncoding())
    elif record.nameID == 4:
        record.string = "Happy Ionicons".encode(record.getEncoding())
    elif record.nameID == 6:
        record.string = "HappyIonicons".encode(record.getEncoding())
    elif record.nameID == 16:
        record.string = "Happy Ionicons".encode(record.getEncoding())

font.save(OUTPUT, reorderTables=False)
print(OUTPUT)

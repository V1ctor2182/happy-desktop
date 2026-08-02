# Animation provenance

## sparkles.json

- **Copied from** `happy-list` (the Happy Coder React Native app),
  `sources/assets/animations/sparkles.json`, on 2 August 2026.
- **SHA-256** `b14e504ce3467a6ba1c519348dee9fc4e05286b9e4f058f33df9175865bde4b9`,
  byte-identical to the source file. It was not re-exported, re-drawn, or
  otherwise modified. The repository formatter is told to leave this directory's
  JSON alone (`ignorePatterns` in `.oxfmtrc.json`); without that it pretty-prints
  the file to five times the size and the hash above stops matching, which is
  the whole point of recording it.
- **Licence** MIT, `Copyright (c) 2024 Happy Coder Contributors`. That is a
  different copyright line from this repository's own
  (`Copyright (c) 2026 Happy (2) Contributors`), so the MIT requirement to carry
  the notice does apply. The complete, unabridged notice sits next to the file
  it covers, in `LICENSE` in this directory.
- **Upstream of upstream** unknown. `happy-list` records no attribution for
  these files and the JSON carries no author metadata, so this note can only
  vouch for the copy: where the artwork originally came from before it entered
  that repository has not been established here.
- **Format** Bodymovin/Lottie 5.5.2, 512×512, 60fps, 180 frames, 23 shape
  layers, no embedded raster assets and no external image dependencies. The
  file is already minified: 106 KB raw, 8.4 KB gzipped over the wire.

### Why it was not converted to a `.lottie` container

A `.lottie` is a zip around the same JSON. At 8.4 KB gzipped there is nothing
left for the container to win, and it would cost a build step, a binary blob in
review, and a second thing to keep reproducible. Plain JSON stays diffable and
needs no tooling.

### Why this is the only animation here

Eight animations were inspected frame by frame in a real renderer. They are
glossy 3D emoji: 👾 game, 🦉 owl, 🍿 popcorn, 🤖 robot, 🐌 snail, ✨ sparkles,
🗿 stone, 🪄 wand.

Only sparkles states something true about an _empty_ screen. It is the ordinary
sign for "clean, finished, nothing left", which is exactly what Happy's settled
empty states mean. The rest were rejected on content, not on taste:

- 🐌 snail and 🍿 popcorn both read as _waiting_. An empty state that looks like
  a loading state is worse than no illustration.
- 🗿 stone is a deadpan internet joke. Happy should not smirk at someone who
  found nothing.
- 🪄 wand promises the app will conjure the missing thing, which it will not.
- 🤖 robot, 🦉 owl and 👾 game are mascots. A mascot decorates an absence; it
  does not explain it.

Sparkles is used for one meaning only — _the absence is the good outcome_ — and
so appears only on surfaces that mean that. A screen that found nothing when it
should have found something keeps its static glyph. See `LottieMark.tsx`.

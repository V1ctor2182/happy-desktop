# Animation provenance

## Where these came from

All five files were copied from `happy-list` (the Happy Coder React Native app),
`sources/assets/animations/`, on 2 August 2026 — `sparkles.json` first, the other
four on the same day the vocabulary was widened. Each is byte-identical to its
source: none was re-exported, re-drawn, re-timed, or otherwise modified.

| File            | SHA-256                                                            | Format                                        | Size              |
| --------------- | ------------------------------------------------------------------ | --------------------------------------------- | ----------------- |
| `owl.json`      | `95402270d116a310aa4b1606f88a2bbc79d2b4d947b5d84181c0b126c7aaba59` | Lottie 5.5.2, 512×512, 60fps, 131f, 18 layers | 284 KB / 47 KB gz |
| `robot.json`    | `eeabc392ba20328ce97452eb826dddf3e306129e360ce4847c3b48470ffc053b` | Lottie 5.5.2, 512×512, 60fps, 180f, 13 layers | 343 KB / 30 KB gz |
| `snail.json`    | `6a9c7b648681ae9d15b31455a76f7d47c5f53d6d72da10b8e43ba134fbd47a2c` | Lottie 5.5.2, 512×512, 60fps, 180f, 19 layers | 368 KB / 42 KB gz |
| `sparkles.json` | `b14e504ce3467a6ba1c519348dee9fc4e05286b9e4f058f33df9175865bde4b9` | Lottie 5.5.2, 512×512, 60fps, 180f, 23 layers | 104 KB / 8 KB gz  |
| `wand.json`     | `8de70508fe1ebdeb08fc7005820329696f28ec84adc94f3cc4362cf7d3e72870` | Lottie 5.5.2, 512×512, 60fps, 176f, 30 layers | 193 KB / 16 KB gz |

None embeds a raster asset and none references an external image, so a scene is
one JSON fetch and nothing else. Each is imported by URL, so a screen only
downloads the animation it actually shows.

The repository formatter is told to leave this directory's JSON alone
(`ignorePatterns` in `.oxfmtrc.json`); without that it pretty-prints the files to
several times their size and the hashes above stop matching, which is the whole
point of recording them.

- **Licence** MIT, `Copyright (c) 2024 Happy Coder Contributors`. That is a
  different copyright line from this repository's own
  (`Copyright (c) 2026 Happy (2) Contributors`), so the MIT requirement to carry
  the notice does apply. The complete, unabridged notice sits next to the files
  it covers, in `LICENSE` in this directory.
- **Upstream of upstream** unknown. `happy-list` records no attribution for
  these files and the JSON carries no author metadata, so this note can only
  vouch for the copy: where the artwork originally came from before it entered
  that repository has not been established here.

### Why they were not converted to `.lottie` containers

A `.lottie` is a zip around the same JSON. These gzip to 8–47 KB over the wire
already, so there is little left for the container to win, and it would cost a
build step, a binary blob in review, and a second thing to keep reproducible.
Plain JSON stays diffable and needs no tooling.

## What each one means

Eight animations were inspected frame by frame in a real renderer. They are
glossy 3D emoji: 👾 game, 🦉 owl, 🍿 popcorn, 🤖 robot, 🐌 snail, ✨ sparkles,
🗿 stone, 🪄 wand. Five carry a meaning Happy actually needs, and each is used
for that one meaning and nothing else:

- 🤖 **robot** — _an agent is ready, and waiting to be told what to do._ The
  screen with no session open, and a conversation with nothing in it yet.
- 🐌 **snail** — _something is being read right now, and it is taking a moment._
  Every panel-wide wait, with no exceptions worth explaining: a session, a file,
  the documents list, the shared files, the plugin catalogue, the inbox, the
  activity list, the calls list, provider usage. It is deliberately
  self-deprecating: a wait is a wait,
  and pretending otherwise while someone stares at a blank screen is worse.
- 🪄 **wand** — _the missing thing is one you can make right here._ Only beside
  a button that makes it: the first document, the first note. Where the same
  screen is composed without that button it drops back to a plain glyph, because
  the wand's whole claim is that the reader can act.
- 🦉 **owl** — _we are watching, and nothing has been found yet._ A search box
  nobody has typed in.
- ✨ **sparkles** — _the absence is the good outcome._ A caught-up inbox, an
  activity list with nothing unread, a quiet home.

Each animation ends on the pose it was drawn to return to — the robot facing
front, the owl upright and alert, the snail at rest, the wand mid-sparkle, the
sparkle cluster full — so the frame a scene stops and holds is a frame worth
holding. That is why no hand-picked "rest frame" index appears in the code: the
last frame is the picture.

### The three that are not used

- 🍿 **popcorn** would be a second way of saying "wait", competing with the
  snail on the same screens. One waiting picture, used consistently, is a
  vocabulary; two is decoration.
- 🗿 **stone** is a deadpan internet joke. Happy should not smirk at someone who
  found nothing.
- 👾 **game** is a mascot with no reading beyond itself. A mascot decorates an
  absence; it does not explain one.

### Where a scene is deliberately absent

Artwork is for a state a reader sits in, not for every blank rectangle:

- **Errors and destructive states** keep their plain glyph. An animation next to
  "Session unavailable" would be levity in the wrong place.
- **A search or filter that matched nothing** keeps its glyph. It is a miss, not
  a settled absence, and it re-renders on every keystroke — art that replayed
  each time would be noise.
- **Small inline placeholders and repeated rows** keep their glyph. A scene is
  128px of artwork and a worker player; dozens at once would be neither.
- **Screens whose two halves are both empty** get one scene, on the half where
  the reader can act — the notes list, not the note editor beside it.

See `LottieScene.tsx` for how a scene plays, rests, and replays.

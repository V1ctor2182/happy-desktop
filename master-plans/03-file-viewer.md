# File Viewer

## Where we are going

The file surfaces — Changed files, All files, and whatever a file opens into —
should look like one thing that was drawn on purpose. Today they are a pile of
small problems: text and icons that do not line up vertically with the header or
the mode controls, faded low-contrast type, a heavy divider between the mode
switch and the list, and a "Changes · 24 files" header that eats a lot of room
for nothing.

The direction is the one we always want: more minimal, higher contrast, and more
color — but color that explains a difference rather than decorates.

Opening a file should open a real preview inside Happy, not a browser. Clicking
a JPEG shows the JPEG. Clicking a Markdown file shows a good Markdown viewer. A
video plays. That preview is one component, reused everywhere a file or a link
is opened. The only difference is where it lands: opened from Files it goes into
a main content tab; opened from the main content it opens on the right.

## How we get there

First the layout. Flatten the Changed / All files and List / Tree switches, and
make the header, the switches, the icons, and the rows share one vertical
rhythm in every combination of the two modes. Drop the big divider between the
switch and the list. We are getting away from little rules and stripes
everywhere, not just here. Shrink the "Changes · N files" header — it should not
own that much space.

The button that expands the right panel moves out of the content flow: put it in
the top right, to the right of the collapse button, rather than shifting all of
the content to make room for it.

Then the rows themselves. File icons should be colorful rather than neutral, and
they should come from the same source as the diff and tree component we already
use. The status vocabulary must actually mean something: U and M, and "Updated"
versus "Modified", are not a distinction anyone can read, and green on the wrong
one makes it worse. A new file is created — say that, and pick colors
accordingly.

Show the per-file change stat in Changes. The file name is the bright part; the
path is the gray part, and it may be hidden by default. Truncation belongs in the
middle of the path, never at the end where it eats the file name. Keep the whole
thing bounded, and let it scroll the way tool calls now do.

Last, build the preview component and route file opens through it — binaries
first, especially images and video, then Markdown. Chat links reuse it instead
of the browser.

## How we know it is done

- Header, mode switches, icons, and rows stay aligned across Changed / All files
  and List / Tree, with no jumping.
- The switches are flat, the divider under them is gone, and the changes header
  is small.
- The panel expand control sits beside the collapse control and no longer shifts
  content.
- Text is high contrast, file icons are colorful and come from the diff/tree
  icon source, and every git status has a name and a color a person can read
  without asking what it means.
- Changes shows a per-file stat; the file name is prominent, the path is gray
  and truncates in the middle, and the list is bounded and scrollable.
- Images, video, and Markdown open in Happy's own preview — in a main content
  tab from Files, on the right from the main content — and never in a browser.

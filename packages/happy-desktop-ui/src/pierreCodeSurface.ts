/**
 * The correction Pierre Diffs' shadow-DOM stylesheet needs wherever Happy owns
 * the scrollport around it — the working-tree diff and the file viewer's source
 * face. Both hand the renderer a whole pane and scroll it from outside, so both
 * need the same two things, written once here rather than drifting apart.
 *
 * Pierre reserves a classic scrollbar gutter inside every code column. On a pane
 * whose vertical scrollport belongs to Happy, that gutter is only an unpainted
 * lane down the right of every row: an addition's green and a deletion's red
 * stop short of the edge, and the lane comes and goes with the file's length, so
 * the same code sits at different coordinates depending on how much of it there
 * is. Releasing it lets each row reach the pane edge and continue underneath
 * whatever scrollbar is drawn above it, which then costs no layout at all.
 *
 * A scrollbar drawn above the rows covers the end of a long line, so each line
 * carries a spacer of that scrollbar's width, giving a long line somewhere
 * further to scroll and its last glyph a way out from under the thumb. The
 * spacer is zero unless a surface sets `--happy2-code-scrollbar-width`: code
 * inside prose is scrolled by the document, with no thumb of its own to clear.
 */
export const PIERRE_PANE_CSS = `
    [data-code] {
        scrollbar-gutter: auto;
    }
    [data-line]::after {
        content: "";
        display: inline-block;
        width: var(--happy2-code-scrollbar-width, 0px);
    }
`;

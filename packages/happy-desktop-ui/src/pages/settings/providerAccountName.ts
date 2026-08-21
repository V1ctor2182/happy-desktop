/**
 * What to call one provider account.
 *
 * The daemon knows an account by its configured id and by nothing else: two
 * accounts may sit behind the same vendor, so the id is the only thing that
 * tells `kirill_claude` from `claude`. Titling its words is the whole
 * transformation — nothing here guesses a vendor from the spelling, because a
 * guess would put two different accounts under one name.
 *
 * Every surface that names an account uses this, so the Providers category and
 * the Usage category call the same account the same thing.
 */
export function providerAccountName(providerId: string): string {
    return (
        providerId
            .split(/[_-]/u)
            .filter(Boolean)
            .map((part) => (part[0] ?? "").toLocaleUpperCase() + part.slice(1))
            .join(" ") || providerId
    );
}

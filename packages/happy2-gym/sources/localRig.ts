/**
 * The bundled Rig daemon refuses to boot unless a coding assistant is signed in
 * on the machine running it: without an authenticated inference provider it
 * exits with "No inference providers are available". CI runners and release
 * validation deliberately hold no such credentials, so scenarios that launch the
 * real daemon are skipped there rather than failing a build for a missing
 * developer login. Everything that can be proven against the mock Rig daemon
 * keeps running everywhere.
 */
export const localRigIsUnavailable =
    process.env.HAPPY2_SKIP_LOCAL_RIG_TESTS === "1" || process.env.CI !== undefined;

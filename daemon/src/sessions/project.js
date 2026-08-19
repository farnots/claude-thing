// A stable, short identity for "the project a session belongs to", derived from
// its working directory.
//
// The device groups tiles by this key and colours them from it. The directory
// itself does not travel: a SessionSummary is budgeted against the Bluetooth
// relay's single-chunk response (see chunk-fit.test.js), and a full path costs
// more than the whole per-session margin. Eight hex characters cost nine, and
// the daemon is the right place to decide that two sessions are the same
// project — the device only decides what that looks like.
//
// FNV-1a 32-bit rather than crypto: the function stays pure and synchronous,
// and collision resistance against an adversary is not what this is for. The
// shape follows slugify() in usage-accounts.js — short, stable, and never
// derived from something that moves.

export function projectKey(dir) {
  if (!dir) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < dir.length; i++) {
    h ^= dir.charCodeAt(i);
    // The multiply, in 32-bit pieces: h * 16777619 overflows a double's exact
    // integer range, and Math.imul is the one form that stays exact.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

import { fmtClock } from '../clock.js';
import { t } from '../i18n.js';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtTokens(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

// Assembled from the catalog rather than glued together with suffixes: French
// writes "35 min" and "1 h 35", which is not the same shape as "35m" and
// "1h 35m". No Intl.RelativeTimeFormat to lean on — the target is Chrome 69.
export function fmtDuration(ms) {
  var mins = Math.floor(ms / 60000);
  if (mins < 60) return t('unit.minutes', { m: mins });
  return t('unit.hoursMinutes', { h: Math.floor(mins / 60), m: mins % 60 });
}

// Under 80% clear, 80-99% sweating, 100% fainted. The thresholds are the
// design's, and they live here rather than on the usage screen because the clock
// screen draws a fill from the same reading: two copies of "80" is how the two
// screens end up disagreeing about when it starts to hurt.
export function moodFor(pct) {
  if (pct >= 1) return 'mood-out';
  if (pct >= 0.8) return 'mood-low';
  return 'mood-clear';
}

// Whatever the daemon sent, as a list of per-account readings. The array is what
// a current daemon sends when asked for it; the flat fields are what one that
// predates accounts sends, and what the default response still carries — so the
// old shape is one unnamed reading rather than a special case downstream.
export function usageReadings(u) {
  if (!u) return [];
  if (u.accounts && u.accounts.length) return u.accounts;
  return [u];
}

// Returns a stable token, not the drawn text — the same contract modeLabel and
// effortLabel below already had, and the reason all three survive translation:
// callers draw t('state.' + token) and, where they need one, build a class name
// out of the token itself. A translated token would produce class names like
// .m-planification and stop matching styles.css.
export function stateLabel(state, ended) {
  if (state === 'idle') return ended ? 'ENDED' : 'IDLE';
  return { busy: 'WORKING', attention: 'ATTENTION', celebrate: 'DONE' }[state] || 'IDLE';
}

// Permission mode, as the daemon reports it, shortened to something that fits
// a tile header. `auto` and `acceptEdits` stay distinct: they are two different
// modes, and the newer name replacing the older one is not a reason to draw
// them the same. Anything unrecognized — including a session no source has
// reported a mode for — returns null and the tile draws no badge.
var MODE_LABELS = {
  plan: 'PLAN',
  bypassPermissions: 'BYPASS',
  acceptEdits: 'EDITS',
  auto: 'AUTO',
  default: 'MANUAL',
};

export function modeLabel(mode) {
  return MODE_LABELS[mode] || null;
}

// Reasoning effort, as the daemon reports it. Whitelisted like the modes: the
// label doubles as a class name, and an unknown level draws neither label nor
// gait — the tile falls back to the plain working sprite. `ultrathink` renders
// as ULTRA: the full word was the only thing forcing the label under the 14px
// type floor; abbreviated, every label clears the meter and the tile edge.
var EFFORT_LABELS = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  xhigh: 'XHIGH',
  max: 'MAX',
  ultrathink: 'ULTRA',
};

export function effortLabel(effort) {
  return EFFORT_LABELS[effort] || null;
}

// A command you cannot take back must not cost the same gesture as "read a
// file". Anything flagged destructive costs a second press on the allow chip,
// on the queue hero and the prompt screen alike. The daemon now classifies at
// the source — against the full command, where a --force past the 200-char
// summary truncation is still visible — and sends the verdict on the ask. The
// regex stays as the fallback for daemons too old to send one, kept verbatim
// in sync with daemon/src/permission-bridge.js.
var DESTRUCTIVE_RE = /\brm\s+-|--force\b|--hard\b|\bDROP\s|\bTRUNCATE\b|\bmkfs|\bdd\s+if=|\bchmod\s+777\b|curl[^|]*\|\s*(ba|z)?sh/i;

export function isDestructive(ask) {
  if (ask.kind !== 'permission') return false;
  if (typeof ask.destructive === 'boolean') return ask.destructive;
  return DESTRUCTIVE_RE.test(String(ask.summary || ''));
}

// Which session's detail stream this screen actually reads: the open detail
// page's session, or the grid cursor's. Every other screen renders no detail,
// so the daemon can keep the rest of the stream to itself (null = none).
export function watchTarget(routeName, routeArg, state) {
  if (routeName === 'session') return routeArg || null;
  if (routeName === 'list') {
    var s = state.sessions[state.selectedIndex];
    return s ? s.id : null;
  }
  return null;
}

// The colour a project wears, from the key the daemon puts on every session.
//
// Deliberately coarse: twelve hues 30 degrees apart, each in a deep and a
// pastel take, for 24 swatches. Spreading the hash over all 360 hues looks like
// more resolution and is less — two projects landing a few degrees apart are
// one colour to the eye, so the grid quietly claims they are one project.
// Rounding to a step the eye can actually resolve does not make collisions
// rarer — measured over random paths, the odds that a screenful holds a
// confusable pair are the same either way: 12% at three projects, 23% at four,
// 36% at five, 49% at six. It makes them honest. Free-range, the question the
// panel raises is "are those two the same colour?"; here two stripes either
// plainly match or plainly don't, and two that differ are guaranteed to look
// it. A colliding pair is also the mild failure: it reads as one project where
// there are two, while the case this feature exists for — several tiles all
// printing the same basename — is settled the moment their stripes differ.
//
// Lightness is the second axis and not saturation, which was tried first and
// does not survive a 6px stripe: a muted teal and a vivid teal at the same hue
// read as the same colour, so the axis counted as separation in the arithmetic
// and delivered none on the panel. Deep against pastel reads at that width.
//
// Saturation sits at the semantic colours' level or below (--warn is a full
// 100%, --danger 71%) and the stripe runs down an edge no state mark uses, so
// no hue can pass for an annunciator lamp. Empty for a session whose directory
// nothing has named — the caller then draws no mark at all rather than one
// colour standing for "unknown". The detail screen prints the whole path, which
// is where a doubt about two matching stripes gets settled.
var PROJECT_HUES = 12;

export function projectColor(key) {
  var hue = projectHue(key);
  if (hue === null) return '';
  return 'hsl(' + hue + ', 55%, ' + (projectPale(key) ? 70 : 46) + '%)';
}

export function projectHue(key) {
  var n = projectNum(key);
  return n === null ? null : (n % PROJECT_HUES) * (360 / PROJECT_HUES);
}

// The second axis, off the bits the hue does not use: same hue, deep or pastel.
export function projectPale(key) {
  var n = projectNum(key);
  return n === null ? false : Math.floor(n / PROJECT_HUES) % 2 === 1;
}

function projectNum(key) {
  if (!key) return null;
  // The key is already a well-spread 32-bit hash, so its low bits are as good
  // as any; hashing it a second time would buy nothing.
  var n = parseInt(key, 16);
  return isNaN(n) ? null : n;
}

// `color` tints the screen to the project it belongs to: the mark takes it and
// the rule under the bar picks it up, which is how a session screen says which
// of the identically-named tiles you actually opened. Screens that span every
// session — the list, the queue, usage — pass nothing and keep the brand accent.
export function topbar(title, connected, count, color) {
  return '<div class="topbar' + (color ? ' tinted' : '') + '"' +
    (color ? ' style="border-bottom-color:' + color + '"' : '') + '>' +
    '<span class="mark"' + (color ? ' style="background:' + color + '"' : '') +
    '></span>' +
    '<span class="title">' + esc(title) + '</span>' +
    (count ? '<span class="tcount">' + esc(count) + '</span>' : '') +
    '<span class="spacer"></span>' +
    '<span class="clock">' + fmtClock() + '</span>' +
    '<span class="conn' + (connected ? ' ok' : '') + '"></span></div>';
}

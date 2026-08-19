import { esc, fmtTokens, fmtDuration, moodFor, usageReadings } from './helpers.js';
import { fmtClock, now } from '../clock.js';
import { t, tn } from '../i18n.js';

// The resting screen works as a desk clock: the clock stays the hero, and the
// status line sits immediately beneath it, where the eye already is. Blocked
// state is carried by colour and motion (plus the pulsing panel edge), never
// by outgrowing the clock.
//
// It also carries the session window — how much of it is spent and how long is
// left — because the whole point of this screen is not having to leave it. One
// row per Claude account: the accounts are polled separately and their windows
// reset at different times, so a single merged row would be a lie about both.
export function renderAmbient(state) {
  var lamps = '';
  for (var i = 0; i < state.sessions.length && i < 8; i++) {
    lamps += '<span class="lamp ' + state.sessions[i].state + '"></span>';
  }
  var working = state.stats.active || 0;
  var resting = Math.max(0, state.sessions.length - working);
  var totalOut = 0;
  for (var j = 0; j < state.sessions.length; j++) totalOut += state.sessions[j].tokens.out || 0;

  var blocked = state.asks.length;
  var head = blocked
    ? '<div class="ahead blocked">' + tn('ambient.needsYou', blocked) + '</div>'
    : '<div class="ahead">' + t('ambient.nothingBlocked') + '</div>';

  // The whole screen is the mascot's switch: he wanders everywhere, so no
  // fixed hotspot could reliably be "on him", and the clock has no other tap
  // target to collide with. The strip below adds no tap target of its own —
  // the full usage screen has its own button on the bezel.
  return '<div class="screen ambient" data-action="mascot-toggle">' +
    '<div class="bigclock">' + fmtClock() + '</div>' +
    head +
    '<div class="caption">' + t('ambient.caption', { working: working, resting: resting }) + '</div>' +
    (lamps ? '<div class="fleet">' + lamps + '</div>' : '') +
    usageStrip(state.usage) +
    '<div class="tokens">' + t('ambient.tokensOut', { tokens: fmtTokens(totalOut) }) + '</div>' +
    '<div class="hint">' + t(blocked ? 'ambient.hintAnswer' : 'ambient.hintSessions') + '</div>' +
    '</div>';
}

// ---- the session window -----------------------------------------------------

// Two rows. It is what the daemon sends synchronously anyway (relay roles cap at
// two accounts), and a third row starts crowding the clock.
var STRIP_ROWS = 2;

function usageStrip(u) {
  var list = usageReadings(u);
  // Before the first reading lands there is nothing honest to draw, and the
  // clock screen does not gain a ghost row waiting for one.
  if (!list.length) return '';

  var named = list.length > 1;
  var rows = '';
  for (var i = 0; i < list.length && i < STRIP_ROWS; i++) rows += stripRow(list[i], named);

  // Past the rows that fit, say how many are missing rather than pretending
  // these are all of them. The full list is a dial turn away on the usage page.
  var more = list.length > STRIP_ROWS
    ? '<span class="amore">+' + (list.length - STRIP_ROWS) + '</span>'
    : '';

  return '<div class="ustrip">' + rows + more + '</div>';
}

// The session limit only. It is the one that blocks within the hour, and there
// is deliberately no fallback to the first limit: a weekly figure drawn where a
// session figure belongs would be worse than an empty row.
function sessionOf(r) {
  var limits = (r && r.limits) || [];
  for (var i = 0; i < limits.length; i++) {
    if (limits[i].key === 'session') return limits[i];
  }
  return null;
}

// How long is left, against the Mac clock this device is corrected to (now(),
// never Date.now()). An instant already behind us belongs to a window that
// rolled over under a held reading — say that, rather than count backwards.
function timeLeft(l) {
  if (!l || typeof l.resetsAt !== 'number' || !l.resetsAt) return '';
  var ms = l.resetsAt - now();
  if (ms <= 0) return t('ambient.resetDue');
  return fmtDuration(ms);
}

// The first cell says what the row is about. With several accounts that is the
// account — repeating SESSION down the strip would say nothing twice. With one
// there is no account to name and the window itself needs saying, or the screen
// carries a percentage of nothing in particular.
function stripRow(r, named) {
  var name = '<span class="aname">' + esc(named ? (r.label || r.id || '') : t('ambient.session')) + '</span>';
  var l = sessionOf(r);

  // An account with no session figure fails inside its own row: the other one
  // keeps reporting, and why it failed is on the usage screen, which has the
  // width for it.
  if (!l) {
    return '<div class="arow">' + name +
      '<span class="apct">—</span>' +
      '<span class="anote">' + t('ambient.noReading') + '</span>' +
      '</div>';
  }

  var pct = Math.max(0, Math.min(1, l.used || 0));
  var m = moodFor(pct);
  // Stale is about the percentage, which may be held from an earlier poll. The
  // time left is not affected: it counts down to an absolute instant.
  return '<div class="arow">' + name +
    '<span class="apct">' + Math.round(pct * 100) + '%</span>' +
    '<span class="utrack"><span class="ufill ' + m + '" style="width:' + (pct * 100).toFixed(1) + '%"></span></span>' +
    '<span class="aleft ' + m + '">' + timeLeft(l) + '</span>' +
    '<span class="astale">' + (r.stale ? t('usage.stale') : '') + '</span>' +
    '</div>';
}

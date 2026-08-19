import { esc, topbar, moodFor, usageReadings } from './helpers.js';
import { t } from '../i18n.js';

// The real /usage figures: plan-limit percentages with reset times, plus the
// "what's contributing" breakdown. Each bar carries its own mascot driven by
// that bar's own fill, so the limits read as independent gauges rather than one
// verdict — being out of weekly Fable says nothing about your session limit.
//
// With more than one Claude account declared on the Mac, the same screen draws
// one column per account instead. Each account is polled separately and its
// figures are its own, so the timestamp moves off the footer and onto each
// column header: two columns dated the same minute would be a lie.

// Two columns per page. 800px less the side padding leaves ~368px each, which is
// as narrow as a bar and its mascot stay legible.
export var USAGE_COLS = 2;

export function renderUsage(state) {
  var bar = topbar(t('bar.usage'), state.daemonConnected);
  var list = usageReadings(state.usage);
  // One account keeps the full-width layout it has always had, mascot phrases
  // and contributing tables included. Nothing about that case changes.
  if (list.length < 2) return single(bar, list[0] || null);
  return columns(bar, list, state.usageCol || 0);
}

function single(bar, r) {
  if (!r || !r.limits || !r.limits.length) {
    return '<div class="screen">' + bar +
      '<div class="empty">' + esc(r && r.error ? r.error : t('usage.reading')) + '</div></div>';
  }

  var rows = '';
  for (var i = 0; i < r.limits.length; i++) rows += wideBar(r.limits[i]);

  return '<div class="screen">' + bar +
    '<div class="usage">' + rows + tables(r) + '</div>' +
    '<div class="ufoot">' + esc(r.updatedLabel || '') + (r.stale ? t('usage.staleSuffix') : '') + '</div>' +
    '</div>';
}

function wideBar(l) {
  var pct = fill(l);
  var m = moodFor(pct);
  return '<div class="ubar">' +
    '<div class="ubarmain">' +
    '<div class="uhead"><span class="ulabel">' + esc(l.label) + '</span>' +
    '<span class="ureset">' + esc(l.detail || '') + '</span>' +
    '<span class="upct">' + Math.round(pct * 100) + '%</span></div>' +
    track(pct, m) +
    '</div>' +
    '<span class="usprite ' + m + '"></span>' +
    '<span class="uphrase ' + m + '">' + moodLabel(pct) + '</span>' +
    '</div>';
}

// ---- two or more accounts ----------------------------------------------------

function columns(bar, list, col) {
  var start = Math.max(0, Math.min(col, list.length - USAGE_COLS));
  var page = list.slice(start, start + USAGE_COLS);

  var cols = '';
  for (var i = 0; i < page.length; i++) cols += column(page[i]);

  // Only worth saying when there is something off-screen. Same shape as the
  // bluetooth list's overflow line, for the same reason.
  var more = list.length > USAGE_COLS
    ? '<div class="umore">' + (start + 1) + '–' + (start + page.length) +
      ' / ' + list.length + t('common.turnDialForMore') + '</div>'
    : '';

  return '<div class="screen">' + bar +
    '<div class="ucols">' + cols + '</div>' + more +
    '<div class="ufoot">' + t('usage.fromClaude') + '</div>' +
    '</div>';
}

function column(r) {
  var head = '<div class="ucolhead">' +
    '<span class="ucolname">' + esc(r.label || r.id || '') + '</span>' +
    '<span class="ucolts">' + esc(stamp(r)) + '</span></div>';

  // An account with nothing to draw says why, in its own column. The other
  // column is untouched: one account being signed out or misconfigured is not a
  // reason to stop reporting the other.
  if (!r.limits || !r.limits.length) {
    return '<div class="ucol">' + head +
      '<div class="ucolerr">' + esc(r.error || t('usage.reading')) + '</div></div>';
  }

  var bars = '';
  for (var i = 0; i < r.limits.length; i++) bars += narrowBar(r.limits[i]);

  // Figures and an error at once: the last good reading with a note that the
  // newest poll failed. Both matter, so both are drawn.
  var note = r.error ? '<div class="ucolerr">' + esc(r.error) + '</div>' : '';

  return '<div class="ucol">' + head +
    '<div class="ucolbars">' + bars + '</div>' +
    '<div class="ucolfoot">' + windowLine(r) + note + '</div>' +
    '</div>';
}

// No mood phrase here — 96px of it does not fit a 368px column, and the mascot
// and the fill colour already say the same thing. The reset clause moves under
// the track instead of sharing the header line.
function narrowBar(l) {
  var pct = fill(l);
  var m = moodFor(pct);
  return '<div class="ubar ucompact">' +
    '<div class="ubarmain">' +
    '<div class="uhead"><span class="ulabel">' + esc(l.label) + '</span>' +
    '<span class="upct">' + Math.round(pct * 100) + '%</span></div>' +
    track(pct, m) +
    '<div class="ureset ucolreset">' + esc(l.detail || '') + '</div>' +
    '</div>' +
    '<span class="usprite ' + m + '"></span>' +
    '</div>';
}

// The device clock has no RTC and no NTP, so every time on screen is formatted
// on the Mac and shipped as text. Pull the clock out of that label rather than
// re-deriving it from updatedTs, which would be wrong by however far the device
// has drifted.
function stamp(r) {
  var m = /(\d{1,2}:\d{2})/.exec(String(r.updatedLabel || ''));
  return (m ? m[1] : '') + (r.stale ? (m ? ' ' : '') + t('usage.stale') : '');
}

function windowLine(r) {
  var w = (r.windows || [])[0];
  if (!w) return '';
  return '<div class="uwin">' + esc(w.window) + ' · ' + w.requests + ' req · ' + w.sessions + ' sessions</div>';
}

// ---- shared ------------------------------------------------------------------

function fill(l) {
  return Math.max(0, Math.min(1, l.used || 0));
}

function track(pct, m) {
  return '<div class="utrack"><span class="ufill ' + m +
    '" style="width:' + (pct * 100).toFixed(1) + '%"></span></div>';
}

// Below the divider: what the window actually was, then the two contributor
// tables side by side. Full-width layout only — a column has no room for them,
// and the daemon does not send them once it is sending more than one account.
function tables(u) {
  var w = (u.windows || [])[0];
  if (!w) return '';
  var win = esc(w.window) + ' · ' + w.requests + ' requests · ' + w.sessions + ' sessions';
  return '<div class="ubreak">' +
    '<div class="uwin">' + win + '</div>' +
    '<div class="utables">' +
    table(t('usage.skills'), w.skills || []) +
    table(t('usage.subagents'), w.subagents || []) +
    '</div></div>';
}

function table(title, rows) {
  var body = '';
  for (var i = 0; i < rows.length && i < 3; i++) {
    body += '<div class="utrow"><span class="utname">' + esc(rows[i].name) + '</span>' +
      '<span class="utval">' + esc(rows[i].pct) + '</span></div>';
  }
  if (!body) body = '<div class="utrow"><span class="utname">—</span></div>';
  return '<div class="utable"><div class="uthead"><span class="uttitle">' + title + '</span>' +
    '<span class="utunit">' + t('usage.pctOfUsage') + '</span></div>' + body + '</div>';
}

function moodLabel(pct) {
  if (pct >= 1) return t('usage.moodOut');
  if (pct >= 0.8) return t('usage.moodLow');
  return t('usage.moodClear');
}

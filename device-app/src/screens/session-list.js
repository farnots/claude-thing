import { esc, topbar, stateLabel, modeLabel, effortLabel, fmtDuration, projectColor } from './helpers.js';
import { now } from '../clock.js';
import { t } from '../i18n.js';

// Sideways-scrolling grid: two rows, columns flow to the right without limit.
// The dial walks sessions in column-major order and the track slides so the
// selected tile stays on screen — any number of sessions fits.
var ROWS = 2;
var COLS_VISIBLE = 2;
var COL_STEP = 380;   // 372px tile + 8px gap (see .gridtrack)

var scrollCol = 0;   // leftmost visible column

export function renderList(state) {
  if (!state.sessions.length) {
    scrollCol = 0;
    return '<div class="screen">' + topbar(t('bar.sessions'), state.daemonConnected) +
      '<div class="empty">' + t('list.empty') + '</div></div>';
  }

  var totalCols = Math.ceil(state.sessions.length / ROWS);
  var selCol = Math.floor(state.selectedIndex / ROWS);
  if (selCol < scrollCol) scrollCol = selCol;
  if (selCol > scrollCol + COLS_VISIBLE - 1) scrollCol = selCol - COLS_VISIBLE + 1;
  var maxScroll = Math.max(0, totalCols - COLS_VISIBLE);
  if (scrollCol > maxScroll) scrollCol = maxScroll;
  if (scrollCol < 0) scrollCol = 0;

  var tiles = '';
  for (var i = 0; i < state.sessions.length; i++) {
    // Tiles beyond the viewport (and the peeking column) get their animations
    // stopped: forty offscreen sprites stepping their sheets is paint work the
    // panel never shows. Scrolling re-renders the list, so the marks track.
    var col = Math.floor(i / ROWS);
    var off = col < scrollCol || col > scrollCol + COLS_VISIBLE;
    tiles += tile(state.sessions[i], i === state.selectedIndex, state, off);
  }

  var offset = scrollCol * COL_STEP;
  // No scrollbar: the next column's edge peeking past the right bezel is the
  // affordance (see .gridwrap), and it costs no vertical space on a 480px panel.
  return '<div class="screen">' +
    topbar(t('bar.sessions'), state.daemonConnected, String(state.sessions.length)) +
    '<div class="gridwrap"><div class="gridtrack" style="transform:translateX(-' + offset + 'px)">' +
    tiles + '</div></div></div>';
}

function tile(s, selected, state, off) {
  // The working mascot's gait comes from the session's effort level; only a
  // busy tile runs, and only a whitelisted level gets a class and a label.
  var eff = s.state === 'busy' ? effortLabel(s.effort) : null;
  // Which project the session belongs to, as a stripe down the left edge. The
  // two marks already on the tile are spoken for — the cap across the top is
  // structural everywhere but ATTENTION, and the accent ring is the dial's
  // cursor — so grouping takes an edge neither of them uses, and a tile can say
  // "needs you", "you are here" and "this project" at once. Built from a number
  // this file computed, never from daemon text, so the inline style is not a
  // way into the markup.
  var color = projectColor(s.project);
  return '<div class="tile state-' + s.state + (selected ? ' selected' : '') +
    (eff ? ' e-' + eff.toLowerCase() : '') +
    (off ? ' off' : '') +
    '" data-action="open" data-id="' + esc(s.id) + '">' +
    '<span class="cap"></span>' +
    // After the cap, so the stripe owns the corner where they meet.
    (color ? '<span class="spine" style="background:' + color + '"></span>' : '') +
    '<div class="thead"><span class="lamp ' + s.state + '"></span>' +
    '<span class="slabel">' + t('state.' + stateLabel(s.state, s.ended)) + '</span>' +
    modeChip(s.permissionMode) +
    (s.pendingPermission ? '<span class="badge">!</span>' : '') + '</div>' +
    // The name is measured after paint and only marquees if it actually
    // overflows; see marquee() in main.js.
    '<div class="tname"><span class="tnamei" data-marquee="1">' + esc(s.name) + '</span></div>' +
    '<div class="tsub">' + esc(subline(s, state)) + '</div>' +
    meterBlock(s, eff ? t('effort.' + eff) : null) +
    '<span class="sprite"></span>' +
    '</div>';
}

// Which permission mode the window is in — the one thing about a session that
// its output never reveals. Only whitelisted modes reach the markup, so the
// label is safe to build a class name out of; an unknown mode draws nothing
// rather than a badge saying something the daemon never claimed.
function modeChip(mode) {
  var token = modeLabel(mode);
  if (!token) return '';
  // The token names the class, the catalog draws the word. Translating the token
  // would give .m-planification, which styles.css knows nothing about.
  return '<span class="mode m-' + token.toLowerCase() + '">' + t('mode.' + token) + '</span>';
}

// The tile's bottom-left block: model and effort merged into one spec line,
// then the context track. Both are lean-in confirmations read once — the gait
// already carries effort across the room — so they share a single 13px mono
// line, which frees the sprite column of its caption and lets the mascot grow.
// The spec line prints whenever a source has named either — including on ended
// sessions, where there is no meter at all — and the track carries its own
// CONTEXT NN% label inside, so no line above it is spent on a number.
//
// Neutral all the way up, red only near the top: a filling context window is
// normal and must not read as an alarm until it is actually close to
// compacting. Absent when the daemon can't work out the fraction.
function meterBlock(s, eff) {
  var model = (s.model || '').replace(/^claude-/, '');
  var spec = model && eff ? model + '  ·  ' + eff : (model || eff || '');
  if (!spec && s.context == null) return '';
  var hot = s.context != null && s.context >= 0.8 ? ' hot' : '';
  var html = '<div class="ctx' + hot + '">';
  if (spec) html += '<div class="tspec">' + esc(spec) + '</div>';
  if (s.context != null) {
    var pct = Math.max(0, Math.min(1, s.context));
    // The label is drawn twice: light ink on the bare track underneath, and a
    // dark copy inside the fill, which clips it at its own edge. Each glyph
    // flips ink at the exact pixel the fill passes it — a single per-span
    // threshold left the word fill-on-fill while the bar was partway under it,
    // and hid where the fill actually ended.
    var label = '<span class="ctxword">' + t('list.context') + '</span>' +
      '<span class="ctxnum">' + Math.round(pct * 100) + '%</span>';
    html += '<div class="ctxtrack">' +
      '<span class="ctxtext">' + label + '</span>' +
      '<span class="ctxfill" style="width:' + (pct * 100).toFixed(1) + '%">' +
      '<span class="ctxtext dark">' + label + '</span></span>' +
      '</div>';
  }
  return html + '</div>';
}

function subline(s, state) {
  var d = state.details[s.id];
  if (s.pendingPermission) return t('list.needsAnswer');
  if (d && d.currentTool) return d.currentTool + ' · ' + (d.lastMessage || '');
  if (s.state === 'celebrate' && s.lastActivityTs) {
    // The duration moves inside the sentence in French — "terminé il y a 5 min" —
    // so the whole line is one catalog entry rather than three glued fragments.
    return t('list.finishedAgo', { d: fmtDuration(now() - s.lastActivityTs) });
  }
  if (d && d.lastMessage) return d.lastMessage;
  return s.state === 'busy' ? t('list.working') : '';
}

// Wall time on the Car Thing, which owns neither half of a correct clock.
//
// It has no battery-backed RTC and never reaches an NTP server, so its epoch is
// whatever the last boot left behind — minutes, hours or years off. And its
// firmware ships no timezone data, so Date always runs UTC. Both are corrected
// from the daemon, which stamps every session snapshot with the Mac's epoch
// (serverNowMs) and UTC offset (tzOffsetMin).
//
// This matters beyond the topbar clock: every timestamp the device compares
// against — a permission's createdTs, a session's startedTs — was stamped by
// the Mac. Subtracting a skewed device Date.now() from those turns countdowns
// and durations into nonsense, so every screen reads now() rather than
// Date.now().
//
// The frame-level server_timestamp_ms is deliberately NOT used: nocturned
// re-emits relayed events with its own (device) clock, so on hardware that
// field carries the very time we are correcting.
//
// The third thing the device cannot know is which format this user reads —
// 14:05 or 2:05 PM. That is a preference, not a measurement, so it is set on
// the Mac (webpage Settings) and rides the same snapshot already resolved to a
// boolean: the device never sees the "auto" rule, only its answer.

var skewMs = 0;
var tzOffsetMin = null;
var clock24 = false;

// Small corrections are ignored so the clock does not jitter across a minute
// boundary on relay latency alone; anything real is orders of magnitude bigger.
var RESYNC_THRESHOLD_MS = 2000;

export function setServerNow(serverMs) {
  if (typeof serverMs !== 'number' || !isFinite(serverMs)) return;
  var next = serverMs - Date.now();
  if (Math.abs(next - skewMs) >= RESYNC_THRESHOLD_MS) skewMs = next;
}

export function setTzOffset(min) {
  tzOffsetMin = typeof min === 'number' && isFinite(min) ? min : null;
}

// Anything that is not a true boolean means 12-hour, which is what a daemon too
// old to send the field leaves us with.
export function setClock24(on) {
  clock24 = on === true;
}

// Mac epoch time. Falls back to the device's own clock until the first
// snapshot lands, or against a daemon too old to send serverNowMs.
export function now() {
  return Date.now() + skewMs;
}

export function fmtClock(d) {
  d = d || new Date(now());
  var h, m;
  if (tzOffsetMin === null) {
    h = d.getHours();
    m = d.getMinutes();
  } else {
    var shifted = new Date(d.getTime() - tzOffsetMin * 60000);
    h = shifted.getUTCHours();
    m = shifted.getUTCMinutes();
  }
  var mm = (m < 10 ? '0' : '') + m;
  // 24-hour pads the hour too: 09:07, not 9:07, which is what the format means
  // everywhere it is used.
  if (clock24) return (h < 10 ? '0' : '') + h + ':' + mm;
  var ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + mm + ' ' + ap;
}

// Tests only: forget everything the daemon taught.
export function resetClock() {
  skewMs = 0;
  tzOffsetMin = null;
  clock24 = false;
}

// When the current window actually resets, as an instant.
//
// `/usage` prints the reset as prose — "resets Aug 19 at 9:09pm", sometimes with
// the zone it means in parentheses, never with a year. That is enough for a
// person reading the line and useless for "how long have I got": the device
// cannot subtract prose, and it cannot resolve the prose either — its firmware
// ships no timezone data and no month names it can trust, and its own epoch is
// whatever the last boot left behind.
//
// So the Mac resolves the sentence to an epoch once, at parse time, and the
// device does one subtraction against the Mac clock it is already corrected to
// (see device-app/src/clock.js). A number rather than a formatted "3h 48m"
// because the countdown then keeps descending between polls instead of freezing
// on whatever the last minute's reading said.
//
// Everything here is pure: `now` is a parameter, so every case below is testable
// at a fixed date.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// "Aug 19 at 9:09pm" — the shape observed on every machine so far.
const DATED = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})\s+at\s+(.+)$/i;
// Not observed, cheap to accept: Claude Code words some dates relatively.
const RELATIVE = /^(today|tomorrow)\s+at\s+(.+)$/i;
// "9:09pm", "5pm" (no minutes — real output), "17:09".
const TIME = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

// A reset stated as past is a reading whose window has already rolled; a reset
// stated as *hours* past is a year we guessed wrong. This is where the line
// between the two sits.
const PAST_SLACK_MS = 12 * 3600 * 1000;

const zones = new Map();

// Reads the wall clock a zone shows at an instant. Intl is used only with an
// explicit timeZone — never to infer a locale, which is the mistake 2.1.0 was
// about — so the en-US formatting here is a parsing convenience, not a guess
// about anyone's preferences.
function zoneFormat(tz) {
  let fmt = zones.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    zones.set(tz, fmt);
  }
  return fmt;
}

// A zone we can actually convert in, or none. An unknown name is not a reason to
// lose the reset entirely: the zone /usage prints is the one the account is set
// to, which on nearly every machine is also the Mac's.
function zoneOrLocal(tz) {
  const name = tz ? String(tz).trim() : '';
  if (!name) return '';
  try {
    zoneFormat(name);
    return name;
  } catch (e) {
    return '';
  }
}

function zoneParts(ts, tz) {
  const fmt = zoneFormat(tz);
  const out = {};
  for (const p of fmt.formatToParts(new Date(ts))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

// How far ahead of UTC the zone is at that instant, in ms.
function offsetAt(ts, tz) {
  const p = zoneParts(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}

// A wall time in a zone, as an instant. Two passes: the first offset is read at
// the wrong instant by up to an hour, which only matters across a DST boundary —
// the second reading, taken at the corrected instant, is the one that lands.
function zonedTime(y, mo, d, h, mi, tz) {
  if (!tz) return new Date(y, mo, d, h, mi, 0, 0).getTime();
  const wall = Date.UTC(y, mo, d, h, mi);
  const first = wall - offsetAt(wall, tz);
  return wall - offsetAt(first, tz);
}

function parseTime(text) {
  const m = TIME.exec(String(text).trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  const ap = m[3] && m[3].toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === 'pm' ? 12 : 0);
  } else if (h > 23) return null;
  if (mi > 59) return null;
  return { h, mi };
}

// Which year the printed month and day belong to. The line carries none, so all
// three neighbouring years are candidates and the nearest one that is not hours
// in the past wins — that is what carries "Jan 2 at 5pm" read on December 31st
// into the next year rather than eleven months into the past.
function pickYear(ref, mo, d, t, tz, now) {
  const cands = [ref - 1, ref, ref + 1]
    .map((y) => zonedTime(y, mo, d, t.h, t.mi, tz))
    .filter((ts) => Number.isFinite(ts));
  const ahead = cands.filter((ts) => ts >= now - PAST_SLACK_MS);
  if (ahead.length) return Math.min(...ahead);
  return cands.length ? Math.max(...cands) : 0;
}

// The reset clause as an epoch, or 0 when it says nothing we can resolve. Never
// a guessed date: a shape this does not recognise costs the countdown, and the
// percentage and the printed clause are drawn either way.
export function parseResetAt(clause, tz, now = Date.now()) {
  const text = String(clause == null ? '' : clause)
    .replace(/^\s*resets\s+/i, '')
    .replace(/[.,;]\s*$/, '')
    .trim();
  if (!text) return 0;

  const zone = zoneOrLocal(tz);
  // The year, and the meaning of "today", are read in the zone the clause is
  // stated in — not the Mac's, which can be a day away from it.
  const here = zone ? zoneParts(now, zone) : null;
  const ref = here
    ? { y: here.year, mo: here.month - 1, d: here.day }
    : (() => { const n = new Date(now); return { y: n.getFullYear(), mo: n.getMonth(), d: n.getDate() }; })();

  const dated = DATED.exec(text);
  if (dated) {
    const mo = MONTHS[dated[1].slice(0, 3).toLowerCase()];
    const day = Number(dated[2]);
    const t = parseTime(dated[3]);
    if (mo === undefined || !t || day < 1 || day > 31) return 0;
    return pickYear(ref.y, mo, day, t, zone, now);
  }

  const rel = RELATIVE.exec(text);
  if (rel) {
    const t = parseTime(rel[2]);
    if (!t) return 0;
    const d = ref.d + (rel[1].toLowerCase() === 'tomorrow' ? 1 : 0);
    return zonedTime(ref.y, ref.mo, d, t.h, t.mi, zone);
  }

  // A bare time means the next time it comes round: a session window resets
  // within five hours, so the same clock time already past today is tomorrow's.
  const only = parseTime(text);
  if (only) {
    const today = zonedTime(ref.y, ref.mo, ref.d, only.h, only.mi, zone);
    if (today > now) return today;
    return zonedTime(ref.y, ref.mo, ref.d + 1, only.h, only.mi, zone);
  }

  return 0;
}

// User settings: the handful of choices that are the user's, not the code's.
//
// Everything else the daemon holds is either derived from live sources or
// rebuilt at boot. These are neither — nobody re-picks a clock format after a
// restart — so they live on disk through persist.js, which already does the
// atomic write and treats a missing file as "nothing saved yet".
//
// The file is read straight off disk on every call rather than cached: a few
// dozen bytes, written when a human clicks something, and a cache would be one
// more thing to invalidate for no gain. The host probe further down is the one
// thing here that IS cached, and says why.

import { execFileSync } from 'node:child_process';
import { readState, writeState } from './persist.js';
import { log } from './log.js';

const DEFAULTS = { clockFormat: 'auto' };

export const CLOCK_FORMATS = ['auto', '12', '24'];

export function readSettings() {
  const saved = readState('settings', null);
  return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

// Returns the settings as they now stand, or null if the value was not one we
// know — the caller turns that into a 400 rather than persisting nonsense.
export function setClockFormat(value) {
  if (!CLOCK_FORMATS.includes(value)) return null;
  const next = { ...readSettings(), clockFormat: value };
  writeState('settings', next);
  return next;
}

// Does this Mac write hours 0–23?
//
// Not a question Intl can answer on its own here: Node derives its default
// locale from LANG/LC_ALL, which on macOS is whatever the terminal exported and
// has nothing to do with System Settings — a Mac set to French routinely runs
// with LANG=en_US.UTF-8, and asking Intl would answer 12-hour for a user who
// has read 14:05 all their life. So the real preference is read out of the
// global defaults domain, in the order macOS itself resolves it: the explicit
// 24-Hour Time switch first, then the region.
//
// Cached: this forks a subprocess and resolveClock24() runs on every snapshot,
// which is several times a second on a busy Mac. A preference change takes up
// to the TTL to reach the device, which is invisible for something nobody
// toggles twice.
const HOST_PROBE_TTL_MS = 60_000;
let hostProbe = { at: 0, value: false };

function readDefault(key) {
  try {
    return execFileSync('defaults', ['read', '-g', key], {
      encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;   // an unset key exits non-zero, which is the ordinary case
  }
}

// hourCycle rather than hour12: Node leaves hour12 undefined for plenty of
// locales, while hourCycle is always one of h11/h12/h23/h24.
function localePrefers24(locale) {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' })
      .resolvedOptions().hourCycle;
    return cycle === 'h23' || cycle === 'h24';
  } catch {
    return null;
  }
}

function probeHost24() {
  if (process.platform === 'darwin') {
    if (readDefault('AppleICUForce24HourTime') === '1') return true;
    if (readDefault('AppleICUForce12HourTime') === '1') return false;
    // e.g. "fr_FR", sometimes with an @rg=… region override glued on.
    const appleLocale = readDefault('AppleLocale');
    if (appleLocale) {
      const fromRegion = localePrefers24(appleLocale.split('@')[0].replace(/_/g, '-'));
      if (fromRegion !== null) return fromRegion;
    }
  }
  // Not a Mac, or defaults told us nothing: the process locale is all we have.
  const fromEnv = localePrefers24(undefined);
  return fromEnv === null ? false : fromEnv;
}

function hostPrefers24() {
  const age = Date.now() - hostProbe.at;
  if (hostProbe.at !== 0 && age < HOST_PROBE_TTL_MS) return hostProbe.value;
  let value = hostProbe.value;
  try {
    value = probeHost24();
  } catch (err) {
    log('ST', `could not read the host clock format: ${err.message}`);
  }
  hostProbe = { at: Date.now(), value };
  return value;
}

// Tests only: forget what the host said.
export function resetHostProbe() {
  hostProbe = { at: 0, value: false };
}

// The device is told the answer, not the rule — see the snapshot comment in
// sessions/store.js. Re-resolved per call (host probe cached, see above) so a
// locale change on the Mac lands without a daemon restart, the same way
// tzOffsetMin follows a DST flip.
export function resolveClock24(settings) {
  const s = settings || readSettings();
  if (s.clockFormat === 'auto') return hostPrefers24();
  return s.clockFormat === '24';
}

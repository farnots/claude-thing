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

const DEFAULTS = { clockFormat: 'auto', language: 'auto' };

export const CLOCK_FORMATS = ['auto', '12', '24'];

// The languages actually shipped, and the only things resolveLang() ever
// answers. `auto` is a rule, not a language, so it is accepted as a setting and
// never as a resolution.
export const LOCALES = ['en', 'fr'];
export const LANGUAGES = ['auto'].concat(LOCALES);

export function readSettings() {
  const saved = readState('settings', null);
  return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

// Returns the settings as they now stand, or null if the value was not one we
// know — the caller turns that into a 400 rather than persisting nonsense.
// One choice at a time: a write reads the file back first, so setting the
// language cannot clobber the clock format.
function setChoice(key, allowed, value) {
  if (!allowed.includes(value)) return null;
  const next = { ...readSettings(), [key]: value };
  writeState('settings', next);
  return next;
}

export function setClockFormat(value) {
  return setChoice('clockFormat', CLOCK_FORMATS, value);
}

export function setLanguage(value) {
  return setChoice('language', LANGUAGES, value);
}

// What does this Mac prefer?
//
// Neither question below is one Intl can answer on its own here: Node derives
// its default locale from LANG/LC_ALL, which on macOS is whatever the terminal
// exported and has nothing to do with System Settings — a Mac set to French
// routinely runs with LANG=en_US.UTF-8, and asking Intl would answer 12-hour
// and English for a user who has read 14:05 in French all their life. So the
// real preferences are read out of the global defaults domain, in the order
// macOS itself resolves them.
//
// Cached, and both answers in one pass: this forks subprocesses, and
// resolveClock24() runs on every snapshot, which is several times a second on a
// busy Mac. A preference change takes up to the TTL to reach the device, which
// is invisible for something nobody toggles twice.
const HOST_PROBE_TTL_MS = 60_000;
let hostProbe = { at: 0, clock24: false, lang: 'en' };

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

// Does this Mac write hours 0–23? The explicit 24-Hour Time switch first, then
// the region.
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

// A BCP-47 tag, a POSIX locale or a bare code, reduced to a language we ship —
// or null, which means "keep looking". Exported because it is the whole fallback
// rule: everything below it just decides which strings to feed it, and on a Mac
// none of those sources can be forced from a test.
export function normalizeLang(tag) {
  const code = String(tag == null ? '' : tag).trim().toLowerCase().split(/[-_@.]/)[0];
  return LOCALES.includes(code) ? code : null;
}

// Which language does this Mac read? AppleLanguages is the ordered list that
// System Settings › Language & Region actually writes, so the first entry we
// ship wins: a Mac set to German with French second lands on French rather than
// on the fallback. AppleLocale carries only the region and is the second
// choice; the environment is the last, for the machines that are not Macs.
function probeHostLang() {
  if (process.platform === 'darwin') {
    // A plist array, printed as (\n    "fr-FR",\n    "en-US"\n)
    const list = readDefault('AppleLanguages');
    for (const quoted of (list || '').match(/"[^"]*"/g) || []) {
      const code = normalizeLang(quoted.slice(1, -1));
      if (code) return code;
    }
    const fromLocale = normalizeLang((readDefault('AppleLocale') || '').split('@')[0]);
    if (fromLocale) return fromLocale;
  }
  return normalizeLang(process.env.LC_ALL || process.env.LANG) || 'en';
}

function hostPrefs() {
  const age = Date.now() - hostProbe.at;
  if (hostProbe.at !== 0 && age < HOST_PROBE_TTL_MS) return hostProbe;
  // Seeded with what the host last said, so a probe that throws holds the old
  // answer rather than snapping back to the defaults.
  let next = { clock24: hostProbe.clock24, lang: hostProbe.lang };
  try {
    next = { clock24: probeHost24(), lang: probeHostLang() };
  } catch (err) {
    log('ST', `could not read the host preferences: ${err.message}`);
  }
  hostProbe = { at: Date.now(), ...next };
  return hostProbe;
}

// Tests only: forget what the host said.
export function resetHostProbe() {
  hostProbe = { at: 0, clock24: false, lang: 'en' };
}

// The device is told the answer, not the rule — see the snapshot comment in
// sessions/store.js. Re-resolved per call (host probe cached, see above) so a
// locale change on the Mac lands without a daemon restart, the same way
// tzOffsetMin follows a DST flip.
export function resolveClock24(settings) {
  const s = settings || readSettings();
  if (s.clockFormat === 'auto') return hostPrefs().clock24;
  return s.clockFormat === '24';
}

// Same contract as resolveClock24: 'auto' is settled here and never crosses the
// wire. A stored value we no longer ship reads as English rather than as
// itself, so removing a locale cannot leave the device asking for a catalog
// that is not there.
export function resolveLang(settings) {
  const s = settings || readSettings();
  if (s.language === 'auto') return hostPrefs().lang;
  return LOCALES.includes(s.language) ? s.language : 'en';
}

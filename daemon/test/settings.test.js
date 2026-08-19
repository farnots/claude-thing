import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the state dir at a scratch directory before anything reads config.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-thing-settings-'));
process.env.CLAUDE_THING_STATE_DIR = DIR;

const {
  readSettings, setClockFormat, setLanguage, resolveClock24, resolveLang,
  resetHostProbe, normalizeLang, LOCALES,
} = await import('../src/settings.js');
const { createStore } = await import('../src/sessions/store.js');

test('nothing chosen yet means auto', () => {
  assert.equal(readSettings().clockFormat, 'auto');
});

test('a chosen format survives the write and decides the boolean', () => {
  assert.deepEqual(setClockFormat('24'), { clockFormat: '24', language: 'auto' });
  assert.equal(readSettings().clockFormat, '24');
  assert.equal(resolveClock24(), true);

  setClockFormat('12');
  assert.equal(resolveClock24(), false, '12 wins over whatever the Mac locale says');
});

// The webpage turns a null into a 400 rather than persisting nonsense that the
// device would then have to defend itself against.
test('an unknown format is refused and changes nothing', () => {
  setClockFormat('24');
  assert.equal(setClockFormat('36'), null);
  assert.equal(setClockFormat(undefined), null);
  assert.equal(readSettings().clockFormat, '24');
});

// The device is told the answer, never the rule — 'auto' is settled here.
test('the snapshot carries the resolved format, not the setting', () => {
  const store = createStore();
  store.touch('a', { name: 'proj' });

  setClockFormat('24');
  assert.equal(store.snapshot().clock24, true);
  setClockFormat('12');
  assert.equal(store.snapshot().clock24, false);
  setClockFormat('auto');
  assert.equal(typeof store.snapshot().clock24, 'boolean', 'auto still resolves to a boolean');
});

// Auto asks the host, which on macOS means forking `defaults` — resolveClock24
// runs on every snapshot, so the answer has to be cached rather than probed
// several times a second.
test('auto answers from the host, and only probes it once', () => {
  resetHostProbe();
  setClockFormat('auto');
  const first = resolveClock24();
  assert.equal(typeof first, 'boolean');

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) assert.equal(resolveClock24(), first);
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(elapsedMs < 50, `200 resolves took ${elapsedMs}ms — the probe is not cached`);
});

// ---- language ----------------------------------------------------------------

test('nothing chosen yet means auto for the language too', () => {
  assert.equal(readSettings().language, 'auto');
});

test('a chosen language survives the write and beats the host', () => {
  assert.deepEqual(setLanguage('fr'), { clockFormat: 'auto', language: 'fr' });
  assert.equal(resolveLang(), 'fr');

  setLanguage('en');
  assert.equal(resolveLang(), 'en', 'en wins over whatever the Mac is set to');
});

test('an unknown language is refused and changes nothing', () => {
  setLanguage('fr');
  assert.equal(setLanguage('de'), null, 'a language we do not ship');
  assert.equal(setLanguage('auto '), null);
  assert.equal(setLanguage(undefined), null);
  assert.equal(readSettings().language, 'fr');
});

// The two settings share one file, and setChoice reads it back before writing.
test('writing one choice leaves the other alone', () => {
  setClockFormat('24');
  setLanguage('fr');
  assert.deepEqual(readSettings(), { clockFormat: '24', language: 'fr' });

  setClockFormat('12');
  assert.equal(readSettings().language, 'fr', 'the clock write kept the language');
  setLanguage('en');
  assert.equal(readSettings().clockFormat, '12', 'the language write kept the clock');
});

// A stored language we no longer ship must read as English rather than as
// itself, or the device would be sent a catalog name it has nothing for.
test('a language that is no longer shipped reads as english', () => {
  assert.equal(resolveLang({ language: 'de' }), 'en');
  assert.equal(resolveLang({ language: '' }), 'en');
});

// The fallback rule itself. What feeds it — AppleLanguages, AppleLocale, LANG —
// cannot be forced from a test on a Mac, so it is tested where the logic is.
test('a locale tag is reduced to a language we ship, or to nothing', () => {
  assert.equal(normalizeLang('fr-FR'), 'fr');
  assert.equal(normalizeLang('fr_FR@euro'), 'fr');
  assert.equal(normalizeLang('en_US.UTF-8'), 'en');
  assert.equal(normalizeLang('FR'), 'fr', 'case is not a language');
  assert.equal(normalizeLang('  fr-CA '), 'fr');
  assert.equal(normalizeLang('de-DE'), null, 'not shipped means keep looking');
  assert.equal(normalizeLang(''), null);
  assert.equal(normalizeLang(undefined), null);
  assert.equal(normalizeLang(null), null);
});

// Same contract as the clock: 'auto' is settled here, against the same cached
// probe, and the answer is always a language the device has a catalog for.
test('auto answers a shipped language, from the same cached probe', () => {
  resetHostProbe();
  setLanguage('auto');
  setClockFormat('auto');

  const first = resolveLang();
  assert.ok(LOCALES.includes(first), `resolveLang answered ${first}`);

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) {
    assert.equal(resolveLang(), first);
    assert.equal(typeof resolveClock24(), 'boolean');
  }
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(elapsedMs < 50, `400 resolves took ${elapsedMs}ms — one probe feeds both or it does not`);
});

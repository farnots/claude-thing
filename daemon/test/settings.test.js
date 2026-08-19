import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the state dir at a scratch directory before anything reads config.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-thing-settings-'));
process.env.CLAUDE_THING_STATE_DIR = DIR;

const { readSettings, setClockFormat, resolveClock24, resetHostProbe } = await import('../src/settings.js');
const { createStore } = await import('../src/sessions/store.js');

test('nothing chosen yet means auto', () => {
  assert.equal(readSettings().clockFormat, 'auto');
});

test('a chosen format survives the write and decides the boolean', () => {
  assert.deepEqual(setClockFormat('24'), { clockFormat: '24' });
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

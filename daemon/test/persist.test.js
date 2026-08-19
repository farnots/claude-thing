import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the state dir at a scratch directory before anything reads config.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-thing-state-'));
process.env.CLAUDE_THING_STATE_DIR = DIR;

const { readState, writeState } = await import('../src/persist.js');
const { createUsage } = await import('../src/usage.js');

// Declared explicitly, never detected: detection reads the real ~/.claude* of
// whoever runs the suite, so leaving it out makes these two tests report
// whatever accounts that machine happens to have signed in.
const ONE = [{ id: 'default', label: 'CLAUDE', configDir: null, enabled: true }];

test('state survives a write and read', () => {
  writeState('round-trip', { limits: [{ key: 'session', used: 0.42 }] });
  assert.deepEqual(readState('round-trip'), { limits: [{ key: 'session', used: 0.42 }] });
  // and no temp files are left behind
  assert.deepEqual(fs.readdirSync(DIR).filter((f) => f.endsWith('.tmp')), []);
});

test('nothing saved yet reads as the fallback, not a throw', () => {
  assert.equal(readState('never-written'), null);
  assert.deepEqual(readState('never-written', { limits: [] }), { limits: [] });
});

test('a half-written file reads as the fallback', () => {
  fs.writeFileSync(path.join(DIR, 'corrupt.json'), '{"limits": [');
  assert.equal(readState('corrupt'), null);
});

// Doubles as the v1 -> v2 migration test: this is the shape a daemon that
// predated accounts wrote, and it has to come back on the first declared one.
test('the daemon boots with the last reading, flagged stale', () => {
  writeState('usage', {
    updatedTs: Date.parse('2026-07-31T21:12:00'),
    updatedLabel: 'updated 21:12 · from claude /usage',
    limits: [{ key: 'session', label: 'SESSION', used: 0.86, detail: 'resets Aug 1 at 2am' }],
  });
  const u = createUsage({ emit: () => {}, accounts: ONE }).get();
  assert.equal(u.limits[0].used, 0.86, 'the screen shows real figures immediately');
  assert.equal(u.stale, true);
  assert.match(u.updatedLabel, /^last reading 21:12/);
  assert.equal(u.accountId, 'default', 'and says which account it is of');
});

test('an empty saved reading is not worth restoring', () => {
  writeState('usage', { limits: [] });
  const u = createUsage({ emit: () => {}, accounts: ONE }).get();
  assert.deepEqual(u, {
    limits: [], error: 'usage not read yet', accountId: 'default', accountCount: 1,
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the state dir at a scratch directory before anything reads config.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-thing-accounts-'));
process.env.CLAUDE_THING_STATE_DIR = DIR;

const { readState, writeState } = await import('../src/persist.js');
const {
  detectAccounts, loadAccounts, saveAccounts, mergeDetected, normalizeAccounts, configDirMissing,
} = await import('../src/usage-accounts.js');
const { createUsage, backoffFor } = await import('../src/usage.js');

const STATE = 'usage-accounts';

// A signed-in .claude.json, reduced to the one field detection reads.
const signedIn = (email, over = {}) => ({
  oauthAccount: { emailAddress: email, accountUuid: `uuid-${email}`, organizationName: '', ...over },
});

// Everything detection is given is a home directory, so every case is a fixture
// rather than a mock: no fs is stubbed anywhere in this file.
function fakeHome(spec) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-thing-home-'));
  for (const [rel, body] of Object.entries(spec)) {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return home;
}

function clearState() {
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { force: true });
}

// ---- detection ---------------------------------------------------------------

test('the machine default is found where it actually lives, not at ~/.claude', () => {
  // This is Lucas's machine, and the trap the whole design turns on: the real
  // account is the legacy $HOME/.claude.json, while ~/.claude/.claude.json is a
  // stub with no oauthAccount. Detecting three accounts here, or naming the
  // default one "~/.claude", breaks the only account that works.
  const home = fakeHome({
    '.claude.json': signedIn('lucas@example.com'),
    '.claude/.claude.json': { numStartups: 3 },
    '.claude-poly/.claude.json': signedIn('lucas@corp.example'),
  });
  const found = detectAccounts(home);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((a) => a.id), ['default', 'poly']);
  assert.equal(found[0].configDir, null, 'the default account sets no CLAUDE_CONFIG_DIR');
  assert.equal(found[1].configDir, path.join(home, '.claude-poly'));
});

test('a signed-in ~/.claude is detected as a config dir, and not duplicated', () => {
  // The other layout: a machine whose config was migrated into ~/.claude and has
  // no $HOME/.claude.json at all. Naming it explicitly is correct there.
  const home = fakeHome({ '.claude/.claude.json': signedIn('solo@example.com') });
  const found = detectAccounts(home);
  assert.equal(found.length, 1);
  assert.equal(found[0].configDir, path.join(home, '.claude'));
});

test('anything without an oauthAccount is not an account', () => {
  const home = fakeHome({
    '.claude.json': signedIn('lucas@example.com'),
    // our own state dir, which matches the directory pattern
    '.claude-thing/accounts.json': { accounts: [] },
    // a stray copy with no credentials
    '.claude-backup/.claude.json': { numStartups: 1 },
    // an empty shell of a config
    '.claude-empty/.claude.json': { oauthAccount: { emailAddress: '  ' } },
    // half-written JSON must not throw
    '.claude-broken/.claude.json': '{"oauthAccount": ',
    // not a directory, so never a candidate
    '.claude.json.tmp.123': signedIn('ghost@example.com'),
  });
  assert.deepEqual(detectAccounts(home).map((a) => a.id), ['default']);
});

test('one account reachable two ways is listed once, as the default', () => {
  const home = fakeHome({
    '.claude.json': signedIn('lucas@example.com'),
    '.claude-copy/.claude.json': signedIn('lucas@example.com'),
  });
  const found = detectAccounts(home);
  assert.equal(found.length, 1);
  assert.equal(found[0].configDir, null, 'the machine default wins the tie');
});

test('labels come from the org, unless the org is just the email', () => {
  const home = fakeHome({
    '.claude.json': signedIn('lucas@example.com', { organizationName: 'Polycea' }),
    '.claude-perso/.claude.json': signedIn('lucas.t@example.com', {
      organizationName: "lucas.t@example.com's Organization",
    }),
    '.claude-long/.claude.json': signedIn('x@example.com', {
      organizationName: 'A Very Long Organisation Name Indeed',
    }),
  });
  const byId = Object.fromEntries(detectAccounts(home).map((a) => [a.id, a.label]));
  assert.equal(byId.default, 'POLYCEA');
  assert.equal(byId.perso, 'LUCAS.T', 'a personal org is not a label anybody wants');
  assert.equal(byId.long.length, 12, 'and a label never overruns the column');
});

test('a home with nothing signed in still yields one account', () => {
  const found = detectAccounts(fakeHome({}));
  assert.deepEqual(found, [{ id: 'default', label: 'CLAUDE', configDir: null, enabled: true }]);
});

// ---- the declaration is stable once written ----------------------------------

test('detection runs once, then the file is the declaration', () => {
  clearState();
  const home = fakeHome({
    '.claude.json': signedIn('lucas@example.com'),
    '.claude-poly/.claude.json': signedIn('lucas@corp.example'),
  });

  const first = loadAccounts({ home });
  assert.deepEqual(first.map((a) => a.id), ['default', 'poly']);
  assert.ok(readState(STATE), 'the result is written, so nothing re-derives it');

  // A hand-edited label, and an account switched off, are decisions.
  const edited = readState(STATE);
  edited.accounts[0].label = 'PERSO';
  edited.accounts[1].enabled = false;
  writeState(STATE, edited);

  const second = loadAccounts({ home });
  assert.equal(second[0].label, 'PERSO', 'the edit survives');
  assert.equal(second[1].enabled, false);
});

test('a re-detect adds what is new without overwriting what was changed', () => {
  const existing = normalizeAccounts([
    { id: 'default', label: 'PERSO', configDir: null, enabled: false },
  ]);
  const merged = mergeDetected(existing, [
    { id: 'default', label: 'LUCAS', configDir: null, enabled: true },
    { id: 'poly', label: 'POLYCEA', configDir: '/tmp/poly', enabled: true },
  ]);
  assert.equal(merged[0].label, 'PERSO', 'the rename is not clobbered');
  assert.equal(merged[0].enabled, false, 'nor is the decision to disable it');
  assert.deepEqual(merged.map((a) => a.id), ['default', 'poly']);
});

test('a declaration with every account disabled is treated as a broken file', () => {
  clearState();
  const home = fakeHome({ '.claude.json': signedIn('lucas@example.com') });
  saveAccounts([{ id: 'poly', configDir: '/tmp/poly', enabled: false }]);
  const list = loadAccounts({ home });
  assert.ok(list.some((a) => a.enabled), 'the screen never goes dark over a config file');
});

// ---- polling, per account ----------------------------------------------------

// b needs a config dir that exists: one that does not is deliberately never
// polled (see the missing-config-dir test), which would make every case below
// measure that behaviour instead of the one it is about.
const B_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-thing-b-'));
const TWO = [
  { id: 'a', label: 'A', configDir: null, enabled: true },
  { id: 'b', label: 'B', configDir: B_DIR, enabled: true },
];

// One queue of canned `claude -p /usage` outputs per account. Nothing spawns.
function scripted(scripts) {
  const calls = [];
  const queues = new Map(Object.entries(scripts).map(([id, out]) => [id, [...out]]));
  const runUsage = async (account) => {
    calls.push(account.id);
    const q = queues.get(account.id) || [];
    return q.length > 1 ? q.shift() : (q[0] || { error: 'no script' });
  };
  return { runUsage, calls };
}

const reading = (pct, resets = 'Aug 1 at 2am') => ({
  text: `Current session: ${pct}% used${resets ? ` · resets ${resets}` : ''}\nLast 24h · 10 requests · 2 sessions\n`,
});

test('each account is polled under its own config dir, and only its own', async () => {
  clearState();
  const seen = [];
  const usage = createUsage({
    emit: () => {},
    accounts: TWO,
    runUsage: async (account) => { seen.push([account.id, account.configDir]); return reading(5); },
  });
  await usage.refresh();
  assert.deepEqual(seen, [['a', null], ['b', B_DIR]]);
});

test('one failing account leaves the other intact', async () => {
  clearState();
  const { runUsage } = scripted({
    a: [{ error: 'Claude configuration file not found at: /x/.claude.json' }],
    b: [reading(4)],
  });
  const usage = createUsage({ emit: () => {}, accounts: TWO, runUsage });
  await usage.refresh();

  const out = usage.all({ slim: 1, withMirror: true });
  const [a, b] = ['a', 'b'].map((id) => out.accounts.find((x) => x.id === id));
  assert.match(a.error, /configuration file not found/);
  assert.equal(b.limits[0].used, 0.04, "b's reading is untouched by a's failure");
  assert.equal(out.accountId, 'b', 'and b carries the mirror, not the broken account');
});

test('the anti-flap hold is per account, and never leaks across them', async () => {
  clearState();
  // a keeps printing the clause-less zero a rolled-over window prints; b climbs.
  // a must hold twice and take the drop on the third, exactly as it would alone,
  // while b's own bookkeeping stays empty.
  const { runUsage } = scripted({
    a: [reading(88), reading(0, ''), reading(0, ''), reading(0, '')],
    b: [reading(10), reading(20), reading(30), reading(40)],
  });
  const usage = createUsage({ emit: () => {}, accounts: TWO, runUsage });

  await usage.refresh();
  assert.equal(usage.get({ account: 'a' }).limits[0].used, 0.88);

  const held = [];
  for (let i = 0; i < 3; i++) {
    await usage.refresh();
    held.push(usage.get({ account: 'a' }).limits[0].used);
  }
  assert.deepEqual(held, [0.88, 0.88, 0], 'held twice, taken on the third');

  const b = usage.get({ account: 'b' });
  assert.equal(b.limits[0].used, 0.4, 'b climbed the whole way');
  assert.equal(b.limits[0].lowSeen, undefined, 'and never entered a hold');
});

// ---- persistence -------------------------------------------------------------

test('only a figure actually read this poll reaches the state file', async () => {
  clearState();
  const { runUsage } = scripted({
    a: [reading(10), reading(20)],
    // b reads high, then prints a lower figure for the same window: held.
    b: [reading(88), reading(10)],
  });
  const usage = createUsage({ emit: () => {}, accounts: TWO, runUsage });
  await usage.refresh();
  // parseUsage stamps readings with Date.now(), and a held reading is told apart
  // from a fresh one by limitsTs !== updatedTs — which collapses if two polls of
  // the same account land in the same millisecond. Only a test can do that; the
  // real interval is 60s.
  await new Promise((r) => setTimeout(r, 2));
  await usage.refresh();

  const saved = readState('usage');
  assert.equal(saved.version, 2);
  assert.deepEqual(Object.keys(saved.accounts).sort(), ['a', 'b']);
  assert.equal(saved.accounts.a.limits[0].used, 0.2, "a's fresh reading is saved");
  // The held figure is dated earlier than the reading that produced it and is
  // flagged stale; the entry on disk must be neither.
  assert.equal(saved.accounts.b.updatedTs, saved.accounts.b.limitsTs);
  assert.equal(saved.accounts.b.stale, undefined,
    "a rewrite for a must not drag b's held figure onto disk");
});

test('a v1 state file boots the first declared account and nothing else', async () => {
  clearState();
  writeState('usage', {
    updatedTs: Date.parse('2026-07-31T21:12:00'),
    updatedLabel: 'updated 21:12 · from claude /usage',
    limits: [{ key: 'session', label: 'SESSION', used: 0.86, detail: 'resets Aug 1 at 2am' }],
  });
  const usage = createUsage({ emit: () => {}, accounts: TWO, runUsage: async () => reading(1) });

  const a = usage.get({ account: 'a' });
  assert.equal(a.limits[0].used, 0.86, 'the figure a pre-accounts daemon left behind');
  assert.equal(a.stale, true);
  assert.match(a.updatedLabel, /^last reading 21:12/);

  const b = usage.get({ account: 'b' });
  assert.deepEqual(b.limits, [], 'nothing is invented for the accounts it never measured');
  assert.equal(b.error, 'usage not read yet');
});

test('a reading kept for an account no longer declared is not thrown away', async () => {
  clearState();
  const usage = createUsage({
    emit: () => {}, accounts: TWO, runUsage: async () => reading(7),
  });
  await usage.refresh();
  // Drop b from the declaration, then bring it back.
  usage.reload([TWO[0]]);
  assert.deepEqual(usage.accounts().map((x) => x.id), ['a']);
  usage.stop();

  const back = createUsage({ emit: () => {}, accounts: TWO, runUsage: async () => reading(7) });
  assert.equal(back.get({ account: 'b' }).limits[0].used, 0.07,
    'its last known figures were still on disk');
  back.stop();
});

// ---- a config dir that is not there ------------------------------------------

test('a missing config dir is reported, never polled, and heals on its own', async () => {
  clearState();
  const gone = path.join(os.tmpdir(), 'claude-thing-not-here-' + process.pid);
  fs.rmSync(gone, { recursive: true, force: true });
  const accounts = [
    { id: 'a', label: 'A', configDir: null, enabled: true },
    { id: 'gone', label: 'GONE', configDir: gone, enabled: true },
  ];
  const { runUsage, calls } = scripted({ a: [reading(5)], gone: [reading(9)] });
  const usage = createUsage({ emit: () => {}, accounts, runUsage });

  await usage.refresh();
  assert.deepEqual(calls, ['a'], 'a run against a directory that is not there is never started');
  assert.match(usage.get({ account: 'gone' }).error, /config dir missing/);
  assert.equal(configDirMissing(accounts[1]), true);

  // Put it back: the check is per poll, so no restart is needed.
  fs.mkdirSync(gone, { recursive: true });
  await usage.refresh();
  assert.deepEqual(calls, ['a', 'a', 'gone'], 'a was polled by both refreshes, gone only by the second');
  assert.equal(usage.get({ account: 'gone' }).limits[0].used, 0.09);
  fs.rmSync(gone, { recursive: true, force: true });
});

// ---- backoff -----------------------------------------------------------------

test('a structural failure backs off after three tries; a timeout never does', async () => {
  clearState();
  assert.equal(backoffFor(0, 60_000), 60_000);
  assert.equal(backoffFor(2, 60_000), 60_000);
  assert.equal(backoffFor(3, 60_000), 15 * 60_000, 'three strikes is not a transient fault');

  const usage = createUsage({
    emit: () => {},
    accounts: TWO,
    runUsage: async (account) => (account.id === 'a'
      ? { error: 'Claude configuration file not found at: /x' }
      : { error: 'timed out after 45s' }),
  });
  for (let i = 0; i < 3; i++) await usage.refresh();

  const byId = Object.fromEntries(usage.accounts().map((x) => [x.id, x]));
  assert.equal(byId.a.failStreak, 3);
  assert.equal(byId.a.nextPollMs, 15 * 60_000, 'and stops burning a claude boot a minute');
  assert.equal(byId.b.failKind, 'timeout');
  assert.equal(byId.b.nextPollMs, 60_000, 'a busy machine is retried as normal');
  usage.stop();
});

test('one good reading puts a backed-off account straight back', async () => {
  clearState();
  let broken = true;
  const usage = createUsage({
    emit: () => {},
    accounts: [TWO[0]],
    runUsage: async () => (broken ? { error: 'Please run /login' } : reading(3)),
  });
  for (let i = 0; i < 3; i++) await usage.refresh();
  assert.equal(usage.accounts()[0].nextPollMs, 15 * 60_000);

  broken = false;
  await usage.refresh();
  assert.equal(usage.accounts()[0].failStreak, 0);
  assert.equal(usage.accounts()[0].nextPollMs, 60_000);
  usage.stop();
});

// ---- one event per refresh ----------------------------------------------------

test('a refresh emits one complete snapshot, never one event per account', async () => {
  clearState();
  // The Mac connector coalesces claude.usage.update by topic alone, so two
  // frames inside its 200ms window supersede each other. That is only lossless
  // while every frame carries every account.
  const events = [];
  const usage = createUsage({
    emit: (topic, data) => events.push([topic, data]),
    accounts: TWO,
    runUsage: async () => reading(5),
  });

  await usage.refresh('a');
  assert.equal(events.length, 1, 'one account polled, one event');
  const [topic, data] = events[0];
  assert.equal(topic, 'claude.usage.update');
  assert.equal(data.accounts.length, 2, 'and it still describes both accounts');
  assert.equal(data.accountCount, 2);
  assert.ok(data.limits, 'with the flat mirror present for older clients');
  usage.stop();
});

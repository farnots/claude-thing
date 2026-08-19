import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUsage, describeFailure, reconcileUsage, slimUsage,
  slimAccount, primaryOf, orderForWire, multiUsage, classifyFailure, scheduleFor,
} from '../src/usage.js';
import { normalizeAccounts, envForAccount } from '../src/usage-accounts.js';

// Verbatim shape of `claude -p "/usage"` output.
const SAMPLE = `You are currently using your subscription to power your Claude Code usage

Current session: 11% used · resets Jul 30 at 5:19am (America/New_York)
Current week (all models): 21% used · resets Aug 4 at 4:59pm (America/New_York)
Current week (Fable): 30% used · resets Aug 4 at 5pm (America/New_York)

What's contributing to your limits usage?
Approximate, based on local sessions on this machine — does not include other devices or claude.ai.

Last 24h · 579 requests · 8 sessions
  95% of your usage came from subagent-heavy sessions
  82% of your usage was at >150k context
  Top skills: /webapp-testing 8%, /frontend-design 3%

Last 7d · 1,413 requests · 21 sessions
  55% of your usage was at >150k context
  Top subagents: Explore 10%, Plan 4%
`;

test('parses every limit line with its reset time', () => {
  const u = parseUsage(SAMPLE, 1_700_000_000_000);
  assert.equal(u.limits.length, 3);

  assert.deepEqual(
    u.limits.map((l) => [l.label, l.used]),
    [['SESSION', 0.11], ['WEEK · ALL MODELS', 0.21], ['WEEK · FABLE', 0.3]]
  );
  assert.equal(u.limits[0].detail, 'resets Jul 30 at 5:19am');
  assert.equal(u.limits[0].key, 'session');
});

test('every reset clause also travels as an instant', () => {
  // The clause is what the usage screen prints; resetsAt is what a countdown can
  // subtract. Resolved in the zone the line states, in the year the reading sits
  // in — neither of which appears anywhere in the text as a number.
  const now = Date.parse('2026-07-30T01:00:00-04:00');
  const u = parseUsage(SAMPLE, now);
  assert.equal(u.limits[0].resetsAt, Date.parse('2026-07-30T05:19:00-04:00'));
  assert.equal(u.limits[1].resetsAt, Date.parse('2026-08-04T16:59:00-04:00'));
  assert.equal(u.limits[2].resetsAt, Date.parse('2026-08-04T17:00:00-04:00'));

  // A limit printed without a reset clause carries no instant at all — the field
  // is absent rather than 0, which the connector would hand the device as
  // `false`.
  const bare = parseUsage('Current session: 4% used', 1);
  assert.equal('resetsAt' in bare.limits[0], false);
});

test('percentages are fractions, never above 1', () => {
  const u = parseUsage(SAMPLE);
  for (const l of u.limits) {
    assert.ok(l.used >= 0 && l.used <= 1, `${l.label} out of range: ${l.used}`);
  }
});

test('parses contributing windows with comma-separated counts', () => {
  const u = parseUsage(SAMPLE);
  assert.equal(u.windows.length, 2);
  assert.deepEqual(
    u.windows.map((w) => [w.window, w.requests, w.sessions]),
    [['Last 24h', 579, 8], ['Last 7d', 1413, 21]]
  );
  assert.equal(u.windows[0].notes.length, 3);
  assert.match(u.windows[0].notes[0], /subagent-heavy/);
  // the 7d bullets must not leak into the 24h window
  assert.equal(u.windows[1].notes.length, 2);
});

test('keeps the subscription line and stamps an update label', () => {
  const u = parseUsage(SAMPLE, Date.parse('2026-07-30T05:19:00Z'));
  assert.match(u.subscription, /subscription/);
  assert.match(u.updatedLabel, /from claude \/usage/);
});

test('returns null only when the output is not a /usage render at all', () => {
  assert.equal(parseUsage(''), null);
  assert.equal(parseUsage('some unrelated error text'), null);
});

// Verbatim, from a machine whose weekly window had just rolled over: every
// limit line gone, the breakdown untouched. `claude -p` reads the utilization
// cache but never refetches it, so this is what every poll returns until an
// interactive session refreshes it.
const NO_LIMITS = `You are currently using your subscription to power your Claude Code usage

What's contributing to your limits usage?
Approximate, based on local sessions on this machine — does not include other devices or claude.ai.

Last 24h · 1,225 requests · 20 sessions
  68% of your usage came from subagent-heavy sessions
  Top skills: /deploy-to-dev 6%
`;

test('a render with no limit lines is a reading, not a parse failure', () => {
  const u = parseUsage(NO_LIMITS, 5);
  assert.ok(u, 'the run succeeded and told us something — it must not be discarded');
  assert.deepEqual(u.limits, []);
  assert.equal(u.limitsTs, 0, 'no limits were read, so none are dated');
  assert.equal(u.windows[0].requests, 1225, 'the breakdown is still fresh and kept');
});

test('a fresh reading dates its own limits', () => {
  assert.equal(parseUsage(SAMPLE, 7).limitsTs, 7);
});

test('limits survive a reading that printed none, dated when they were read', () => {
  const prev = parseUsage(SAMPLE, Date.parse('2026-08-04T10:56:00'));
  const out = reconcileUsage(prev, parseUsage(NO_LIMITS, Date.parse('2026-08-04T17:15:00')));

  assert.deepEqual(out.limits.map((l) => l.used), [0.11, 0.21, 0.3], 'the last real limits stand');
  assert.equal(out.stale, true);
  assert.equal(out.updatedLabel, 'limits 10:56 · from claude /usage', 'dated honestly, not as of now');
  assert.equal(out.windows[0].requests, 1225, 'the fresh breakdown still comes from the new reading');
  assert.equal(out.updatedTs, Date.parse('2026-08-04T17:15:00'), 'the reading itself is current');
});

test('a carried-over limit does not age into looking fresh', () => {
  const first = parseUsage(SAMPLE, Date.parse('2026-08-04T10:56:00'));
  let held = reconcileUsage(first, parseUsage(NO_LIMITS, Date.parse('2026-08-04T17:15:00')));
  held = reconcileUsage(held, parseUsage(NO_LIMITS, Date.parse('2026-08-04T19:30:00')));
  assert.equal(held.limitsTs, Date.parse('2026-08-04T10:56:00'), 'still dated by the last real read');
  assert.equal(held.updatedLabel, 'limits 10:56 · from claude /usage');
});

test('limits coming back clears the carry-over', () => {
  const held = reconcileUsage(parseUsage(SAMPLE, 1), parseUsage(NO_LIMITS, 2));
  const back = reconcileUsage(held, parseUsage(SAMPLE, 3));
  assert.equal(back.limitsTs, 3);
  assert.equal(back.stale, undefined);
  assert.match(back.updatedLabel, /^updated /);
});

test('with nothing to carry, a limitless reading passes straight through', () => {
  const out = reconcileUsage(null, parseUsage(NO_LIMITS, 2));
  assert.deepEqual(out.limits, []);
  assert.equal(out.stale, undefined, 'nothing was held, so nothing is being passed off as current');
});

test('survives a limit line with no reset clause', () => {
  const u = parseUsage('Current session: 5% used');
  assert.equal(u.limits.length, 1);
  assert.equal(u.limits[0].used, 0.05);
  assert.equal(u.limits[0].detail, '');
});

test('a window with one request and one session is written in the singular', () => {
  const out = parseUsage([
    'Current session: 8% used · resets Aug 6 at 5:50am (America/New_York)',
    'Last 24h · 1 request · 1 session',
    '  100% of your usage came from subagent-heavy sessions',
    '  Top subagents: Explore 47%',
  ].join('\n'));
  assert.equal(out.windows.length, 1, 'the plural-only pattern dropped this window whole');
  assert.deepEqual(
    { requests: out.windows[0].requests, sessions: out.windows[0].sessions },
    { requests: 1, sessions: 1 }
  );
  assert.deepEqual(out.windows[0].subagents, [{ name: 'Explore', pct: '47%' }],
    'and its bullets had nowhere to land');
});

test('top-skills prose is parsed into rows the device can tabulate', () => {
  const out = parseUsage([
    'Current session: 27% used · resets Jul 31 at 2am (America/New_York)',
    'Last 24h · 775 requests · 4 sessions',
    '  94% of your usage was at >150k context',
    '  Top skills: /webapp-testing 4%, /deploy-to-dev 1%',
    '  Top subagents: Explore 7%, Plan 3%',
    '  Top MCP servers: claude-in-chrome 4%',
  ].join('\n'));
  const w = out.windows[0];
  assert.deepEqual(w.skills, [
    { name: '/webapp-testing', pct: '4%' },
    { name: '/deploy-to-dev', pct: '1%' },
  ]);
  assert.deepEqual(w.subagents, [{ name: 'Explore', pct: '7%' }, { name: 'Plan', pct: '3%' }]);
  assert.deepEqual(w.mcp, [{ name: 'claude-in-chrome', pct: '4%' }]);
  // the raw bullets survive, so a behaviour line is never lost to parsing
  assert.ok(w.notes.some((n) => /150k context/.test(n)));
});

// --- reconciling consecutive readings -----------------------------------------

const reading = (limits) => ({ updatedTs: 1, limits });

test('a lower reading for the same window is a stale cache read, not a refund', () => {
  const prev = reading([{ key: 'session', label: 'SESSION', used: 1, detail: 'resets Aug 1 at 2am' }]);
  const next = reading([{ key: 'session', label: 'SESSION', used: 0.86, detail: 'resets Aug 1 at 2am' }]);
  assert.equal(reconcileUsage(prev, next).limits[0].used, 1);
});

test('a reading that lost its reset clause cannot pass as a new window', () => {
  // the zeroed shape a clobbered ~/.claude.json cache prints
  const prev = reading([{ key: 'session', label: 'SESSION', used: 0.06, detail: 'resets Aug 1 at 2am', resetsAt: 111 }]);
  const next = reading([{ key: 'session', label: 'SESSION', used: 0, detail: '' }]);
  const l = reconcileUsage(prev, next).limits[0];
  assert.equal(l.used, 0.06);
  assert.equal(l.detail, 'resets Aug 1 at 2am', 'the held reading keeps its reset clause');
  assert.equal(l.resetsAt, 111, 'and the instant that clause resolved to');
});

test('a held figure never wears the other reading\'s reset instant', () => {
  // resetsAt is a projection of the clause, so whichever clause survives the hold
  // brings its own instant. Taking this reading's percentage with the previous
  // clause and this one's instant would date the bar against a window it is not
  // reporting on.
  const prev = reading([{ key: 'session', label: 'SESSION', used: 0.9, detail: 'resets Aug 1 at 2am', resetsAt: 111 }]);
  const next = reading([{ key: 'session', label: 'SESSION', used: 0.4, detail: 'resets Aug 1 at 2am', resetsAt: 222 }]);
  const l = reconcileUsage(prev, next).limits[0];
  assert.equal(l.used, 0.9, 'the drop is held');
  assert.equal(l.resetsAt, 222, 'the clause is this reading\'s, so the instant is too');
});

test('a clause-less drop is held twice and taken on the third reading', () => {
  // The shape a session window prints once it rolls over while inactive: 0%
  // used, no reset clause at all. Indistinguishable from a clobbered cache in
  // any one reading, so the hold is bounded by how long it lasts instead.
  const zero = () => reading([{ key: 'session', label: 'SESSION', used: 0, detail: '' }]);
  let s = reading([{ key: 'session', label: 'SESSION', used: 0.88, detail: 'resets Aug 1 at 2am' }]);
  s = reconcileUsage(s, zero());
  assert.equal(s.limits[0].used, 0.88, 'one low reading is still a suspect cache read');
  s = reconcileUsage(s, zero());
  assert.equal(s.limits[0].used, 0.88);
  s = reconcileUsage(s, zero());
  assert.equal(s.limits[0].used, 0, 'three in a row is a rollover, not a flap');
  assert.equal(s.limits[0].lowSeen, undefined, 'the count goes with the held figure');
  assert.equal(s.stale, undefined, 'the reading taken at face value is current');
});

test('a flap resets the count, so the hold never accumulates across one', () => {
  const high = () => reading([{ key: 'session', label: 'SESSION', used: 0.88, detail: 'resets Aug 1 at 2am' }]);
  const low = () => reading([{ key: 'session', label: 'SESSION', used: 0, detail: '' }]);
  let s = reconcileUsage(high(), low());
  s = reconcileUsage(s, high());
  assert.equal(s.limits[0].lowSeen, undefined, 'the cache came back — nothing is being held');
  s = reconcileUsage(s, low());
  s = reconcileUsage(s, low());
  assert.equal(s.limits[0].used, 0.88, 'counting starts again from the flap, not from before it');
});

test('a held reading says so, and is dated when its limits were read', () => {
  const prev = parseUsage(SAMPLE, Date.parse('2026-08-06T10:56:00'));
  const out = reconcileUsage(prev, {
    updatedTs: Date.parse('2026-08-06T11:56:00'),
    limitsTs: Date.parse('2026-08-06T11:56:00'),
    limits: prev.limits.map((l) => ({ ...l, used: 0, detail: '' })),
  });
  assert.equal(out.stale, true);
  assert.equal(out.limitsTs, Date.parse('2026-08-06T10:56:00'), 'dated by the last real read');
  assert.equal(out.updatedTs, Date.parse('2026-08-06T11:56:00'), 'the reading itself is current');
});

test('a real rollover moves the reset clause, and the drop is taken', () => {
  const prev = reading([{ key: 'session', label: 'SESSION', used: 1, detail: 'resets Aug 1 at 2am' }]);
  const next = reading([{ key: 'session', label: 'SESSION', used: 0.03, detail: 'resets Aug 1 at 7am' }]);
  assert.equal(reconcileUsage(prev, next).limits[0].used, 0.03);
});

test('rising usage always wins, and limits are matched per key', () => {
  const prev = reading([
    { key: 'session', label: 'SESSION', used: 0.4, detail: 'resets Aug 1 at 2am' },
    { key: 'week-all-models', label: 'WEEK · ALL MODELS', used: 0.9, detail: 'resets Aug 4 at 5pm' },
  ]);
  const next = reading([
    { key: 'session', label: 'SESSION', used: 0.5, detail: 'resets Aug 1 at 2am' },
    { key: 'week-all-models', label: 'WEEK · ALL MODELS', used: 0.7, detail: 'resets Aug 4 at 5pm' },
  ]);
  assert.deepEqual(reconcileUsage(prev, next).limits.map((l) => l.used), [0.5, 0.9]);
});

test('a limit with no history, and no history at all, passes straight through', () => {
  const next = reading([{ key: 'week-fable', label: 'WEEK · FABLE', used: 0.2, detail: 'resets Aug 4 at 5pm' }]);
  assert.equal(reconcileUsage(null, next).limits[0].used, 0.2);
  assert.equal(reconcileUsage(reading([]), next).limits[0].used, 0.2);
});

test('everything but the limits comes from the newest reading', () => {
  const prev = { updatedTs: 1, stale: true, error: 'old failure', limits: [] };
  const next = parseUsage(SAMPLE, 2);
  const out = reconcileUsage(prev, next);
  assert.equal(out.updatedTs, 2);
  assert.equal(out.stale, undefined, 'a fresh reading is never stale');
  assert.equal(out.error, undefined);
});

// --- failure text -------------------------------------------------------------

const STDIN_WARNING =
  'Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.';

test('a timed-out run says it timed out, not whatever stderr ended on', () => {
  const err = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' });
  const msg = describeFailure(err, STDIN_WARNING);
  assert.match(msg, /timed out after \d+s/);
  assert.ok(!/stdin/.test(msg), 'the warning is not the cause and must not read as one');
});

test('a real stderr line beats a warning above it', () => {
  const err = new Error('Command failed');
  const msg = describeFailure(err, `${STDIN_WARNING}\nError: not logged in\n`);
  assert.equal(msg, 'Error: not logged in');
});

test('with nothing but warnings, the error message itself is used', () => {
  const msg = describeFailure(new Error('spawn claude ENOENT'), STDIN_WARNING);
  assert.equal(msg, 'spawn claude ENOENT');
});

// ---- slimUsage --------------------------------------------------------------

test('slimUsage keeps what the device renders and drops the rest', () => {
  const slim = slimUsage({
    updatedTs: 5, updatedLabel: 'updated', stale: true, error: undefined,
    subscription: 'You are currently using your subscription…',
    limits: [{ key: 'session', label: 'SESSION', used: 0.5, detail: 'resets soon', resetsAt: 99 }],
    windows: [
      {
        window: 'Last 24h', requests: 10, sessions: 2,
        notes: ['Top skills: /a 4%'],
        skills: [{ name: '/a', pct: '4%' }, { name: '/b', pct: '3%' }, { name: '/c', pct: '2%' }, { name: '/d', pct: '1%' }],
        subagents: [],
        mcp: [{ name: 'srv', pct: '9%' }],
      },
      { window: 'Last 7d', requests: 99, sessions: 9, notes: [], skills: [], subagents: [], mcp: [] },
    ],
  });

  assert.equal(slim.subscription, undefined, 'subscription dropped');
  assert.equal(slim.windows.length, 1, 'first window only');
  assert.equal(slim.windows[0].notes, undefined, 'notes dropped');
  assert.equal(slim.windows[0].mcp, undefined, 'mcp dropped');
  assert.equal(slim.windows[0].skills.length, 3, 'top lists capped at 3');
  assert.deepEqual(
    { window: slim.windows[0].window, requests: slim.windows[0].requests, sessions: slim.windows[0].sessions },
    { window: 'Last 24h', requests: 10, sessions: 2 }
  );
  assert.equal(slim.limits[0].used, 0.5, 'every field a bar draws survives');
  assert.equal(slim.limits[0].resetsAt, 99, 'including the instant the countdown needs');
  assert.equal(slim.stale, true);
});

test('slimUsage leaves the hold bookkeeping behind', () => {
  const held = reconcileUsage(
    reading([{ key: 'session', label: 'SESSION', used: 0.88, detail: 'resets Aug 1 at 2am' }]),
    reading([{ key: 'session', label: 'SESSION', used: 0, detail: '' }])
  );
  assert.equal(held.limits[0].lowSeen, 1, 'the daemon counts');
  assert.equal(slimUsage(held).limits[0].lowSeen, undefined, 'the device is never told');
});

test('slimUsage tolerates the not-read-yet and windowless shapes', () => {
  assert.equal(slimUsage(null), null);
  const slim = slimUsage({ limits: [], error: 'usage not read yet' });
  assert.deepEqual(slim.windows, []);
  assert.equal(slim.error, 'usage not read yet');
});

// ---- accounts, on the wire ---------------------------------------------------

const acct = (id, over = {}) => ({ id, label: id.toUpperCase(), configDir: null, enabled: true, ...over });
const withLimits = (used) => parseUsage(`Current session: ${Math.round(used * 100)}% used · resets Aug 1 at 2am`, 1);
const failed = (msg) => ({ limits: [], stale: true, error: msg });

test('slimAccount carries only what a two-column screen draws', () => {
  const u = parseUsage(SAMPLE, 7);
  const a = slimAccount(acct('poly'), u, true);
  assert.equal(a.id, 'poly');
  assert.equal(a.label, 'POLY');
  assert.deepEqual(a.limits, slimUsage(u).limits, 'every bar survives');
  // A column has no room for the contributing tables, so they are not sent —
  // and dropping them is what makes two accounts fit one Bluetooth chunk.
  assert.deepEqual(a.windows, [{ window: 'Last 24h', requests: 579, sessions: 8 }]);
  assert.equal(a.windows[0].skills, undefined);
  assert.equal(a.windows[0].subagents, undefined);
  assert.equal(a.updatedLabel, slimUsage(u).updatedLabel, 'the timestamp is per account');
});

test('a single account keeps its tables, because the screen still draws them', () => {
  const u = parseUsage(SAMPLE, 7);
  const { id, label, ...rest } = slimAccount(acct('only'), u);
  assert.deepEqual(rest, slimUsage(u), 'nothing is dropped when there is one column');
  // And the shape the daemon actually sends for one account matches.
  const out = multiUsage([acct('only')], new Map([['only', u]]), { withMirror: false });
  assert.ok(out.accounts[0].windows[0].skills.length, 'the contributing tables survive');
});

test('an account with no reading yet says so rather than looking empty', () => {
  const a = slimAccount(acct('poly'), null);
  assert.deepEqual(a.limits, []);
  assert.equal(a.error, 'usage not read yet');
});

test('one account produces exactly the pre-accounts shape at the root', () => {
  const u = parseUsage(SAMPLE, 7);
  const out = multiUsage([acct('default')], new Map([['default', u]]), { withAccounts: false });
  const { accountId, accountCount, ...flat } = out;
  assert.deepEqual(flat, slimUsage(u), 'a device app that predates accounts is unaffected');
  assert.equal(accountId, 'default');
  assert.equal(accountCount, 1);
});

test('the mirror is the primary, and the primary leads the array', () => {
  const accounts = [acct('a'), acct('b')];
  const states = new Map([['a', withLimits(0.4)], ['b', withLimits(0.9)]]);
  const out = multiUsage(accounts, states);
  assert.equal(out.accountId, 'a');
  assert.equal(out.limits[0].used, 0.4, 'the flat fields are account a');
  assert.deepEqual(out.accounts.map((x) => x.id), ['a', 'b']);
});

test('a broken first account does not become the mirror', () => {
  // The real case: detection puts the machine default first, and that is the
  // account most likely to be the misconfigured one. A client reading only the
  // flat fields must not be handed its error while a good account sits unread.
  const accounts = [acct('default'), acct('poly')];
  const states = new Map([
    ['default', failed('claude /usage failed: Claude configuration file not found')],
    ['poly', withLimits(0.04)],
  ]);
  const out = multiUsage(accounts, states);
  assert.equal(out.accountId, 'poly');
  assert.equal(out.limits[0].used, 0.04);
  assert.equal(out.error, undefined, 'the mirror carries no error at all');
});

test('a broken account is still listed, with its error and its last figures', () => {
  const accounts = [acct('default'), acct('poly')];
  const broken = { ...withLimits(0.4), stale: true, error: 'claude /usage failed: not logged in' };
  const out = multiUsage(accounts, new Map([['default', broken], ['poly', withLimits(0.04)]]));
  const listed = out.accounts.find((x) => x.id === 'default');
  assert.ok(listed, 'dropping it would be indistinguishable from never declaring it');
  assert.match(listed.error, /not logged in/);
  assert.equal(listed.limits[0].used, 0.4, 'and its last known figures survive the failure');
});

test('a disabled account is off the wire entirely', () => {
  const accounts = [acct('a'), acct('b', { enabled: false })];
  const out = multiUsage(accounts, new Map([['a', withLimits(0.2)], ['b', withLimits(0.9)]]));
  assert.equal(out.accountCount, 1);
  assert.deepEqual(out.accounts.map((x) => x.id), ['a']);
});

test('a cap trims the array but never the count', () => {
  const accounts = [acct('a'), acct('b'), acct('c')];
  const states = new Map(accounts.map((a) => [a.id, withLimits(0.5)]));
  const out = multiUsage(accounts, states, { cap: 1 });
  assert.equal(out.accounts.length, 1);
  assert.equal(out.accountCount, 3, 'so the client knows it is looking at a slice');
});

test('the response shapes are mirror-or-array, never both', () => {
  const accounts = [acct('a'), acct('b')];
  const states = new Map(accounts.map((a) => [a.id, withLimits(0.5)]));
  const mirrorOnly = multiUsage(accounts, states, { withAccounts: false });
  assert.equal(mirrorOnly.accounts, undefined);
  assert.ok(mirrorOnly.limits.length);
  const arrayOnly = multiUsage(accounts, states, { withMirror: false });
  assert.equal(arrayOnly.limits, undefined);
  assert.equal(arrayOnly.accounts.length, 2);
});

test('primaryOf and orderForWire survive having nothing to go on', () => {
  assert.equal(primaryOf([], new Map()), null);
  assert.deepEqual(orderForWire([], new Map()), []);
  // Nothing enabled is a misconfiguration, not a reason to draw an empty screen.
  const off = [acct('a', { enabled: false })];
  assert.equal(primaryOf(off, new Map()).id, 'a');
  assert.deepEqual(orderForWire(off, new Map()).map((x) => x.id), ['a']);
  // Nothing read yet: the first enabled account leads.
  assert.equal(primaryOf([acct('a'), acct('b')], new Map()).id, 'a');
});

test('structural failures are told apart from transient ones', () => {
  assert.equal(classifyFailure('Claude configuration file not found at: /x/.claude.json'), 'config');
  assert.equal(classifyFailure('Invalid API key · Please run /login'), 'auth');
  assert.equal(classifyFailure('timed out after 45s'), 'timeout');
  assert.equal(classifyFailure('spawn claude ENOENT'), 'other');
  assert.equal(classifyFailure(''), 'other');
});

test('polls are spread across the refresh window, not fired together', () => {
  assert.deepEqual(scheduleFor([acct('a')], 60_000), [{ id: 'a', delayMs: 0, intervalMs: 60_000 }]);
  assert.deepEqual(scheduleFor([acct('a'), acct('b')], 60_000), [
    { id: 'a', delayMs: 0, intervalMs: 60_000 },
    { id: 'b', delayMs: 30_000, intervalMs: 60_000 },
  ]);
  // A disabled account costs no slot, so the rest are not spread thinner for it.
  assert.deepEqual(
    scheduleFor([acct('a'), acct('b', { enabled: false })], 60_000).map((s) => s.delayMs), [0]);
});

// ---- the env is the account --------------------------------------------------

test('a null configDir removes CLAUDE_CONFIG_DIR rather than trusting the env', () => {
  // The bug this guards: the daemon inherits process.env, so a daemon launched
  // from a shell that exports CLAUDE_CONFIG_DIR used to measure that shell's
  // account for every reading. Assigning undefined is not enough — the key would
  // still reach the child — so the default account has to delete it.
  const base = { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/Users/x/.claude-poly' };
  const def = envForAccount({ id: 'default', configDir: null }, base);
  assert.equal('CLAUDE_CONFIG_DIR' in def, false);
  assert.equal(def.CLAUDE_CODE_SKIP_PROMPT_HISTORY, '1');

  const poly = envForAccount({ id: 'poly', configDir: '/Users/x/.claude-poly' }, base);
  assert.equal(poly.CLAUDE_CONFIG_DIR, '/Users/x/.claude-poly');
  assert.equal(poly.CLAUDE_CODE_SKIP_PROMPT_HISTORY, '1');
});

test('a declaration is normalized without ever inventing a config dir', () => {
  const list = normalizeAccounts([
    { id: 'default', configDir: null },
    { id: 'Poly Conseil', label: 'polycea', configDir: '/tmp/x' },
    { id: 'default', configDir: '/tmp/dupe' },
    { id: '!!!', configDir: '/tmp/y' },
    { id: 'nope', configDir: 42 },
    { id: 'off', configDir: null, enabled: false },
  ]);
  assert.deepEqual(list.map((a) => a.id), ['default', 'poly-conseil', 'off']);
  assert.equal(list[0].configDir, null, 'null is never replaced by ~/.claude');
  assert.equal(list[0].label, 'DEFAULT', 'a missing label falls back to the id');
  assert.equal(list[1].label, 'POLYCEA');
  assert.equal(list[2].enabled, false);
});

test('a declaration that normalizes to nothing falls back to the single account', () => {
  for (const input of [[], [{ id: '' }], { accounts: [] }, null, 'nonsense']) {
    assert.deepEqual(normalizeAccounts(input), [
      { id: 'default', label: 'CLAUDE', configDir: null, enabled: true },
    ]);
  }
});

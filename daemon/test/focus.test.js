// Focusing, in two halves: which window owns a session (the registry), and
// which route the keyboard takes to it (tmux pane vs Terminal tab).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lookupSession, hostWindowFor, createFocus } from '../src/focus.js';

function registry(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-'));
  for (const rec of records) {
    fs.writeFileSync(path.join(dir, `${rec.pid}.json`), JSON.stringify(rec));
  }
  return dir;
}

const JOB = {
  pid: 65545,
  sessionId: 'f036b86d-4e37-491b-9c0c-5a851afbdab4',
  kind: 'bg',
  jobId: 'f036b86d',
  name: 'configure-model-effort',
  status: 'waiting',
};
const WINDOW = { pid: 64808, sessionId: 'ddfa1280-328c', kind: 'interactive', parkedJobId: 'f036b86d' };
const OTHER = { pid: 70824, sessionId: '2d6cdd0f-d9d7', kind: 'interactive' };

test('a background job resolves to the window parked on it', () => {
  const dir = registry([JOB, WINDOW, OTHER]);
  assert.equal(hostWindowFor(lookupSession(JOB.sessionId, dir), dir).pid, WINDOW.pid);
});

test('a parkedJobId written as the full session id still matches', () => {
  const dir = registry([JOB, { ...WINDOW, parkedJobId: JOB.sessionId }]);
  assert.equal(hostWindowFor(JOB, dir).pid, WINDOW.pid);
});

test('a job nobody parked on has no window', () => {
  const dir = registry([JOB, OTHER, { ...WINDOW, pid: 1, parkedJobId: 'deadbeef' }]);
  assert.equal(hostWindowFor(JOB, dir), null);
});

test('only interactive sessions count as windows', () => {
  const dir = registry([JOB, { ...WINDOW, kind: 'bg' }]);
  assert.equal(hostWindowFor(JOB, dir), null);
});

test('unparsable and unrelated files are skipped, not fatal', () => {
  const dir = registry([JOB, WINDOW]);
  fs.writeFileSync(path.join(dir, 'junk.json'), '{not json');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
  assert.equal(hostWindowFor(JOB, dir).pid, WINDOW.pid);
  assert.equal(lookupSession('nope', dir), null);
});

// ── Which route the keyboard takes ───────────────────────────────────────────
// Every dependency is injected, so these assert the routing itself: no ps, no
// osascript, no tmux server.

const PANE = { id: '%1', tty: '/dev/ttys002', inMode: false, label: '0:1.2' };
const SESSION = { pid: 4242, sessionId: 'sess-1', kind: 'interactive', name: 'my-project' };

function routing({ panes = [], app = null } = {}) {
  const osaCalls = [];
  const sent = [];
  const focus = createFocus({
    sessionsDir: registry([SESSION]),
    ttyFor: async () => '/dev/ttys002',
    ownerApp: async () => app,
    osa: async (script) => { osaCalls.push(script); return { ok: true, out: 'true' }; },
    tmux: {
      paneForTty: async (tty) => panes.find((p) => p.tty === tty) || null,
      selectPane: async () => {},
      capturePane: async () => null,
      sendKeys: async (id, keys) => { sent.push([id, ...keys]); return { sent: true }; },
    },
  });
  return { focus, osaCalls, sent };
}

test('a session in a pane is answered through the pane, with no AppleScript', async () => {
  const { focus, osaCalls, sent } = routing({ panes: [PANE] });
  const f = await focus.focusSession('sess-1');
  assert.equal(f.focused, true);
  assert.equal(f.exact, true, 'exact: keys are addressed to the pane, not to whatever is in front');
  assert.equal(f.pane, '%1');
  assert.deepEqual(osaCalls, [], 'nothing macOS can deny is involved');

  assert.deepEqual(await focus.typeSequence(['down', 'return'], f), { typed: true, via: 'tmux' });
  assert.deepEqual(sent, [['%1', 'down', 'return']]);
});

test('answering does not move what the user is looking at', async () => {
  // The device's own "focus this session" jumps tmux to the pane; an answer
  // must not, since send-keys does not care which pane is active.
  const selected = [];
  const focus = createFocus({
    sessionsDir: registry([SESSION]),
    ttyFor: async () => '/dev/ttys002',
    ownerApp: async () => null,
    osa: async () => ({ ok: true, out: 'true' }),
    tmux: {
      paneForTty: async () => PANE,
      selectPane: async (id) => selected.push(id),
      capturePane: async () => null,
      sendKeys: async () => ({ sent: true }),
    },
  });
  await focus.focusSession('sess-1', { select: false });
  assert.deepEqual(selected, []);
  await focus.focusSession('sess-1');
  assert.deepEqual(selected, ['%1'], 'an explicit focus still brings the pane up');
});

test('a pane in copy mode is not typed into', async () => {
  // Down would scroll the scrollback instead of moving the dialog's cursor.
  const { focus, sent } = routing({ panes: [{ ...PANE, inMode: true }] });
  const f = await focus.focusSession('sess-1');
  assert.equal(f.focused, false);
  assert.match(f.reason, /copy mode/);
  assert.deepEqual(sent, []);
});

test('a terminal we cannot name is never assumed to be Terminal.app', async () => {
  // This is the bug that made a tmux session open a stray empty Terminal window
  // every time the device tried to answer it: `tell application "Terminal"`
  // LAUNCHES Terminal, and then reports that no tab owns the tty.
  const { focus, osaCalls } = routing({ panes: [], app: null });
  const f = await focus.focusSession('sess-1');
  assert.equal(f.focused, false);
  assert.match(f.reason, /identify the terminal app/);
  assert.deepEqual(osaCalls, []);
});

test('without tmux, a Terminal session still gets its tab raised', async () => {
  const { focus, osaCalls } = routing({ panes: [], app: 'Terminal' });
  const f = await focus.focusSession('sess-1');
  assert.equal(f.focused, true);
  assert.equal(f.exact, true);
  assert.equal(f.pane, undefined);
  assert.match(osaCalls[0], /tell application "Terminal"/);
});

test('another emulator is raised for the human, and not typed into', async () => {
  const { focus, osaCalls } = routing({ panes: [], app: 'Ghostty' });
  const f = await focus.focusSession('sess-1');
  assert.equal(f.focused, true);
  assert.equal(f.exact, false, 'no way to target a tab, so the human presses the key');
  assert.match(osaCalls[0], /tell application "Ghostty" to activate/);
});

test('paneForSession finds the pane the queue reads the dialog from', async () => {
  const { focus } = routing({ panes: [PANE] });
  assert.equal((await focus.paneForSession('sess-1')).id, '%1');
  assert.equal(await focus.paneForSession('nope'), null);
});

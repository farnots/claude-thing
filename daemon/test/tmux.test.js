// The tmux layer: what it reads out of the server, and what argv it drives it
// with. `exec` is injected, so nothing here runs tmux.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePanes, sendKeyArgs, createTmux } from '../src/tmux.js';

// Verbatim `tmux list-panes -a -F …` output for the format the layer asks for,
// with a third pane sitting in copy mode.
const LIST = [
  '%0\t/dev/ttys004\t0\t0:1.1',
  '%1\t/dev/ttys002\t0\t0:1.2',
  '%2\t/dev/ttys010\t1\t0:1.3',
  '',
].join('\n');

function fakeExec(script = {}) {
  const calls = [];
  const exec = async (bin, args) => {
    calls.push([bin, ...args]);
    const key = args[0];
    if (key === '-V') return { ok: true, out: 'tmux 3.7c\n' };
    if (key in script) return script[key];
    return { ok: true, out: '' };
  };
  return { exec, calls };
}

const layer = (script) => {
  const { exec, calls } = fakeExec(script);
  return { tmux: createTmux({ exec, gapMs: 0 }), calls };
};

test('panes parse into id, tty and copy-mode state', () => {
  assert.deepEqual(parsePanes(LIST), [
    { id: '%0', tty: '/dev/ttys004', inMode: false, label: '0:1.1' },
    { id: '%1', tty: '/dev/ttys002', inMode: false, label: '0:1.2' },
    { id: '%2', tty: '/dev/ttys010', inMode: true, label: '0:1.3' },
  ]);
  assert.deepEqual(parsePanes(''), []);
  assert.deepEqual(parsePanes('garbage without tabs'), []);
});

test('a session tty resolves to its pane, and an unknown one to nothing', async () => {
  const { tmux } = layer({ 'list-panes': { ok: true, out: LIST } });
  assert.equal((await tmux.paneForTty('/dev/ttys002')).id, '%1');
  assert.equal((await tmux.paneForTty('/dev/ttys010')).inMode, true);
  assert.equal(await tmux.paneForTty('/dev/ttys999'), null);
  assert.equal(await tmux.paneForTty(null), null);
});

test('no tmux on the machine is an answer, not an error', async () => {
  const exec = async () => ({ ok: false, error: 'ENOENT' });
  const tmux = createTmux({ exec, gapMs: 0 });
  assert.deepEqual(await tmux.listPanes(), []);
  assert.equal(await tmux.paneForTty('/dev/ttys002'), null);
  assert.equal(await tmux.capturePane('%1'), null);
  assert.deepEqual(await tmux.sendKeys('%1', ['return']), { sent: false, reason: 'no tmux' });
});

test('named keys go as names and a digit goes as a literal', () => {
  assert.deepEqual(sendKeyArgs('return'), ['Enter']);
  assert.deepEqual(sendKeyArgs('down'), ['Down']);
  assert.deepEqual(sendKeyArgs('tab'), ['Tab']);
  // Without -l a digit would be read as a key name, and "3" is not one.
  assert.deepEqual(sendKeyArgs('3'), ['-l', '--', '3']);
  assert.equal(sendKeyArgs(''), null);
});

test('a sequence is one send-keys per key, all naming the pane', async () => {
  const { tmux, calls } = layer();
  assert.deepEqual(await tmux.sendKeys('%1', ['down', 'down', 'return']), { sent: true });
  assert.deepEqual(calls.filter((c) => c[1] === 'send-keys'), [
    ['/opt/homebrew/bin/tmux', 'send-keys', '-t', '%1', 'Down'],
    ['/opt/homebrew/bin/tmux', 'send-keys', '-t', '%1', 'Down'],
    ['/opt/homebrew/bin/tmux', 'send-keys', '-t', '%1', 'Enter'],
  ]);
});

test('a failed key stops the sequence instead of finishing it blind', async () => {
  let sent = 0;
  const exec = async (bin, args) => {
    if (args[0] === '-V') return { ok: true, out: 'tmux 3.7c' };
    if (args[0] !== 'send-keys') return { ok: true, out: '' };
    sent++;
    return sent === 2 ? { ok: false, error: "can't find pane" } : { ok: true, out: '' };
  };
  const tmux = createTmux({ exec, gapMs: 0 });
  assert.deepEqual(await tmux.sendKeys('%1', ['down', 'down', 'return']),
    { sent: false, reason: "can't find pane" });
  assert.equal(sent, 2);
});

test('the pane is captured as plain text, by pane id', async () => {
  const { tmux, calls } = layer({ 'capture-pane': { ok: true, out: '  1. Yes\n  2. No\n' } });
  assert.equal(await tmux.capturePane('%2'), '  1. Yes\n  2. No\n');
  assert.deepEqual(calls.find((c) => c[1] === 'capture-pane'),
    ['/opt/homebrew/bin/tmux', 'capture-pane', '-p', '-t', '%2']);
});

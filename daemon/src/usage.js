// Real usage, straight from Claude Code.
//
// `claude -p "/usage"` runs the slash command locally and prints the same
// figures the interactive /usage view shows — percentages against the actual
// plan limits, reset times, and the "what's contributing" breakdown. It costs
// no model tokens (no inference happens) and, with
// CLAUDE_CODE_SKIP_PROMPT_HISTORY=1, writes no transcript.
//
// Everything here is parsed from that text. We never invent a denominator.
//
// One reading per account, an account being a CLAUDE_CONFIG_DIR (or its
// absence — see usage-accounts.js). Every account gets its own reading, its own
// anti-flap state and its own persisted figure; nothing about one is ever
// derived from another, so an account that is signed out or misconfigured
// cannot blank the screen for the rest.

import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import {
  USAGE_REFRESH_MS, USAGE_BACKOFF_AFTER, USAGE_ERROR_BACKOFF_MS,
} from './config.js';
import { markOwnSession } from './own-sessions.js';
import {
  configDirMissing, envForAccount, loadAccounts, normalizeAccounts,
} from './usage-accounts.js';
import { readState, writeState } from './persist.js';
import { log } from './log.js';

// Where the last good reading is kept between runs.
const STATE_NAME = 'usage';

// A run costs no inference but still boots Claude Code and reads the plan, which
// takes the better part of 20 seconds on a cold start. The old 25s ceiling cut
// slower runs off, and the timeout then reported whatever stderr happened to
// hold — which is how a harmless stdin warning ended up on the usage screen as
// the failure. Well under the 60s refresh, so runs still never overlap.
const RUN_TIMEOUT_MS = 45_000;

// How many consecutive lower readings it takes to believe a drop. The hold in
// reconcileUsage exists to ride out a clobbered cache, which flaps back within a
// poll or two; a window that really rolled over stays low. Three polls a minute
// apart is long enough to outlast the flap and short enough that a bar is never
// wrong for more than a few minutes.
const HOLD_POLLS = 3;

// "Current session: 11% used · resets Jul 30 at 5:19am (America/New_York)"
const LIMIT_RE = /^\s*Current\s+(session|week[^:]*):\s*(\d+)%\s*used(?:\s*·\s*resets\s+([^(\n]+?))?\s*(?:\(([^)]+)\))?\s*$/i;
// "Last 24h · 579 requests · 8 sessions" — and "Last 24h · 1 request · 1 session",
// which Claude Code writes in the singular. Requiring the plural dropped the
// whole window, bullets included, so the device drew the 7-day breakdown while
// the Mac led with the 24h one.
const WINDOW_RE = /^\s*Last\s+(\S+)\s*·\s*([\d,]+)\s+requests?\s*·\s*([\d,]+)\s+sessions?\s*$/i;
// "Top skills: /webapp-testing 4%, /frontend-design 1%"
const TOP_RE = /^Top\s+(skills|subagents|MCP servers):\s*(.+)$/i;

// Trailing percentage per item; anything that doesn't match that shape is kept
// with an empty value rather than dropped, so an unparsed entry still shows.
function parseTopList(rest) {
  return String(rest).split(',').map((chunk) => {
    const item = chunk.trim();
    const m = /^(.*\S)\s+(\d+%)$/.exec(item);
    return m ? { name: m[1], pct: m[2] } : { name: item, pct: '' };
  }).filter((x) => x.name);
}

function labelFor(kind) {
  const k = kind.toLowerCase();
  if (k === 'session') return 'SESSION';
  const model = /week\s*\(([^)]+)\)/i.exec(kind);
  if (model) {
    const name = model[1].trim();
    return /all models/i.test(name) ? 'WEEK · ALL MODELS' : `WEEK · ${name.toUpperCase()}`;
  }
  return kind.toUpperCase();
}

export function parseUsage(text, now = Date.now()) {
  const lines = String(text).split('\n');
  const limits = [];
  const windows = [];
  let current = null;
  let subscription = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (/subscription to power your Claude Code usage/i.test(line)) {
      subscription = line.trim();
      continue;
    }

    const limit = LIMIT_RE.exec(line);
    if (limit) {
      limits.push({
        key: limit[1].toLowerCase().replace(/[^a-z]+/g, '-'),
        label: labelFor(limit[1]),
        used: Number(limit[2]) / 100,
        detail: limit[3] ? `resets ${limit[3].trim()}` : '',
      });
      continue;
    }

    const win = WINDOW_RE.exec(line);
    if (win) {
      current = {
        window: `Last ${win[1]}`,
        requests: Number(win[2].replace(/,/g, '')),
        sessions: Number(win[3].replace(/,/g, '')),
        notes: [],
        skills: [],
        subagents: [],
        mcp: [],
      };
      windows.push(current);
      continue;
    }

    // indented bullets under a window: behaviours and top skills/subagents/MCP
    if (current && /^\s{2,}\S/.test(raw) && line.trim()) {
      const note = line.trim();
      current.notes.push(note);
      // "Top skills: /webapp-testing 4%, /deploy-to-dev 1%" is a table wearing
      // a sentence. Split it here so the device renders rows, not prose.
      const top = TOP_RE.exec(note);
      if (top) {
        const key = { skills: 'skills', subagents: 'subagents', 'mcp servers': 'mcp' }[top[1].toLowerCase()];
        if (key) current[key] = parseTopList(top[2]);
      }
    }
  }

  // A run can succeed and print no limit lines at all. Claude Code renders a
  // limit only while its reset time is still ahead, and the figures come from
  // `cachedUsageUtilization` in ~/.claude.json, which a `claude -p` run reads
  // but never refetches. So once a window rolls over, every poll comes back
  // with the breakdown intact and not one "Current session:" line, until an
  // interactive session refreshes the cache. Observed live for seven hours.
  //
  // That is a real reading of a real state — the limits are unavailable — not a
  // parse failure, and treating it as one froze the screen on the last reading
  // that happened to parse. What tells the two apart is whether /usage rendered
  // anything we recognise: a window line or the subscription sentence.
  if (!limits.length && !windows.length && !subscription) return null;

  return {
    updatedTs: now,
    // When the limits were last actually read, as opposed to when this reading
    // was taken. They diverge as soon as one is carried over.
    limitsTs: limits.length ? now : 0,
    updatedLabel: 'updated ' + hhmm(now) + ' · from claude /usage',
    subscription,
    limits,
    windows,
  };
}

function hhmm(ts) {
  return new Date(ts).toTimeString().slice(0, 5);
}

// The device renders a fixed subset of a reading: every limit bar, the first
// window's line and its top-3 skills/subagents tables. The rest — notes, MCP
// servers, the subscription sentence, further windows — is ~half the payload
// and never drawn, so the once-a-minute event (which crosses the Bluetooth
// link) carries only the rendered shape. claude.usage.get stays full unless
// asked ({slim}), and what is persisted is always the full reading.
export function slimUsage(u) {
  if (!u) return u;
  const first = (u.windows || [])[0];
  return {
    updatedTs: u.updatedTs,
    updatedLabel: u.updatedLabel,
    stale: u.stale,
    error: u.error,
    // The four fields a bar draws. Projected rather than passed through so the
    // hold bookkeeping reconcileUsage attaches (lowSeen) stays daemon-side.
    limits: (u.limits || []).map((l) => ({
      key: l.key, label: l.label, used: l.used, detail: l.detail,
    })),
    windows: first ? [{
      window: first.window,
      requests: first.requests,
      sessions: first.sessions,
      skills: (first.skills || []).slice(0, 3),
      subagents: (first.subagents || []).slice(0, 3),
    }] : [],
  };
}

// --- keeping a reading honest across polls ------------------------------------
//
// `claude -p /usage` does not always ask the server. It prints whatever is in
// `cachedUsageUtilization` in ~/.claude.json, and that file is read-modify-
// written wholesale by every claude process on the machine. A long-lived
// session that loaded it an hour ago writes its own stale copy back over the
// fresh one, so consecutive polls a minute apart can disagree — the screen
// flips between the real figure and a stale lower one until something settles.
// Observed live: 1% used, then 0% used, inside the same five-hour window.
//
// The fix is the one fact the reading itself gives us: usage inside a window
// only ever goes up. A lower number for the same window is a stale read, not a
// refund, so the higher one stands. When the window really does roll over the
// reset clause changes with it, and the drop is taken at face value.

function sameWindow(prev, next) {
  // A reading with no reset clause carries no window identity of its own — the
  // zeroed-out shape a clobbered cache prints — so it cannot claim to be a new
  // window. Only a different, stated reset time counts as a rollover.
  if (!prev.detail || !next.detail) return true;
  return prev.detail === next.detail;
}

export function reconcileUsage(prev, next) {
  if (!next || !Array.isArray(next.limits)) return next;

  // Silence about the limits is not a report that they are gone. A reading that
  // printed none is the expired-cache shape above: its windows are fresh and
  // worth taking, but the last limits actually read still stand, dated by when
  // they were read rather than by now. Held indefinitely — a figure the device
  // labels as hours old beats a screen that stops moving altogether.
  if (!next.limits.length) {
    const held = (prev && prev.limits) || [];
    if (!held.length) return next;
    const limitsTs = (prev && (prev.limitsTs || prev.updatedTs)) || next.updatedTs;
    return {
      ...next,
      limits: held,
      limitsTs,
      stale: true,
      updatedLabel: 'limits ' + hhmm(limitsTs) + ' · from claude /usage',
    };
  }

  const before = new Map(((prev && prev.limits) || []).map((l) => [l.key, l]));
  let holding = false;
  const limits = next.limits.map((l) => {
    const p = before.get(l.key);
    if (!p || !(p.used > l.used) || !sameWindow(p, l)) return l;
    // A drop the reading itself cannot explain. Hold it, but count: a window
    // that rolled over while inactive prints 0% with no reset clause at all, so
    // sameWindow can never tell that apart from a clobbered cache and the hold
    // used to stand forever — a bar frozen on a figure hours out of date,
    // labelled as current. After HOLD_POLLS consecutive lower readings the drop
    // is real enough to take.
    const lowSeen = (p.lowSeen || 0) + 1;
    if (lowSeen >= HOLD_POLLS) return l;
    // Held: the previous reading wins, and keeps its reset clause if this one
    // arrived without any. The count rides on the limit so it accumulates
    // across polls, and vanishes the moment a reading is taken at face value.
    holding = true;
    return { ...l, used: p.used, detail: l.detail || p.detail, lowSeen };
  });
  // A held figure is not current, and must not be dated or persisted as if it
  // were — same treatment the carry-over above gets.
  if (!holding) return { ...next, limits };
  return {
    ...next,
    limits,
    stale: true,
    limitsTs: (prev && (prev.limitsTs || prev.updatedTs)) || next.updatedTs,
  };
}

// What actually went wrong, in the words the device has room for. A killed run
// timed out — say that, rather than quoting whichever line stderr happened to
// end on, which is how warnings get mistaken for causes.
export function describeFailure(err, stderr) {
  if (err && (err.killed || err.signal)) {
    return `timed out after ${Math.round(RUN_TIMEOUT_MS / 1000)}s`;
  }
  const line = String(stderr || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^warning:/i.test(l));
  return line || String((err && err.message) || 'unknown error').split('\n')[0];
}

// ---- accounts on the wire ----------------------------------------------------
//
// `states` throughout this section is a Map of account id -> its latest reading
// (or null). Keeping it a parameter rather than a closure is what lets every
// function below stay pure and be tested without booting anything.

const NOT_READ = { limits: [], error: 'usage not read yet' };

// Same rule slimUsage follows, applied one level down: carry what the screen
// draws. `columns` says the receiver will draw two columns, which happens from
// two accounts on, and a column has no room for the contributing tables — it
// draws the bars and the window line. Three skills plus three subagents per
// account is ~330 bytes of an 1800-byte chunk spent on rows nobody renders, and
// that is exactly the difference between two accounts fitting one synchronous
// response (1449 bytes) and not (2101). With a single account the screen keeps
// the full layout, tables included, so nothing is dropped there.
export function slimAccount(account, u, columns = false) {
  const slim = slimUsage(u) || NOT_READ;
  const out = { ...slim, id: account.id, label: account.label };
  if (!columns) return out;
  const first = (slim.windows || [])[0];
  out.windows = first
    ? [{ window: first.window, requests: first.requests, sessions: first.sessions }]
    : [];
  return out;
}

// Which account the flat mirror speaks for: the first enabled one that actually
// has limits. Not simply accounts[0] — detection puts the machine default first,
// and if that is the account that is signed out or misconfigured then a client
// reading only the flat fields (a firmware that predates multi-account) would be
// shown nothing but an error while a perfectly good second account sat unread.
// The mirror therefore moves only when an account breaks or is repaired, which
// is exactly when it should, and accountId always names it.
export function primaryOf(accounts, states) {
  const enabled = accounts.filter((a) => a.enabled);
  if (!enabled.length) return accounts[0] || null;
  for (const a of enabled) {
    const u = states.get(a.id);
    if (u && u.limits && u.limits.length) return a;
  }
  return enabled[0];
}

// Primary first, everything else in declaration order. One ordering rule for the
// mirror and for the array, so a capped response and the mirror can never
// disagree about which account came first.
export function orderForWire(accounts, states) {
  const primary = primaryOf(accounts, states);
  if (!primary) return [];
  return [primary, ...accounts.filter((a) => a.enabled && a.id !== primary.id)];
}

// One reading of every account, plus the flat mirror of the primary.
//
// withMirror / withAccounts are separate because the three callers want three
// different shapes, and the reason is the Bluetooth chunk budget: a synchronous
// response cannot span chunks, so it carries either the mirror (what an old
// client reads) or the array (what a new one reads), never both. The event
// carries both, because events chunk.
export function multiUsage(accounts, states, {
  cap = 0, slim = true, withMirror = true, withAccounts = true,
} = {}) {
  const order = orderForWire(accounts, states);
  const primary = order[0] || null;
  const out = {};

  if (withMirror) {
    const u = primary ? states.get(primary.id) : null;
    Object.assign(out, (slim ? slimUsage(u) : u) || NOT_READ);
  }
  out.accountId = primary ? primary.id : '';
  out.accountCount = order.length;

  if (withAccounts) {
    const carried = cap > 0 ? order.slice(0, cap) : order;
    // Narrowed only when there is more than one to draw — see slimAccount.
    const columns = carried.length > 1;
    out.accounts = carried.map((a) => (
      slim ? slimAccount(a, states.get(a.id), columns)
           : { id: a.id, label: a.label, ...(states.get(a.id) || NOT_READ) }
    ));
  }
  return out;
}

// Structural or transient? A missing config file and a signed-out account fail
// identically on every retry, so they are worth backing off; a timeout is the
// machine being busy and is worth trying again in a minute.
export function classifyFailure(message) {
  const s = String(message || '');
  if (/timed out after/i.test(s)) return 'timeout';
  if (/configuration file not found|no such file|not found at/i.test(s)) return 'config';
  if (/not logged in|invalid api key|please run \/login|credentials|unauthorized/i.test(s)) return 'auth';
  return 'other';
}

// How long until this account's next poll. A structural failure repeated this
// many times is not going to fix itself in a minute, and retrying it there costs
// a 45s `claude` boot every minute plus one more writer on the session registry.
// One good reading clears the streak, so a repaired account is back on the
// nominal interval immediately.
export function backoffFor(failStreak, refreshMs) {
  return failStreak >= USAGE_BACKOFF_AFTER ? USAGE_ERROR_BACKOFF_MS : refreshMs;
}

// Polls are spread across the refresh window rather than fired together. A run
// takes the better part of 20-45s, so running two accounts back to back would
// overrun the 60s window, and running them at the same instant doubles the
// number of concurrent `claude` processes rewriting the session registry the
// poller reads (see RETIRE_AFTER_MISSED_POLLS in config.js). Spreading them does
// neither: two accounts land at t=0 and t=30s, and each still gets a reading
// every 60s.
export function scheduleFor(accounts, refreshMs) {
  const enabled = accounts.filter((a) => a.enabled);
  const step = Math.floor(refreshMs / (enabled.length || 1));
  return enabled.map((a, i) => ({ id: a.id, delayMs: i * step, intervalMs: refreshMs }));
}

// ---- persistence -------------------------------------------------------------

// The last good reading, so a restart shows real figures instead of spending a
// minute on "READING USAGE…". Flagged stale until the first live poll lands.
function labelPersisted(saved) {
  if (!saved || !Array.isArray(saved.limits) || !saved.limits.length) return null;
  // Dated by when the limits were read, which after a carry-over is older than
  // the reading that saved them.
  const ts = saved.limitsTs || saved.updatedTs;
  const at = ts ? hhmm(ts) : '';
  return {
    ...saved,
    stale: true,
    error: undefined,
    updatedLabel: `last reading${at ? ' ' + at : ''} · from claude /usage`,
  };
}

function loadPersistedMap(list) {
  const out = new Map(list.map((a) => [a.id, null]));
  const saved = readState(STATE_NAME);
  if (!saved) return out;

  // v2: one entry per account id. Ids the declaration no longer mentions are
  // ignored rather than deleted — an account disabled today may come back, and
  // its figures are still the last true thing we knew about it.
  if (saved.accounts && typeof saved.accounts === 'object' && !Array.isArray(saved.accounts)) {
    for (const a of list) out.set(a.id, labelPersisted(saved.accounts[a.id]));
    return out;
  }

  // v1: a single flat reading, written by a daemon that measured whichever
  // account its own environment happened to name — and that is information no
  // migration can recover. Attributing it to the first declared account invents
  // nothing about the others, and the first poll of each supersedes it anyway.
  if (Array.isArray(saved.limits) && list.length) out.set(list[0].id, labelPersisted(saved));
  return out;
}

// ---- the poller --------------------------------------------------------------

export function createUsage({ emit, accounts, runUsage, home } = {}) {
  let list = [];
  const slots = new Map();

  function states() {
    const m = new Map();
    for (const [id, slot] of slots) m.set(id, slot.latest);
    return m;
  }

  function install(next) {
    list = next;
    const saved = loadPersistedMap(list);
    for (const a of list) {
      const prev = slots.get(a.id);
      // A surviving account keeps the reading it already has: re-reading it off
      // disk would swap a live figure for the older persisted one.
      if (prev) { prev.account = a; continue; }
      const restored = saved.get(a.id) || null;
      slots.set(a.id, {
        account: a,
        latest: restored,
        // The last reading that satisfied limitsTs === updatedTs. Kept apart from
        // `latest` because persistAll rewrites the whole file: without it, saving
        // one account's fresh figure would drag another account's *held* figure
        // onto disk, which is precisely what the hold forbids.
        persisted: restored,
        running: false,
        timer: null,
        failStreak: 0,
        failKind: null,
      });
    }
    for (const id of [...slots.keys()]) {
      if (list.some((a) => a.id === id)) continue;
      const gone = slots.get(id);
      if (gone.timer) clearTimeout(gone.timer);
      slots.delete(id);
    }
  }

  function persistAll() {
    const out = {};
    for (const [id, slot] of slots) if (slot.persisted) out[id] = slot.persisted;
    writeState(STATE_NAME, { version: 2, accounts: out });
  }

  // Our own polling is still a Claude Code session. disableAllHooks stops it
  // reporting itself through the hook path, the explicit session id lets the
  // session sources recognise and skip it, and running from a temp dir keeps
  // it out of any project the user actually works in. One marked id per run, so
  // no account's poll is mistaken for a real session.
  function defaultRun(account) {
    const sessionId = crypto.randomUUID();
    markOwnSession(sessionId);

    return new Promise((resolve) => {
      execFile(
        'claude',
        ['--settings', '{"disableAllHooks":true}', '--session-id', sessionId, '-p', '/usage'],
        {
          timeout: RUN_TIMEOUT_MS,
          cwd: os.tmpdir(),
          // Which account this reading is of, and the only thing that decides it.
          env: envForAccount(account),
          maxBuffer: 1024 * 1024,
          // Closed stdin, not an idle pipe. `claude -p` waits three seconds for
          // input that is never coming, warns about it, and only then starts —
          // three seconds of every run, spent on nothing.
          stdio: ['ignore', 'pipe', 'pipe'],
        },
        (err, stdout, stderr) => {
          if (err) return resolve({ error: describeFailure(err, stderr) });
          resolve({ text: String(stdout) });
        }
      );
    });
  }

  const run = runUsage || defaultRun;

  async function refreshOne(id) {
    const slot = slots.get(id);
    if (!slot) return null;
    if (slot.running) return slot.latest;

    // Not polled at all. A run against a directory that is not there burns the
    // full timeout to tell us what one existsSync already said, and does it once
    // a minute forever. Re-checked every tick, so a restored directory heals
    // without a restart.
    if (configDirMissing(slot.account)) {
      slot.latest = {
        ...(slot.latest || {}),
        limits: (slot.latest && slot.latest.limits) || [],
        stale: true,
        error: `config dir missing: ${slot.account.configDir}`,
      };
      slot.failKind = 'config';
      slot.failStreak = USAGE_BACKOFF_AFTER;
      return slot.latest;
    }

    slot.running = true;
    try {
      const out = await run(slot.account);
      if (out.error) {
        slot.latest = {
          ...(slot.latest || {}),
          stale: true,
          error: `claude /usage failed: ${out.error}`.slice(0, 120),
        };
        const kind = classifyFailure(out.error);
        slot.failKind = kind;
        slot.failStreak = (kind === 'config' || kind === 'auth') ? slot.failStreak + 1 : 0;
      } else {
        const parsed = parseUsage(out.text);
        if (parsed) {
          slot.failStreak = 0;
          slot.failKind = null;
          slot.latest = reconcileUsage(slot.latest, parsed);
          // Nothing to carry and nothing read: say which of the two it is,
          // rather than leaving the screen on "READING USAGE…" forever.
          //
          // Only limits actually read in this poll are persisted, which is what
          // `limitsTs === updatedTs` says: a carried-over or held figure is
          // dated earlier and must never reach the state file, or a restart —
          // or an update — recovers the wrong number and shows it again.
          if (slot.latest.limits.length && slot.latest.limitsTs === slot.latest.updatedTs) {
            slot.persisted = slot.latest;
            persistAll();
          }
          else slot.latest = { ...slot.latest, stale: true, error: 'claude /usage printed no limits' };
        } else {
          slot.latest = { ...(slot.latest || {}), stale: true, error: 'could not parse /usage output' };
        }
      }
    } catch (err) {
      log('US', `${id}: usage refresh failed: ${err.message}`);
    } finally {
      slot.running = false;
    }
    return slot.latest;
  }

  // One event per refresh, carrying every account — never one event per account.
  // The Mac connector coalesces by topic alone (ClaudeRelayService.coalesceKey),
  // so two frames on this topic inside its 200ms window supersede each other;
  // that is lossless only while each frame is a complete snapshot.
  function announce() {
    if (emit) emit('claude.usage.update', multiUsage(list, states()));
  }

  async function tick(id) {
    await refreshOne(id);
    announce();
  }

  function schedule(id, delayMs) {
    const slot = slots.get(id);
    if (!slot) return;
    // Self-rescheduling rather than setInterval: the interval is not constant —
    // an account that keeps failing structurally backs off — and a fixed
    // interval cannot express that.
    slot.timer = setTimeout(async () => {
      slot.timer = null;
      await tick(id);
      const still = slots.get(id);
      if (still) schedule(id, backoffFor(still.failStreak, USAGE_REFRESH_MS));
    }, delayMs);
  }

  function start() {
    for (const s of scheduleFor(list, USAGE_REFRESH_MS)) schedule(s.id, s.delayMs);
  }

  function stop() {
    for (const slot of slots.values()) {
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
    }
  }

  install(accounts ? normalizeAccounts(accounts) : loadAccounts({ home }));

  return {
    start,
    stop,

    // Re-read the declaration: new accounts appear, removed ones go, and the
    // readings of everything that survived are kept.
    reload: (next) => {
      stop();
      install(next ? normalizeAccounts(next) : loadAccounts({ home }));
      start();
      announce();
      return list;
    },

    refresh: (id) => (id
      ? tick(id)
      : Promise.all([...slots.keys()].map(refreshOne)).then(() => { announce(); })),

    // A flat reading — the shape this method has always returned — for one
    // account, the primary by default.
    get: ({ account, slim } = {}) => {
      const st = states();
      const target = account ? list.find((a) => a.id === account) : primaryOf(list, st);
      if (!target) throw new Error('unknown account');
      const u = st.get(target.id);
      return {
        ...((slim ? slimUsage(u) : u) || NOT_READ),
        accountId: target.id,
        accountCount: list.filter((a) => a.enabled).length,
      };
    },

    all: (opts = {}) => multiUsage(list, states(), { withMirror: false, ...opts }),

    accounts: () => list.map((a) => {
      const slot = slots.get(a.id);
      return {
        ...a,
        missing: configDirMissing(a),
        failKind: (slot && slot.failKind) || null,
        failStreak: (slot && slot.failStreak) || 0,
        nextPollMs: backoffFor((slot && slot.failStreak) || 0, USAGE_REFRESH_MS),
      };
    }),
  };
}

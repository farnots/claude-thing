// Which Claude accounts the usage screen measures.
//
// A Claude Code account is not a name or a token this daemon can see — it is
// whichever `.claude.json` the CLI happens to read, and that is selected purely
// by `CLAUDE_CONFIG_DIR`. So an "account" here is exactly one thing: the value
// of that variable, **or its absence**.
//
// The absence matters and is not interchangeable with `~/.claude`. Claude Code
// resolves its state to `$CLAUDE_CONFIG_DIR/.claude.json` when the variable is
// set, and to `$HOME/.claude.json` when it is not — two different files. A
// machine whose real account lives in the legacy `$HOME/.claude.json` therefore
// answers `/usage` correctly with the variable unset and fails with
// "Claude configuration file not found" the moment something helpfully sets it
// to `~/.claude`. `configDir: null` is that case, and it is the default.
//
// Which also fixes a bug that predates multi-account: the poll inherited
// `process.env`, so the screen showed whichever account the shell that launched
// the daemon happened to be in — with nothing on screen saying so. Every account
// now states its config dir, or states that it wants none.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_USAGE_ACCOUNTS } from './config.js';
import { readState, writeState } from './persist.js';
import { log } from './log.js';

// Where the declaration lives, beside the usage.json it indexes. Same state dir
// as everything else the daemon keeps across restarts, so CLAUDE_THING_STATE_DIR
// isolates it in tests and the atomic-write/tolerant-read behaviour is inherited.
const STATE_NAME = 'usage-accounts';

// A directory that could hold a Claude Code config: `.claude` itself, or a
// `.claude-<something>` sibling. Nothing is assumed about which of them is real —
// see isCandidateValid.
const CONFIG_DIR_RE = /^\.claude(-[A-Za-z0-9._-]+)?$/;

// Ids are slugs, not emails: an email changes and the id is the key under which
// a reading is persisted and an account is addressed on the wire.
const ID_RE = /^[a-z0-9][a-z0-9-]{0,15}$/;

// "lucas@example.com's Organization" is what Claude Code calls a personal
// account's org. It is not a label anybody wants on a 800x480 screen, so when we
// see that shape we fall back to the email's local part.
const PERSONAL_ORG_RE = /^\S+@\S+'s Organization$/;

const LABEL_MAX = 12;

export const DEFAULT_ACCOUNT = { id: 'default', label: 'CLAUDE', configDir: null, enabled: true };

function slugify(s) {
  const out = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16)
    .replace(/-+$/, '');
  return ID_RE.test(out) ? out : '';
}

function shortLabel(s) {
  return String(s || '').trim().toUpperCase().slice(0, LABEL_MAX);
}

// Absolute path, `~` expanded. Anything that is not a string and not null is a
// malformed entry rather than a default — see normalizeAccounts.
function resolveConfigDir(dir) {
  if (dir === null || dir === undefined || dir === '') return null;
  if (typeof dir !== 'string') return undefined;
  const expanded = dir.startsWith('~') ? path.join(os.homedir(), dir.slice(1)) : dir;
  return path.resolve(expanded);
}

// The env a poll for this account must run under. `delete` rather than
// `undefined`: the variable may already be in the base env (a daemon started
// from a shell that sets it), and assigning undefined still passes the key to the
// child. A null configDir means "whatever the machine's default is", and that
// only holds if the variable is genuinely gone.
export function envForAccount(account, base = process.env) {
  const env = { ...base, CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1' };
  if (account && account.configDir) env.CLAUDE_CONFIG_DIR = account.configDir;
  else delete env.CLAUDE_CONFIG_DIR;
  return env;
}

// Checked per poll rather than once at load: a config dir can come back — an
// external volume remounts, a directory is restored — and a daemon that decided
// at boot would need a restart to notice.
export function configDirMissing(account) {
  if (!account || !account.configDir) return false;
  return !fs.existsSync(account.configDir);
}

export function normalizeAccounts(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.accounts) ? raw.accounts : []);
  const out = [];
  const seen = new Set();

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;

    const configDir = resolveConfigDir(entry.configDir);
    if (configDir === undefined) {
      log('US', `account dropped: configDir must be a string or null (${JSON.stringify(entry.id)})`);
      continue;
    }

    const id = ID_RE.test(entry.id) ? entry.id : slugify(entry.id);
    if (!id) {
      log('US', `account dropped: unusable id ${JSON.stringify(entry.id)}`);
      continue;
    }
    // First declaration of an id wins. Silently merging two entries would make
    // one of them invisible with no way to tell which.
    if (seen.has(id)) {
      log('US', `account dropped: duplicate id ${id}`);
      continue;
    }

    if (out.length >= MAX_USAGE_ACCOUNTS) {
      log('US', `account dropped: more than ${MAX_USAGE_ACCOUNTS} declared (${id})`);
      continue;
    }

    seen.add(id);
    out.push({
      id,
      label: shortLabel(entry.label) || id.toUpperCase().slice(0, LABEL_MAX),
      configDir,
      enabled: entry.enabled !== false,
    });
  }

  // A declaration that normalizes to nothing is a broken file, not an
  // instruction to measure nothing. Fall back to the single implicit account,
  // which is exactly the behaviour that predates this module.
  return out.length ? out : [{ ...DEFAULT_ACCOUNT }];
}

function readConfig(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// The one thing that tells a real account from a stub: a signed-in config carries
// oauthAccount.emailAddress. This is what makes the `.claude` directory need no
// special case — on a machine using the legacy `$HOME/.claude.json`, the
// `~/.claude/.claude.json` left behind is a stub with no oauthAccount and gets
// rejected on its own, while the null candidate passes. It also rejects
// `.claude-thing` (our own state dir, which matches the directory pattern) and
// anything else that merely looks like a config dir.
function accountFrom(configDir, file) {
  const cfg = readConfig(file);
  const oauth = cfg && cfg.oauthAccount;
  const email = oauth && oauth.emailAddress;
  if (typeof email !== 'string' || !email.trim()) return null;
  return { configDir, email: email.trim(), uuid: (oauth.accountUuid || '') || null, org: oauth.organizationName || '' };
}

function labelFor(found) {
  const org = String(found.org || '').trim();
  if (org && !PERSONAL_ORG_RE.test(org)) return shortLabel(org);
  return shortLabel(String(found.email).split('@')[0]);
}

export function detectAccounts(home = os.homedir()) {
  // The null candidate first, and deliberately: it is the machine default, the
  // one an unset CLAUDE_CONFIG_DIR selects, and the one a pre-multi-account
  // daemon was measuring.
  const candidates = [{ configDir: null, file: path.join(home, '.claude.json') }];

  let entries = [];
  try {
    entries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && CONFIG_DIR_RE.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of dirs) {
    candidates.push({ configDir: path.join(home, name), file: path.join(home, name, '.claude.json') });
  }

  const out = [];
  const uuids = new Set();
  const ids = new Set();
  for (const c of candidates) {
    const found = accountFrom(c.configDir, c.file);
    if (!found) continue;
    // Same account reachable two ways — a `.claude-backup` copy, or a config dir
    // that is a symlink to the default one. Keep the first, which the ordering
    // above makes the null candidate.
    if (found.uuid && uuids.has(found.uuid)) continue;
    if (found.uuid) uuids.add(found.uuid);

    let id = c.configDir === null
      ? 'default'
      : slugify(path.basename(c.configDir).replace(/^\.claude-?/, '')) || 'claude';
    if (ids.has(id)) {
      let n = 2;
      while (ids.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    ids.add(id);

    out.push({ id, label: labelFor(found) || id.toUpperCase(), configDir: c.configDir, enabled: true });
  }

  return out.length ? out : [{ ...DEFAULT_ACCOUNT }];
}

// Read the declaration, detecting once if there is none. Detection writes its
// result, so the file becomes the stable declaration from then on and is never
// re-derived behind the user's back: an account removed from the file stays
// removed, and a hand-edited label survives every restart.
export function loadAccounts({ home = os.homedir() } = {}) {
  const saved = readState(STATE_NAME);
  if (saved && Array.isArray(saved.accounts) && saved.accounts.length) {
    const list = normalizeAccounts(saved);
    if (list.some((a) => a.enabled)) return list;
  }
  const detected = detectAccounts(home);
  saveAccounts(detected);
  log('US', `detected ${detected.length} account(s): ${detected.map((a) => a.id).join(', ')}`);
  return detected;
}

export function saveAccounts(accounts, now = 0) {
  const list = normalizeAccounts(accounts);
  writeState(STATE_NAME, { version: 1, detectedTs: now, accounts: list });
  return list;
}

// Re-detect without losing what the user changed: a label they renamed and an
// account they disabled are decisions, and a rescan must not overwrite them. New
// config dirs are appended, and declared accounts that no longer exist on disk
// are kept — configDirMissing reports them rather than making them vanish.
export function mergeDetected(existing, detected) {
  const byDir = new Map(existing.map((a) => [String(a.configDir), a]));
  const out = existing.map((a) => ({ ...a }));
  for (const d of detected) {
    if (byDir.has(String(d.configDir))) continue;
    out.push(d);
  }
  return normalizeAccounts(out);
}

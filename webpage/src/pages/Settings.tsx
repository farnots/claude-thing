import { useEffect, useState } from 'react';
import { Button, Card, PageHeader, StatusRow } from '../components/ui';
import { useStatus, type ClockFormat } from '../hooks';
import { getApi, postApi } from '../ws';

type Account = {
  id: string;
  label: string;
  configDir: string | null;
  enabled: boolean;
  missing?: boolean;
  failKind?: string | null;
  failStreak?: number;
  nextPollMs?: number;
};

const CLOCK_CHOICES: { value: ClockFormat; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '12', label: '12-hour' },
  { value: '24', label: '24-hour' },
];

export function Settings() {
  const { status, refresh } = useStatus([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [clockBusy, setClockBusy] = useState(false);

  const clockFormat = status?.settings?.clockFormat ?? 'auto';
  const clock24 = status?.settings?.clock24 ?? false;

  async function setClockFormat(value: ClockFormat) {
    if (value === clockFormat) return;
    setClockBusy(true);
    try {
      await postApi('/api/settings', { clockFormat: value });
      await refresh();
    } catch (e) {
      setMsg(`clock format failed: ${(e as Error).message}`);
    } finally {
      setClockBusy(false);
    }
  }

  async function run(action: 'install' | 'uninstall') {
    setBusy(true);
    setMsg(null);
    try {
      const out = await postApi(`/api/hooks/${action}`);
      setMsg(out.output || `${action} complete`);
      await refresh();
    } catch (e) {
      setMsg(`failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Claude Code integration and daemon configuration." />

      <ClaudeAccounts />

      <Card className="mb-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Device</div>
        <div className="flex items-center justify-between gap-4 py-2">
          <div>
            <div className="text-sm text-fg">Clock format</div>
            <p className="mt-1 text-xs text-muted">
              {clockFormat === 'auto'
                ? `Auto follows this Mac's locale (currently ${clock24 ? '24-hour' : '12-hour'}).`
                : `The device shows ${clock24 ? '14:05' : '2:05 PM'}, whatever this Mac's locale says.`}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {CLOCK_CHOICES.map((c) => (
              <Button key={c.value}
                variant={c.value === clockFormat ? 'default' : 'outline'}
                disabled={clockBusy || !status}
                onClick={() => setClockFormat(c.value)}>{c.label}</Button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">
          The Car Thing has no clock of its own — the daemon stamps every snapshot with this Mac's time,
          timezone and clock format, so a change here lands on the device within a frame.
        </p>
      </Card>

      <Card className="mb-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Claude Code hooks</div>
        <StatusRow label="Hook status" value={status?.hooks ? 'installed' : 'not installed'}
          tone={status?.hooks ? 'ok' : 'warn'}
          hint="PermissionRequest, SessionStart/End, PreToolUse, PostToolUse, Stop, UserPromptSubmit" />
        <div className="mt-4 flex gap-2">
          <Button onClick={() => run('install')} disabled={busy}>Install hooks</Button>
          <Button variant="danger" onClick={() => run('uninstall')} disabled={busy}>Remove hooks</Button>
        </div>
        {msg && <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-hover p-3 font-mono text-xs text-secondary">{msg}</pre>}
        <p className="mt-3 text-xs text-muted">
          A backup of ~/.claude/settings.json is written on every change. Hooks only affect Claude Code sessions
          started afterwards, and a missing daemon never blocks Claude Code — prompts fall back to the terminal.
        </p>
      </Card>

      <Card>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Daemon</div>
        <StatusRow label="Version" value={status ? `v${status.daemonVersion}` : '—'} tone={status ? 'ok' : 'off'} />
        <StatusRow label="Port" value="127.0.0.1:8790" tone="ok" hint="loopback only" />
        <StatusRow label="Permission hold" value="55s" tone="ok"
          hint="after this the terminal prompt takes over — the device never auto-denies" />
        <StatusRow label="Session cap on device" value="8 sessions" tone="ok"
          hint="keeps a snapshot under the Bluetooth chunk budget" />
      </Card>
    </div>
  );
}

// Which Claude accounts the usage screen measures. An account is a
// CLAUDE_CONFIG_DIR, or the absence of one — those are different things, and the
// blank field below means the absence, not ~/.claude.
function ClaudeAccounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  async function load() {
    try {
      const out = await getApi('/api/usage/accounts');
      setAccounts(out.accounts);
      setDirty(false);
    } catch (e) {
      setMsg(`could not read accounts: ${(e as Error).message}`);
    }
  }

  useEffect(() => { load(); }, []);

  function edit(i: number, patch: Partial<Account>) {
    setAccounts((prev) => prev && prev.map((a, n) => (n === i ? { ...a, ...patch } : a)));
    setDirty(true);
    setMsg(null);
  }

  async function save() {
    if (!accounts) return;
    setBusy(true);
    setMsg(null);
    try {
      const out = await postApi('/api/usage/accounts', {
        accounts: accounts.map(({ id, label, configDir, enabled }) => ({ id, label, configDir, enabled })),
      });
      setAccounts(out.accounts);
      setDirty(false);
      setMsg('saved — the next reading uses these');
    } catch (e) {
      setMsg(`not saved: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function redetect() {
    setBusy(true);
    setMsg(null);
    try {
      const out = await postApi('/api/usage/accounts/redetect');
      setAccounts(out.accounts);
      setDirty(false);
      setMsg('rescanned — labels and disabled accounts were left alone');
    } catch (e) {
      setMsg(`rescan failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const enabled = (accounts || []).filter((a) => a.enabled).length;

  return (
    <Card className="mb-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Claude accounts</div>
      <p className="mb-4 text-xs text-muted">
        One usage column per account on the device. An account is a CLAUDE_CONFIG_DIR — leave it blank for the
        machine default, which is not the same thing as <code className="font-mono">~/.claude</code>. Detected once
        on first run; edits here stick.
      </p>

      {!accounts && <div className="text-sm text-muted">reading…</div>}

      {accounts && accounts.map((a, i) => (
        <div key={a.id} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
          <input
            className="w-28 rounded-lg border border-line bg-hover px-2 py-1 font-mono text-sm uppercase text-fg"
            value={a.label}
            maxLength={12}
            onChange={(e) => edit(i, { label: e.target.value.toUpperCase().slice(0, 12) })}
            aria-label={`label for ${a.id}`}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs text-secondary">
              {a.configDir || 'default — no CLAUDE_CONFIG_DIR'}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              id <span className="font-mono">{a.id}</span>
              {a.missing && <span className="text-warn"> · config dir not found, so it is not polled</span>}
              {!a.missing && a.failKind && (
                <span className="text-warn">
                  {' '}· last poll failed ({a.failKind})
                  {a.nextPollMs && a.nextPollMs > 60_000
                    ? `, backed off to every ${Math.round(a.nextPollMs / 60_000)} min`
                    : ''}
                </span>
              )}
            </div>
          </div>
          <Button
            variant={a.enabled ? 'outline' : 'default'}
            onClick={() => edit(i, { enabled: !a.enabled })}
          >
            {a.enabled ? 'on' : 'off'}
          </Button>
        </div>
      ))}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={busy || !dirty || !accounts || enabled === 0}>Save</Button>
        <Button variant="outline" onClick={redetect} disabled={busy}>Re-detect</Button>
        {dirty && enabled === 0 && (
          <span className="text-xs text-warn">at least one account has to stay on</span>
        )}
      </div>

      {msg && <p className="mt-3 font-mono text-xs text-secondary">{msg}</p>}
    </Card>
  );
}

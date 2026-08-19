import { useState } from 'react';
import { Button, Card, PageHeader, StatusRow } from '../components/ui';
import { useStatus, type ClockFormat } from '../hooks';
import { postApi } from '../ws';

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

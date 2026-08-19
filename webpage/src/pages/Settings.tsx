import { useEffect, useState } from 'react';
import { Button, Card, PageHeader, StatusRow } from '../components/ui';
import { useStatus, type ClockFormat, type Language } from '../hooks';
import { useT, type Translate } from '../i18n';
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

const CLOCK_CHOICES: { value: ClockFormat; key: 'set.clock.auto' | 'set.clock.12' | 'set.clock.24' }[] = [
  { value: 'auto', key: 'set.clock.auto' },
  { value: '12', key: 'set.clock.12' },
  { value: '24', key: 'set.clock.24' },
];

// Every language names itself in itself — a French speaker looking for their
// language finds "Français", not "French".
const LANG_CHOICES: { value: Language; key: 'set.lang.auto' | 'set.lang.en' | 'set.lang.fr' }[] = [
  { value: 'auto', key: 'set.lang.auto' },
  { value: 'en', key: 'set.lang.en' },
  { value: 'fr', key: 'set.lang.fr' },
];

export function Settings() {
  const { status, refresh } = useStatus([]);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [clockBusy, setClockBusy] = useState(false);
  const [langBusy, setLangBusy] = useState(false);

  const clockFormat = status?.settings?.clockFormat ?? 'auto';
  const clock24 = status?.settings?.clock24 ?? false;
  const language = status?.settings?.language ?? 'auto';
  const lang = status?.settings?.lang ?? 'en';

  async function setClockFormat(value: ClockFormat) {
    if (value === clockFormat) return;
    setClockBusy(true);
    try {
      await postApi('/api/settings', { clockFormat: value });
      await refresh();
    } catch (e) {
      setMsg(t('set.clockFailed', { error: (e as Error).message }));
    } finally {
      setClockBusy(false);
    }
  }

  // The daemon pushes a fresh snapshot on the same request, so the device flips
  // in a frame; this page waits for its own /status poll to come back.
  async function setLanguage(value: Language) {
    if (value === language) return;
    setLangBusy(true);
    try {
      await postApi('/api/settings', { language: value });
      await refresh();
    } catch (e) {
      setMsg(t('set.langFailed', { error: (e as Error).message }));
    } finally {
      setLangBusy(false);
    }
  }

  async function run(action: 'install' | 'uninstall') {
    setBusy(true);
    setMsg(null);
    try {
      const out = await postApi(`/api/hooks/${action}`);
      setMsg(out.output || t('set.actionComplete', { action }));
      await refresh();
    } catch (e) {
      setMsg(t('set.actionFailed', { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  const langName = t(lang === 'fr' ? 'set.lang.fr' : 'set.lang.en');

  return (
    <div>
      <PageHeader title={t('set.title')} subtitle={t('set.subtitle')} />

      <ClaudeAccounts t={t} />

      <Card className="mb-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{t('set.section.device')}</div>

        <div className="flex items-center justify-between gap-4 py-2">
          <div>
            <div className="text-sm text-fg">{t('set.clockFormat')}</div>
            <p className="mt-1 text-xs text-muted">
              {clockFormat === 'auto'
                ? t('set.clockAutoNote', { now: t(clock24 ? 'set.clock.24' : 'set.clock.12') })
                : t('set.clockFixedNote', { sample: clock24 ? '14:05' : '2:05 PM' })}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {CLOCK_CHOICES.map((c) => (
              <Button key={c.value}
                variant={c.value === clockFormat ? 'default' : 'outline'}
                disabled={clockBusy || !status}
                onClick={() => setClockFormat(c.value)}>{t(c.key)}</Button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">{t('set.clockFoot')}</p>

        <div className="mt-4 flex items-center justify-between gap-4 border-t border-line py-2 pt-4">
          <div>
            <div className="text-sm text-fg">{t('set.language')}</div>
            <p className="mt-1 text-xs text-muted">
              {language === 'auto'
                ? t('set.langAutoNote', { now: langName })
                : t('set.langFixedNote', { now: langName })}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {LANG_CHOICES.map((c) => (
              <Button key={c.value}
                variant={c.value === language ? 'default' : 'outline'}
                disabled={langBusy || !status}
                onClick={() => setLanguage(c.value)}>{t(c.key)}</Button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">{t('set.langFoot')}</p>
      </Card>

      <Card className="mb-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{t('set.section.hooks')}</div>
        <StatusRow label={t('set.hookStatus')} value={t(status?.hooks ? 'set.hooksInstalled' : 'set.hooksNotInstalled')}
          tone={status?.hooks ? 'ok' : 'warn'}
          hint={t('set.hooksHint')} />
        <div className="mt-4 flex gap-2">
          <Button onClick={() => run('install')} disabled={busy}>{t('set.installHooks')}</Button>
          <Button variant="danger" onClick={() => run('uninstall')} disabled={busy}>{t('set.removeHooks')}</Button>
        </div>
        {msg && <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-hover p-3 font-mono text-xs text-secondary">{msg}</pre>}
        <p className="mt-3 text-xs text-muted">{t('set.hooksFoot')}</p>
      </Card>

      <Card>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{t('set.section.daemon')}</div>
        <StatusRow label={t('set.version')} value={status ? `v${status.daemonVersion}` : '—'} tone={status ? 'ok' : 'off'} />
        <StatusRow label={t('set.port')} value="127.0.0.1:8790" tone="ok" hint={t('set.portHint')} />
        <StatusRow label={t('set.hold')} value="55s" tone="ok"
          hint={t('set.holdHint')} />
        <StatusRow label={t('set.sessionCap')} value={t('set.sessionCapValue')} tone="ok"
          hint={t('set.sessionCapHint')} />
      </Card>
    </div>
  );
}

// Which Claude accounts the usage screen measures. An account is a
// CLAUDE_CONFIG_DIR, or the absence of one — those are different things, and the
// blank field below means the absence, not ~/.claude.
function ClaudeAccounts({ t }: { t: Translate }) {
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
      setMsg(t('set.accountsReadFailed', { error: (e as Error).message }));
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
      setMsg(t('set.saved'));
    } catch (e) {
      setMsg(t('set.notSaved', { error: (e as Error).message }));
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
      setMsg(t('set.rescanned'));
    } catch (e) {
      setMsg(t('set.rescanFailed', { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  const enabled = (accounts || []).filter((a) => a.enabled).length;

  return (
    <Card className="mb-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{t('set.section.accounts')}</div>
      <p className="mb-4 text-xs text-muted">
        {t('set.accountsIntro.before')}<code className="font-mono">~/.claude</code>{t('set.accountsIntro.after')}
      </p>

      {!accounts && <div className="text-sm text-muted">{t('set.accountsReading')}</div>}

      {accounts && accounts.map((a, i) => (
        <div key={a.id} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
          <input
            className="w-28 rounded-lg border border-line bg-hover px-2 py-1 font-mono text-sm uppercase text-fg"
            value={a.label}
            maxLength={12}
            onChange={(e) => edit(i, { label: e.target.value.toUpperCase().slice(0, 12) })}
            aria-label={t('set.accountLabelFor', { id: a.id })}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs text-secondary">
              {a.configDir || t('set.accountDefault')}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              {t('set.accountId')} <span className="font-mono">{a.id}</span>
              {a.missing && <span className="text-warn">{t('set.accountMissing')}</span>}
              {!a.missing && a.failKind && (
                <span className="text-warn">
                  {t('set.accountFailed', { kind: a.failKind })}
                  {a.nextPollMs && a.nextPollMs > 60_000
                    ? t('set.accountBackoff', { min: Math.round(a.nextPollMs / 60_000) })
                    : ''}
                </span>
              )}
            </div>
          </div>
          <Button
            variant={a.enabled ? 'outline' : 'default'}
            onClick={() => edit(i, { enabled: !a.enabled })}
          >
            {t(a.enabled ? 'set.on' : 'set.off')}
          </Button>
        </div>
      ))}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={busy || !dirty || !accounts || enabled === 0}>{t('set.save')}</Button>
        <Button variant="outline" onClick={redetect} disabled={busy}>{t('set.redetect')}</Button>
        {dirty && enabled === 0 && (
          <span className="text-xs text-warn">{t('set.oneMustStayOn')}</span>
        )}
      </div>

      {msg && <p className="mt-3 font-mono text-xs text-secondary">{msg}</p>}
    </Card>
  );
}

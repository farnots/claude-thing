import { RefreshCw } from 'lucide-react';
import { Button, Card, PageHeader, Stat, StatusRow } from '../components/ui';
import { useDaemonLink, useLastPermission, useStatus } from '../hooks';
import { useT } from '../i18n';

const TOPICS = ['bridge.clients', 'bridge.connector', 'claude.permission.request', 'claude.permission.resolved'];

export function Dashboard() {
  const { status, error, refresh } = useStatus(TOPICS);
  const linked = useDaemonLink();
  const lastPerm = useLastPermission();
  const t = useT();

  const connectorOnline = (status?.clients?.connector ?? 0) > 0;
  const deviceOnline = (status?.clients?.emulator ?? 0) > 0 || connectorOnline;
  const bt = status?.connector?.bt;

  return (
    <div>
      <PageHeader
        title={t('dash.title')}
        subtitle={t('dash.subtitle')}
        action={<Button variant="outline" onClick={refresh}><RefreshCw className="size-3.5" />{t('dash.refresh')}</Button>}
      />

      {error && (
        <Card className="mb-4 border-destructive/40">
          <div className="text-sm text-destructive">{t('dash.unreachable', { error })}</div>
          <div className="mt-1 text-xs text-muted">
            {t('dash.startIt.before')}<span className="font-mono">npm start</span>{t('dash.startIt.after')}
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <div className="grid grid-cols-3 gap-6">
          <Stat k={t('dash.stat.sessions')} v={status?.sessions ?? '—'} />
          <Stat k={t('dash.stat.pending')} v={status?.pendingPermissions ?? '—'} />
          <Stat k={t('dash.stat.daemon')} v={status ? `v${status.daemonVersion}` : '—'} />
        </div>
      </Card>

      <Card className="mb-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{t('dash.section.backend')}</div>
        <StatusRow label={t('dash.daemon')} value={t(status ? 'dash.running' : 'dash.offline')} tone={status ? 'ok' : 'bad'}
          hint={t('dash.daemonHint')} />
        <StatusRow label={t('dash.eventStream')} value={t(linked ? 'dash.connected' : 'dash.reconnecting')} tone={linked ? 'ok' : 'warn'}
          hint={t('dash.eventStreamHint')} />
        <StatusRow label={t('dash.hooks')} value={t(status?.hooks ? 'dash.installed' : 'dash.notInstalled')}
          tone={status?.hooks ? 'ok' : 'warn'} hint={t('dash.hooksHint')} />
        <StatusRow label={t('dash.sources')} value={status?.sources?.join(', ') || '—'} tone={status ? 'ok' : 'off'} />
      </Card>

      <Card className="mb-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{t('dash.section.link')}</div>
        <StatusRow label={t('dash.connector')} value={t(connectorOnline ? 'dash.relaying' : 'dash.notConnected')}
          tone={connectorOnline ? 'ok' : 'off'} hint={t('dash.connectorHint')} />
        <StatusRow label={t('dash.emulator')} value={t((status?.clients?.emulator ?? 0) > 0 ? 'dash.attached' : 'dash.notRunning')}
          tone={(status?.clients?.emulator ?? 0) > 0 ? 'ok' : 'off'} hint={t('dash.emulatorHint')} />
        <StatusRow label={t('dash.reachable')} value={t(deviceOnline ? 'dash.yes' : 'dash.no')} tone={deviceOnline ? 'ok' : 'bad'} />
        {bt && (
          <StatusRow label={t('dash.btDevice')} value={bt.device || bt.address || t('dash.unknown')}
            tone={bt.connected ? 'ok' : 'warn'} hint={bt.firmware ? t('dash.firmware', { v: bt.firmware }) : undefined} />
        )}
      </Card>

      <Card>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{t('dash.section.lastPerm')}</div>
        {lastPerm ? (
          <div>
            <div className="font-mono text-sm text-fg">{lastPerm.tool}: {lastPerm.summary}</div>
            <div className="mt-1 text-xs text-muted">
              {lastPerm.resolution ? t('dash.resolved', { r: lastPerm.resolution }) : t('dash.waitingAnswer')}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted">{t('dash.nothingYet')}</div>
        )}
      </Card>
    </div>
  );
}

import { Bluetooth as BtIcon } from 'lucide-react';
import { Card, PageHeader, StatusRow } from '../components/ui';
import { useStatus } from '../hooks';
import { useT } from '../i18n';

const TOPICS = ['bridge.connector', 'bridge.clients'];

export function Bluetooth() {
  const { status } = useStatus(TOPICS);
  const t = useT();
  const connector = status?.connector;
  const bt = connector?.bt;
  const relaying = (status?.clients?.connector ?? 0) > 0;

  return (
    <div>
      <PageHeader title={t('bt.title')} subtitle={t('bt.subtitle')} />

      <Card className="mb-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{t('bt.section.link')}</div>
        <StatusRow label={t('bt.relay')} value={t(relaying ? 'bt.relayConnected' : 'bt.notConnected')}
          tone={relaying ? 'ok' : 'off'}
          hint={t('bt.relayHint')} />
        <StatusRow label={t('bt.session')} value={t(bt?.connected ? 'bt.connected' : bt ? 'bt.idle' : 'bt.unknown')}
          tone={bt?.connected ? 'ok' : bt ? 'warn' : 'off'}
          hint={t('bt.sessionHint')} />
        <StatusRow label={t('bt.device')} value={bt?.device || '—'} tone={bt?.device ? 'ok' : 'off'} />
        <StatusRow label={t('bt.address')} value={bt?.address || '—'} tone={bt?.address ? 'ok' : 'off'} />
        <StatusRow label={t('bt.serial')} value={bt?.serial || '—'} tone={bt?.serial ? 'ok' : 'off'} />
        <StatusRow label={t('bt.firmware')} value={bt?.firmware || '—'} tone={bt?.firmware ? 'ok' : 'off'} />
        <StatusRow label={t('bt.heartbeat')} value={connector?.updatedTs ? new Date(connector.updatedTs).toLocaleTimeString() : '—'}
          tone={connector?.updatedTs ? 'ok' : 'off'} hint={t('bt.heartbeatHint')} />
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg">
          <BtIcon className="size-4" /> {t('bt.troubleTitle')}
        </div>
        <ol className="space-y-2 text-sm text-secondary">
          <li>{t('bt.step1')}</li>
          <li>{t('bt.step2')}</li>
          <li>{t('bt.step3')}</li>
          <li>{t('bt.step4')}</li>
        </ol>
      </Card>
    </div>
  );
}

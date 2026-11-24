/**
 * C2 session info: identity, system environment, network and beacon, timeline and notes.
 */
import { Button, Space, Typography } from '@douyinfe/semi-ui';
import { useT } from '../../lib/i18n';
import { JsonViewer, KeyValueList, SectionCard } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

const { Text } = Typography;

export default function SessionInfo({ session, canWrite, onEditNote }) {
    const t = useT();

    const identity = [
        { label: t('c2.sessions.infoSessionId', null, 'Session ID'), value: <Text copyable={{ text: session.id }} className="c2-mono">{session.id}</Text> },
        { label: t('c2.sessions.infoImplantUuid', null, 'Implant UUID'), value: <Text className="c2-mono">{session.implantUuid || '—'}</Text> },
        { label: t('c2.sessions.infoHostname', null, 'Hostname'), value: session.hostname || '—' },
        { label: t('c2.sessions.infoUsername', null, 'Username'), value: session.username || '—' },
        { label: t('c2.sessions.infoProcess', null, 'Process'), value: session.processName || '—' },
        { label: t('c2.sessions.infoPid', null, 'PID'), value: session.pid || '—' }
    ];

    const system = [
        { label: t('c2.sessions.infoOs', null, 'OS'), value: session.os || '—' },
        { label: t('c2.sessions.infoArch', null, 'Arch'), value: session.arch || '—' },
        { label: t('c2.sessions.infoAdmin', null, 'Admin'), value: session.isAdmin ? t('c2.sessions.adminYes', null, 'Yes') : t('c2.sessions.adminNo', null, 'No') },
        { label: t('c2.sessions.infoInternalIp', null, 'Internal IP'), value: <span className="c2-mono">{session.internalIp || '—'}</span> },
        { label: t('c2.sessions.ip', null, 'IP Address'), value: <span className="c2-mono">{session.externalIp || '—'}</span> },
        { label: t('c2.sessions.infoSleep', null, 'Sleep'), value: `${session.sleepSeconds || 0}s ± ${session.jitterPercent || 0}%` }
    ];

    const timeline = [
        { label: t('c2.sessions.infoFirstSeen', null, 'First seen'), value: formatDateTime(session.firstSeenAt) },
        { label: t('c2.sessions.infoLastCheckin', null, 'Last check-in'), value: formatDateTime(session.lastCheckIn) },
        { label: t('c2.sessions.status', null, 'Status'), value: session.status || '—' },
        { label: t('c2.sessions.listener', null, 'Listener'), value: <span className="c2-mono">{session.listenerId || '—'}</span> }
    ];

    return (
        <div className="c2-session-info">
            <SectionCard title={t('c2.sessions.infoSectionIdentity', null, 'Identity')}>
                <KeyValueList items={identity} columns={2} />
            </SectionCard>
            <SectionCard title={t('c2.sessions.infoSectionSystem', null, 'System')}>
                <KeyValueList items={system} columns={2} />
            </SectionCard>
            <SectionCard title={t('c2.sessions.infoSectionNetwork', null, 'Network & beacon')}>
                <KeyValueList items={timeline} columns={2} />
            </SectionCard>
            <SectionCard
                title={t('c2.sessions.infoSectionNote', null, 'Notes')}
                extra={(
                    <Space>
                        <Button size="small" disabled={!canWrite} onClick={onEditNote}>{t('c2.sessions.noteEdit', null, 'Edit')}</Button>
                    </Space>
                )}
            >
                <Text type={session.note ? undefined : 'tertiary'}>{session.note || t('c2.sessions.infoNoteEmpty', null, 'No notes')}</Text>
            </SectionCard>
            {session.metadata && Object.keys(session.metadata).length > 0 && (
                <SectionCard title={t('c2.sessions.infoMetadata', null, 'Raw metadata')}>
                    <JsonViewer value={session.metadata} collapsed />
                </SectionCard>
            )}
        </div>
    );
}

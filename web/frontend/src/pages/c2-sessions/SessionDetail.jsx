/**
 * C2 session workspace: header metadata + four tabs: terminal/files/tasks/info.
 */
import { useState } from 'react';
import { Button, Input, Space, Tabs, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import { Drawer, ErrorBanner, confirmAction, toastError, toastSuccess, toastWarning } from '../../components/ui';
import * as c2 from './components/c2-api';
import { SESSION_STATUS_COLOR } from './components/c2-shared';
import SessionTerminal from './SessionTerminal';
import SessionFiles from './SessionFiles';
import SessionTasks from './SessionTasks';
import SessionInfo from './SessionInfo';

const { Text } = Typography;

export default function SessionDetail({ session, canWrite, canDelete, onChanged, onDeleted }) {
    const t = useT();
    const [tab, setTab] = useState('terminal');
    const [sleepModal, setSleepModal] = useState(null);
    const [noteModal, setNoteModal] = useState(null);
    const [saving, setSaving] = useState(false);
    const { data, loading, error, reload } = useResource(() => c2.getSession(session.id), [session.id]);
    const detail = data?.session || session;

    const openSleep = () => setSleepModal({
        sleepSeconds: String(detail.sleepSeconds || 5),
        jitterPercent: String(detail.jitterPercent || 0)
    });
    const openNote = () => setNoteModal({ note: detail.note || '' });

    const saveSleep = async () => {
        const sleepSeconds = Number(sleepModal.sleepSeconds);
        const jitterPercent = Number(sleepModal.jitterPercent);
        if (!Number.isFinite(sleepSeconds) || sleepSeconds < 1) {
            toastWarning(t('c2.sessions.toastSleepInvalid', null, 'Sleep interval must be at least 1 second'));
            return;
        }
        if (!Number.isFinite(jitterPercent) || jitterPercent < 0 || jitterPercent > 100) {
            toastWarning(t('c2.sessions.toastSleepInvalid', null, 'Sleep interval must be at least 1 second'));
            return;
        }
        setSaving(true);
        try {
            await c2.setSessionSleep(detail.id, { sleepSeconds, jitterPercent });
            toastSuccess(t('c2.sessions.toastSleepUpdated', null, 'Sleep settings updated'));
            setSleepModal(null);
            reload({ silent: true });
            onChanged?.();
        } catch (err) {
            toastError(err);
        } finally {
            setSaving(false);
        }
    };

    const saveNote = async () => {
        const note = String(noteModal.note || '').trim();
        if (note.length > 2000) {
            toastWarning(t('c2.sessions.toastNoteTooLong', null, 'Note must be at most 2000 characters'));
            return;
        }
        setSaving(true);
        try {
            await c2.setSessionNote(detail.id, note);
            toastSuccess(t('c2.sessions.toastNoteSaved', null, 'Note saved'));
            setNoteModal(null);
            reload({ silent: true });
            onChanged?.();
        } catch (err) {
            toastError(err);
        } finally {
            setSaving(false);
        }
    };

    const remove = () => {
        confirmAction({
            title: t('c2.sessions.cardDeleteSession', null, 'Delete'),
            content: t('c2.sessions.confirmDeleteSession', null, 'Remove this session and related tasks/files from the server? (Does not send exit to the implant; use Kill Session to exit the agent.)'),
            onOk: async () => {
                try {
                    await c2.deleteSession(detail.id);
                    toastSuccess(t('c2.sessions.toastSessionDeleted', null, 'Session record deleted'));
                    onDeleted?.();
                } catch (err) {
                    toastError(err);
                }
            }
        });
    };

    const items = [
        { tab: t('c2.sessions.terminal', null, 'Terminal'), itemKey: 'terminal', children: <SessionTerminal session={detail} canWrite={canWrite} onTaskCreated={reload} /> },
        { tab: t('c2.sessions.files', null, 'Files'), itemKey: 'files', children: <SessionFiles session={detail} canWrite={canWrite} /> },
        { tab: t('c2.sessions.tasks', null, 'Tasks'), itemKey: 'tasks', children: <SessionTasks session={detail} canDelete={canDelete} onChanged={reload} /> },
        { tab: t('c2.sessions.info', null, 'Info'), itemKey: 'info', children: <SessionInfo session={detail} canWrite={canWrite} onEditNote={openNote} /> }
    ];

    return (
        <div className="c2-session-detail">
            <div className="c2-session-head">
                <div className="c2-session-title">
                    <Text strong className="c2-session-hostname">{detail.hostname || t('c2.sessions.unknownHost', null, 'unknown')}</Text>
                    <Space spacing={6} wrap>
                        <Tag size="small" color={SESSION_STATUS_COLOR[detail.status] || 'grey'}>
                            {t(`c2.sessions.${detail.status || 'active'}`, null, detail.status || '—')}
                        </Tag>
                        <Tag size="small">{detail.os || '—'}/{detail.arch || '—'}</Tag>
                        {detail.isAdmin && <Tag size="small" color="red">{t('c2.sessions.rootBadge', null, 'ROOT')}</Tag>}
                        <Text type="tertiary" size="small">{detail.username || '—'}@{detail.internalIp || detail.externalIp || '—'}</Text>
                        <Text type="tertiary" size="small">sleep {detail.sleepSeconds || 0}s ± {detail.jitterPercent || 0}%</Text>
                    </Space>
                </div>
                <Space spacing={6} wrap>
                    <Button size="small" icon={<IconRefresh />} loading={loading} onClick={() => reload()}>{t('common.refresh', null, 'Refresh')}</Button>
                    <Button size="small" disabled={!canWrite} onClick={openSleep}>{t('c2.sessions.btnSleep', null, 'Sleep')}</Button>
                    <Button size="small" disabled={!canWrite} onClick={openNote}>{t('c2.sessions.noteEdit', null, 'Edit')}</Button>
                    <Button size="small" type="danger" disabled={!canDelete} onClick={remove}>{t('c2.sessions.cardDeleteSession', null, 'Delete')}</Button>
                </Space>
            </div>

            <ErrorBanner error={error} onRetry={reload} />

            <Tabs type="button" activeKey={tab} onChange={setTab} items={items} />

            <Drawer
                visible={Boolean(sleepModal)}
                title={t('c2.sessions.sleepModalTitle', null, 'Beacon interval')}
                width={440}
                onCancel={() => setSleepModal(null)}
                onOk={saveSleep}
                confirmLoading={saving}
            >
                <Text type="tertiary" size="small">{t('c2.sessions.sleepModalHint', null, 'Saves to the server and queues a sleep task. The implant applies it on the next task poll; later check-ins keep this config.')}</Text>
                <div className="c2-session-modal-field">
                    <Text size="small">{t('c2.sessions.promptSleepSeconds', null, 'Sleep interval (seconds)')}</Text>
                    <Input
                        value={sleepModal?.sleepSeconds || ''}
                        onChange={value => setSleepModal(current => ({ ...current, sleepSeconds: value }))}
                    />
                </div>
                <div className="c2-session-modal-field">
                    <Text size="small">{t('c2.sessions.promptJitterPercent', null, 'Jitter percent (0–100)')}</Text>
                    <Input
                        value={sleepModal?.jitterPercent || ''}
                        onChange={value => setSleepModal(current => ({ ...current, jitterPercent: value }))}
                    />
                </div>
            </Drawer>

            <Drawer
                visible={Boolean(noteModal)}
                title={t('c2.sessions.infoNote', null, 'Note')}
                width={480}
                onCancel={() => setNoteModal(null)}
                onOk={saveNote}
                confirmLoading={saving}
            >
                <TextArea
                    value={noteModal?.note || ''}
                    onChange={value => setNoteModal(current => ({ ...current, note: value }))}
                    placeholder={t('c2.sessions.notePlaceholder', null, 'Add a note to identify this session…')}
                    autosize={{ minRows: 4, maxRows: 10 }}
                />
            </Drawer>
        </div>
    );
}

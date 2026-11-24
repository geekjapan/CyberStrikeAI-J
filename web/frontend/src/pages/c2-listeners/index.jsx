/**
 * C2 listener management: list, create/edit, start/stop and delete.
 */
import { useMemo, useState } from 'react';
import { Button, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh } from '@douyinfe/semi-icons';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import {
    Drawer, PageHeader, SectionCard, StatGrid, DataTable, ErrorBanner, CopyButton,
    confirmAction, toastError, toastSuccess
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import * as c2 from '../c2-sessions/components/c2-api';
import { LISTENER_STATUS_COLOR, LISTENER_STATUS_LABEL, LISTENER_TYPES } from '../c2-sessions/components/c2-shared';
import ListenerForm from './ListenerForm';
import './page.css';

const { Text } = Typography;

const typeLabel = value => (LISTENER_TYPES.find(item => item.value === value)?.label || value || '—');

export default function C2ListenersPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('c2:write');
    const canDelete = hasPermission('c2:delete') || canWrite;

    const [form, setForm] = useState({ visible: false, record: null });
    const [submitting, setSubmitting] = useState(false);
    const [busyId, setBusyId] = useState('');
    const [tokenInfo, setTokenInfo] = useState(null);

    const { data, loading, error, reload } = useResource(
        () => Promise.all([c2.listListeners(), c2.listProfiles().catch(() => ({ profiles: [] })), c2.listProjects()]),
        []
    );
    const listeners = Array.isArray(data?.[0]?.listeners) ? data[0].listeners : [];
    const profiles = Array.isArray(data?.[1]?.profiles) ? data[1].profiles : [];
    const projects = Array.isArray(data?.[2]) ? data[2] : [];

    const metrics = useMemo(() => {
        const running = listeners.filter(item => item.status === 'running').length;
        const failed = listeners.filter(item => item.status === 'error').length;
        return [
            { id: 'total', label: t('c2.listeners.statTotal', null, 'Total listeners'), value: listeners.length },
            { id: 'running', label: t('c2.listeners.running', null, 'Running'), value: running, tone: running ? 'success' : undefined },
            { id: 'stopped', label: t('c2.listeners.stopped', null, 'Stopped'), value: listeners.length - running - failed },
            { id: 'error', label: t('c2.listeners.statusError', null, 'Error'), value: failed, tone: failed ? 'danger' : undefined }
        ];
    }, [listeners, t]);

    const toggle = async (record, action) => {
        setBusyId(record.id);
        try {
            if (action === 'start') {
                await c2.startListener(record.id);
                toastSuccess(t('c2.listeners.toastStarted', null, 'Listener started'));
            } else {
                await c2.stopListener(record.id);
                toastSuccess(t('c2.listeners.toastStopped', null, 'Listener stopped'));
            }
            reload();
        } catch (err) {
            toastError(err, action === 'start' ? t('c2.listeners.start', null, 'Start') : t('c2.listeners.stop', null, 'Stop'));
        } finally {
            setBusyId('');
        }
    };

    const remove = record => {
        confirmAction({
            title: t('c2.listeners.delete', null, 'Delete'),
            content: t('c2.listeners.confirmDelete', null, 'Delete this listener? All related sessions and tasks will be removed.'),
            onOk: async () => {
                try {
                    await c2.deleteListener(record.id);
                    toastSuccess(t('c2.listeners.toastDeleted', null, 'Listener deleted'));
                    reload();
                } catch (err) {
                    toastError(err);
                }
            }
        });
    };

    const submit = async values => {
        setSubmitting(true);
        try {
            if (form.record?.id) {
                await c2.updateListener(form.record.id, values);
                toastSuccess(t('c2.listeners.toastUpdated', null, 'Listener updated'));
            } else {
                const payload = await c2.createListener(values);
                toastSuccess(t('c2.listeners.toastCreated', null, 'Listener created'));
                if (payload?.implant_token) {
                    setTokenInfo({ name: payload.listener?.name || values.name, token: payload.implant_token });
                }
            }
            setForm({ visible: false, record: null });
            reload();
        } catch (err) {
            toastError(err, t('c2.listeners.saveFailed', null, 'Failed to save listener'));
        } finally {
            setSubmitting(false);
        }
    };

    const columns = [
        {
            title: t('c2.listeners.name', null, 'Name'),
            dataIndex: 'name',
            render: (name, record) => (
                <div className="c2-listener-name">
                    <Text strong>{name || record.id}</Text>
                    {record.remark && <Text type="tertiary" size="small">{record.remark}</Text>}
                </div>
            )
        },
        { title: t('c2.listeners.type', null, 'Type'), dataIndex: 'type', width: 140, render: typeLabel },
        {
            title: t('c2.listeners.bindEndpoint', null, 'Listen address'),
            dataIndex: 'bindPort',
            width: 200,
            render: (port, record) => <span className="c2-mono">{record.bindHost}:{port}</span>
        },
        {
            title: t('c2.listeners.callbackShort', null, 'Callback'),
            dataIndex: 'configJson',
            width: 160,
            render: value => {
                try {
                    const config = JSON.parse(value || '{}');
                    return config.callback_host ? <span className="c2-mono">{config.callback_host}</span> : <Text type="tertiary">—</Text>;
                } catch (error) {
                    return <Text type="tertiary">—</Text>;
                }
            }
        },
        {
            title: t('c2.listeners.status', null, 'Status'),
            dataIndex: 'status',
            width: 120,
            render: (status, record) => (
                <div className="c2-listener-status">
                    <Tag size="small" color={LISTENER_STATUS_COLOR[status] || 'grey'}>
                        {LISTENER_STATUS_LABEL[status] || status || '—'}
                    </Tag>
                    {record.lastError && <Text type="danger" size="small">{record.lastError}</Text>}
                </div>
            )
        },
        {
            title: t('c2.listeners.startedAtPrefix', null, 'Started'),
            dataIndex: 'startedAt',
            width: 180,
            render: value => (value ? formatDateTime(value) : <Text type="tertiary">—</Text>)
        },
        {
            title: t('c2.listeners.actions', null, 'Actions'),
            dataIndex: 'actions',
            width: 220,
            render: (_, record) => {
                const running = record.status === 'running';
                return (
                    <Space spacing={4} wrap>
                        <Button
                            size="small"
                            theme="borderless"
                            disabled={!canWrite}
                            loading={busyId === record.id}
                            onClick={() => toggle(record, running ? 'stop' : 'start')}
                        >
                            {running ? t('c2.listeners.stop', null, 'Stop') : t('c2.listeners.start', null, 'Start')}
                        </Button>
                        <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => setForm({ visible: true, record })}>
                            {t('c2.listeners.edit', null, 'Edit')}
                        </Button>
                        <Button size="small" theme="borderless" type="danger" disabled={!canDelete} onClick={() => remove(record)}>
                            {t('c2.listeners.delete', null, 'Delete')}
                        </Button>
                    </Space>
                );
            }
        }
    ];

    return (
        <div className="c2-page" id="page-c2-listeners">
            <PageHeader
                title={t('c2.listeners.title', null, 'Listener Management')}
                description={t('c2.listeners.pageDesc', null, 'Create, start, and stop C2 listeners; state changes sync to the backend immediately')}
                extra={[
                    <Button key="refresh" icon={<IconRefresh />} onClick={reload} loading={loading}>
                        {t('common.refresh', null, 'Refresh')}
                    </Button>,
                    <Button key="create" theme="solid" type="primary" icon={<IconPlus />} disabled={!canWrite} onClick={() => setForm({ visible: true, record: null })}>
                        {t('c2.listeners.create', null, 'Create Listener')}
                    </Button>
                ]}
            />

            <StatGrid metrics={metrics} columns={4} />
            <ErrorBanner error={error} onRetry={reload} />

            <SectionCard title={t('c2.listeners.title', null, 'Listener Management')}>
                <DataTable
                    columns={columns}
                    dataSource={listeners}
                    rowKey="id"
                    loading={loading}
                    onRefresh={reload}
                    pagination={{ pageSize: 10 }}
                    emptyText={t('c2.listeners.emptyTitle', null, 'No listeners yet')}
                />
            </SectionCard>

            <ListenerForm
                visible={form.visible}
                record={form.record}
                projects={projects}
                profiles={profiles}
                submitting={submitting}
                onCancel={() => setForm({ visible: false, record: null })}
                onSubmit={submit}
            />

            <Drawer
                visible={Boolean(tokenInfo)}
                title={t('c2.listeners.implantTokenTitle', null, 'Implant token')}
                onCancel={() => setTokenInfo(null)}
                footer={<Button onClick={() => setTokenInfo(null)}>{t('c2.listeners.close', null, 'Close')}</Button>}
            >
                <Text type="tertiary">
                    {t('c2.listeners.implantTokenHint', null, 'This token is shown only once here. Save it now; to get a new one, recreate the listener.')}
                </Text>
                <div className="c2-listener-token">
                    <span className="c2-mono">{tokenInfo?.token}</span>
                    <CopyButton text={tokenInfo?.token || ''} />
                </div>
            </Drawer>
        </div>
    );
}

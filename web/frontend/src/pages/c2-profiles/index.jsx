/**
 * C2 traffic disguise (Malleable Profile): list, create, edit and delete.
 */
import { useMemo, useState } from 'react';
import { Button, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh } from '@douyinfe/semi-icons';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import {
    PageHeader, SectionCard, StatGrid, DataTable, ErrorBanner,
    confirmAction, toastError, toastSuccess, JsonViewer
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import * as c2 from '../c2-sessions/components/c2-api';
import ProfileForm from './ProfileForm';
import '../c2-sessions/components/c2-shared.css';
import './page.css';

const { Text } = Typography;

export default function C2ProfilesPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('c2:write');
    const canDelete = hasPermission('c2:delete') || canWrite;

    const [form, setForm] = useState({ visible: false, record: null });
    const [submitting, setSubmitting] = useState(false);
    const [preview, setPreview] = useState(null);

    const { data, loading, error, reload } = useResource(() => c2.listProfiles(), []);
    const profiles = Array.isArray(data?.profiles) ? data.profiles : [];

    const metrics = useMemo(() => [
        { id: 'total', label: t('c2.profiles.total', null, 'Total profiles'), value: profiles.length },
        {
            id: 'jitter',
            label: t('c2.profiles.withJitter', null, 'Jitter enabled'),
            value: profiles.filter(item => Number(item.jitterMaxMs) > 0).length
        },
        {
            id: 'uris',
            label: t('c2.profiles.withUris', null, 'Custom URIs'),
            value: profiles.filter(item => Array.isArray(item.uris) && item.uris.length > 0).length
        },
        {
            id: 'headers',
            label: t('c2.profiles.withHeaders', null, 'Custom response headers'),
            value: profiles.filter(item => item.responseHeaders && Object.keys(item.responseHeaders).length > 0).length
        }
    ], [profiles, t]);

    const submit = async values => {
        setSubmitting(true);
        try {
            if (form.record?.id) {
                await c2.updateProfile(form.record.id, values);
                toastSuccess(t('c2.profiles.toastUpdated', null, 'Profile updated'));
            } else {
                await c2.createProfile(values);
                toastSuccess(t('c2.profiles.toastCreated', null, 'Profile created'));
            }
            setForm({ visible: false, record: null });
            reload();
        } catch (err) {
            toastError(err, t('c2.profiles.saveFailed', null, 'Failed to save profile'));
        } finally {
            setSubmitting(false);
        }
    };

    const remove = record => {
        confirmAction({
            title: t('c2.profiles.delete', null, 'Delete'),
            content: t('c2.profiles.confirmDelete', null, 'Delete this profile?'),
            onOk: async () => {
                try {
                    await c2.deleteProfile(record.id);
                    toastSuccess(t('c2.profiles.toastDeleted', null, 'Profile deleted'));
                    reload();
                } catch (err) {
                    toastError(err);
                }
            }
        });
    };

    const columns = [
        {
            title: t('c2.profiles.name', null, 'Name'),
            dataIndex: 'name',
            render: (name, record) => (
                <button type="button" className="c2-profile-name" onClick={() => setPreview(record)}>
                    {name || record.id}
                </button>
            )
        },
        {
            title: t('c2.profiles.userAgent', null, 'User-Agent'),
            dataIndex: 'userAgent',
            render: value => <span className="c2-mono c2-profile-ua" title={value}>{value || '—'}</span>
        },
        {
            title: t('c2.profiles.uris', null, 'URI Paths'),
            dataIndex: 'uris',
            width: 220,
            render: value => (Array.isArray(value) && value.length
                ? <Space spacing={4} wrap>{value.slice(0, 3).map(uri => <Tag key={uri} size="small">{uri}</Tag>)}</Space>
                : <Text type="tertiary">—</Text>)
        },
        {
            title: t('c2.profiles.jitter', null, 'Jitter Range'),
            dataIndex: 'jitterMinMs',
            width: 140,
            render: (value, record) => `${value || 0} – ${record.jitterMaxMs || 0} ms`
        },
        { title: t('c2.profiles.createdAt', null, 'Created'), dataIndex: 'createdAt', width: 170, render: value => formatDateTime(value) },
        {
            title: t('c2.tasks.colActions', null, 'Actions'),
            dataIndex: 'actions',
            width: 180,
            render: (_, record) => (
                <Space spacing={4}>
                    <Button size="small" theme="borderless" onClick={() => setPreview(record)}>{t('c2.profiles.view', null, 'View')}</Button>
                    <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => setForm({ visible: true, record })}>
                        {t('c2.profiles.edit', null, 'Edit')}
                    </Button>
                    <Button size="small" theme="borderless" type="danger" disabled={!canDelete} onClick={() => remove(record)}>
                        {t('c2.profiles.delete', null, 'Delete')}
                    </Button>
                </Space>
            )
        }
    ];

    return (
        <div className="c2-page" id="page-c2-profiles">
            <PageHeader
                title={t('c2.profiles.title', null, 'Malleable Profile')}
                description={t('c2.profiles.pageDesc', null, 'Maintain UA, URI, and response-header templates for HTTP/HTTPS Beacons')}
                extra={[
                    <Button key="refresh" icon={<IconRefresh />} onClick={reload} loading={loading}>{t('common.refresh', null, 'Refresh')}</Button>,
                    <Button key="create" theme="solid" type="primary" icon={<IconPlus />} disabled={!canWrite} onClick={() => setForm({ visible: true, record: null })}>
                        {t('c2.profiles.createBtn', null, '+ Create Profile')}
                    </Button>
                ]}
            />

            <StatGrid metrics={metrics} columns={4} />
            <ErrorBanner error={error} onRetry={reload} />

            <SectionCard title={t('c2.profiles.listTitle', null, 'Profiles')}>
                <DataTable
                    columns={columns}
                    dataSource={profiles}
                    rowKey="id"
                    loading={loading}
                    onRefresh={reload}
                    pagination={{ pageSize: 10 }}
                    emptyText={t('c2.profiles.empty', null, 'No profiles yet')}
                />
            </SectionCard>

            {preview && (
                <SectionCard
                    title={`${t('c2.profiles.detailTitle', null, 'Profile details')} · ${preview.name || preview.id}`}
                    extra={<Button size="small" onClick={() => setPreview(null)}>{t('c2.profiles.close', null, 'Collapse')}</Button>}
                >
                    <JsonViewer value={preview} />
                </SectionCard>
            )}

            <ProfileForm
                visible={form.visible}
                record={form.record}
                submitting={submitting}
                onCancel={() => setForm({ visible: false, record: null })}
                onSubmit={submit}
            />
        </div>
    );
}

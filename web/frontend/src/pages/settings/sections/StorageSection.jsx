/**
 * Storage cleanup: GET /storage/status, GET /storage/meta, POST /storage/cleanup (preview/run),
 * PUT /config (storage section) saves the retention policy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Banner, Button, Input, Progress, Space, Switch, Tooltip, Typography
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { api } from '../../../lib/http';
import { useAuth } from '../../../lib/auth';
import { useT } from '../../../lib/i18n';
import { useResource } from '../../../components/hooks';
import {
    DataTable, ErrorBanner, KeyValueList, SectionCard, confirmAction, toastError, toastSuccess
} from '../../../components/ui';
import { formatBytes, formatDateTime, formatNumber } from '../../../lib/format';
import { Hint, LoadingBlock, Mono, PermissionBanner } from './common';

const { Text } = Typography;

function intOr(raw, fallback) {
    const value = parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function categoryLabel(t, item) {
    return t(`settingsStorage.cat.${item.key}`, null, item.label || item.key);
}

function categoryHint(t, item) {
    return t(`settingsStorage.catHint.${item.key}`, null, item.hint || '');
}

export default function StorageSection() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canRead = hasPermission('storage:read');
    const canClean = hasPermission('storage:write');
    const canSavePolicy = hasPermission('config:write');

    const meta = useResource(() => api.get('/storage/meta'), [canRead], { skip: !canRead });
    const status = useResource(() => api.get('/storage/status'), [canRead], { skip: !canRead });

    const [policy, setPolicy] = useState(null);
    const [busy, setBusy] = useState('');
    const [actionError, setActionError] = useState(null);
    const [report, setReport] = useState(null);

    useEffect(() => {
        if (!meta.data) return;
        const categories = {};
        for (const item of meta.data.categories || []) {
            categories[item.key] = { enabled: Boolean(item.enabled), retention_days: Number(item.retention_days) || 0 };
        }
        setPolicy({
            auto_clean: Boolean(meta.data.auto_clean),
            interval_minutes: Number(meta.data.interval_minutes) || 0,
            orphan_grace_days: Number(meta.data.orphan_grace_days) || 0,
            active_grace_hours: Number(meta.data.active_grace_hours) || 0,
            categories
        });
    }, [meta.data]);

    const refreshStatus = useCallback(async () => {
        if (!canRead) return;
        setBusy('status');
        setActionError(null);
        try {
            const fresh = await api.get('/storage/status', { refresh: 1 });
            status.setData(fresh);
        } catch (error) {
            setActionError(error);
        } finally {
            setBusy('');
        }
    }, [canRead, status.setData]);

    const savePolicy = async () => {
        if (!canSavePolicy || !policy) return;
        setBusy('policy');
        setActionError(null);
        const categories = {};
        for (const [key, value] of Object.entries(policy.categories || {})) {
            categories[key] = { enabled: Boolean(value.enabled), retention_days: intOr(value.retention_days, 0) };
        }
        const payload = {
            auto_clean: Boolean(policy.auto_clean),
            interval_minutes: intOr(policy.interval_minutes, 5),
            orphan_grace_days: intOr(policy.orphan_grace_days, 0),
            active_grace_hours: intOr(policy.active_grace_hours, 1),
            categories
        };
        try {
            await api.put('/config', { storage: payload });
            toastSuccess(t('settingsStorage.saved', null, 'Cleanup policy saved'));
            await meta.reload();
        } catch (error) {
            setActionError(error);
            toastError(error, t('settingsStorage.saveFailed', null, 'Save failed'));
        } finally {
            setBusy('');
        }
    };

    const runCleanup = async (dryRun) => {
        if (!canClean) return;
        setBusy(dryRun ? 'preview' : 'clean');
        setActionError(null);
        try {
            const payload = dryRun
                ? await api.post('/storage/cleanup', { dry_run: true })
                : await api.post('/storage/cleanup', { dry_run: false, confirm: true });
            setReport(payload);
            if (dryRun) toastSuccess(t('settingsStorage.previewTitle', null, 'Preview (nothing was deleted)'));
            else {
                toastSuccess(t('settingsStorage.cleanDone', null, 'Cleanup finished'));
                const fresh = await api.get('/storage/status', { refresh: 1 });
                status.setData(fresh);
            }
        } catch (error) {
            setActionError(error);
            toastError(error, t('settingsStorage.cleanupFailed', null, 'Cleanup request failed'));
        } finally {
            setBusy('');
        }
    };

    const totals = status.data?.totals || {};
    const filesystem = status.data?.filesystem || {};

    const overview = useMemo(() => ([
        {
            label: t('settingsStorage.diskUsed', null, 'Disk used'),
            value: filesystem.available ? formatBytes(filesystem.used_bytes) : t('settingsStorage.unavailable', null, 'Unavailable')
        },
        {
            label: t('settingsStorage.runtimeTotal', null, 'Runtime footprint'),
            value: `${formatBytes(totals.bytes)}（${formatNumber(totals.units)} ${t('settingsStorage.itemsUnit', null, 'items')}）`
        },
        {
            label: t('settingsStorage.reclaimable', null, 'Reclaimable'),
            value: `${formatBytes(totals.reclaimable_bytes)}（${formatNumber(totals.reclaimable_units)} ${t('settingsStorage.itemsUnit', null, 'items')}）`
        },
        {
            label: t('settingsStorage.inodes', null, 'inode usage'),
            value: filesystem.available && filesystem.inodes_total > 0
                ? `${formatNumber(filesystem.inodes_total - filesystem.inodes_free)} / ${formatNumber(filesystem.inodes_total)}`
                : t('settingsStorage.unavailable', null, 'Unavailable')
        }
    ]), [filesystem, totals, t]);

    if (!canRead) {
        return <PermissionBanner permission="storage:read" label={t('settings.nav.storage', null, 'Storage cleanup')} />;
    }
    if ((meta.loading && !meta.data) || (status.loading && !status.data)) return <LoadingBlock rows={6} />;

    const categoryRows = (meta.data?.categories || []).map(item => {
        const stat = (status.data?.categories || []).find(entry => entry.key === item.key) || {};
        return { ...item, stat, key: item.key };
    });

    const columns = [
        {
            title: t('settingsStorage.colCategory', null, 'Category'),
            dataIndex: 'label',
            width: 200,
            render: (_, row) => (
                <Tooltip content={categoryHint(t, row)} position="topLeft">
                    <Space vertical spacing={2} align="start">
                        <Text strong>{categoryLabel(t, row)}</Text>
                        {row.stat.missing && <Text type="tertiary" size="small">{t('settingsStorage.unused', null, 'Unused')}</Text>}
                    </Space>
                </Tooltip>
            )
        },
        {
            title: t('settingsStorage.colRoot', null, 'Directory'),
            dataIndex: 'key',
            render: (_, row) => (
                <Tooltip content={row.stat.root || ''} position="topLeft">
                    <Mono>{row.stat.missing ? '—' : (row.stat.root || '—')}</Mono>
                </Tooltip>
            )
        },
        {
            title: t('settingsStorage.colUnits', null, 'Items'),
            align: 'right',
            width: 100,
            render: (_, row) => (row.stat.missing ? '—' : formatNumber(row.stat.units))
        },
        {
            title: t('settingsStorage.colSize', null, 'Size'),
            align: 'right',
            width: 110,
            render: (_, row) => (row.stat.missing ? '—' : formatBytes(row.stat.bytes))
        },
        {
            title: t('settingsStorage.colReclaimable', null, 'Reclaimable'),
            align: 'right',
            width: 190,
            render: (_, row) => (row.stat.missing ? '—' : (
                <Space vertical spacing={2} align="end">
                    <Text strong>{formatBytes(row.stat.reclaimable_bytes)}</Text>
                    <Text type="tertiary" size="small">
                        {`${formatNumber(row.stat.reclaimable_units)} ${t('settingsStorage.itemsUnit', null, 'items')}`}
                        {row.stat.orphan_units ? ` · ${t('settingsStorage.orphanSuffix', null, 'incl. orphans')} ${row.stat.orphan_units}` : ''}
                        {row.stat.skipped_active ? ` · ${t('settingsStorage.skippedActive', null, 'skipped active')} ${row.stat.skipped_active}` : ''}
                    </Text>
                </Space>
            ))
        },
        {
            title: t('settingsStorage.colRetention', null, 'Retention days'),
            width: 130,
            render: (_, row) => (
                <Input
                    value={String(policy?.categories?.[row.key]?.retention_days ?? 0)}
                    disabled={!canSavePolicy || busy === 'policy'}
                    onChange={value => setPolicy(current => current && ({
                        ...current,
                        categories: {
                            ...current.categories,
                            [row.key]: {
                                ...(current.categories[row.key] || {}),
                                retention_days: value === '' ? '' : intOr(value, 0)
                            }
                        }
                    }))}
                    style={{ width: 96 }}
                />
            )
        },
        {
            title: t('settingsStorage.colEnabled', null, 'Enabled'),
            width: 90,
            render: (_, row) => (
                <Switch
                    size="small"
                    checked={Boolean(policy?.categories?.[row.key]?.enabled)}
                    disabled={!canSavePolicy || busy === 'policy'}
                    onChange={next => setPolicy(current => current && ({
                        ...current,
                        categories: {
                            ...current.categories,
                            [row.key]: { ...(current.categories[row.key] || {}), enabled: next }
                        }
                    }))}
                    aria-label={t('settingsStorage.colEnabled', null, 'Enabled')}
                />
            )
        }
    ];

    return (
        <>
            <ErrorBanner error={meta.error} onRetry={meta.reload} />
            <ErrorBanner error={status.error} onRetry={status.reload} />
            <ErrorBanner error={actionError} />

            <SectionCard
                title={t('settingsStorage.title', null, 'Storage cleanup')}
                description={t('settingsStorage.subtitle', null, 'Inspect and reclaim disk space used by runtime artifacts (agent workspaces, tool-output spill, C2 artifacts, chat uploads). Deletion is irreversible - preview first.')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} loading={busy === 'status'} onClick={refreshStatus}>
                            {t('settingsStorage.refresh', null, 'Rescan')}
                        </Button>
                        <Button
                            loading={busy === 'preview'}
                            disabled={!canClean}
                            onClick={() => runCleanup(true)}
                        >
                            {t('settingsStorage.preview', null, 'Preview reclaimable')}
                        </Button>
                        <Button
                            type="danger"
                            theme="light"
                            loading={busy === 'clean'}
                            disabled={!canClean}
                            onClick={() => confirmAction({
                                title: t('settingsStorage.cleanNow', null, 'Clean now'),
                                content: t(
                                    'settingsStorage.confirmClean',
                                    { size: formatBytes(totals.reclaimable_bytes), count: formatNumber(totals.reclaimable_units) },
                                    'This permanently deletes about {{size}} ({{count}} items) of runtime files and cannot be undone. Run "Preview reclaimable" first. Continue?'
                                ),
                                okText: t('settingsStorage.cleanNow', null, 'Clean now'),
                                onOk: () => runCleanup(false)
                            })}
                        >
                            {t('settingsStorage.cleanNow', null, 'Clean now')}
                        </Button>
                    </Space>
                )}
            >
                {filesystem.available && (
                    <div className="settings-disk">
                        <Progress
                            percent={Math.max(0, Math.min(100, Number(filesystem.used_percent) || 0))}
                            stroke={Number(filesystem.used_percent) >= 85 ? 'var(--semi-color-danger)' : undefined}
                            showInfo
                        />
                        <Hint>
                            {`${formatBytes(filesystem.free_bytes)} ${t('settingsStorage.free', null, 'free')} / ${formatBytes(filesystem.total_bytes)}`}
                            {status.data?.scanned_at
                                ? ` · ${t('settingsStorage.scannedAt', null, 'Scanned at')} ${formatDateTime(status.data.scanned_at)}`
                                : ''}
                        </Hint>
                    </div>
                )}
                <KeyValueList items={overview} columns={4} />
            </SectionCard>

            <SectionCard
                title={t('settingsStorage.policyTitle', null, 'Automatic cleanup policy')}
                extra={(
                    <Button
                        theme="solid"
                        type="primary"
                        loading={busy === 'policy'}
                        disabled={!canSavePolicy || !policy}
                        onClick={savePolicy}
                    >
                        {t('settingsStorage.save', null, 'Save policy')}
                    </Button>
                )}
            >
                <div className="settings-policy-grid">
                    <label className="settings-field">
                        <Text type="tertiary" size="small">{t('settingsStorage.autoClean', null, 'Enable scheduled background cleanup')}</Text>
                        <Switch
                            checked={Boolean(policy?.auto_clean)}
                            disabled={!canSavePolicy}
                            onChange={next => setPolicy(current => current && ({ ...current, auto_clean: next }))}
                        />
                    </label>
                    <label className="settings-field">
                        <Text type="tertiary" size="small">{t('settingsStorage.intervalMinutes', null, 'Interval (minutes)')}</Text>
                        <Input
                            value={String(policy?.interval_minutes ?? '')}
                            disabled={!canSavePolicy}
                            onChange={value => setPolicy(current => current && ({ ...current, interval_minutes: value === '' ? '' : intOr(value, 5) }))}
                        />
                    </label>
                    <label className="settings-field">
                        <Text type="tertiary" size="small">{t('settingsStorage.orphanGraceDays', null, 'Orphan grace (days)')}</Text>
                        <Input
                            value={String(policy?.orphan_grace_days ?? '')}
                            disabled={!canSavePolicy}
                            onChange={value => setPolicy(current => current && ({ ...current, orphan_grace_days: value === '' ? '' : intOr(value, 0) }))}
                        />
                    </label>
                    <label className="settings-field">
                        <Text type="tertiary" size="small">{t('settingsStorage.activeGraceHours', null, 'Active session protection (hours)')}</Text>
                        <Input
                            value={String(policy?.active_grace_hours ?? '')}
                            disabled={!canSavePolicy}
                            onChange={value => setPolicy(current => current && ({ ...current, active_grace_hours: value === '' ? '' : intOr(value, 1) }))}
                        />
                    </label>
                </div>
                <Hint>{t('settingsStorage.policyHint', null, 'Retention of 0 disables age-based cleanup, but directories whose conversation is already gone are still reclaimed. Sessions with recent activity are never cleaned. Automatic cleanup is off by default, so upgrading never deletes existing data.')}</Hint>
            </SectionCard>

            <SectionCard title={t('settingsStorage.categoriesTitle', null, 'Usage and retention policy by category')}>
                <DataTable
                    columns={columns}
                    dataSource={categoryRows}
                    rowKey="key"
                    loading={status.loading || meta.loading}
                    pagination={false}
                    emptyText={t('settingsStorage.noCategories', null, 'No cleanable categories')}
                />
            </SectionCard>

            {report && (
                <SectionCard
                    title={report.dry_run
                        ? t('settingsStorage.previewTitle', null, 'Preview (nothing was deleted)')
                        : t('settingsStorage.cleanDone', null, 'Cleanup finished')}
                >
                    <KeyValueList
                        columns={3}
                        items={[
                            { label: t('settingsStorage.colUnits', null, 'Items'), value: formatNumber(report.dry_run ? report.totals?.reclaimable_units : report.totals?.removed_units) },
                            { label: report.dry_run ? t('settingsStorage.reclaimable', null, 'Reclaimable') : t('settingsDisplay.freed', null, 'Space freed'), value: formatBytes(report.dry_run ? report.totals?.reclaimable_bytes : report.totals?.freed_bytes) },
                            { label: t('settingsDisplay.errors', null, 'Errors'), value: formatNumber(report.totals?.errors) },
                            { label: t('settingsStorage.skippedActive', null, 'skipped active'), value: formatNumber(report.totals?.skipped_active) },
                            { label: t('settingsDisplay.cleanupDuration', null, 'Cleanup duration'),
                                value: t('settingsProbe.milliseconds', { value: formatNumber(report.duration_ms ?? 0) }, '{{value}} ms') }
                        ]}
                    />
                    {(report.categories || []).filter(item => item.errors?.length).length > 0 && (
                        <Banner
                            type="warning"
                            bordered
                            closeIcon={null}
                            description={(report.categories || [])
                                .filter(item => item.errors?.length)
                                .map(item => `${categoryLabel(t, item)}：${item.errors.slice(0, 3).join('；')}`)
                                .join(' / ')}
                        />
                    )}
                </SectionCard>
            )}
        </>
    );
}

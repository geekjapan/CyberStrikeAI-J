/** Asset overview: stat cards, protocol distribution, scan coverage, recent assets. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Empty, Progress, RadioGroup, Space, Typography } from '@douyinfe/semi-ui';
import { IconArrowRight, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { formatNumber, relativeTime } from '../../lib/format';
import { translate, useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import {
    DataTable, ErrorBanner, PageHeader, SectionCard, StatGrid
} from '../../components/ui';
import { ProtocolTag, RiskTag, TooltipText } from '../asset-library/components/AssetBits';
import { assetTargetLabel } from '../asset-library/components/assetTarget';
import './page.css';

const { Text } = Typography;

const PERIODS = [
    { value: 7, get label() { return translate('ui.assetOverview.periodDays', { days: 7 }, '{{days}} days'); } },
    { value: 30, get label() { return translate('ui.assetOverview.periodDays', { days: 30 }, '{{days}} days'); } },
    { value: 90, get label() { return translate('ui.assetOverview.periodDays', { days: 90 }, '{{days}} days'); } }
];

function percentOf(count, total) {
    const value = Number(count || 0);
    const base = Number(total || 0);
    if (!base) return 0;
    return Math.round((value / base) * 1000) / 10;
}

export default function AssetOverviewPage() {
    const t = useT();
    const navigate = useNavigate();
    const { hasPermission, hasAnyPermission } = useAuth();
    const canRead = hasPermission('asset:read');
    const canCollect = hasAnyPermission(['asset:read', 'fofa:execute']);
    const [days, setDays] = useState(30);

    const statsRes = useResource(() => api.get('/assets/stats', { days }), [days], { skip: !canRead });
    const recentRes = useResource(
        () => api.get('/assets', { page: 1, page_size: 10, sort_by: 'last_seen_at', sort_order: 'desc' }),
        [],
        { skip: !canRead }
    );

    const stats = statsRes.data || {};
    const coverage = stats.coverage || {};
    const protocols = Array.isArray(stats.protocols) ? stats.protocols : [];
    const protocolTotal = useMemo(
        () => protocols.reduce((sum, item) => sum + Number(item.count || 0), 0),
        [protocols]
    );
    const recentAssets = Array.isArray(recentRes.data?.assets) ? recentRes.data.assets : [];

    const metrics = [
        {
            id: 'total',
            label: t('assets.totalAssets', null, 'Total assets'),
            value: formatNumber(stats.total || 0),
            detail: t('assets.totalAssetsHint', null, 'Assets currently under continuous monitoring'),
            loading: statsRes.loading
        },
        {
            id: 'ips',
            label: t('assets.ipCount', null, 'IP addresses'),
            value: formatNumber(stats.ips || 0),
            loading: statsRes.loading
        },
        {
            id: 'domains',
            label: t('assets.domainCount', null, 'Domains'),
            value: formatNumber(stats.domains || 0),
            loading: statsRes.loading
        },
        {
            id: 'ports',
            label: t('assets.portCount', null, 'Ports'),
            value: formatNumber(stats.ports || 0),
            loading: statsRes.loading
        },
        {
            id: 'protocols',
            label: t('assets.serviceTypes', null, 'Service types'),
            value: formatNumber(protocols.length),
            detail: protocols[0] ? `${t('assets.topProtocol', null, 'Top protocol')}: ${protocols[0].name}` : undefined,
            loading: statsRes.loading
        },
        {
            id: 'recent',
            label: t('assets.recentCount', null, 'Discovered in 7 days'),
            value: formatNumber(stats.recent || 0),
            detail: t('assets.recentShare', { percent: percentOf(stats.recent, stats.total) }, '{{percent}}% of all current assets'),
            loading: statsRes.loading
        }
    ];

    const goLibrary = asset => {
        const suffix = asset?.id ? `?id=${encodeURIComponent(asset.id)}` : '';
        navigate(`/asset-library${suffix}`, asset ? { state: { asset } } : undefined);
    };

    const columns = [
        {
            title: t('assets.target', null, 'Target'),
            dataIndex: 'host',
            render: (_, record) => (
                <div className="asset-overview-target">
                    <TooltipText text={assetTargetLabel(record)} max={34} />
                    <Text type="tertiary" size="small">{[record.ip, record.domain].filter(Boolean).join(' · ') || '—'}</Text>
                </div>
            )
        },
        {
            title: t('assets.service', null, 'Service'),
            dataIndex: 'protocol',
            width: 150,
            render: (_, record) => <ProtocolTag protocol={record.protocol} port={record.port} />
        },
        {
            title: t('assets.source', null, 'Source'),
            dataIndex: 'source',
            width: 120,
            render: value => <TooltipText text={value} max={14} />
        },
        {
            title: t('assets.riskLevel', null, 'Risk'),
            dataIndex: 'risk_level',
            width: 120,
            render: (_, record) => <RiskTag asset={record} />
        },
        {
            title: t('assets.lastSeen', null, 'Last seen'),
            dataIndex: 'last_seen_at',
            width: 130,
            render: value => <Text size="small">{relativeTime(value, t)}</Text>
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 100,
            render: (_, record) => (
                <Button theme="borderless" size="small" onClick={() => goLibrary(record)}>
                    {t('common.view', null, 'View')}
                </Button>
            )
        }
    ];

    const coverageItems = [
        { label: t('assets.scannedAssets', null, 'Scanned assets'), value: formatNumber(coverage.scanned || 0) },
        { label: t('assets.recentlyScanned', null, 'Covered in 30 days'), value: formatNumber(coverage.scanned_30d || 0) },
        { label: t('assets.neverScanned', null, 'Never scanned'), value: formatNumber(coverage.never_scanned || 0) },
        { label: t('assets.staleScans', null, 'Not scanned in 30+ days'), value: formatNumber(coverage.stale || 0) }
    ];

    return (
        <div className="asset-overview-page">
            <PageHeader
                title={t('assets.overviewTitle', null, 'Asset Overview')}
                description={t('ui.assetOverview.description', null, 'Summary of asset volume, service types, scan coverage, and recent discoveries.')}
                extra={(
                    <Space wrap>
                        <RadioGroup
                            type="button"
                            value={days}
                            options={PERIODS}
                            onChange={event => setDays(Number(event.target.value) || 30)}
                        />
                        <Button icon={<IconRefresh />} onClick={() => { statsRes.reload(); recentRes.reload(); }}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button icon={<IconArrowRight />} onClick={() => navigate('/asset-library')}>
                            {t('assets.viewLibrary', null, 'View asset library')}
                        </Button>
                        {canCollect && (
                            <Button theme="solid" type="primary" icon={<IconSearch />} onClick={() => navigate('/info-collect')}>
                                {t('nav.infoCollect', null, 'Recon')}
                            </Button>
                        )}
                    </Space>
                )}
            />
            {!canRead && (
                <Banner
                    type="warning"
                    bordered
                    closeIcon={null}
                    description={t('assets.readDenied', null, 'The current account lacks the asset:read permission and cannot read asset data. Contact an administrator for access.')}
                />
            )}
            {canRead && <ErrorBanner error={statsRes.error} onRetry={() => statsRes.reload()} />}
            {canRead && <StatGrid metrics={metrics} columns={6} />}

            {canRead && (<div className="asset-overview-columns">
                <SectionCard
                    className="asset-overview-card"
                    title={t('assets.protocolDistribution', null, 'Protocol distribution')}
                    description={t('assets.protocolDistributionHint', null, 'Exposure composition by identified service')}
                    extra={<Text type="tertiary" size="small">{t('assets.protocolKinds', { count: protocols.length }, '{{count}} protocols')}</Text>}
                >
                    {protocols.length === 0 ? (
                        <Empty title={t('common.noData', null, 'No data')} description={null} style={{ padding: 24 }} />
                    ) : (
                        <div className="asset-overview-bars">
                            {protocols.map(item => {
                                const percent = percentOf(item.count, stats.total || protocolTotal);
                                return (
                                    <div className="asset-overview-bar-row" key={item.name}>
                                        <Text size="small" className="asset-overview-bar-label">
                                            {item.name || 'unknown'}
                                        </Text>
                                        <Progress percent={percent} showInfo={false} stroke="var(--semi-color-primary)" />
                                        <Text type="tertiary" size="small" className="asset-overview-bar-value">
                                            {formatNumber(item.count || 0)} · {percent}%
                                        </Text>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </SectionCard>

                <SectionCard
                    className="asset-overview-card"
                    title={t('assets.scanCoverage', null, 'Scan coverage')}
                    description={t('assets.scanCoverageHint', null, 'Identify assets that are unscanned or overdue for review')}
                    extra={<Text type="tertiary" size="small">{t('assets.coverageMeta', { scanned: coverage.scanned || 0, total: stats.total || 0 }, '{{scanned}} / {{total}} covered')}</Text>}
                >
                    <div className="asset-overview-coverage">
                        <div className="asset-overview-coverage-main">
                            <Text type="tertiary" size="small">{t('assets.overallCoverage', null, 'Overall coverage')}</Text>
                            <Progress
                                percent={Number(coverage.rate || 0)}
                                stroke={Number(coverage.rate || 0) >= 80 ? 'var(--semi-color-success)' : undefined}
                                format={percent => `${percent}%`}
                            />
                        </div>
                        <div className="asset-overview-coverage-grid">
                            {coverageItems.map(item => (
                                <div key={item.label} className="asset-overview-coverage-item">
                                    <Text type="tertiary" size="small">{item.label}</Text>
                                    <Text strong>{item.value}</Text>
                                </div>
                            ))}
                        </div>
                    </div>
                </SectionCard>
            </div>)}

            {canRead && (<SectionCard
                title={t('assets.recentAssets', null, 'Recent assets')}
                description={t('ui.assetOverview.recentDescription', null, 'Top 10 assets, sorted by last seen time.')}
                extra={(
                    <Button theme="borderless" onClick={() => navigate('/asset-library')}>
                        {t('assets.viewLibrary', null, 'View asset library')}
                    </Button>
                )}
            >
                <ErrorBanner error={recentRes.error} onRetry={() => recentRes.reload()} />
                <DataTable
                    columns={columns}
                    dataSource={recentAssets}
                    loading={recentRes.loading}
                    rowKey="id"
                    pagination={false}
                    onRefresh={() => recentRes.reload()}
                    emptyText={t('common.noData', null, 'No data')}
                />
            </SectionCard>)}
        </div>
    );
}

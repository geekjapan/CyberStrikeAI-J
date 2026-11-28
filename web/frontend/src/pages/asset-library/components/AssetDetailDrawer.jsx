/** Asset detail drawer: all fields plus links to related vulnerabilities/projects. */
import { useNavigate } from 'react-router-dom';
import { Button, Divider, SideSheet, Space, Typography } from '@douyinfe/semi-ui';
import { CopyButton, KeyValueList } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format';
import { useT } from '../../../lib/i18n';
import { AssetStatusTag, ProtocolTag, RiskTag, TagList } from './AssetBits';
import { criticalityLabel, environmentLabel, riskLabel } from './assetConstants';
import { assetServiceLabel, assetTargetLabel } from './assetTarget';

const { Text } = Typography;

export default function AssetDetailDrawer({ asset, visible, onClose, onEdit, onDelete, canWrite, canDelete }) {
    const t = useT();
    const navigate = useNavigate();
    if (!asset) return null;

    const openVulnerabilities = () => {
        if (asset.last_scan_task_id) {
            navigate(`/vulnerabilities?task_id=${encodeURIComponent(asset.last_scan_task_id)}`);
            return;
        }
        if (asset.last_scan_conversation_id) {
            navigate(`/vulnerabilities?conversation_id=${encodeURIComponent(asset.last_scan_conversation_id)}`);
            return;
        }
        const host = asset.host || asset.domain || asset.ip || '';
        navigate(host ? `/vulnerabilities?host_q=${encodeURIComponent(host)}` : '/vulnerabilities');
    };

    const items = [
        { label: 'Host', value: asset.host || '—' },
        { label: 'IP', value: asset.ip || '—' },
        { label: t('assets.domain', null, 'Domain'), value: asset.domain || '—' },
        { label: t('assets.service', null, 'Service'), value: <ProtocolTag protocol={asset.protocol} port={asset.port} /> },
        { label: t('assets.project', null, 'Project'), value: asset.project_name || asset.project_id || '—' },
        { label: t('assets.status', null, 'Status'), value: <AssetStatusTag status={asset.status} /> },
        { label: t('assets.riskLevel', null, 'Risk'), value: <RiskTag asset={asset} /> },
        { label: t('assets.environment', null, 'Environment'), value: environmentLabel(asset.environment) || '—' },
        { label: t('assets.criticality', null, 'Criticality'), value: criticalityLabel(asset.criticality) || '—' },
        {
            label: t('assets.location', null, 'Location'),
            value: [asset.country, asset.province, asset.city].filter(Boolean).join(' / ') || '—'
        },
        { label: t('assets.responsiblePerson', null, 'Owner'), value: asset.responsible_person || '—' },
        { label: t('assets.department', null, 'Department'), value: asset.department || '—' },
        { label: t('assets.businessSystem', null, 'Business system'), value: asset.business_system || '—' },
        { label: t('assets.title', null, 'Title / fingerprint'), value: asset.title || '—' },
        { label: t('assets.server', null, 'Server fingerprint'), value: asset.server || '—' },
        { label: t('assets.source', null, 'Source'), value: asset.source || '—' },
        {
            label: t('assets.sourceQuery', null, 'Source query'),
            value: asset.source_query ? <Text code size="small">{asset.source_query}</Text> : '—'
        },
        { label: t('assets.tagsLabel', null, 'Tags'), value: <TagList tags={asset.tags} max={6} /> },
        { label: t('assets.firstSeen', null, 'First seen'), value: formatDateTime(asset.first_seen_at) },
        { label: t('assets.lastSeen', null, 'Last seen'), value: formatDateTime(asset.last_seen_at) },
        { label: t('assets.lastScan', null, 'Last scan'), value: formatDateTime(asset.last_scan_at) },
        { label: t('ui.assetDetailDrawer.createdAt', null, 'Created'), value: formatDateTime(asset.created_at) },
        { label: t('ui.assetDetailDrawer.updatedAt', null, 'Updated'), value: formatDateTime(asset.updated_at) },
        { label: t('ui.assetDetailDrawer.assetId', null, 'Asset ID'), value: <Text copyable={{ content: asset.id }} size="small">{asset.id}</Text> }
    ];

    return (
        <SideSheet
            visible={visible}
            onCancel={onClose}
            title={t('assets.detailTitle', null, 'Asset details')}
            width={620}
            placement="right"
            footer={(
                <Space>
                    {canWrite && <Button onClick={() => onEdit(asset)}>{t('common.edit', null, 'Edit')}</Button>}
                    {canDelete && (
                        <Button type="danger" onClick={() => onDelete(asset)}>
                            {t('common.delete', null, 'Delete')}
                        </Button>
                    )}
                    <Button theme="borderless" onClick={onClose}>{t('common.close', null, 'Close')}</Button>
                </Space>
            )}
        >
            <div className="asset-library-detail-target">
                <div className="asset-library-detail-target-main">
                    <Text strong size="large">{assetTargetLabel(asset)}</Text>
                    <CopyButton text={assetTargetLabel(asset)} />
                </div>
                <Text type="tertiary">
                    {[asset.ip, asset.domain, assetServiceLabel(asset)].filter(Boolean).join(' · ') || '—'}
                </Text>
                <Space spacing={6} wrap className="asset-library-detail-badges">
                    <AssetStatusTag status={asset.status} />
                    <RiskTag asset={asset} />
                    <Text type="tertiary" size="small">
                        {t('assets.relatedVulnerabilities', null, 'Related findings')}：
                        {Number(asset.vulnerability_count || 0)}
                        {asset.risk_level ? `（${riskLabel(asset.risk_level)}）` : ''}
                    </Text>
                </Space>
            </div>
            <Divider margin="12px" />
            <KeyValueList items={items} columns={2} />
            <Divider margin="12px" />
            <Space>
                <Button theme="light" onClick={openVulnerabilities}>
                    {t('assets.viewRelatedVulnerabilities', null, 'View related vulnerabilities')}
                </Button>
                {asset.project_id && (
                    <Button
                        theme="borderless"
                        onClick={() => navigate(`/projects?id=${encodeURIComponent(asset.project_id)}`)}
                    >
                        {t('assets.viewProject', null, 'View project')}
                    </Button>
                )}
            </Space>
        </SideSheet>
    );
}

/** Project detail: single entry for overview stats, tabs and the fact dialog/detail drawer. */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Space, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../components/hooks';
import { ErrorBanner, SectionCard, StatGrid } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import FactsPanel from './facts-panel';
import FactGraphPanel from './fact-graph';
import ConversationsPanel from './conversations-panel';
import SettingsPanel from './settings-panel';
import FactFormModal from './fact-form';
import FactDetailSheet from './fact-detail';
import AssetEditorModal from '../asset-library/components/AssetEditorModal';
import { errorProp } from './helpers';

const { Title, Text, Paragraph } = Typography;

export default function ProjectDetail({ projectId, tab, refreshToken = 0, onTabChange, onChanged, onDeleted }) {
    const t = useT();
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('project:write');
    const canDelete = hasPermission('project:delete');

    const [revision, setRevision] = useState(0);
    const [factForm, setFactForm] = useState({ visible: false, factKey: '' });
    const [addingAsset, setAddingAsset] = useState(false);
    const [factDetail, setFactDetail] = useState('');

    const project = useResource(() => api.get(`/projects/${projectId}`), [projectId, revision, refreshToken]);
    const stats = useResource(() => api.get(`/projects/${projectId}/stats`), [projectId, revision, refreshToken]);

    const bump = useCallback(() => {
        setRevision(value => value + 1);
        onChanged?.();
    }, [onChanged]);

    const openFactForm = useCallback(factKey => setFactForm({ visible: true, factKey: factKey || '' }), []);
    const openFactDetail = useCallback(factKey => setFactDetail(factKey || ''), []);

    const tabList = useMemo(() => ([
        { itemKey: 'facts', tab: t('projects.tabFacts', null, 'Fact board') },
        { itemKey: 'graph', tab: t('projects.tabGraph', null, 'Attack path') },
        { itemKey: 'conversations', tab: t('projects.tabConversations', null, 'Bound conversations') },
        { itemKey: 'settings', tab: t('projects.tabSettings', null, 'Settings') }
    ]), [t]);

    const metrics = [
        { id: 'facts', label: t('projects.facts', null, 'Facts'), value: stats.data?.fact_count ?? '—', loading: stats.loading },
        { id: 'vulns', label: t('projects.vulnerabilityManagement', null, 'Vulnerability management'), value: stats.data?.vuln_count ?? '—', loading: stats.loading },
        { id: 'conversations', label: t('projects.tabConversations', null, 'Bound conversations'), value: stats.data?.conversation_count ?? '—', loading: stats.loading },
        {
            id: 'sparse',
            label: t('projects.factBodySparse', null, 'Incomplete'),
            value: stats.data?.sparse_fact_count ?? '—',
            tone: (stats.data?.sparse_fact_count || 0) > 0 ? 'warning' : undefined,
            loading: stats.loading
        }
    ];

    const current = project.data;

    return (
        <div className="project-detail">
            <div className="project-detail-summary">
                <ErrorBanner error={errorProp(project.error)} onRetry={project.reload} />
                <SectionCard className="project-detail-head">
                    <div className="project-detail-head-main">
                        <div className="project-detail-title-row">
                            <Title heading={4} className="project-detail-title">
                                {current?.name || t('projects.projectNotFound', null, 'Project not found')}
                            </Title>
                            {current?.pinned ? <Tag size="small" color="blue">{t('projects.pinned', null, 'Pinned')}</Tag> : null}
                            <Tag size="small" color={(current?.status || 'active') === 'archived' ? 'grey' : 'green'}>
                                {(current?.status || 'active') === 'archived'
                                    ? t('projects.statusArchived', null, 'Archived')
                                    : t('projects.statusActive', null, 'Active')}
                            </Tag>
                        </div>
                        {current?.description
                            ? <Paragraph className="project-detail-desc">{current.description}</Paragraph>
                            : <Text type="tertiary" size="small">{t('projects.noProjectDescription', null, 'No project binding')}</Text>}
                        <Text type="tertiary" size="small">
                            {t('projects.updatedPrefix', { time: formatDateTime(current?.updated_at) }, 'Updated {{time}}')}
                            {' · '}ID: <code>{projectId}</code>
                        </Text>
                    </div>
                    <Space wrap>
                        {current && hasPermission('asset:write') && (
                            <Button onClick={() => setAddingAsset(true)}>{t('assets.addAsset', null, 'Add asset')}</Button>
                        )}
                        {current && hasPermission('asset:read') && (
                            <Button onClick={() => navigate(`/asset-library?project_id=${encodeURIComponent(projectId)}`)}>
                                {t('assets.projectAssets', null, 'Project assets')}
                            </Button>
                        )}
                        <Button
                            icon={<IconRefresh />}
                            theme="borderless"
                            loading={project.loading || stats.loading}
                            onClick={() => { project.reload(); stats.reload(); }}
                        />
                        <Button type="primary" disabled={!canWrite} onClick={() => openFactForm('')}>
                            {t('projects.addFactCta', null, '+ Add fact')}
                        </Button>
                    </Space>
                </SectionCard>

                <StatGrid metrics={metrics} columns={4} />

                <Tabs
                    type="line"
                    tabList={tabList}
                    activeKey={tab || 'facts'}
                    onChange={key => onTabChange?.(key)}
                    className="project-tabs"
                />
            </div>

            {(!tab || tab === 'facts') && (
                <FactsPanel
                    projectId={projectId}
                    canWrite={canWrite}
                    revision={revision}
                    onAddFact={() => openFactForm('')}
                    onEditFact={openFactForm}
                    onViewFact={openFactDetail}
                    onMutated={bump}
                />
            )}

            {tab === 'graph' && (
                <FactGraphPanel
                    projectId={projectId}
                    canWrite={canWrite}
                    revision={revision}
                    onOpenFact={openFactDetail}
                    onEditFact={openFactForm}
                    onAddFact={() => openFactForm('')}
                    onChanged={bump}
                />
            )}

            {tab === 'conversations' && (
                <ConversationsPanel projectId={projectId} canWrite={canWrite} onChanged={bump} />
            )}

            {tab === 'settings' && (
                <SettingsPanel
                    project={current}
                    canWrite={canWrite}
                    canDelete={canDelete}
                    onChanged={bump}
                    onDeleted={id => onDeleted?.(id)}
                />
            )}

            {addingAsset && current && hasPermission('asset:write') && (
                <AssetEditorModal visible defaultProjectId={projectId} fixedProject
                    projects={[current]} onClose={() => setAddingAsset(false)} />
            )}

            <FactFormModal
                visible={factForm.visible}
                projectId={projectId}
                factKey={factForm.factKey}
                onCancel={() => setFactForm({ visible: false, factKey: '' })}
                onSaved={() => {
                    setFactForm({ visible: false, factKey: '' });
                    bump();
                }}
            />

            <FactDetailSheet
                projectId={projectId}
                factKey={factDetail}
                visible={Boolean(factDetail)}
                canWrite={canWrite}
                revision={revision}
                onClose={() => setFactDetail('')}
                onEdit={factKey => {
                    setFactDetail('');
                    openFactForm(factKey);
                }}
            />

        </div>
    );
}

/** Human-in-the-loop: pending approvals / approval logs / whitelist / review strategy. */
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Banner, Button, Space, Tabs, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { PageHeader } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import PendingPanel from './pending-panel';
import LogsPanel from './logs-panel';
import WhitelistPanel from './whitelist-panel';
import StrategyPanel from './strategy-panel';
import './page.css';

const { Text } = Typography;
const TAB_KEYS = ['pending', 'logs', 'whitelist', 'strategy'];

export default function HitlPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canRead = hasPermission('hitl:read');
    const canWrite = hasPermission('hitl:write');
    const [params, setParams] = useSearchParams();
    const [pendingCount, setPendingCount] = useState(0);
    const [refreshKey, setRefreshKey] = useState(0);

    const tabParam = params.get('tab');
    const logId = params.get('id') || '';
    const convId = params.get('conv') || '';
    const tab = TAB_KEYS.includes(tabParam)
        ? tabParam
        : (logId ? 'logs' : (convId ? 'strategy' : 'pending'));

    const updateParams = useCallback(patch => {
        const next = new URLSearchParams(params);
        Object.entries(patch).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') next.delete(key);
            else next.set(key, value);
        });
        setParams(next, { replace: true });
    }, [params, setParams]);

    const switchTab = useCallback(nextTab => {
        updateParams({ tab: nextTab, id: null });
    }, [updateParams]);

    const openLog = useCallback(id => updateParams({ tab: 'logs', id }), [updateParams]);
    const closeLog = useCallback(() => updateParams({ id: null }), [updateParams]);

    const tabLabel = (key, fallback) => (key === 'pending' && pendingCount > 0
        ? (
            <span className="hitl-tab-label">
                {fallback}
                <Badge count={pendingCount} type="danger" />
            </span>
        )
        : fallback);

    return (
        <div className="hitl-page">
            <PageHeader
                title={t('hitl.pageTitle', null, 'HITL approvals')}
                description={t('ui.hitlIndex.pageDescription', null, 'Sensitive tool calls enter the approval queue first. The Audit Agent can decide automatically by policy, and allowlisted tools are approved directly.')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} onClick={() => setRefreshKey(key => key + 1)}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                    </Space>
                )}
            >
                {!canWrite && <Text type="tertiary" size="small">{t('ui.hitlIndex.readOnly', null, 'This account is read-only. Approval and save actions are disabled.')}</Text>}
            </PageHeader>

            {!canRead && (
                <Banner
                    type="warning"
                    bordered
                    description={t('ui.hitlIndex.noReadPermission', null, 'This account lacks the hitl:read permission and cannot read pending approvals or audit logs.')}
                />
            )}

            {canRead && (
                <Tabs
                    type="line"
                    activeKey={tab}
                    onChange={switchTab}
                    className="hitl-tabs"
                >
                    <Tabs.TabPane itemKey="pending" tab={tabLabel('pending', t('hitl.tabPending', null, 'Pending'))}>
                        {tab === 'pending' && (
                            <PendingPanel
                                canWrite={canWrite}
                                refreshKey={refreshKey}
                                onCountChange={setPendingCount}
                            />
                        )}
                    </Tabs.TabPane>
                    <Tabs.TabPane itemKey="logs" tab={t('hitl.tabLogs', null, 'Audit logs')}>
                        {tab === 'logs' && (
                            <LogsPanel
                                canWrite={canWrite}
                                refreshKey={refreshKey}
                                detailId={logId}
                                onOpenDetail={openLog}
                                onCloseDetail={closeLog}
                            />
                        )}
                    </Tabs.TabPane>
                    <Tabs.TabPane itemKey="whitelist" tab={t('hitl.tabWhitelist', null, 'Tool whitelist')}>
                        {tab === 'whitelist' && (
                            <WhitelistPanel canWrite={canWrite} refreshKey={refreshKey} />
                        )}
                    </Tabs.TabPane>
                    <Tabs.TabPane itemKey="strategy" tab={t('hitl.tabStrategy', null, 'Audit strategy')}>
                        {tab === 'strategy' && (
                            <StrategyPanel
                                canWrite={canWrite}
                                refreshKey={refreshKey}
                                initialConversationId={convId}
                            />
                        )}
                    </Tabs.TabPane>
                </Tabs>
            )}
        </div>
    );
}

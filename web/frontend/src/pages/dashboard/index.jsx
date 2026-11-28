import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Empty, List, Progress, Space, Tag, Typography } from '@douyinfe/semi-ui';
import {
    IconArrowRight, IconBolt, IconCheckCircleStroked, IconCheckList,
    IconComment, IconRefresh, IconShield, IconTerminal
} from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useInterval, useResource } from '../../components/hooks';
import { PageHeader, SectionCard, StatGrid, ErrorBanner, SeverityTag } from '../../components/ui';
import { formatDateTime, formatNumber, formatPercent } from '../../lib/format';
import VulnerabilityOverview, { asCount, displayCount, severityCount } from './vulnerability-overview';
import './page.css';

const { Text } = Typography;
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

async function safe(path, query) {
    try {
        return await api.get(path, query);
    } catch (error) {
        if (error.status === 503 && error.payload?.error === 'c2_disabled') return { enabled: false };
        return null;
    }
}

async function loadDashboard() {
    const [
        agentTasks, vulnStats, pendingVulnStats, vulnList, batchQueues, monitorStats, tokenUsage,
        knowledgeStats, skillsStats, roles, agents, hitlPending, externalMcp,
        webshell, c2Listeners, c2Sessions, projectSummary, toolsConfig
    ] = await Promise.all([
        safe('/agent-loop/tasks'),
        safe('/vulnerabilities/stats'),
        safe('/vulnerabilities/stats', { status: 'open' }),
        safe('/vulnerabilities', { limit: 8, page: 1 }),
        safe('/batch-tasks', { limit: 200, page: 1 }),
        safe('/monitor/stats', { top: 8 }),
        safe('/usage/tokens', { days: 7, limit: 20 }),
        safe('/knowledge/stats'),
        safe('/skills/stats'),
        safe('/roles'),
        safe('/multi-agent/markdown-agents'),
        safe('/hitl/pending'),
        safe('/external-mcp/stats'),
        safe('/webshell/connections'),
        safe('/c2/listeners'),
        safe('/c2/sessions', { limit: 200 }),
        safe('/projects/dashboard-summary', { fact_limit: 8 }),
        safe('/config/tools', { page: 1, page_size: 1, include_external: false })
    ]);
    const sources = {
        agentTasks, vulnStats, pendingVulnStats, vulnList, batchQueues, monitorStats, tokenUsage,
        knowledgeStats, skillsStats, roles, agents, hitlPending, externalMcp,
        webshell, c2Listeners, c2Sessions, projectSummary, toolsConfig
    };
    return {
        ...sources,
        unavailableCount: Object.values(sources).filter(value => value == null).length,
        sourceCount: Object.keys(sources).length,
        loadedAt: new Date().toISOString()
    };
}

function getList(value, ...keys) {
    if (Array.isArray(value)) return value;
    for (const key of keys) {
        if (Array.isArray(value?.[key])) return value[key];
    }
    return null;
}

function countList(value, ...keys) {
    return getList(value, ...keys)?.length ?? null;
}

function DashboardEmpty({ loading, unavailable, title, description }) {
    const t = useT();
    return (
        <Empty
            className="dashboard-empty"
            title={loading ? t('ui.dashboardPage.loadingTitle', null, 'Loading data') : unavailable ? t('ui.dashboardPage.unavailableTitle', null, 'Data unavailable') : title}
            description={loading ? t('ui.dashboardPage.loadingDesc', null, 'Reading the latest records. Please wait.') : unavailable ? t('ui.dashboardPage.unavailableDesc', null, 'Could not retrieve the data. Please refresh and try again later.') : description}
        />
    );
}

function RecentVulnerabilities({ data, loading, onOpen }) {
    const t = useT();
    const list = getList(data, 'vulnerabilities');
    return (
        <List
            className="dashboard-list dashboard-feed"
            loading={loading}
            dataSource={list || []}
            emptyContent={<DashboardEmpty loading={loading} unavailable={list === null} title={t('ui.dashboardPage.vulnEmptyTitle', null, 'No vulnerability records')} description={t('ui.dashboardPage.vulnEmptyDesc', null, 'Vulnerabilities found during assessments are collected here for follow-up and review.')} />}
            renderItem={item => (
                <List.Item
                    key={item.id}
                    main={(
                        <div className="dashboard-record">
                            <Button theme="borderless" className="dashboard-record-link" onClick={() => onOpen(item.id)}>
                                {item.title || item.name || t('ui.dashboardPage.vulnUntitled', null, 'Untitled vulnerability')}
                            </Button>
                            <Text type="tertiary" size="small" className="dashboard-meta">
                                {item.host || item.target || '—'} · {formatDateTime(item.created_at)}
                            </Text>
                        </div>
                    )}
                    extra={<SeverityTag severity={item.severity} />}
                />
            )}
        />
    );
}

function RecentFacts({ summary, loading, onOpen }) {
    const t = useT();
    const facts = getList(summary, 'recent_facts', 'facts');
    return (
        <List
            className="dashboard-list dashboard-feed dashboard-facts"
            split={false}
            loading={loading}
            dataSource={facts || []}
            emptyContent={<DashboardEmpty loading={loading} unavailable={facts === null} title={t('ui.dashboardPage.factsEmptyTitle', null, 'No recent facts')} description={t('ui.dashboardPage.factsEmptyDesc', null, 'Facts and evidence collected in projects will appear here.')} />}
            renderItem={(fact, index) => (
                <List.Item
                    key={fact.id || fact.key || fact.fact_key || index}
                    main={(
                        <div className="dashboard-record">
                            <Text strong className="dashboard-fact-title">{fact.title || fact.summary || fact.key || fact.fact_key || fact.subject || t('ui.dashboardPage.fact', null, 'Fact')}</Text>
                            <Text type="tertiary" size="small" className="dashboard-meta">
                                {fact.project_name || fact.projectName || fact.value || '—'}
                            </Text>
                        </div>
                    )}
                    extra={(
                        <Space spacing={8}>
                            {fact.status && <Tag size="small">{fact.status}</Tag>}
                            {fact.project_id && (
                                <Button theme="borderless" icon={<IconArrowRight />} aria-label={t('ui.dashboardPage.openProject', null, 'View project')} onClick={() => onOpen(fact.project_id)} />
                            )}
                        </Space>
                    )}
                />
            )}
        />
    );
}

export default function DashboardPage() {
    const t = useT();
    const navigate = useNavigate();
    const { data, loading, error, reload } = useResource(loadDashboard, []);
    useInterval(() => reload({ silent: true }), 60000);

    const metrics = useMemo(() => {
        const runningAgents = countList(data?.agentTasks, 'tasks');
        const tokenCount = asCount(data?.tokenUsage?.summary?.totalTokens);
        const critical = severityCount(data?.vulnStats, 'critical');
        const pendingHigh = severityCount(data?.pendingVulnStats, 'high');
        const summary = data?.monitorStats?.summary;
        const successCalls = asCount(summary?.successCalls);
        const failedCalls = asCount(summary?.failedCalls);
        const effective = successCalls === null || failedCalls === null ? null : successCalls + failedCalls;
        const rate = effective > 0 ? successCalls / effective : null;
        const queues = getList(data?.batchQueues, 'queues');
        const batchRunning = queues?.filter(queue => String(queue.status).toLowerCase() === 'running').length;
        return [
            {
                id: 'tasks',
                label: t('dashboard.runningConversations', null, 'Running conversations'),
                value: displayCount(runningAgents),
                detail: t('ui.dashboardPage.runningBatchQueues', { count: displayCount(batchRunning) }, 'Running batch queues {{count}}'),
                icon: <IconCheckList />,
                onClick: () => navigate('/tasks')
            },
            {
                id: 'vulnerabilities',
                label: t('dashboard.vulnTotal', null, 'Total vulnerabilities'),
                value: displayCount(data?.vulnStats?.total),
                detail: t('dashboard.openHighCountLabel', { count: displayCount(pendingHigh) }, 'Open high {{count}}'),
                tone: critical > 0 ? 'danger' : undefined,
                icon: <IconShield />,
                onClick: () => navigate('/vulnerabilities')
            },
            {
                id: 'calls',
                label: t('dashboard.toolCalls', null, 'Tool invocations'),
                value: displayCount(summary?.totalCalls),
                detail: t('ui.dashboardPage.toolsInvolved', { count: displayCount(summary?.toolCount) }, 'Tools involved {{count}}'),
                icon: <IconTerminal />,
                onClick: () => navigate('/mcp-monitor')
            },
            {
                id: 'rate',
                label: t('dashboard.successRate', null, 'Tool success rate'),
                value: rate === null ? '—' : formatPercent(rate),
                detail: effective === null ? t('ui.dashboardPage.resultUnavailable', null, 'Execution results unavailable') : effective === 0 ? t('ui.dashboardPage.noFinishedCalls', null, 'No completed calls yet') : t('ui.dashboardPage.failedTimes', { count: displayCount(failedCalls) }, 'Failed {{count}} times'),
                tone: rate !== null && rate < 0.8 ? 'warning' : undefined,
                icon: <IconCheckCircleStroked />,
                onClick: () => navigate('/mcp-monitor')
            },
            {
                id: 'tokens',
                label: t('dashboard.tokenUsage', null, 'Token usage'),
                value: tokenCount >= 1_000_000 ? compactNumber.format(tokenCount) : displayCount(tokenCount),
                valueTitle: tokenCount >= 1_000_000 ? displayCount(tokenCount) : undefined,
                detail: t('ui.dashboardPage.callCount', { count: displayCount(data?.tokenUsage?.summary?.modelCalls ?? data?.tokenUsage?.summary?.calls) }, 'Calls {{count}}'),
                icon: <IconBolt />,
                onClick: () => navigate('/settings?section=token-usage')
            }
        ].map(metric => ({ ...metric, loading, detail: loading ? t('ui.dashboardPage.refreshing', null, 'Refreshing data') : metric.detail }));
    }, [data, loading, navigate, t]);

    const alerts = useMemo(() => {
        const list = [];
        const critical = severityCount(data?.vulnStats, 'critical');
        if (critical > 0) list.push({ id: 'critical', text: t('ui.dashboardPage.alertCritical', { count: displayCount(critical) }, '{{count}} critical vulnerabilities'), page: '/vulnerabilities' });
        const pending = countList(data?.hitlPending, 'items', 'pending');
        if (pending > 0) list.push({ id: 'pending', text: t('ui.dashboardPage.alertPending', { count: displayCount(pending) }, '{{count}} approvals pending'), page: '/hitl' });
        const failed = asCount(data?.monitorStats?.summary?.failedCalls);
        if (failed > 0) list.push({ id: 'failed', text: t('ui.dashboardPage.alertFailed', { count: displayCount(failed) }, 'Tool calls failed {{count}} times'), page: '/mcp-monitor' });
        const mcpTotal = asCount(data?.externalMcp?.total);
        const mcpConnected = asCount(data?.externalMcp?.connected);
        if (mcpTotal !== null && mcpConnected !== null && mcpTotal > mcpConnected) {
            list.push({ id: 'mcp', text: t('ui.dashboardPage.alertMcp', { count: displayCount(mcpTotal - mcpConnected) }, '{{count}} external MCP servers not connected'), page: '/mcp-management' });
        }
        return list;
    }, [data, t]);

    const capability = useMemo(() => [
        { id: 'tools', label: t('ui.dashboardPage.capTools', null, 'MCP tools'), value: data?.toolsConfig?.total, page: '/mcp-management' },
        { id: 'knowledge', label: t('ui.dashboardPage.capKnowledge', null, 'Knowledge items'), value: data?.knowledgeStats?.total_items, page: '/knowledge-management' },
        { id: 'skills', label: t('ui.dashboardPage.capSkills', null, 'Skills'), value: data?.skillsStats?.total_skills, page: '/skills-management' },
        { id: 'roles', label: t('ui.dashboardPage.capRoles', null, 'Roles'), value: countList(data?.roles, 'roles'), page: '/roles-management' },
        { id: 'agents', label: t('ui.dashboardPage.capAgents', null, 'Agents'), value: countList(data?.agents, 'agents'), page: '/agents-management' },
        { id: 'webshell', label: t('ui.dashboardPage.capWebshell', null, 'WebShell connections'), value: countList(data?.webshell, 'connections'), page: '/webshell' },
        { id: 'listeners', label: t('ui.dashboardPage.capListeners', null, 'C2 listeners'), value: countList(data?.c2Listeners, 'listeners'), page: '/c2-listeners' },
        { id: 'sessions', label: t('ui.dashboardPage.capSessions', null, 'C2 sessions'), value: countList(data?.c2Sessions, 'sessions', 'items'), page: '/c2-sessions' }
    ].filter(item => (item.id !== 'listeners' || data?.c2Listeners?.enabled !== false)
        && (item.id !== 'sessions' || data?.c2Sessions?.enabled !== false)), [data, t]);

    const lastUpdated = data?.loadedAt ? formatDateTime(data.loadedAt) : '—';
    const openProject = id => navigate(`/projects?id=${encodeURIComponent(id)}`);

    return (
        <div className="dashboard-page" aria-busy={loading}>
            <PageHeader
                title={t('dashboard.title', null, 'Dashboard')}
                description={t('ui.dashboardPage.lastRefresh', { time: lastUpdated }, 'Last refreshed {{time}} · auto-refreshes every 60 seconds')}
                extra={<>
                    <Button icon={<IconRefresh />} onClick={() => reload()} loading={loading}>{t('common.refresh', null, 'Refresh')}</Button>
                    <Button theme="solid" icon={<IconComment />} onClick={() => navigate('/chat')}>{t('ui.dashboardPage.enterChat', null, 'Open conversation')}</Button>
                </>}
            />
            <StatGrid metrics={metrics} columns={5} />

            <ErrorBanner error={error} onRetry={() => reload()} />
            {data?.unavailableCount > 0 && (
                <Banner
                    className="dashboard-notice"
                    type="info"
                    fullMode={false}
                    closeIcon={null}
                    title={data.unavailableCount === data.sourceCount ? t('ui.dashboardPage.unavailableTitle', null, 'Data unavailable') : t('ui.dashboardPage.partialTitle', null, 'Some data unavailable')}
                    description={data.unavailableCount === data.sourceCount
                        ? t('ui.dashboardPage.allFailedDesc', null, 'Could not retrieve dashboard data. Check the service connection, then refresh and try again.')
                        : t('ui.dashboardPage.partialDesc', { count: data.unavailableCount }, '{{count}} data sources failed to load; the related values are shown as —. Data that was returned is still available. Please refresh and try again later.')}
                />
            )}
            {alerts.length > 0 && (
                <Banner
                    className="dashboard-notice"
                    type="warning"
                    fullMode={false}
                    closeIcon={null}
                    description={(
                        <Space wrap spacing={8}>
                            <Text strong>{t('ui.dashboardPage.attention', null, 'Needs attention')}</Text>
                            {alerts.map(item => (
                                <Button key={item.id} theme="borderless" type="warning" icon={<IconArrowRight />} iconPosition="right" onClick={() => navigate(item.page)}>
                                    {item.text}
                                </Button>
                            ))}
                        </Space>
                    )}
                />
            )}

            <div className="dashboard-grid">
                <div className="dashboard-column">
                    <VulnerabilityOverview
                        stats={data?.vulnStats}
                        pendingStats={data?.pendingVulnStats}
                        latest={data?.vulnList?.vulnerabilities?.[0]?.created_at}
                        loadedAt={data?.loadedAt}
                        loading={loading}
                    />
                    <SectionCard
                        title={t('dashboard.recentVulns', null, 'Recent vulnerabilities')}
                        extra={<Button theme="borderless" size="small" icon={<IconArrowRight />} iconPosition="right" onClick={() => navigate('/vulnerabilities')}>{t('ui.dashboardPage.viewAll', null, 'View all')}</Button>}
                    >
                        <RecentVulnerabilities data={data?.vulnList} loading={loading} onOpen={id => navigate(`/vulnerabilities?id=${encodeURIComponent(id)}`)} />
                    </SectionCard>
                </div>
                <div className="dashboard-column">
                    <SectionCard
                        title={t('dashboard.projects', null, 'Project overview')}
                        extra={<Button theme="borderless" size="small" icon={<IconArrowRight />} iconPosition="right" onClick={() => navigate('/projects')}>{t('ui.dashboardPage.allProjects', null, 'All projects')}</Button>}
                    >
                        <ProjectSummary summary={data?.projectSummary} loading={loading} onOpen={openProject} />
                    </SectionCard>
                    <SectionCard
                        title={t('dashboard.toolsTop', null, 'Top tool calls')}
                        extra={<Button theme="borderless" size="small" onClick={() => navigate('/mcp-monitor')}>{t('ui.dashboardPage.callMonitor', null, 'Call monitor')}</Button>}
                    >
                        <TopTools data={data?.monitorStats} loading={loading} />
                    </SectionCard>
                    <SectionCard
                        className="dashboard-capability-card"
                        bodyClassName="dashboard-capability-body"
                        title={t('dashboard.capability', null, 'Capabilities and runtime')}
                    >
                        <List
                            className="dashboard-capabilities"
                            split={false}
                            dataSource={capability}
                            renderItem={item => (
                                <List.Item key={item.id}>
                                    <Button block theme="borderless" type="tertiary" className="dashboard-capability" onClick={() => navigate(item.page)}>
                                        <span>{item.label}</span>
                                        <span className="dashboard-capability-value">{loading ? '…' : displayCount(item.value)}</span>
                                    </Button>
                                </List.Item>
                            )}
                        />
                    </SectionCard>
                </div>
            </div>
            <SectionCard className="dashboard-facts-card" title={t('dashboard.recentFacts', null, 'Recent facts')}>
                <RecentFacts summary={data?.projectSummary} loading={loading} onOpen={openProject} />
            </SectionCard>
        </div>
    );
}

function TopTools({ data, loading }) {
    const t = useT();
    const tools = getList(data, 'topTools');
    const items = tools?.slice(0, 8).map(tool => ({
        name: tool.name || tool.toolName || t('ui.dashboardPage.toolUntitled', null, 'Unnamed tool'),
        count: asCount(tool.count ?? tool.calls ?? tool.totalCalls)
    })) || [];
    const max = Math.max(...items.map(tool => tool.count ?? 0), 1);
    return (
        <List
            className="dashboard-list"
            loading={loading}
            dataSource={items}
            emptyContent={<DashboardEmpty loading={loading} unavailable={tools === null} title={t('ui.dashboardPage.toolsEmptyTitle', null, 'No tool calls')} description={t('ui.dashboardPage.toolsEmptyDesc', null, 'After tasks run, the most-used tools appear here.')} />}
            renderItem={(tool, index) => (
                <List.Item key={`${tool.name}-${index}`} className="dashboard-tool-row">
                    <Text type="tertiary" size="small" className="dashboard-tool-rank">{index + 1}</Text>
                    <div className="dashboard-record">
                        <div className="dashboard-tool-heading">
                            <Text className="dashboard-tool-name" title={tool.name}>{tool.name}</Text>
                            <Text type="secondary" size="small" className="dashboard-count">{t('ui.dashboardPage.times', { count: displayCount(tool.count) }, '{{count}} times')}</Text>
                        </div>
                        {tool.count !== null && (
                            <Progress percent={Math.round((tool.count / max) * 100)} showInfo={false} size="small" stroke="var(--semi-color-primary)" aria-label={t('ui.dashboardPage.callsAria', { name: tool.name }, '{{name}} call count')} aria-valuetext={t('ui.dashboardPage.times', { count: displayCount(tool.count) }, '{{count}} times')} />
                        )}
                    </div>
                </List.Item>
            )}
        />
    );
}

function ProjectSummary({ summary, loading, onOpen }) {
    const t = useT();
    const projects = getList(summary, 'projects');
    const facts = getList(summary, 'recent_facts', 'facts');
    const totalsSource = summary?.totals || summary;
    const totals = [
        [t('ui.dashboardPage.activeProjects', null, 'Active projects'), totalsSource?.active_projects ?? totalsSource?.activeProjects],
        [t('ui.dashboardPage.totalFacts', null, 'Total facts'), totalsSource?.total_facts ?? totalsSource?.totalFacts],
        [t('ui.dashboardPage.recentFacts', null, 'Recent facts'), facts?.length]
    ];
    return (
        <div>
            <dl className="dashboard-project-totals">
                {totals.map(([label, value]) => (
                    <div key={label}>
                        <dt>{label}</dt>
                        <dd>{loading ? '…' : displayCount(value)}</dd>
                    </div>
                ))}
            </dl>
            <List
                className="dashboard-list dashboard-feed"
                loading={loading}
                dataSource={projects?.slice(0, 6) || []}
                emptyContent={(
                    <DashboardEmpty
                        loading={loading}
                        unavailable={!summary}
                        title={projects === null ? t('ui.dashboardPage.continueInProjects', null, 'Continue in projects') : t('ui.dashboardPage.noProjects', null, 'No projects')}
                        description={projects === null ? t('ui.dashboardPage.summaryOnlyDesc', null, 'The current summary provides project and fact statistics. See All projects for the full list.') : t('ui.dashboardPage.noProjectsDesc', null, 'After you create a project, follow its progress here.')}
                    />
                )}
                renderItem={project => (
                    <List.Item
                        key={project.id}
                        main={(
                            <div className="dashboard-record">
                                <Button theme="borderless" className="dashboard-record-link" onClick={() => onOpen(project.id)}>{project.name || t('ui.dashboardPage.projectUntitled', null, 'Untitled project')}</Button>
                                <Text type="tertiary" size="small" className="dashboard-meta">
                                    {project.status || '—'} · {formatDateTime(project.updated_at)}
                                </Text>
                            </div>
                        )}
                    />
                )}
            />
        </div>
    );
}

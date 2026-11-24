import { Button, Space, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconRefresh } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import {
    DataTable, ErrorBanner, PageHeader, SectionCard, StatGrid, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import { formatNumber, formatPercent } from '../../lib/format';

const { Text } = Typography;

export default function SkillsMonitorPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canDelete = hasPermission('skills:delete');
    const stats = useResource(() => api.get('/skills/stats'), []);
    const rows = Array.isArray(stats.data?.stats) ? stats.data.stats : [];
    const total = Number(stats.data?.total_calls || 0);
    const success = Number(stats.data?.total_success || 0);
    const rate = total > 0 ? success / total : null;

    const clearAll = () => confirmAction({
        title: t('ui.skillsMonitor.clearAllTitle', null, 'Clear call statistics for all skills?'),
        content: t('ui.skillsMonitor.clearAllContent', null, 'Only the counters are affected; skill files are not deleted.'),
        onOk: async () => {
            await api.del('/skills/stats');
            toastSuccess(t('ui.skillsMonitor.clearedAll', null, 'Statistics cleared'));
            stats.reload();
        }
    });

    const clearOne = name => confirmAction({
        title: t('ui.skillsMonitor.clearOneTitle', { name }, 'Clear statistics for "{{name}}"?'),
        onOk: async () => {
            await api.del(`/skills/${encodeURIComponent(name)}/stats`);
            toastSuccess(t('ui.skillsMonitor.clearedOne', null, 'Cleared'));
            stats.reload();
        }
    });

    const columns = [
        { title: t('ui.skillsMonitor.colSkill', null, 'Skill'), dataIndex: 'skill_name', render: value => <Text strong>{value}</Text> },
        { title: t('ui.skillsMonitor.colCalls', null, 'Calls'), dataIndex: 'total_calls', width: 120, render: value => formatNumber(value || 0) },
        { title: t('ui.skillsMonitor.colSuccess', null, 'Succeeded'), dataIndex: 'success_calls', width: 100, render: value => formatNumber(value || 0) },
        {
            title: t('ui.skillsMonitor.colFailed', null, 'Failed'), dataIndex: 'failed_calls', width: 100,
            render: value => (Number(value) > 0 ? <Text type="danger">{formatNumber(value)}</Text> : '0')
        },
        { title: t('ui.skillsMonitor.colLastCall', null, 'Last call'), dataIndex: 'last_call_time', width: 180, render: value => value || '—' },
        {
            title: t('ui.skillsMonitor.colActions', null, 'Actions'), width: 110, render: (_, record) => (
                canDelete && Number(record.total_calls) > 0
                    ? <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} onClick={() => clearOne(record.skill_name)}>{t('ui.skillsMonitor.clear', null, 'Clear')}</Button>
                    : null
            )
        }
    ];

    return (
        <div>
            <PageHeader
                title={t('skills.monitorTitle', null, 'Skills monitor')}
                description={stats.data?.skills_dir
                    ? t('ui.skillsMonitor.skillsDir', { dir: stats.data.skills_dir }, 'Skills directory: {{dir}}')
                    : t('ui.skillsMonitor.description', null, 'Tracks how often skills are called, their success rate and when they were last used.')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} onClick={() => stats.reload()} loading={stats.loading}>{t('ui.skillsMonitor.refresh', null, 'Refresh')}</Button>
                        {canDelete && <Button type="danger" theme="light" onClick={clearAll}>{t('ui.skillsMonitor.clearAll', null, 'Clear all statistics')}</Button>}
                    </Space>
                )}
            />
            <StatGrid
                columns={4}
                metrics={[
                    { id: 'skills', label: t('ui.skillsMonitor.metricSkills', null, 'Total skills'), value: formatNumber(stats.data?.total_skills || 0), loading: stats.loading },
                    { id: 'calls', label: t('ui.skillsMonitor.metricCalls', null, 'Total calls'), value: formatNumber(total), loading: stats.loading },
                    { id: 'success', label: t('ui.skillsMonitor.metricSuccess', null, 'Successful calls'), value: formatNumber(success), loading: stats.loading },
                    { id: 'rate', label: t('ui.skillsMonitor.metricRate', null, 'Success rate'), value: rate === null ? '—' : formatPercent(rate), tone: rate !== null && rate < 0.8 ? 'warning' : 'success', loading: stats.loading }
                ]}
            />
            <SectionCard title={t('ui.skillsMonitor.bySkill', null, 'Statistics by skill')}>
                <ErrorBanner error={stats.error} onRetry={() => stats.reload()} />
                <DataTable columns={columns} dataSource={rows} rowKey="skill_name" loading={stats.loading} pagination={{ pageSize: 20 }} />
            </SectionCard>
        </div>
    );
}

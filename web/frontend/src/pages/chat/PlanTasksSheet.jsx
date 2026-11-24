import { Button, Empty, Progress, SideSheet, Tag, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { translate, useT } from '../../lib/i18n';

const { Text } = Typography;

const TASK_STATUS = {
    pending: { color: 'grey', get label() { return translate('ui.planTasksSheet.statusPending', null, 'Pending'); } },
    in_progress: { color: 'blue', get label() { return translate('ui.planTasksSheet.statusInProgress', null, 'In progress'); } },
    completed: { color: 'green', get label() { return translate('ui.planTasksSheet.statusCompleted', null, 'Completed'); } },
    blocked: { color: 'orange', get label() { return translate('ui.planTasksSheet.statusBlocked', null, 'Blocked'); } },
    deleted: { color: 'grey', get label() { return translate('ui.planTasksSheet.statusDeleted', null, 'Deleted'); } }
};

function PlanTasksPanel({ plan, loading, onRefresh }) {
    const t = useT();
    const tasks = Array.isArray(plan?.tasks)
        ? plan.tasks.filter(task => String(task.status || '').toLowerCase() !== 'deleted')
        : [];
    const total = Number(plan?.total) || tasks.length;
    const completed = Number(plan?.completed) || tasks.filter(task => task.status === 'completed').length;
    const percent = total ? Math.round((completed / total) * 100) : 0;

    return (
        <div className="chat-plan">
            <div className="chat-plan-toolbar">
                <Text type="tertiary" size="small">
                    {plan?.running ? t('chat.planRunning', null, 'Task running') : t('chat.planIdle', null, 'No task is running')}
                </Text>
                <Button size="small" icon={<IconRefresh />} onClick={onRefresh} loading={loading}>
                    {t('common.refresh', null, 'Refresh')}
                </Button>
            </div>
            <Progress percent={percent} showInfo />
            <Text type="tertiary" size="small">
                {t('chat.planSummary', { total, done: completed }, '{{total}} items, {{done}} completed')}
            </Text>
            {!tasks.length && (
                <Empty
                    title={t('chat.planEmpty', null, 'No execution plan')}
                    description={t('chat.planEmptyHint', null, 'The task board appears here after the agent calls the task tool.')}
                    style={{ padding: 24 }}
                />
            )}
            <div className="chat-plan-list">
                {tasks.map((task, index) => {
                    const status = String(task.status || 'pending').toLowerCase();
                    const meta = TASK_STATUS[status] || TASK_STATUS.pending;
                    return (
                        <div className={`chat-plan-item ${status === 'in_progress' ? 'is-active' : ''}`} key={task.id || index}>
                            <div className="chat-plan-item-head">
                                <span className="chat-plan-index">{index + 1}</span>
                                <span className="chat-plan-subject">{task.subject || task.activeForm || '—'}</span>
                                <Tag size="small" color={meta.color} shape="circle">{meta.label}</Tag>
                            </div>
                            {task.description && <div className="chat-plan-desc">{task.description}</div>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function PlanTasksSheet({ visible, onClose, plan, loading, onRefresh }) {
    const t = useT();
    const title = t('chat.planTasks', null, 'Execution plan');
    return (
        <SideSheet
            title={title}
            aria-label={title}
            visible={visible}
            onCancel={onClose}
            width="min(100%, 560px)"
            placement="right"
        >
            <PlanTasksPanel plan={plan} loading={loading} onRefresh={onRefresh} />
        </SideSheet>
    );
}

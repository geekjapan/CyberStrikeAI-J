/** New batch task queue: task list, role, project, agent mode, approval policy, scheduling and concurrency. */
import { useEffect, useState } from 'react';
import { Checkbox, Input, Select, TextArea, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { Drawer, toastError, toastSuccess } from '../../components/ui';
import { AGENT_MODES, HITL_POLICIES, SCHEDULE_MODES, errText } from './helpers';

const { Text } = Typography;

const EMPTY = {
    title: '',
    tasksText: '',
    role: '',
    projectId: '',
    agentMode: 'single',
    hitlPolicy: '',
    scheduleMode: 'manual',
    cronExpr: '',
    concurrency: 1,
    executeNow: false
};

const CRON_PATTERN = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

export default function QueueFormModal({ visible, onCancel, onCreated }) {
    const t = useT();
    const { hasPermission } = useAuth();
    const [form, setForm] = useState(EMPTY);
    const [roles, setRoles] = useState([]);
    const [projects, setProjects] = useState([]);
    const [assetTotal, setAssetTotal] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setForm(EMPTY);
        setSaving(false);
        let cancelled = false;
        if (hasPermission('roles:read')) {
            api.get('/roles')
                .then(payload => { if (!cancelled) setRoles(Array.isArray(payload?.roles) ? payload.roles : []); })
                .catch(() => { if (!cancelled) setRoles([]); });
        }
        if (hasPermission('project:read')) {
            api.get('/projects', { limit: 500 })
                .then(payload => { if (!cancelled) setProjects(Array.isArray(payload?.projects) ? payload.projects : []); })
                .catch(() => { if (!cancelled) setProjects([]); });
        }
        return () => { cancelled = true; };
    }, [visible, hasPermission]);

    useEffect(() => {
        if (!visible || !form.projectId || !hasPermission('asset:read')) {
            setAssetTotal(null);
            return undefined;
        }
        let cancelled = false;
        api.get('/assets', { project_id: form.projectId, page: 1, page_size: 1 })
            .then(payload => { if (!cancelled) setAssetTotal(Number.isFinite(Number(payload?.total)) ? Number(payload.total) : 0); })
            .catch(() => { if (!cancelled) setAssetTotal(null); });
        return () => { cancelled = true; };
    }, [visible, form.projectId, hasPermission]);

    const update = patch => setForm(prev => ({ ...prev, ...patch }));

    const submit = async () => {
        const tasks = form.tasksText.split('\n').map(line => line.trim()).filter(Boolean);
        if (!tasks.length) {
            toastError(t('tasks.noValidTask', null, 'No valid tasks'));
            return;
        }
        if (form.scheduleMode === 'cron') {
            if (!form.cronExpr.trim()) {
                toastError(t('batchImportModal.cronExprRequired', null, 'Please fill in a Cron expression when Cron schedule is selected'));
                return;
            }
            if (!CRON_PATTERN.test(form.cronExpr.trim())) {
                toastError(t('batchImportModal.cronExprInvalid', null, 'Invalid Cron expression format. Must have 5 fields (minute hour day month weekday), e.g.: 0 */2 * * *'));
                return;
            }
        }
        let concurrency = Number(form.concurrency);
        if (!Number.isFinite(concurrency) || concurrency < 1) concurrency = 1;
        if (concurrency > 8) concurrency = 8;
        setSaving(true);
        try {
            const payload = await api.post('/batch-tasks', {
                title: form.title.trim(),
                tasks,
                role: form.role || '',
                projectId: form.projectId || '',
                agentMode: form.agentMode || 'single',
                hitlPolicy: form.hitlPolicy || '',
                scheduleMode: form.scheduleMode === 'cron' ? 'cron' : 'manual',
                cronExpr: form.scheduleMode === 'cron' ? form.cronExpr.trim() : '',
                concurrency,
                executeNow: Boolean(form.executeNow)
            });
            toastSuccess(t('tasks.batchQueueTitle', null, 'Batch task queue'));
            onCreated?.(payload);
        } catch (error) {
            toastError(errText(error, t('tasks.createBatchQueueFailed', null, 'Failed to create batch task queue')));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            title={t('batchImportModal.title', null, 'New task')}
            onCancel={onCancel}
            onOk={submit}
            okText={t('batchImportModal.createQueue', null, 'Create queue')}
            cancelText={t('common.cancel', null, 'Cancel')}
            confirmLoading={saving}
            width={760}
            maskClosable={false}
        >
            <div className="task-form-grid">
                <div className="task-form-field">
                    <Text strong size="small">{t('batchImportModal.queueTitle', null, 'Queue title')}</Text>
                    <Input
                        value={form.title}
                        maxLength={200}
                        placeholder={t('batchImportModal.queueTitlePlaceholder', null, 'Enter queue title (optional, for identification and filtering)')}
                        onChange={value => update({ title: value })}
                    />
                </div>
                <div className="task-form-field">
                    <Text strong size="small">{t('batchImportModal.role', null, 'Role')}</Text>
                    <Select
                        value={form.role}
                        style={{ width: '100%' }}
                        optionList={[{ value: '', label: t('batchImportModal.defaultRole', null, 'Default') },
                            ...roles.map(item => ({ value: item.name, label: item.name }))]}
                        onChange={value => update({ role: value })}
                    />
                    <Text type="tertiary" size="small">{t('batchImportModal.roleHint', null, 'Select a role; all tasks will be executed using that role\'s configuration (prompt and tools).')}</Text>
                </div>
            </div>

            <div className="task-form-grid">
                <div className="task-form-field">
                    <Text strong size="small">{t('batchImportModal.project', null, 'Project')}</Text>
                    <Select
                        value={form.projectId}
                        style={{ width: '100%' }}
                        optionList={[{ value: '', label: t('batchImportModal.projectNone', null, '(Unbound)') },
                            ...projects.map(item => ({ value: item.id, label: item.name || item.id }))]}
                        onChange={value => update({ projectId: value || '' })}
                    />
                </div>
                <div className="task-form-field">
                    <Text strong size="small">{t('batchImportModal.agentMode', null, 'Agent mode')}</Text>
                    <Select
                        value={form.agentMode}
                        style={{ width: '100%' }}
                        optionList={AGENT_MODES}
                        onChange={value => update({ agentMode: value })}
                    />
                    <Text type="tertiary" size="small">{t('batchImportModal.agentModeHint', null, 'Same as chat: Pi single-agent (ADK), or Deep / Plan-Execute / Supervisor (last three require multi_agent.enabled).')}</Text>
                </div>
            </div>

            <div className="task-form-field">
                <Text strong size="small">{t('ui.tasksQueueForm.assetScope', null, 'Asset scope')}</Text>
                <Text type="tertiary" size="small">
                    {form.projectId
                        ? (assetTotal == null
                            ? t('ui.tasksQueueForm.assetAll', null, 'All assets of this project in the asset library')
                            : t('ui.tasksQueueForm.assetAllCount', { count: assetTotal }, 'All assets of this project in the asset library ({{count}})'))
                        : t('ui.tasksQueueForm.assetHint', null, 'After you select a project, the assets of that project in the asset library are used.')}
                </Text>
            </div>

            <div className="task-form-field">
                <Text strong size="small">{t('batchImportModal.tasksList', null, 'Task list (one task per line)')}</Text>
                <TextArea
                    value={form.tasksText}
                    rows={7}
                    placeholder={t('batchImportModal.tasksListPlaceholderExample', null, 'Enter task list, one per line, for example:\nScan open ports of 192.168.1.1\nCheck if https://example.com has SQL injection\nEnumerate subdomains of example.com')}
                    onChange={value => update({ tasksText: value })}
                />
                <Text type="tertiary" size="small">{t('batchImportModal.tasksListHint', null, 'Enter one task command per line; the system runs them via a concurrency pool. Empty lines are ignored.')}</Text>
            </div>

            <div className="task-form-grid">
                <div className="task-form-field">
                    <Text strong size="small">{t('batchImportModal.hitlPolicy', null, 'Tool approval')}</Text>
                    <Select
                        value={form.hitlPolicy}
                        style={{ width: '100%' }}
                        optionList={HITL_POLICIES}
                        onChange={value => update({ hitlPolicy: value })}
                    />
                </div>
                <div className="task-form-field">
                    <Text strong size="small">{t('batchImportModal.concurrency', null, 'Concurrency')}</Text>
                    <Input
                        type="number"
                        min={1}
                        max={8}
                        value={String(form.concurrency)}
                        onChange={value => update({ concurrency: value })}
                    />
                    <Text type="tertiary" size="small">{t('batchImportModal.concurrencyHint', null, 'Number of subtasks to run in parallel (1-8). Default 1 is serial; use 1-2 for scan-heavy tasks.')}</Text>
                </div>
            </div>

            <div className="task-form-grid">
                <div className="task-form-field">
                    <Text strong size="small">{t('batchImportModal.scheduleMode', null, 'Schedule mode')}</Text>
                    <Select
                        value={form.scheduleMode}
                        style={{ width: '100%' }}
                        optionList={SCHEDULE_MODES}
                        onChange={value => update({ scheduleMode: value })}
                    />
                </div>
                <div className="task-form-field">
                    <Text strong size="small">{t('batchImportModal.cronExpr', null, 'Cron expression')}</Text>
                    <Input
                        value={form.cronExpr}
                        disabled={form.scheduleMode !== 'cron'}
                        placeholder={t('batchImportModal.cronExprPlaceholder', null, 'e.g. 0 */2 * * * (run every 2 hours)')}
                        onChange={value => update({ cronExpr: value })}
                    />
                    <Text type="tertiary" size="small">{t('batchImportModal.cronExprHint', null, 'Use standard 5-field Cron: minute hour day month weekday. Example: `0 2 * * *` runs at 02:00 daily.')}</Text>
                </div>
            </div>

            <div className="task-form-field">
                <Checkbox checked={form.executeNow} onChange={event => update({ executeNow: event.target.checked })}>
                    {t('batchImportModal.executeNow', null, 'Run immediately after creation')}
                </Checkbox>
                <Text type="tertiary" size="small">{t('batchImportModal.executeNowHint', null, 'Default is off. When disabled, the queue stays pending and can be started manually later.')}</Text>
            </div>
        </Drawer>
    );
}

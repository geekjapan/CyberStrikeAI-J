/** Task page private helpers: status dictionary, progress calculation, error text normalization. */
import { currentLocale } from '../../lib/format';
import { translate } from '../../lib/i18n';

export const QUEUE_STATUS = {
    pending: { get label() { return translate('ui.tasksHelpers.queueStatusPending', null, 'Pending'); }, color: 'amber' },
    running: { get label() { return translate('ui.tasksHelpers.queueStatusRunning', null, 'Running'); }, color: 'blue' },
    paused: { get label() { return translate('ui.tasksHelpers.queueStatusPaused', null, 'Paused'); }, color: 'grey' },
    completed: { get label() { return translate('ui.tasksHelpers.queueStatusCompleted', null, 'Completed'); }, color: 'green' },
    cancelled: { get label() { return translate('ui.tasksHelpers.queueStatusCancelled', null, 'Cancelled'); }, color: 'grey' }
};

export const TASK_STATUS = {
    pending: { get label() { return translate('ui.tasksHelpers.taskStatusPending', null, 'Pending'); }, color: 'amber' },
    running: { get label() { return translate('ui.tasksHelpers.taskStatusRunning', null, 'Running'); }, color: 'blue' },
    completed: { get label() { return translate('ui.tasksHelpers.taskStatusCompleted', null, 'Completed'); }, color: 'green' },
    failed: { get label() { return translate('ui.tasksHelpers.taskStatusFailed', null, 'Failed'); }, color: 'red' },
    cancelled: { get label() { return translate('ui.tasksHelpers.taskStatusCancelled', null, 'Cancelled'); }, color: 'grey' },
    blocked: { get label() { return translate('ui.tasksHelpers.taskStatusBlocked', null, 'Blocked'); }, color: 'orange' }
};

export const AGENT_MODES = [
    { value: 'single', get label() { return translate('ui.tasksHelpers.agentModeSingle', null, 'Single agent (Pi SDK)'); } },
    { value: 'deep', label: 'Deep（DeepAgent）' },
    { value: 'plan_execute', label: 'Plan-Execute' },
    { value: 'supervisor', get label() { return translate('ui.tasksHelpers.agentModeSupervisor', null, 'Supervisor (expert routing)'); } }
];

export const HITL_POLICIES = [
    { value: '', get label() { return translate('ui.tasksHelpers.hitlInherit', null, 'Use global setting'); } },
    { value: 'off', get label() { return translate('ui.tasksHelpers.hitlOff', null, 'Approval off'); } },
    { value: 'human', get label() { return translate('ui.tasksHelpers.hitlHuman', null, 'Human approval'); } },
    { value: 'audit_agent', get label() { return translate('ui.tasksHelpers.hitlAuditAgent', null, 'Agent approval'); } },
    { value: 'review_edit', get label() { return translate('ui.tasksHelpers.hitlReviewEdit', null, 'Agent review and edit'); } }
];

export const SCHEDULE_MODES = [
    { value: 'manual', get label() { return translate('ui.tasksHelpers.scheduleManual', null, 'Manual'); } },
    { value: 'cron', get label() { return translate('ui.tasksHelpers.scheduleCron', null, 'Cron schedule'); } }
];

export const QUEUE_STATUS_FILTERS = [
    { value: 'all', get label() { return translate('ui.tasksHelpers.filterAll', null, 'All statuses'); } },
    { value: 'pending', get label() { return translate('ui.tasksHelpers.queueStatusPending', null, 'Pending'); } },
    { value: 'running', get label() { return translate('ui.tasksHelpers.queueStatusRunning', null, 'Running'); } },
    { value: 'paused', get label() { return translate('ui.tasksHelpers.queueStatusPaused', null, 'Paused'); } },
    { value: 'completed', get label() { return translate('ui.tasksHelpers.queueStatusCompleted', null, 'Completed'); } },
    { value: 'cancelled', get label() { return translate('ui.tasksHelpers.queueStatusCancelled', null, 'Cancelled'); } }
];

export function queueStats(queue) {
    const tasks = Array.isArray(queue?.tasks) ? queue.tasks : [];
    const total = tasks.length;
    const completed = tasks.filter(task => task.status === 'completed').length;
    const failed = tasks.filter(task => task.status === 'failed').length;
    const cancelled = tasks.filter(task => task.status === 'cancelled').length;
    const blocked = tasks.filter(task => task.status === 'blocked').length;
    const running = tasks.filter(task => task.status === 'running').length;
    const pending = tasks.filter(task => task.status === 'pending').length;
    const done = completed + failed + cancelled + blocked;
    const percent = total ? Math.round((done / total) * 100) : 0;
    return { total, completed, failed, cancelled, blocked, running, pending, done, percent };
}

export function agentModeLabel(mode) {
    return (AGENT_MODES.find(item => item.value === String(mode || 'single')) || AGENT_MODES[0]).label;
}

/** Status display: a Cron queue stresses cyclic scheduling when "round finished"; the underlying status is unchanged. */
export function queueStatusView(queue) {
    const base = QUEUE_STATUS[String(queue?.status || '')] || { label: queue?.status || '—', color: 'grey' };
    const cronOn = queue?.scheduleMode === 'cron' && queue?.scheduleEnabled !== false;
    const nextRun = queue?.nextRunAt ? new Date(queue.nextRunAt) : null;
    const nextText = nextRun && Number.isFinite(nextRun.getTime()) ? nextRun.toLocaleString(currentLocale(), { hourCycle: 'h23' }) : '';
    const stats = queueStats(queue);
    const blockedNote = stats.blocked > 0 ? (queue?.lastRunError || translate('ui.tasksHelpers.blockedCount', { count: stats.blocked }, '{{count}} blocked')) : '';
    if (stats.blocked > 0 && stats.completed === 0 && stats.failed === 0) {
        return { ...base, label: translate('ui.tasksHelpers.blockedLabel', { count: stats.blocked }, 'Blocked ({{count}})'), color: 'orange', sublabel: blockedNote };
    }
    if (cronOn && queue?.status === 'completed') {
        const unfinished = stats.failed > 0 || stats.blocked > 0;
        return {
            ...base,
            label: unfinished
                ? translate('ui.tasksHelpers.cronRoundEnded', null, 'Round ended · cron loop active')
                : translate('ui.tasksHelpers.cronRoundCompleted', null, 'Round completed · cron loop active'),
            color: stats.failed > 0 ? 'red' : (stats.blocked > 0 ? 'orange' : base.color),
            sublabel: blockedNote || (nextText ? translate('ui.tasksHelpers.nextRun', { time: nextText }, 'Next run: {{time}}') : ''),
            note: translate('ui.tasksHelpers.cronQueueNote', null, 'Scheduled queue: all subtasks have finished; the next round starts automatically on schedule')
        };
    }
    if (cronOn && queue?.status === 'pending' && nextText) {
        return { ...base, sublabel: translate('ui.tasksHelpers.cronScheduled', { time: nextText }, 'Cron scheduled · next {{time}}') };
    }
    if (queue?.status === 'completed' && stats.failed > 0) {
        const blockedText = stats.blocked > 0 ? translate('ui.tasksHelpers.blockedSuffix', { count: stats.blocked }, ', {{count}} blocked') : '';
        return { ...base, label: translate('ui.tasksHelpers.endedFailed', { failed: stats.failed, blocked: blockedText }, 'Ended ({{failed}} failed{{blocked}})'), color: 'red', sublabel: blockedNote };
    }
    if (queue?.status === 'completed' && stats.blocked > 0) {
        return { ...base, label: translate('ui.tasksHelpers.endedBlocked', { count: stats.blocked }, 'Ended ({{count}} blocked)'), color: 'orange', sublabel: blockedNote };
    }
    return { ...base, sublabel: '' };
}

export function durationText(start, end) {
    if (!start) return '—';
    const from = new Date(start).getTime();
    const to = end ? new Date(end).getTime() : Date.now();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return '—';
    const seconds = Math.round((to - from) / 1000);
    if (seconds < 60) return translate('ui.tasksHelpers.durSeconds', { s: seconds }, '{{s}} s');
    if (seconds < 3600) return translate('ui.tasksHelpers.durMinSec', { m: Math.floor(seconds / 60), s: seconds % 60 }, '{{m}} min {{s}} s');
    return translate('ui.tasksHelpers.durHourMin', { h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60) }, '{{h}} h {{m}} min');
}

export function errText(error, fallback = translate('ui.tasksHelpers.opFailed', null, 'Operation failed')) {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    const payload = error.payload;
    if (payload && typeof payload === 'object') {
        const body = payload.error;
        if (typeof body === 'string' && body) return body;
        if (body && typeof body === 'object') {
            const message = typeof body.message === 'string' ? body.message : '';
            const code = typeof body.code === 'string' ? body.code : '';
            if (message) return code ? `${message}（${code}）` : message;
        }
        if (typeof payload.message === 'string' && payload.message) return payload.message;
    }
    if (typeof error.message === 'string' && error.message && error.message !== '[object Object]') return error.message;
    return fallback;
}

export function errorProp(error, fallback = translate('ui.tasksHelpers.loadFailed', null, 'Failed to load')) {
    if (!error) return null;
    return { message: errText(error, fallback) };
}

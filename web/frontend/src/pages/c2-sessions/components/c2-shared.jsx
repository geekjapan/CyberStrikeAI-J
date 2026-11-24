/**
 * C2 page shared constants, quick time filters and small display helpers.
 */
import { Button, Space, Typography } from '@douyinfe/semi-ui';
import { lazyLabels, lazyOptions, translate, useT } from '../../../lib/i18n';
import { formatDateTime, relativeTime } from '../../../lib/format';
import './c2-shared.css';

const { Text } = Typography;

export const LISTENER_TYPES = [
    { value: 'http_beacon', label: 'HTTP Beacon' },
    { value: 'https_beacon', label: 'HTTPS Beacon' },
    { value: 'tcp_reverse', get label() { return translate('ui.c2Shared.tcpReverse', null, 'TCP reverse'); } },
    { value: 'websocket', label: 'WebSocket' }
];

export const LISTENER_STATUS_LABEL = lazyLabels('ui.c2Shared.listenerStatus', {
    running: 'Running',
    stopped: 'Stopped',
    error: 'Error'
});

export const HEARTBEAT_TYPES = new Set(['http_beacon', 'https_beacon', 'websocket']);

export const ONELINER_KINDS = {
    tcp_reverse: [
        { value: 'bash', label: 'Bash (/dev/tcp)' },
        { value: 'nc', label: 'Netcat (-e)' },
        { value: 'nc_mkfifo', label: 'Netcat (mkfifo)' },
        { value: 'python', label: 'Python' },
        { value: 'perl', label: 'Perl' },
        { value: 'powershell', label: 'PowerShell' }
    ],
    http_beacon: [{ value: 'curl_beacon', label: 'Curl Beacon (HTTP)' }],
    https_beacon: [{ value: 'curl_beacon', label: 'Curl Beacon (HTTP)' }],
    websocket: [{ value: 'curl_beacon', label: 'Curl Beacon (HTTP)' }]
};

export const TASK_TYPES = [
    { value: 'shell', label: 'shell' },
    { value: 'exec', label: 'exec' },
    { value: 'ls', label: 'ls' },
    { value: 'pwd', label: 'pwd' },
    { value: 'cd', label: 'cd' },
    { value: 'ps', label: 'ps' },
    { value: 'kill_proc', label: 'kill_proc' },
    { value: 'download', label: 'download' },
    { value: 'upload', label: 'upload' },
    { value: 'screenshot', label: 'screenshot' },
    { value: 'sleep', label: 'sleep' },
    { value: 'exit', label: 'exit' },
    { value: 'self_delete', label: 'self_delete' },
    { value: 'port_fwd', label: 'port_fwd' },
    { value: 'socks_start', label: 'socks_start' },
    { value: 'socks_stop', label: 'socks_stop' },
    { value: 'load_assembly', label: 'load_assembly' },
    { value: 'persist', label: 'persist' }
];

export const TASK_STATUS_OPTIONS = lazyOptions('ui.c2Shared.taskStatus', [
    { value: 'queued', label: 'Queued' },
    { value: 'sent', label: 'Sent' },
    { value: 'running', label: 'Running' },
    { value: 'success', label: 'Succeeded' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' }
]);

export const EVENT_LEVEL_OPTIONS = lazyOptions('ui.c2Shared.eventLevel', [
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Warning' },
    { value: 'critical', label: 'Critical' }
]);

export const EVENT_CATEGORY_OPTIONS = lazyOptions('ui.c2Shared.eventCategory', [
    { value: 'listener', label: 'Listener' },
    { value: 'session', label: 'Session' },
    { value: 'task', label: 'Task' },
    { value: 'payload', label: 'Payload' },
    { value: 'opsec', label: 'OPSEC' }
]);

export const SESSION_STATUS_OPTIONS = lazyOptions('ui.c2Shared.sessionStatus', [
    { value: 'active', label: 'Active' },
    { value: 'sleeping', label: 'Sleeping' },
    { value: 'dead', label: 'Offline' },
    { value: 'killed', label: 'Terminated' }
]);

/** Task/event polling interval: requirements call for 5-second polling. */
export const POLL_INTERVAL = 5000;

export const TIME_PRESETS = lazyOptions('ui.c2Shared.timePreset', [
    { value: '15m', label: 'Last 15 minutes', ms: 15 * 60 * 1000 },
    { value: '1h', label: 'Last hour', ms: 60 * 60 * 1000 },
    { value: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
    { value: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
    { value: 'all', label: 'All', ms: 0 }
]);

/** Quick time window -> since (RFC3339); all returns an empty string. */
export function presetToSince(preset) {
    const item = TIME_PRESETS.find(entry => entry.value === preset);
    if (!item || !item.ms) return '';
    return new Date(Date.now() - item.ms).toISOString();
}

export function TimePresetBar({ value, onChange, ns = 'tasks' }) {
    const t = useT();
    return (
        <Space spacing={6} wrap className="c2-time-presets">
            <Text type="tertiary" size="small">{t('c2.tasks.timePresets', null, 'Quick')}</Text>
            {TIME_PRESETS.map(preset => (
                <Button
                    key={preset.value}
                    size="small"
                    theme={preset.value === value ? 'solid' : 'borderless'}
                    type={preset.value === value ? 'primary' : 'tertiary'}
                    onClick={() => onChange(preset.value)}
                >
                    {t(`c2.${ns}.preset${preset.value === 'all' ? 'All' : preset.value}`, null, preset.label)}
                </Button>
            ))}
        </Space>
    );
}

export function formatDurationMs(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return '—';
    if (value < 1000) return `${Math.round(value)}ms`;
    if (value < 60_000) return translate('ui.c2Shared.seconds', { n: (value / 1000).toFixed(1) }, '{{n}} s');
    return translate('ui.c2Shared.minutes', { n: Math.round(value / 60_000) }, '{{n}} min');
}

export function TimeText({ value }) {
    const t = useT();
    if (!value) return <Text type="tertiary">—</Text>;
    return (
        <span className="c2-time-text" title={formatDateTime(value)}>
            {relativeTime(value, t)}
        </span>
    );
}

export function truncateMiddle(text, max = 42) {
    const value = String(text || '');
    if (value.length <= max) return value;
    const side = Math.floor((max - 1) / 2);
    return `${value.slice(0, side)}…${value.slice(value.length - side)}`;
}

export const LISTENER_STATUS_COLOR = { running: 'green', stopped: 'grey', error: 'red' };
export const TASK_STATUS_COLOR = {
    queued: 'amber', sent: 'blue', running: 'blue', success: 'green', failed: 'red', cancelled: 'grey'
};
export const SESSION_STATUS_COLOR = { active: 'green', sleeping: 'amber', dead: 'grey', killed: 'red' };
export const EVENT_LEVEL_COLOR = { info: 'blue', warn: 'amber', critical: 'red' };

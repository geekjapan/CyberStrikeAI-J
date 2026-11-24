/**
 * C2 task dispatch: POST /c2/tasks, organizes the payload by task type.
 */
import { useState } from 'react';
import { Button, Form, Space, Typography } from '@douyinfe/semi-ui';
import { Drawer } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { TASK_TYPES } from '../c2-sessions/components/c2-shared';

const { Text } = Typography;

const COMMAND_TYPES = new Set(['shell', 'exec']);
const PATH_TYPES = new Set(['ls', 'download', 'cd']);

export default function CreateTaskModal({ visible, defaultSessionId, onCancel, onSubmit, submitting }) {
    const t = useT();
    const [formApi, setFormApi] = useState(null);
    const [taskType, setTaskType] = useState('shell');

    const submit = values => {
        const payload = {};
        const command = String(values.command || '').trim();
        if (COMMAND_TYPES.has(values.task_type)) {
            payload.command = command;
            const timeout = Number(values.timeout_seconds);
            if (Number.isFinite(timeout) && timeout > 0) payload.timeout_seconds = timeout;
        } else if (PATH_TYPES.has(values.task_type)) {
            payload.path = command;
        } else if (command) {
            payload.path = command;
        }
        const extra = String(values.extra || '').trim();
        if (extra) {
            try {
                Object.assign(payload, JSON.parse(extra));
            } catch (error) {
                payload.raw = extra;
            }
        }
        onSubmit({
            session_id: String(values.session_id || '').trim(),
            task_type: values.task_type || 'shell',
            payload,
            source: 'manual'
        });
    };

    return (
        <Drawer
            visible={visible}
            title={t('c2.tasks.createTitle', null, 'Send task')}
            footer={(
                <Space>
                    <Button onClick={onCancel}>{t('c2.tasks.cancelFilters', null, 'Cancel')}</Button>
                    <Button theme="solid" type="primary" loading={submitting} onClick={() => formApi?.submitForm()}>
                        {t('c2.tasks.createSubmit', null, 'Send')}
                    </Button>
                </Space>
            )}
            width={560}
            onCancel={onCancel}
        >
            <Form
                key={visible ? 'open' : 'closed'}
                initValues={{ session_id: defaultSessionId || '', task_type: 'shell', command: '', timeout_seconds: '60', extra: '' }}
                onSubmit={submit}
                getFormApi={setFormApi}
                labelPosition="top"
                onValueChange={changed => { if (changed.task_type) setTaskType(changed.task_type); }}
            >
                <Form.Input
                    field="session_id"
                    label={t('c2.tasks.labelSession', null, 'Session')}
                    placeholder="s_xxxxxxxx"
                    rules={[{ required: true, message: t('c2.tasks.labelSession', null, 'Session') }]}
                />
                <Form.Select field="task_type" label={t('c2.tasks.labelType', null, 'Type')} optionList={TASK_TYPES} style={{ width: '100%' }} />
                <Form.Input
                    field="command"
                    label={COMMAND_TYPES.has(taskType) ? t('c2.tasks.labelCommand', null, 'Command') : t('c2.tasks.labelPath', null, 'Path')}
                    placeholder={COMMAND_TYPES.has(taskType) ? 'whoami' : '/etc/passwd'}
                />
                {COMMAND_TYPES.has(taskType) && (
                    <Form.Input field="timeout_seconds" label={t('c2.tasks.labelTimeout', null, 'Timeout (seconds)')} placeholder="60" />
                )}
                <Form.Input field="extra" label={t('c2.tasks.labelExtraPayload', null, 'Extra parameters (JSON, optional)')} placeholder='{"key":"value"}' />
                <Text type="tertiary" size="small">
                    {t('c2.tasks.createHint', null, 'A queued task is fetched by the implant at its next check-in. Dangerous task types may require human-in-the-loop approval.')}
                </Text>
            </Form>
        </Drawer>
    );
}

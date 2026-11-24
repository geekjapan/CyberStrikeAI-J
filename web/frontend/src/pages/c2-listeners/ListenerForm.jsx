/**
 * C2 listener form: create / edit, covering bind port, callback address and key OPSEC parameters.
 */
import { useState } from 'react';
import { Button, Form, Space, Typography } from '@douyinfe/semi-ui';
import { Drawer } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { LISTENER_TYPES } from '../c2-sessions/components/c2-shared';

const { Text } = Typography;

function parseConfig(record) {
    if (!record?.configJson) return {};
    try {
        return JSON.parse(record.configJson) || {};
    } catch (error) {
        return {};
    }
}

function toValues(record) {
    const config = parseConfig(record);
    return {
        name: record?.name || '',
        type: record?.type || 'http_beacon',
        project_id: record?.project_id || '',
        bind_host: record?.bindHost || '127.0.0.1',
        bind_port: String(record?.bindPort ?? '4444'),
        callback_host: config.callback_host || '',
        profile_id: record?.profileId || '',
        remark: record?.remark || '',
        default_sleep: String(config.default_sleep ?? 5),
        default_jitter: String(config.default_jitter ?? 0),
        max_concurrent_tasks: String(config.max_concurrent_tasks ?? 0),
        allow_legacy_shell: Boolean(config.allow_legacy_shell)
    };
}

export default function ListenerForm({ visible, record, projects, profiles, submitting, onCancel, onSubmit }) {
    const t = useT();
    const [formApi, setFormApi] = useState(null);
    const [type, setType] = useState(record?.type || 'http_beacon');

    const submit = values => {
        const port = Number(values.bind_port);
        onSubmit({
            name: String(values.name || '').trim(),
            type: values.type,
            project_id: values.project_id || '',
            bind_host: String(values.bind_host || '').trim() || '127.0.0.1',
            bind_port: Number.isFinite(port) ? port : 0,
            callback_host: String(values.callback_host || '').trim(),
            profile_id: values.profile_id || '',
            remark: String(values.remark || '').trim(),
            config: {
                callback_host: String(values.callback_host || '').trim(),
                default_sleep: Number(values.default_sleep) || 5,
                default_jitter: Number(values.default_jitter) || 0,
                max_concurrent_tasks: Number(values.max_concurrent_tasks) || 0,
                allow_legacy_shell: Boolean(values.allow_legacy_shell)
            }
        });
    };

    return (
        <Drawer
            visible={visible}
            title={record ? t('c2.listeners.editTitle', null, 'Edit Listener') : t('c2.listeners.modalCreateTitle', null, 'Create Listener')}
            footer={(
                <Space>
                    <Button onClick={onCancel}>{t('c2.common.cancel', null, 'Cancel')}</Button>
                    <Button theme="solid" type="primary" loading={submitting} onClick={() => formApi?.submitForm()}>
                        {record ? t('c2.listeners.save', null, 'Save') : t('c2.listeners.submitCreate', null, 'Create')}
                    </Button>
                </Space>
            )}
            width={620}
            onCancel={onCancel}
        >
            <Form
                key={record?.id || 'new'}
                initValues={toValues(record)}
                onSubmit={submit}
                getFormApi={setFormApi}
                labelPosition="top"
                onValueChange={changed => { if (changed.type) setType(changed.type); }}
            >
                <div className="c2-form-row">
                    <Form.Input
                        field="name"
                        label={t('c2.listeners.name', null, 'Name')}
                        placeholder={t('c2.listeners.placeholderNameExample', null, 'e.g. http-beacon-01')}
                        rules={[{ required: true, message: t('c2.listeners.nameRequired', null, 'Enter a listener name') }]}
                    />
                    <Form.Select
                        field="type"
                        label={t('c2.listeners.type', null, 'Type')}
                        optionList={LISTENER_TYPES}
                        disabled={Boolean(record)}
                        style={{ width: '100%' }}
                    />
                </div>
                <div className="c2-form-row">
                    <Form.Input field="bind_host" label={t('c2.listeners.bindHost', null, 'Bind Host')} placeholder="127.0.0.1" />
                    <Form.Input
                        field="bind_port"
                        label={t('c2.listeners.bindPort', null, 'Bind Port')}
                        placeholder={t('c2.listeners.placeholderPort', null, 'Enter port number')}
                        rules={[{
                            required: true,
                            validator: (rule, value) => {
                                const port = Number(value);
                                return Number.isInteger(port) && port > 0 && port <= 65535;
                            },
                            message: t('c2.listeners.portInvalid', null, 'Port must be an integer from 1 to 65535')
                        }]}
                    />
                </div>
                <Text type="tertiary" size="small">{t('c2.listeners.bindHintExternal', null, 'Use 0.0.0.0 to allow external access')}</Text>
                <div className="c2-form-row">
                    <Form.Input field="callback_host" label={t('c2.listeners.callbackHost', null, 'Callback host (optional)')} placeholder={t('ui.listenerForm.callbackHostPlaceholder', null, 'Public IP or domain')} />
                    <Form.Select
                        field="profile_id"
                        label={t('c2.listeners.malleableProfile', null, 'Malleable Profile')}
                        optionList={[{ value: '', label: t('c2.listeners.malleableProfileNone', null, 'None') },
                            ...profiles.map(item => ({ value: item.id, label: item.name || item.id }))]}
                        style={{ width: '100%' }}
                    />
                </div>
                <div className="c2-form-row">
                    <Form.Select
                        field="project_id"
                        label={t('c2.listeners.project', null, 'Project')}
                        optionList={[{ value: '', label: t('c2.listeners.projectNone', null, 'No project') },
                            ...projects.map(item => ({ value: item.id, label: item.name || item.id }))]}
                        style={{ width: '100%' }}
                    />
                    <Form.Input field="remark" label={t('c2.listeners.remark', null, 'Remark')} placeholder={t('c2.listeners.placeholderRemarkLong', null, 'Optional remark')} />
                </div>
                <div className="c2-form-row">
                    <Form.Input field="default_sleep" label={t('ui.listenerForm.defaultSleep', null, 'Default sleep (seconds)')} placeholder="5" />
                    <Form.Input field="default_jitter" label={t('ui.listenerForm.defaultJitter', null, 'Default jitter (%)')} placeholder="0" />
                </div>
                <div className="c2-form-row">
                    <Form.Input field="max_concurrent_tasks" label={t('ui.listenerForm.maxConcurrentTasks', null, 'Max concurrent tasks per session (0 = unlimited)')} placeholder="0" />
                    {type === 'tcp_reverse' && (
                        <Form.Switch
                            field="allow_legacy_shell"
                            label={t('c2.listeners.allowLegacyShell', null, 'Allow unencrypted classic reverse shell (lab only)')}
                        />
                    )}
                </div>
            </Form>
        </Drawer>
    );
}

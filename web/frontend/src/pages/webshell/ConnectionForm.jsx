/**
 * WebShell connection form: create / edit, with a one-shot liveness test.
 */
import { useState } from 'react';
import { Form, Button, Space, Typography } from '@douyinfe/semi-ui';
import { useT, translate } from '../../lib/i18n';
import { Drawer, toastError, toastSuccess, toastWarning } from '../../components/ui';
import { probeConnection, MASKED_SECRET } from './api';

const { Text } = Typography;

const TYPE_OPTIONS = [
    { value: 'php', label: 'PHP' },
    { value: 'asp', label: 'ASP' },
    { value: 'aspx', label: 'ASPX' },
    { value: 'jsp', label: 'JSP' },
    { value: 'custom', get label() { return translate('ui.webshellForm.typeCustom', null, 'Custom'); } }
];

const METHOD_OPTIONS = [
    { value: 'post', label: 'POST' },
    { value: 'get', label: 'GET' }
];

const ENCODING_OPTIONS = [
    { value: 'auto', get label() { return translate('ui.webshellForm.encodingAuto', null, 'Auto-detect'); } },
    { value: 'utf-8', label: 'UTF-8' },
    { value: 'gbk', get label() { return translate('ui.webshellForm.encodingGbk', null, 'GBK (Chinese Windows)'); } },
    { value: 'gb18030', label: 'GB18030' }
];

const OS_OPTIONS = [
    { value: 'auto', get label() { return translate('ui.webshellForm.osAuto', null, 'Auto (inferred from the shell type)'); } },
    { value: 'linux', label: 'Linux / Unix' },
    { value: 'windows', label: 'Windows' }
];

function toFormValues(record) {
    if (!record) {
        return {
            url: '', password: '', type: 'php', method: 'post', cmd_param: '',
            encoding: 'auto', os: 'auto', remark: '', project_id: ''
        };
    }
    return {
        url: record.url || '',
        password: record.password || '',
        type: record.type || 'php',
        method: (record.method || 'post').toLowerCase(),
        cmd_param: record.cmdParam || '',
        encoding: record.encoding || 'auto',
        os: record.os || 'auto',
        remark: record.remark || '',
        project_id: record.project_id || ''
    };
}

export default function ConnectionForm({ visible, record, projects, submitting, onCancel, onSubmit }) {
    const t = useT();
    const [formApi, setFormApi] = useState(null);
    const [testing, setTesting] = useState(false);

    const handleTest = async () => {
        const values = formApi?.getValues?.() || {};
        const url = String(values.url || '').trim();
        if (!url) {
            toastWarning(t('webshell.url', null, 'Shell URL'));
            return;
        }
        if (values.password === MASKED_SECRET) {
            toastWarning(t('webshell.testNoExpectedOutput', null, 'Shell responded but expected output was not found. Check password and command parameter name.'));
            return;
        }
        setTesting(true);
        try {
            const result = await probeConnection({
                id: record?.id || '',
                url,
                password: values.password || '',
                type: values.type || 'php',
                method: values.method || 'post',
                cmdParam: values.cmd_param || '',
                encoding: values.encoding || 'auto',
                os: values.os || 'auto'
            });
            if (result.ok) toastSuccess(t('webshell.testSuccess', null, 'Connection OK, shell is reachable'));
            else toastError(result.error || t('webshell.testFailed', null, 'Connectivity test failed'));
        } catch (error) {
            toastError(error, t('webshell.testFailed', null, 'Connectivity test failed'));
        } finally {
            setTesting(false);
        }
    };

    const submit = values => {
        onSubmit({
            url: String(values.url || '').trim(),
            password: values.password || '',
            type: values.type || 'php',
            method: values.method || 'post',
            cmd_param: String(values.cmd_param || '').trim(),
            encoding: values.encoding || 'auto',
            os: values.os || 'auto',
            remark: String(values.remark || '').trim(),
            project_id: values.project_id || ''
        });
    };

    return (
        <Drawer
            visible={visible}
            title={record ? t('webshell.editConnectionTitle', null, 'Edit connection') : t('webshell.addConnection', null, 'Add connection')}
            footer={(
                <Space>
                    <Button onClick={handleTest} loading={testing}>{t('webshell.testConnectivity', null, 'Test connectivity')}</Button>
                    <Button onClick={onCancel}>{t('webshell.cancelEdit', null, 'Cancel')}</Button>
                    <Button theme="solid" type="primary" loading={submitting} onClick={() => formApi?.submitForm()}>
                        {record ? t('webshell.saveFile', null, 'Save') : t('webshell.addConnection', null, 'Add connection')}
                    </Button>
                </Space>
            )}
            width={600}
            onCancel={onCancel}
        >
            <Form
                key={record?.id || 'new'}
                initValues={toFormValues(record)}
                onSubmit={submit}
                getFormApi={setFormApi}
                labelPosition="top"
            >
                <Form.Input
                    field="url"
                    label={t('webshell.url', null, 'Shell URL')}
                    placeholder="http(s)://target.com/shell.php"
                    rules={[{ required: true, message: t('webshell.url', null, 'Shell URL') }]}
                />
                <Form.Input
                    field="password"
                    label={t('webshell.password', null, 'Password / Key')}
                    placeholder={t('webshell.passwordPlaceholder', null, 'e.g. IceSword/AntSword connection password')}
                />
                <div className="webshell-form-row">
                    <Form.Select field="type" label={t('webshell.type', null, 'Shell type')} optionList={TYPE_OPTIONS} style={{ width: '100%' }} />
                    <Form.Select field="method" label={t('webshell.method', null, 'Request method')} optionList={METHOD_OPTIONS} style={{ width: '100%' }} />
                </div>
                <div className="webshell-form-row">
                    <Form.Input field="cmd_param" label={t('webshell.cmdParam', null, 'Command parameter name')} placeholder="cmd" />
                    <Form.Select field="encoding" label={t('webshell.encoding', null, 'Response encoding')} optionList={ENCODING_OPTIONS} style={{ width: '100%' }} />
                </div>
                <div className="webshell-form-row">
                    <Form.Select field="os" label={t('webshell.os', null, 'Target OS')} optionList={OS_OPTIONS} style={{ width: '100%' }} />
                    <Form.Select
                        field="project_id"
                        label={t('webshell.project', null, 'Project')}
                        optionList={projects.map(item => ({ value: item.id, label: item.name || item.id }))}
                        showClear
                        style={{ width: '100%' }}
                        placeholder={t('ui.webshellForm.optional', null, 'Optional')}
                    />
                </div>
                <Form.Input field="remark" label={t('webshell.remark', null, 'Remark')} placeholder={t('webshell.remarkPlaceholder', null, 'Friendly name for this connection')} />
                <Text type="tertiary" size="small">{t('webshell.encodingHint', null, 'Switch to GBK or GB18030 if the Simplified Chinese Windows target shows garbled output.')}</Text>
            </Form>
        </Drawer>
    );
}

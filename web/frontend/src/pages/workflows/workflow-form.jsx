/** Workflow create / edit: metadata + graph JSON textarea (validate, format, template). */
import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Checkbox, Input, InputNumber, Space, TextArea, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { Drawer, toastError, toastSuccess } from '../../components/ui';
import { GRAPH_TEMPLATE, NODE_TYPES, errText, graphSummary } from './helpers';

const { Text } = Typography;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const EMPTY = { id: '', name: '', description: '', version: 1, enabled: true, graph: '' };

export default function WorkflowFormModal({ visible, workflow, onCancel, onSaved }) {
    const t = useT();
    const { hasPermission } = useAuth();
    const canValidate = hasPermission('workflow:execute');

    const [form, setForm] = useState(EMPTY);
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);
    const [check, setCheck] = useState(null);

    const editing = Boolean(workflow?.id);

    useEffect(() => {
        if (!visible) return;
        setCheck(null);
        setSaving(false);
        if (workflow) {
            let graphText = workflow.graph_json || '';
            try {
                graphText = JSON.stringify(JSON.parse(graphText), null, 2);
            } catch (error) { /* Keep the original text and leave it to the validation hint */ }
            setForm({
                id: workflow.id || '',
                name: workflow.name || '',
                description: workflow.description || '',
                version: workflow.version || 1,
                enabled: workflow.enabled !== false,
                graph: graphText
            });
            return;
        }
        setForm({ ...EMPTY, graph: JSON.stringify(GRAPH_TEMPLATE, null, 2) });
    }, [visible, workflow]);

    const update = patch => setForm(prev => ({ ...prev, ...patch }));

    const summary = useMemo(() => graphSummary(form.graph), [form.graph]);

    const format = () => {
        try {
            update({ graph: JSON.stringify(JSON.parse(form.graph), null, 2) });
            setCheck(null);
        } catch (error) {
            toastError(`${t('projects.invalidJson', null, 'Invalid JSON format')}: ${errText(error, '')}`);
        }
    };

    const insertTemplate = () => {
        update({ graph: JSON.stringify(GRAPH_TEMPLATE, null, 2) });
        setCheck(null);
    };

    const validate = async () => {
        if (!form.graph.trim()) {
            setCheck({ type: 'danger', text: t('workflows.validation.serverFailed', null, 'Server graph validation failed') });
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(form.graph);
        } catch (error) {
            setCheck({ type: 'danger', text: t('ui.workflowsForm.jsonParseFailed', { detail: errText(error, '') }, 'Failed to parse JSON: {{detail}}') });
            return;
        }
        setValidating(true);
        setCheck(null);
        try {
            await api.post('/workflows/validate', { graph: parsed });
            setCheck({ type: 'success', text: t('ui.workflowsForm.validationPassed', null, 'Structure validation passed') });
        } catch (error) {
            setCheck({ type: 'danger', text: errText(error, t('workflows.validation.serverFailed', null, 'Server graph validation failed')) });
        } finally {
            setValidating(false);
        }
    };

    const submit = async () => {
        const id = (editing ? workflow.id : form.id).trim();
        const name = form.name.trim();
        if (!id || !name) {
            toastError(t('workflows.idNameRequired', null, 'Workflow ID and name are required'));
            return;
        }
        if (!editing && !ID_PATTERN.test(id)) {
            toastError(t('ui.workflowsForm.invalidId', null, 'The workflow ID must start with a letter or digit and contain only letters, digits, underscores and hyphens'));
            return;
        }
        if (form.graph.trim()) {
            try {
                JSON.parse(form.graph);
            } catch (error) {
                toastError(t('ui.workflowsForm.graphInvalidJson', { detail: errText(error, '') }, 'graph must be valid JSON: {{detail}}'));
                return;
            }
        }
        setSaving(true);
        try {
            const body = {
                id,
                name,
                description: form.description,
                version: Number(form.version) || 0,
                enabled: Boolean(form.enabled),
                graph: form.graph.trim() ? JSON.parse(form.graph) : undefined
            };
            const saved = editing
                ? await api.put(`/workflows/${encodeURIComponent(id)}`, body)
                : await api.post('/workflows', body);
            toastSuccess(t('workflows.saved', null, 'Workflow saved'));
            onSaved?.(saved?.workflow || null);
        } catch (error) {
            toastError(errText(error, t('workflows.saveFailed', null, 'Failed to save workflow')));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            title={editing ? t('workflows.metaModalTitle', null, 'Workflow details') : t('workflows.newGraph', null, 'New workflow')}
            onCancel={onCancel}
            onOk={submit}
            okText={t('common.save', null, 'Save')}
            cancelText={t('common.cancel', null, 'Cancel')}
            confirmLoading={saving}
            width={860}
        >
            <div className="workflow-form-grid">
                <div className="workflow-form-field">
                    <Text strong size="small">{t('workflows.metaId', null, 'ID')}</Text>
                    <Input
                        value={form.id}
                        disabled={editing}
                        placeholder="web-scan-basic"
                        onChange={value => update({ id: value })}
                    />
                    <Text type="tertiary" size="small">{t('workflows.metaIdHint', null, 'Cannot be changed after creation; used for API and role binding')}</Text>
                </div>
                <div className="workflow-form-field">
                    <Text strong size="small">{t('workflows.metaName', null, 'Name')}</Text>
                    <Input
                        value={form.name}
                        placeholder={t('workflows.namePlaceholder', null, 'Basic Web scan')}
                        onChange={value => update({ name: value })}
                    />
                </div>
            </div>

            <div className="workflow-form-grid">
                <div className="workflow-form-field">
                    <Text strong size="small">{t('workflows.metaDescription', null, 'Description')}</Text>
                    <Input
                        value={form.description}
                        placeholder={t('workflows.descriptionPlaceholder', null, 'Optional')}
                        onChange={value => update({ description: value })}
                    />
                </div>
                <div className="workflow-form-grid workflow-form-grid--tight">
                    <div className="workflow-form-field">
                        <Text strong size="small">{t('ui.workflowsForm.version', null, 'Version')}</Text>
                        <InputNumber
                            value={form.version}
                            min={0}
                            style={{ width: '100%' }}
                            onChange={value => update({ version: value || 0 })}
                        />
                    </div>
                    <div className="workflow-form-field">
                        <Text strong size="small">{t('workflows.metaEnabled', null, 'Enabled')}</Text>
                        <Checkbox checked={form.enabled} onChange={event => update({ enabled: event.target.checked })}>
                            {t('workflows.metaEnabledHint', null, 'Disabled workflows cannot be auto-triggered by roles')}
                        </Checkbox>
                    </div>
                </div>
            </div>

            <div className="workflow-form-field">
                <Space>
                    <Text strong size="small">graph JSON</Text>
                    <Text type="tertiary" size="small">
                        {summary.error
                            ? t('ui.workflowsForm.parseFailed', { detail: summary.error }, 'Parse failed: {{detail}}')
                            : t('ui.workflowsForm.nodeEdgeCount', { nodes: summary.nodes.length, edges: summary.edges.length }, '{{nodes}} nodes · {{edges}} edges')}
                    </Text>
                </Space>
                <TextArea
                    value={form.graph}
                    rows={16}
                    spellCheck={false}
                    className="workflow-graph-input"
                    placeholder='{"nodes":[],"edges":[],"config":{}}'
                    onChange={value => { update({ graph: value }); setCheck(null); }}
                />
                <Space wrap>
                    <Button size="small" onClick={format}>{t('projects.formatJson', null, 'Format')}</Button>
                    <Button size="small" onClick={insertTemplate}>{t('ui.workflowsForm.insertTemplate', null, 'Insert minimal template')}</Button>
                    <Button
                        size="small"
                        loading={validating}
                        disabled={!canValidate}
                        title={canValidate ? '' : t('ui.workflowsForm.needExecutePermission', null, 'Requires the workflow:execute permission')}
                        onClick={validate}
                    >
                        {t('workflows.validate', null, 'Validate graph definition')}
                    </Button>
                    <Text type="tertiary" size="small">
                        {t('ui.workflowsForm.nodeTypes', { types: NODE_TYPES.map(item => item.label).join(' / ') }, 'Node types: {{types}}')}
                    </Text>
                </Space>
            </div>

            {check ? (
                <Banner
                    type={check.type}
                    bordered
                    closeIcon={null}
                    description={check.text}
                    style={{ marginTop: 12 }}
                />
            ) : null}
        </Drawer>
    );
}

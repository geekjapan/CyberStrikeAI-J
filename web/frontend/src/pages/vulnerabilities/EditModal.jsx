/** Create/edit vulnerability: fields aligned with CreateVulnerabilityRequest / UpdateVulnerabilityRequest. */
import { useEffect, useId, useRef, useState } from 'react';
import { Form, Spin, Typography } from '@douyinfe/semi-ui';
import { api, errorMessage } from '../../lib/http';
import { Drawer, toastError } from '../../components/ui';
import { severityOptions, statusOptions } from './shared';

const { Text } = Typography;

const EMPTY_VALUES = {
    title: '',
    severity: '',
    status: 'open',
    type: '',
    target: '',
    project_id: '',
    conversation_id: '',
    conversation_tag: '',
    task_tag: '',
    description: '',
    preconditions: '',
    reproduction_steps: '',
    evidence: '',
    impact: '',
    recommendation: '',
    retest_notes: ''
};

function pickValues(vuln) {
    if (!vuln) return { ...EMPTY_VALUES };
    return {
        title: vuln.title || '',
        severity: vuln.severity || '',
        status: vuln.status || 'open',
        type: vuln.type || '',
        target: vuln.target || '',
        project_id: vuln.project_id || '',
        conversation_id: vuln.conversation_id || '',
        conversation_tag: vuln.conversation_tag || '',
        task_tag: vuln.task_tag || '',
        description: vuln.description || '',
        preconditions: vuln.preconditions || '',
        reproduction_steps: vuln.reproduction_steps || '',
        evidence: vuln.evidence || '',
        impact: vuln.impact || '',
        recommendation: vuln.recommendation || '',
        retest_notes: vuln.retest_notes || ''
    };
}

function trim(value) {
    return String(value ?? '').trim();
}

export default function EditModal({ visible, vulnId, t, projectOptions, onClose, onSaved }) {
    const editing = Boolean(vulnId);
    const formId = useId();
    const formApi = useRef(null);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [initial, setInitial] = useState({ ...EMPTY_VALUES });
    // Track which record initial belongs to: render a Spin first when switching records so stale form values do not flash.
    const [loadedFor, setLoadedFor] = useState('');

    useEffect(() => {
        if (!visible) return undefined;
        setLoadError(null);
        if (!vulnId) {
            setLoadedFor('');
            return undefined;
        }
        let cancelled = false;
        api.get(`/vulnerabilities/${encodeURIComponent(vulnId)}`)
            .then(payload => {
                if (cancelled) return;
                setInitial(pickValues(payload));
                setLoadedFor(vulnId);
            })
            .catch(error => { if (!cancelled) setLoadError(error); });
        return () => { cancelled = true; };
    }, [visible, vulnId]);

    const ready = !editing || loadedFor === vulnId;
    const formValues = editing ? initial : { ...EMPTY_VALUES };
    // Semi's Select commits onChange after the popover closes. Save must also work during that transition.
    const commitSelection = field => value => formApi.current?.setValue(field, value);

    const submit = async values => {
        if (saving) return;
        const body = {
            title: trim(values.title),
            severity: values.severity,
            status: values.status || 'open',
            type: trim(values.type),
            target: trim(values.target),
            description: values.description || '',
            preconditions: values.preconditions || '',
            reproduction_steps: values.reproduction_steps || '',
            evidence: values.evidence || '',
            impact: values.impact || '',
            recommendation: values.recommendation || '',
            retest_notes: values.retest_notes || '',
            project_id: trim(values.project_id),
            conversation_tag: trim(values.conversation_tag),
            task_tag: trim(values.task_tag)
        };
        if (!editing) body.conversation_id = trim(values.conversation_id);

        setSaving(true);
        try {
            const saved = editing
                ? await api.put(`/vulnerabilities/${encodeURIComponent(vulnId)}`, body)
                : await api.post('/vulnerabilities', body);
            onSaved?.(saved);
        } catch (error) {
            toastError(error, t('vulnerabilityPage.saveFailed', null, 'Save failed'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            title={editing
                ? t('vulnerability.editVuln', null, 'Edit vulnerability')
                : t('vulnerability.addVuln', null, 'Add vulnerability')}
            visible={visible}
            onCancel={onClose}
            formId={ready && !loadError ? formId : undefined}
            confirmLoading={saving}
            okText={t('common.save', null, 'Save')}
            cancelText={t('common.cancel', null, 'Cancel')}
            width={780}
        >
            {!visible ? null : loadError ? (
                <Text type="danger">{errorMessage(loadError, t('vulnerabilityPage.fetchFailed', null, 'Failed to fetch vulnerability'))}</Text>
            ) : !ready ? (
                <div className="vulnerability-modal-loading"><Spin size="large" /></div>
            ) : (
                <Form
                    id={formId}
                    getFormApi={instance => { formApi.current = instance; }}
                    key={editing ? `${vulnId}-${loadedFor}` : 'new'}
                    initValues={formValues}
                    labelPosition="top"
                    onSubmit={submit}
                >
                    <div className="vulnerability-form-grid">
                        <div className="vulnerability-field vulnerability-field--full">
                            <Form.Input
                                field="title"
                                label={t('vulnerabilityModal.title', null, 'Title')}
                                placeholder={t('vulnerabilityModal.titlePlaceholder', null, '/api/login is vulnerable to SQL injection')}
                                rules={[{ required: true, message: t('vulnerabilityModal.titleRequired', null, 'Enter a vulnerability title') }]}
                                maxLength={500}
                            />
                        </div>
                        <div className="vulnerability-field">
                            <Form.Select
                                field="severity"
                                onSelect={commitSelection('severity')}
                                label={t('vulnerabilityModal.severity', null, 'Severity')}
                                placeholder={t('vulnerabilityModal.pleaseSelect', null, 'Please select')}
                                style={{ width: '100%' }}
                                optionList={severityOptions(t)}
                                rules={[{ required: true, message: t('vulnerabilityModal.severityRequired', null, 'Select a severity') }]}
                            />
                        </div>
                        <div className="vulnerability-field">
                            <Form.Select
                                field="status"
                                onSelect={commitSelection('status')}
                                label={t('vulnerabilityModal.status', null, 'Status')}
                                style={{ width: '100%' }}
                                optionList={statusOptions(t)}
                            />
                        </div>
                        <div className="vulnerability-field">
                            <Form.Input
                                field="target"
                                label={t('vulnerabilityModal.target', null, 'Target')}
                                placeholder={t('vulnerabilityModal.targetPlaceholder', null, 'Be specific: URL, IP:port, endpoint path, and parameter name.')}
                            />
                        </div>
                        <div className="vulnerability-field">
                            <Form.Input
                                field="type"
                                label={t('vulnerabilityModal.type', null, 'Vulnerability type')}
                                placeholder={t('vulnerabilityModal.typePlaceholder', null, 'e.g. SQL injection, XSS, CSRF')}
                            />
                        </div>
                        <div className="vulnerability-field">
                            <Form.Select
                                field="project_id"
                                onSelect={commitSelection('project_id')}
                                label={t('vulnerabilityModal.project', null, 'Project')}
                                placeholder={t('vulnerabilityModal.projectNone', null, '(Unbound)')}
                                style={{ width: '100%' }}
                                filter
                                optionList={[{ value: '', label: t('vulnerabilityModal.projectNone', null, '(Unbound)') }, ...projectOptions]}
                            />
                        </div>
                        <div className="vulnerability-field">
                            <Form.Input
                                field="conversation_id"
                                label={t('vulnerabilityModal.conversationId', null, 'Conversation ID')}
                                placeholder={t('vulnerabilityModal.conversationIdPlaceholder', null, 'Optional: enter an existing conversation ID, or leave blank for a standalone finding')}
                                disabled={editing}
                            />
                        </div>
                        <div className="vulnerability-field">
                            <Form.Input
                                field="conversation_tag"
                                label={t('vulnerabilityModal.conversationTag', null, 'Conversation tag')}
                                placeholder={t('vulnerabilityModal.conversationTagPlaceholder', null, 'e.g. engagement A, weekly report')}
                            />
                        </div>
                        <div className="vulnerability-field">
                            <Form.Input
                                field="task_tag"
                                label={t('vulnerabilityModal.taskTag', null, 'Task tag')}
                                placeholder={t('vulnerabilityModal.taskTagPlaceholder', null, 'e.g. batch scan Q2, retest')}
                            />
                        </div>
                        <div className="vulnerability-field vulnerability-field--full">
                            <Form.TextArea
                                field="description"
                                label={t('vulnerabilityModal.description', null, 'Description')}
                                placeholder={t('vulnerabilityModal.descriptionPlaceholder', null, 'Describe the summary, trigger point, observed abnormal behavior, and why it is exploitable.')}
                                autosize={{ minRows: 3, maxRows: 8 }}
                            />
                        </div>
                        <div className="vulnerability-field vulnerability-field--full">
                            <Form.TextArea
                                field="preconditions"
                                label={t('vulnerabilityModal.preconditions', null, 'Preconditions')}
                                placeholder={t('vulnerabilityModal.preconditionsPlaceholder', null, 'Login state, permissions, account, headers/cookies, required data, environment/version; write none if not needed.')}
                                autosize={{ minRows: 2, maxRows: 6 }}
                            />
                        </div>
                        <div className="vulnerability-field vulnerability-field--full">
                            <Form.TextArea
                                field="reproduction_steps"
                                label={t('vulnerabilityModal.reproductionSteps', null, 'Reproduction steps')}
                                placeholder={t('vulnerabilityModal.reproductionStepsPlaceholder', null, 'Number the steps and include entry point, parameter, payload, command, and observation point.')}
                                autosize={{ minRows: 3, maxRows: 10 }}
                            />
                        </div>
                        <div className="vulnerability-field vulnerability-field--full">
                            <Form.TextArea
                                field="evidence"
                                label={t('vulnerabilityModal.evidence', null, 'Evidence / POC')}
                                placeholder={t('vulnerabilityModal.evidencePlaceholder', null, 'Raw request/response, curl/tool command, screenshot notes, logs, DNSLog/callback records, database results, file paths, timestamps, etc.')}
                                autosize={{ minRows: 3, maxRows: 10 }}
                            />
                        </div>
                        <div className="vulnerability-field vulnerability-field--full">
                            <Form.TextArea
                                field="impact"
                                label={t('vulnerabilityModal.impact', null, 'Impact')}
                                placeholder={t('vulnerabilityModal.impactPlaceholder', null, 'Describe the verified real-world impact, such as which data can be read or changed.')}
                                autosize={{ minRows: 2, maxRows: 6 }}
                            />
                        </div>
                        <div className="vulnerability-field vulnerability-field--full">
                            <Form.TextArea
                                field="recommendation"
                                label={t('vulnerabilityModal.recommendation', null, 'Recommendation')}
                                placeholder={t('vulnerabilityModal.recommendationPlaceholder', null, 'Write the concrete fix and retest criteria.')}
                                autosize={{ minRows: 2, maxRows: 8 }}
                            />
                        </div>
                        <div className="vulnerability-field vulnerability-field--full">
                            <Form.TextArea
                                field="retest_notes"
                                label={t('vulnerabilityModal.retestNotes', null, 'Retest method')}
                                placeholder={t('vulnerabilityModal.retestNotesPlaceholder', null, 'How to verify the fix, including expected status code, error message, or access-control result.')}
                                autosize={{ minRows: 2, maxRows: 6 }}
                            />
                        </div>
                    </div>
                </Form>
            )}
        </Drawer>
    );
}

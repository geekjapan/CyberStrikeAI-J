/** Workflow package import: choose/paste package -> precheck -> conflict handling -> import result. */
import { useEffect, useMemo, useState } from 'react';
import {
    Banner, Button, Checkbox, Input, Radio, RadioGroup, Space, Tag, TextArea, Typography
} from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { translate, useT } from '../../lib/i18n';
import { Drawer, KeyValueList, toastSuccess } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import {
    PACKAGE_ACTIONS, allowedActions, createIdempotencyKey, errText, packageErrorText, shortHash
} from './helpers';

const { Text, Paragraph } = Typography;

const MAX_BYTES = 10 * 1024 * 1024;

function base64ToFile(text) {
    const clean = String(text || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (!clean) throw new Error(translate('ui.workflowsPackageImport.pasteEmpty', null, 'The pasted content is empty'));
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], 'pasted-workflow.csapkg.zip', { type: 'application/zip' });
}

const RESULT_MESSAGE = {
    created: 'workflows.package.result.created',
    overwritten: 'workflows.package.result.overwritten',
    renamed: 'workflows.package.result.renamed',
    kept_existing: 'workflows.package.result.keptExisting',
    skipped_identical: 'workflows.package.result.skippedIdentical'
};

export default function PackageImportModal({ visible, onCancel, onImported }) {
    const t = useT();
    const [file, setFile] = useState(null);
    const [pasteText, setPasteText] = useState('');
    const [pasteError, setPasteError] = useState('');
    const [inspection, setInspection] = useState(null);
    const [action, setAction] = useState('');
    const [newId, setNewId] = useState('');
    const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
    const [inspecting, setInspecting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);

    useEffect(() => {
        if (visible) return;
        setFile(null);
        setPasteText('');
        setPasteError('');
        setInspection(null);
        setAction('');
        setNewId('');
        setOverwriteConfirmed(false);
        setError('');
        setResult(null);
        setInspecting(false);
        setImporting(false);
    }, [visible]);

    const conflictState = inspection?.conflict?.state || '';
    const actions = useMemo(() => allowedActions(conflictState), [conflictState]);

    const usePaste = () => {
        setPasteError('');
        try {
            const next = base64ToFile(pasteText);
            if (next.size > MAX_BYTES) {
                setPasteError(t('workflows.package.errors.fileTooLarge', null, 'The file exceeds the 10 MiB limit. Choose a smaller local package.'));
                return;
            }
            setFile(next);
            setInspection(null);
            setResult(null);
        } catch (decodeError) {
            setPasteError(t('ui.workflowsPackageImport.base64DecodeFailed', { detail: errText(decodeError, '') }, 'Base64 decoding failed: {{detail}}'));
        }
    };

    const pickFile = (event) => {
        const picked = event.target.files && event.target.files[0];
        setPasteError('');
        setError('');
        setResult(null);
        setInspection(null);
        if (!picked) {
            setFile(null);
            return;
        }
        if (picked.size > MAX_BYTES) {
            setPasteError(t('workflows.package.errors.fileTooLarge', null, 'The file exceeds the 10 MiB limit. Choose a smaller local package.'));
            setFile(null);
            return;
        }
        setFile(picked);
    };

    const inspect = async () => {
        if (!file) {
            setPasteError(t('workflows.package.errors.fileRequired', null, 'Choose a local workflow package before preflight.'));
            return;
        }
        setInspecting(true);
        setError('');
        setResult(null);
        try {
            const form = new FormData();
            form.append('file', file, file.name || 'workflow.csapkg.zip');
            const payload = await api.post('/workflow-package-inspections', form);
            const summary = payload?.inspection || null;
            setInspection(summary);
            const nextActions = allowedActions(summary?.conflict?.state || '');
            setAction(nextActions[0] || '');
            setNewId('');
            setOverwriteConfirmed(false);
        } catch (inspectError) {
            setError(packageErrorText(inspectError, t));
        } finally {
            setInspecting(false);
        }
    };

    const applyImport = async () => {
        if (!inspection?.id) {
            setError(t('workflows.package.resolution.needInspection', null, 'Choose a local package and complete preflight first.'));
            return;
        }
        if (!action) {
            setError(t('workflows.package.errors.invalidAction', null, 'The import resolution is invalid. Choose it again.'));
            return;
        }
        if (action === 'rename' && !newId.trim()) {
            setError(t('workflows.package.errors.invalidRenameId', null, 'Enter an available new workflow ID.'));
            return;
        }
        if (action === 'overwrite' && !overwriteConfirmed) {
            setError(t('workflows.package.errors.overwriteConfirmationRequired', null, 'Confirm the overwrite before replacing the local workflow.'));
            return;
        }
        const key = createIdempotencyKey();
        if (!key) {
            setError(t('workflows.package.errors.idempotencyKeyRequired', null, 'The browser cannot create an import request identifier. Refresh and try again.'));
            return;
        }
        setImporting(true);
        setError('');
        try {
            const payload = await api.post('/workflow-package-imports', {
                inspection_id: inspection.id,
                resolution: {
                    action,
                    new_workflow_id: action === 'rename' ? newId.trim() : ''
                },
                confirm_overwrite: action === 'overwrite'
            }, { headers: { 'Idempotency-Key': key } });
            setResult(payload?.import || null);
            toastSuccess(t('workflows.package.result.complete', null, 'Import completed.'));
            onImported?.(payload?.import || null);
        } catch (importError) {
            setError(packageErrorText(importError, t));
        } finally {
            setImporting(false);
        }
    };

    const conflictHint = conflictState === 'identical'
        ? t('workflows.package.conflict.identical', null, 'A local workflow with the same ID and content was found; import will be skipped.')
        : conflictState === 'id_conflict'
            ? t('workflows.package.conflict.idConflict', null, 'A local workflow with the same ID but different content was found. The local version will be kept by default.')
            : conflictState === 'none'
                ? t('workflows.package.conflict.none', null, 'No local workflow with the same ID was found. A new workflow can be created.')
                : '';

    const workflow = inspection?.workflow;

    return (
        <Drawer
            visible={visible}
            title={t('workflows.package.title', null, 'Import local package')}
            onCancel={onCancel}
            width={760}
            maskClosable={!inspecting && !importing}
            footer={(
                <Space>
                    <Button onClick={onCancel}>{t('common.close', null, 'Close')}</Button>
                    <Button
                        type="primary"
                        loading={inspecting}
                        disabled={Boolean(result)}
                        onClick={inspect}
                    >
                        {inspecting
                            ? t('workflows.package.inspecting', null, 'Running safe preflight…')
                            : t('workflows.package.inspect', null, 'Upload and preflight')}
                    </Button>
                    <Button
                        type="primary"
                        loading={importing}
                        disabled={!inspection || Boolean(result) || !action}
                        onClick={applyImport}
                    >
                        {t('workflows.package.confirmImport', null, 'Confirm import')}
                    </Button>
                </Space>
            )}
        >
            <Paragraph type="tertiary" size="small">
                {t('workflows.package.preflightHint', null, 'Review package contents and conflicts before you approve the import')}
                {' · '}
                {t('workflows.package.fileHint', null, 'One .csapkg.zip package only, up to 10 MiB.')}
            </Paragraph>

            <div className="workflow-package-block">
                <Text strong size="small">{t('workflows.package.stepInspection', null, 'Upload and preflight')}</Text>
                <div className="workflow-package-file-row">
                    <input
                        type="file"
                        accept=".zip,application/zip"
                        className="workflow-file-input"
                        onChange={pickFile}
                        aria-label={t('workflows.package.selectFile', null, 'Choose local package')}
                    />
                    <Text type="tertiary" size="small">
                        {file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KiB` : t('workflows.package.noFile', null, 'No file selected')}
                    </Text>
                    {file ? (
                        <Button size="small" theme="borderless" onClick={() => { setFile(null); setInspection(null); setResult(null); }}>
                            {t('workflows.package.removeFile', null, 'Remove file')}
                        </Button>
                    ) : null}
                </div>
                <TextArea
                    value={pasteText}
                    rows={3}
                    placeholder={t('ui.workflowsPackageImport.pastePlaceholder', null, 'Or paste the workflow package as base64 (.csapkg.zip)')}
                    onChange={value => setPasteText(value)}
                />
                <Space>
                    <Button size="small" onClick={usePaste} disabled={!pasteText.trim()}>
                        {t('ui.workflowsPackageImport.usePaste', null, 'Use pasted content')}
                    </Button>
                    {pasteError ? <Text type="danger" size="small">{pasteError}</Text> : null}
                </Space>
            </div>

            {error ? (
                <Banner type="danger" bordered closeIcon={null} description={error} className="workflow-package-banner" />
            ) : null}

            {inspection ? (
                <div className="workflow-package-block">
                    <div className="workflow-package-summary-head">
                        <Text strong size="small">{t('workflows.package.summary.title', null, 'Preflight result')}</Text>
                        <Tag size="small" color="green">{t('workflows.package.summary.passed', null, 'Checks passed')}</Tag>
                    </div>
                    <Banner
                        type={conflictState === 'id_conflict' ? 'warning' : 'success'}
                        bordered
                        closeIcon={null}
                        description={conflictHint}
                        className="workflow-package-banner"
                    />
                    <KeyValueList
                        columns={2}
                        items={[
                            { label: t('workflows.package.summary.workflowName', null, 'Workflow name'), value: workflow?.name || '—' },
                            { label: t('workflows.package.summary.sourceId', null, 'Source workflow ID'), value: <code>{workflow?.source_id || '—'}</code> },
                            { label: t('workflows.package.summary.sourceRevision', null, 'Source revision'), value: workflow?.source_revision ?? '—' },
                            {
                                label: t('workflows.package.summary.graphSize', null, 'Graph size'),
                                value: t('ui.workflowsPackageImport.graphSizeValue', { nodes: workflow?.node_count || 0, edges: workflow?.edge_count || 0 }, '{{nodes}} nodes · {{edges}} edges')
                            },
                            { label: t('workflows.package.summary.contentHash', null, 'Content hash'), value: shortHash(workflow?.content_hash) },
                            { label: t('workflows.package.summary.expiresAt', null, 'Preflight expires'), value: formatDateTime(inspection.expires_at) }
                        ]}
                    />

                    <Text strong size="small">{t('workflows.package.resolutionTitle', null, 'Resolution')}</Text>
                    <RadioGroup
                        value={action}
                        onChange={event => { setAction(event.target.value); setOverwriteConfirmed(false); }}
                        direction="vertical"
                    >
                        {actions.map(item => (
                            <Radio key={item} value={item}>
                                <span className="workflow-package-action">
                                    <Text strong size="small">{PACKAGE_ACTIONS[item]?.label || item}</Text>
                                    <Text type="tertiary" size="small">{PACKAGE_ACTIONS[item]?.hint || ''}</Text>
                                </span>
                            </Radio>
                        ))}
                    </RadioGroup>

                    {action === 'rename' ? (
                        <Input
                            value={newId}
                            placeholder={t('workflows.package.resolution.newWorkflowIdPlaceholder', null, 'For example: web-scan-basic-copy')}
                            onChange={value => setNewId(value)}
                        />
                    ) : null}

                    {action === 'overwrite' ? (
                        <div className="workflow-package-overwrite">
                            <Banner
                                type="warning"
                                bordered
                                closeIcon={null}
                                description={t('workflows.package.overwriteWarning', null, 'This replaces the name, description, graph, and enabled state. Rollback is not available in this release.')}
                            />
                            <Checkbox
                                checked={overwriteConfirmed}
                                onChange={event => setOverwriteConfirmed(event.target.checked)}
                            >
                                {t('workflows.package.overwriteCheck', null, 'I confirm overwriting the current local workflow')}
                            </Checkbox>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {result ? (
                <Banner
                    type="success"
                    bordered
                    closeIcon={null}
                    className="workflow-package-banner"
                    description={t(RESULT_MESSAGE[result.result] || 'workflows.package.result.complete', null, 'Import completed.')}
                />
            ) : null}
        </Drawer>
    );
}

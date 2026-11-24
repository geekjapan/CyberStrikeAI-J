/** Run detail: run + nodeRuns, replay trace and approve/reject. */
import { useEffect, useState } from 'react';
import { Button, SideSheet, Space, Tag, TextArea, Timeline, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import { ErrorBanner, JsonViewer, KeyValueList, confirmAction, toastError, toastSuccess } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { RUN_STATUS, errorProp, errText, shortHash } from './helpers';

const { Text } = Typography;

function statusTag(status) {
    const meta = RUN_STATUS[String(status || '')] || { label: status || '—', color: 'grey' };
    return <Tag size="small" color={meta.color}>{meta.label}</Tag>;
}

export default function RunDetailDrawer({ runId, visible, canExecute, onClose, onChanged }) {
    const t = useT();
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);

    const detail = useResource(
        () => (runId ? api.get(`/workflows/runs/${encodeURIComponent(runId)}`) : Promise.resolve(null)),
        [runId]
    );
    const replay = useResource(
        () => (runId ? api.get(`/workflows/runs/${encodeURIComponent(runId)}/replay`) : Promise.resolve(null)),
        [runId]
    );

    const run = detail.data?.run || null;

    useEffect(() => {
        if (visible && runId) {
            detail.reload({ silent: true });
            replay.reload({ silent: true });
        }
    }, [visible, runId]); // eslint-disable-line react-hooks/exhaustive-deps

    const nodeRuns = detail.data?.nodeRuns || [];
    const steps = replay.data?.steps || [];

    const decide = (approved) => confirmAction({
        title: approved ? t('ui.workflowsRunDetail.approveTitle', null, 'Approve') : t('ui.workflowsRunDetail.rejectTitle', null, 'Reject'),
        content: approved
            ? t('ui.workflowsRunDetail.approveConfirm', null, 'Approve this workflow approval node and continue the run?')
            : t('ui.workflowsRunDetail.rejectConfirm', null, 'Reject this workflow approval node? The run will end as failed.'),
        okText: t('common.confirm', null, 'Confirm'),
        danger: !approved,
        onOk: async () => {
            setBusy(true);
            try {
                await api.post(`/workflows/runs/${encodeURIComponent(runId)}/resume`, { approved, comment });
                toastSuccess(approved ? t('ui.workflowsRunDetail.approved', null, 'Approved') : t('ui.workflowsRunDetail.rejected', null, 'Rejected'));
                setComment('');
                detail.reload({ silent: true });
                replay.reload({ silent: true });
                onChanged?.();
            } catch (error) {
                toastError(errText(error, t('ui.workflowsRunDetail.decideFailed', null, 'Failed to submit the approval decision')));
            } finally {
                setBusy(false);
            }
        }
    });

    return (
        <SideSheet
            visible={visible}
            width={820}
            title={t('workflows.dryRunTrace', null, 'Dry-run trace')}
            onCancel={onClose}
            footer={(
                <Space>
                    {run?.status === 'awaiting_hitl' && canExecute ? (
                        <>
                            <TextArea
                                value={comment}
                                rows={1}
                                placeholder={t('ui.workflowsRunDetail.commentPlaceholder', null, 'Approval note (optional)')}
                                onChange={value => setComment(value)}
                                style={{ width: 240 }}
                            />
                            <Button type="primary" loading={busy} onClick={() => decide(true)}>{t('ui.workflowsRunDetail.approve', null, 'Approve')}</Button>
                            <Button type="danger" loading={busy} onClick={() => decide(false)}>{t('ui.workflowsRunDetail.reject', null, 'Reject')}</Button>
                        </>
                    ) : null}
                    <Button onClick={onClose}>{t('common.close', null, 'Close')}</Button>
                </Space>
            )}
        >
            <ErrorBanner error={errorProp(detail.error)} onRetry={() => detail.reload()} />
            {run ? (
                <div className="workflow-detail-stack">
                    <div className="workflow-detail-tags">
                        {statusTag(run.status)}
                        <Text type="tertiary" size="small">
                            {t('ui.workflowsRunDetail.run', null, 'Run')} <code>{shortHash(run.id, 16)}</code>
                        </Text>
                    </div>

                    <KeyValueList
                        columns={2}
                        items={[
                            { label: t('ui.workflowsRunDetail.workflow', null, 'Workflow'), value: <code>{run.workflow_id}</code> },
                            { label: t('ui.workflowsRunDetail.version', null, 'Version'), value: run.workflow_version ?? '—' },
                            { label: t('ui.workflowsRunDetail.conversation', null, 'Conversation'), value: run.conversation_id || '—' },
                            { label: t('ui.workflowsRunDetail.project', null, 'Project'), value: run.project_id || '—' },
                            { label: t('ui.workflowsRunDetail.startedAt', null, 'Started at'), value: formatDateTime(run.started_at) },
                            { label: t('ui.workflowsRunDetail.finishedAt', null, 'Finished at'), value: formatDateTime(run.finished_at) },
                            run.pending_hitl_node_id
                                ? { label: t('ui.workflowsRunDetail.pendingNode', null, 'Pending approval node'), value: <code>{run.pending_hitl_node_id}</code> }
                                : null,
                            run.error ? { label: t('ui.workflowsRunDetail.error', null, 'Error'), value: <Text type="danger" size="small">{run.error}</Text> } : null
                        ]}
                    />

                    <div>
                        <Text strong>{t('ui.workflowsRunDetail.nodeRuns', { count: nodeRuns.length }, 'Node runs ({{count}})')}</Text>
                        <Timeline className="workflow-timeline">
                            {nodeRuns.length ? nodeRuns.map(node => (
                                <Timeline.Item
                                    key={node.id}
                                    time={formatDateTime(node.started_at)}
                                    type={node.status === 'failed' ? 'error' : node.status === 'completed' ? 'success' : 'ongoing'}
                                >
                                    <div className="workflow-timeline-item">
                                        <div>
                                            <code>{node.node_id}</code> {statusTag(node.status)}
                                        </div>
                                        {node.error ? <Text type="danger" size="small">{node.error}</Text> : null}
                                        {node.output_json
                                            ? <JsonViewer value={safeParse(node.output_json)} title="output" collapsed />
                                            : null}
                                    </div>
                                </Timeline.Item>
                            )) : <Text type="tertiary" size="small">{t('ui.workflowsRunDetail.noNodeRuns', null, 'No node run records')}</Text>}
                        </Timeline>
                    </div>

                    <div>
                        <Text strong>{t('ui.workflowsRunDetail.replayTrace', { count: steps.length }, 'Replay trace ({{count}} steps)')}</Text>
                        <Timeline className="workflow-timeline">
                            {steps.length ? steps.map(step => (
                                <Timeline.Item
                                    key={step.nodeRunId || `${step.step}-${step.nodeId}`}
                                    time={formatDateTime(step.startedAt)}
                                    type={step.status === 'failed' ? 'error' : step.status === 'completed' ? 'success' : 'ongoing'}
                                >
                                    <div className="workflow-timeline-item">
                                        <div>
                                            <Text strong size="small">#{step.step}</Text> <code>{step.nodeId}</code> {statusTag(step.status)}
                                        </div>
                                        {step.error ? <Text type="danger" size="small">{step.error}</Text> : null}
                                        <JsonViewer value={{ input: step.input, output: step.output }} title="step" collapsed />
                                    </div>
                                </Timeline.Item>
                            )) : <Text type="tertiary" size="small">{t('workflows.dryRunNoTrace', null, 'No trace')}</Text>}
                        </Timeline>
                    </div>

                    <JsonViewer value={run} title="run" collapsed />
                </div>
            ) : null}
        </SideSheet>
    );
}

function safeParse(raw) {
    try {
        return JSON.parse(raw);
    } catch (error) {
        return { raw };
    }
}

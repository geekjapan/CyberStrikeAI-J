/** Workflow detail: metadata, graph structure summary, raw graph JSON and export/delete entry points. */
import { useEffect, useMemo, useState } from 'react';
import { Button, SideSheet, Space, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { api, downloadFile } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import { ErrorBanner, JsonViewer, KeyValueList, confirmAction, toastError, toastSuccess } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import {
    NODE_TYPE_LABEL, errorProp, errText, graphSummary
} from './helpers';

const { Text } = Typography;

function GraphPreview({ raw }) {
    const t = useT();
    const summary = useMemo(() => graphSummary(raw), [raw]);
    if (summary.error) {
        return <Text type="danger" size="small">{t('ui.workflowsDetail.graphParseFailed', { detail: summary.error }, 'Failed to parse graph: {{detail}}')}</Text>;
    }
    const rows = summary.nodes.map(node => ({
        id: node.id,
        type: node.type || 'tool',
        label: node.label || '',
        config: node.config || {}
    }));
    const columns = [
        { title: t('ui.workflowsDetail.node', null, 'Node'), dataIndex: 'id', width: 160, render: value => <code>{value}</code> },
        {
            title: t('ui.workflowsDetail.type', null, 'Type'),
            dataIndex: 'type',
            width: 90,
            render: value => <Tag size="small" color="blue" type="light">{NODE_TYPE_LABEL[value] || value}</Tag>
        },
        {
            title: t('ui.workflowsDetail.name', null, 'Name'),
            dataIndex: 'label',
            render: (value, record) => (
                <span className="workflow-cell-ellipsis" title={value || record.id}>{value || '—'}</span>
            )
        }
    ];
    return (
        <div className="workflow-detail-stack">
            <Table
                columns={columns}
                dataSource={rows}
                rowKey="id"
                size="small"
                pagination={false}
                empty={<Text type="tertiary" size="small">{t('ui.workflowsDetail.noNodes', null, 'No nodes in the graph')}</Text>}
            />
            <div className="workflow-edge-list">
                <Text strong size="small">{t('ui.workflowsDetail.edges', { count: summary.edges.length }, 'Edges ({{count}})')}</Text>
                {summary.edges.length ? (
                    <ul className="workflow-link-list">
                        {summary.edges.map((edge, index) => (
                            <li key={edge.id || `${edge.source}-${edge.target}-${index}`}>
                                <code>{edge.source}</code> → <code>{edge.target}</code>
                                {edge.label ? <span className="workflow-edge-label">{edge.label}</span> : null}
                            </li>
                        ))}
                    </ul>
                ) : <Text type="tertiary" size="small">{t('ui.workflowsDetail.noEdges', null, 'No edges')}</Text>}
            </div>
        </div>
    );
}

export default function WorkflowDetailDrawer({ workflowId, visible, canWrite, canDelete, onClose, onEdit, onDeleted }) {
    const t = useT();
    const [exporting, setExporting] = useState(false);

    const detail = useResource(
        () => (workflowId ? api.get(`/workflows/${encodeURIComponent(workflowId)}`) : Promise.resolve(null)),
        [workflowId]
    );
    const workflow = detail.data?.workflow || null;

    useEffect(() => {
        if (visible && workflowId) detail.reload({ silent: true });
    }, [visible, workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

    const exportPackage = async () => {
        if (!workflow) return;
        setExporting(true);
        try {
            await downloadFile(`/workflows/${encodeURIComponent(workflow.id)}/package`, {
                filename: `${workflow.id}.csapkg.zip`
            });
            toastSuccess(t('workflows.package.export', null, 'Export'));
        } catch (error) {
            toastError(errText(error, t('workflows.package.errors.exportFailed', null, 'Export failed. Try again later.')));
        } finally {
            setExporting(false);
        }
    };

    const remove = () => confirmAction({
        title: t('workflows.deleteWorkflow', null, 'Delete workflow'),
        content: t('workflows.confirmDelete', { id: workflow?.id }, 'Delete workflow {{id}}?'),
        okText: t('common.delete', null, 'Delete'),
        onOk: async () => {
            try {
                await api.del(`/workflows/${encodeURIComponent(workflow.id)}`);
                toastSuccess(t('workflows.deleted', null, 'Workflow deleted'));
                onDeleted?.(workflow.id);
            } catch (error) {
                toastError(errText(error, t('workflows.deleteFailed', null, 'Failed to delete workflow')));
            }
        }
    });

    return (
        <SideSheet
            visible={visible}
            width={760}
            title={workflow ? workflow.name || workflow.id : t('workflows.metaModalTitle', null, 'Workflow details')}
            onCancel={onClose}
            footer={(
                <Space>
                    <Button disabled={!canWrite || !workflow} onClick={() => onEdit?.(workflow)}>
                        {t('common.edit', null, 'Edit')}
                    </Button>
                    <Button loading={exporting} disabled={!workflow} onClick={exportPackage}>
                        {t('workflows.package.export', null, 'Export')}
                    </Button>
                    <Button type="danger" disabled={!canDelete || !workflow} onClick={remove}>
                        {t('workflows.deleteWorkflow', null, 'Delete workflow')}
                    </Button>
                    <Button onClick={onClose}>{t('common.close', null, 'Close')}</Button>
                </Space>
            )}
        >
            <ErrorBanner error={errorProp(detail.error)} onRetry={() => detail.reload()} />
            {workflow ? (
                <div className="workflow-detail-stack">
                    <div className="workflow-detail-tags">
                        <Tag size="small" color={workflow.enabled ? 'green' : 'grey'}>
                            {workflow.enabled ? t('workflows.statusEnabled', null, 'Enabled') : t('workflows.statusDisabled', null, 'Disabled')}
                        </Tag>
                        {workflow.validation_error
                            ? <Tag size="small" color="red">{t('workflows.statusInvalid', null, 'Invalid workflow')}</Tag>
                            : <Tag size="small" color="green" type="light">{t('ui.workflowsDetail.structureValid', null, 'Structure valid')}</Tag>}
                        <Text type="tertiary" size="small">{t('ui.workflowsDetail.versionLabel', { version: workflow.version || 0 }, 'Version {{version}}')}</Text>
                    </div>

                    {workflow.validation_error ? (
                        <ErrorBanner error={{ message: workflow.validation_error }} />
                    ) : null}

                    <KeyValueList
                        columns={2}
                        items={[
                            { label: t('workflows.metaId', null, 'ID'), value: <code>{workflow.id}</code> },
                            { label: t('workflows.metaName', null, 'Name'), value: workflow.name || '—' },
                            { label: t('workflows.updated', null, 'Updated'), value: formatDateTime(workflow.updated_at) },
                            { label: t('ui.workflowsDetail.created', null, 'Created'), value: formatDateTime(workflow.created_at) },
                            { label: t('workflows.metaDescription', null, 'Description'), value: workflow.description || '—' }
                        ]}
                    />

                    <div>
                        <Text strong>{t('workflows.nodeProperties', null, 'Node properties')}</Text>
                        <GraphPreview raw={workflow.graph_json} />
                    </div>

                    <JsonViewer value={workflow.graph_json ? safeParse(workflow.graph_json) : {}} title="graph JSON" collapsed />
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

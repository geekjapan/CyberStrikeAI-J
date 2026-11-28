/** Execution detail side drawer: input / output / duration / error / linked conversation. */
import { Banner, Button, SideSheet, Space, Spin, Typography } from '@douyinfe/semi-ui';
import { useResource } from '../../components/hooks';
import { CopyButton, ErrorBanner, JsonViewer, KeyValueList } from '../../components/ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { formatDateTime } from '../../lib/format';
import { executionDurationMs, formatDurationMs, isRunning, statusLabel, toolDisplayName } from './utils';
import { ExecutionStatusTag } from './executions';

const { Text } = Typography;

export default function ExecutionDetail({ executionId, onClose, canWrite, onCancelRequest }) {
    const t = useT();
    const { data, loading, error, reload } = useResource(
        () => api.get(`/monitor/execution/${encodeURIComponent(executionId)}`),
        [executionId],
        { skip: !executionId }
    );
    const exec = executionId ? data : null;
    const running = exec ? isRunning(exec.status) : false;

    return (
        <SideSheet
            visible={Boolean(executionId)}
            onCancel={onClose}
            title={t('mcpMonitor.viewDetail', null, 'View details')}
            width={720}
            footer={exec ? (
                <Space>
                    {running && (
                        <Button theme="solid" disabled={!canWrite} onClick={() => onCancelRequest(exec)}>
                            {t('mcpMonitor.terminateExecution', null, 'Stop')}
                        </Button>
                    )}
                    <Button onClick={onClose}>{t('common.close', null, 'Close')}</Button>
                </Space>
            ) : null}
        >
            {!exec && loading && (
                <div className="mcp-monitor-detail-loading"><Spin /></div>
            )}
            <ErrorBanner error={error} onRetry={reload} />
            {exec && (
                <div className="mcp-monitor-detail">
                    <KeyValueList
                        columns={2}
                        items={[
                            { label: t('ui.mcpDetail.tool', null, 'Tool'), value: <Text strong>{toolDisplayName(exec.toolName) || '—'}</Text> },
                            { label: t('mcpMonitor.columnStatus', null, 'Status'), value: <ExecutionStatusTag status={exec.status} /> },
                            { label: t('ui.mcpDetail.executionId', null, 'Execution ID'), value: <span className="mcp-monitor-mono">{exec.id}</span> },
                            {
                                label: t('mcpMonitor.columnStartTime', null, 'Start time'),
                                value: formatDateTime(exec.startTime)
                            },
                            {
                                label: t('ui.mcpDetail.endTime', null, 'End time'),
                                value: exec.endTime ? formatDateTime(exec.endTime) : '—'
                            },
                            {
                                label: t('mcpMonitor.columnDuration', null, 'Duration'),
                                value: formatDurationMs(executionDurationMs(exec))
                            },
                            {
                                label: t('ui.mcpDetail.linkedConversation', null, 'Linked conversation'),
                                value: exec.conversationId
                                    ? (
                                        <Space spacing={4}>
                                            <span className="mcp-monitor-mono">{exec.conversationId}</span>
                                            <CopyButton text={exec.conversationId} size="small" />
                                        </Space>
                                    )
                                    : '—'
                            },
                            {
                                label: t('ui.mcpDetail.resultStatus', null, 'Result status'),
                                value: exec.result
                                    ? (exec.result.isError ? t('ui.mcpDetail.resultError', null, 'Error result') : (exec.result.blocked ? t('ui.mcpDetail.resultBlocked', null, 'Blocked') : t('ui.mcpDetail.resultOk', null, 'Returned normally')))
                                    : t('ui.mcpDetail.noReturn', null, 'No response')
                            }
                        ]}
                    />

                    {exec.error && (
                        <Banner
                            type="danger"
                            className="mcp-monitor-detail-error"
                            description={<span className="mcp-monitor-mono">{exec.error}</span>}
                        />
                    )}

                    <div className="mcp-monitor-detail-section">
                        <JsonViewer title={t('mcpDetailModal.requestParams', null, 'Request params')} value={exec.arguments ?? {}} />
                    </div>

                    <div className="mcp-monitor-detail-section">
                        {exec.result ? (
                            <JsonViewer title={t('mcpDetailModal.responseResult', null, 'Response')} value={exec.result} />
                        ) : (
                            <div className="mcp-monitor-detail-empty">
                                {running
                                    ? t('mcpDetailModal.runningNoResponseYet', null, 'No output yet; the tool may still be running. If it hangs, use "Stop tool" below to end this call only.')
                                    : t('chat.noResponseData', null, 'No response data')}
                            </div>
                        )}
                    </div>

                    {exec.partialOutput && (
                        <div className="mcp-monitor-detail-section">
                            <div className="mcp-monitor-detail-section-head">
                                <Text strong>{t('ui.mcpDetail.liveOutputTail', null, 'Live output tail')}</Text>
                                <Space spacing={4}>
                                    {exec.partialOutputBytes ? <Text type="tertiary">{exec.partialOutputBytes} B</Text> : null}
                                    <CopyButton text={exec.partialOutput} size="small" />
                                </Space>
                            </div>
                            <pre className="mcp-monitor-detail-pre">{exec.partialOutput}</pre>
                        </div>
                    )}

                    <div className="mcp-monitor-detail-footnote">
                        {statusLabel(t, exec.status)} · {t('mcpMonitor.statsFromAllTools', null, 'From all tool calls')}
                    </div>
                </div>
            )}
        </SideSheet>
    );
}

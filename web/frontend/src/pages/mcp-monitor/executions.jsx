/** Execution record list: filtering, pagination, batch selection, row actions. */
import { Button, Input, Select, Space, Tag } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { DataTable, ErrorBanner } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { formatDateTime } from '../../lib/format';
import {
    STATUS_VALUES, executionDurationMs, formatDurationMs, isRunning, statusLabel, statusTagColor, toolDisplayName
} from './utils';

export function ExecutionStatusTag({ status }) {
    const t = useT();
    return (
        <Tag size="small" color={statusTagColor(status)} shape="square">
            {statusLabel(t, status)}
        </Tag>
    );
}

export default function ExecutionTable({
    data, loading, error, page, pageSize, status, toolInput,
    selected, onQuery, onPageChange, onRefresh, onOpenDetail, onCancel, onDelete,
    onSelectionChange, canWrite, canDelete
}) {
    const t = useT();
    const executions = data?.executions || [];
    const total = Number(data?.total) || 0;

    const statusOptions = [
        { value: 'all', label: t('mcp.filterAll', null, 'All') },
        ...STATUS_VALUES.map(value => ({ value, label: statusLabel(t, value) }))
    ];

    const columns = [
        {
            title: t('mcpMonitor.columnTool', null, 'Tool'),
            dataIndex: 'toolName',
            render: value => (
                <span className="mcp-monitor-cell-tool">{toolDisplayName(value) || t('mcpMonitor.unknownTool', null, 'Unknown tool')}</span>
            )
        },
        {
            title: t('mcpMonitor.columnStatus', null, 'Status'),
            dataIndex: 'status',
            width: 110,
            render: value => <ExecutionStatusTag status={value} />
        },
        {
            title: t('mcpMonitor.columnStartTime', null, 'Start time'),
            dataIndex: 'startTime',
            width: 180,
            render: value => formatDateTime(value)
        },
        {
            title: t('mcpMonitor.columnDuration', null, 'Duration'),
            dataIndex: 'duration',
            width: 110,
            render: (value, record) => formatDurationMs(executionDurationMs(record))
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 230,
            render: (id, record) => (
                <Space spacing={4} wrap>
                    <Button size="small" theme="borderless" onClick={() => onOpenDetail(id)}>
                        {t('mcpMonitor.viewDetail', null, 'View details')}
                    </Button>
                    {isRunning(record.status) && (
                        <Button
                            size="small"
                            theme="borderless"
                            disabled={!canWrite}
                            onClick={() => onCancel(record)}
                        >
                            {t('mcpMonitor.terminateExecution', null, 'Stop')}
                        </Button>
                    )}
                    <Button
                        size="small"
                        theme="borderless"
                        type="danger"
                        disabled={!canDelete}
                        onClick={() => onDelete(record)}
                    >
                        {t('common.delete', null, 'Delete')}
                    </Button>
                </Space>
            )
        }
    ];

    const pagination = {
        currentPage: page,
        pageSize,
        total,
        showSizeChanger: true,
        pageSizeOpts: [20, 50, 100],
        showTotal: true,
        onPageChange: next => onPageChange(next, pageSize),
        onPageSizeChange: size => onPageChange(1, size)
    };

    return (
        <>
            <ErrorBanner error={error} onRetry={onRefresh} />
            <DataTable
                columns={columns}
                dataSource={executions}
                rowKey="id"
                loading={loading}
                pagination={pagination}
                onRefresh={onRefresh}
                emptyText={t('mcpMonitor.noExecutions', null, 'No execution records')}
                rowSelection={{
                    selectedRowKeys: selected,
                    onChange: keys => onSelectionChange(keys || [])
                }}
                toolbar={(
                    <Space spacing={8} wrap>
                        <Input
                            prefix={<IconSearch />}
                            value={toolInput}
                            showClear
                            style={{ width: 220 }}
                            placeholder={t('mcp.toolSearchPlaceholder', null, 'Enter tool name...')}
                            onChange={value => onQuery({ toolInput: value })}
                        />
                        <Select
                            value={status}
                            style={{ width: 150 }}
                            optionList={statusOptions}
                            onChange={value => onQuery({ status: value })}
                        />
                    </Space>
                )}
            />
        </>
    );
}

/** Vulnerability list: server-paginated table + row actions + multi-select. */
import { Button, Select, Tag, Typography } from '@douyinfe/semi-ui';
import { formatDateTime } from '../../lib/format';
import { DataTable, SeverityTag, StatusTag } from '../../components/ui';
import { PAGE_SIZE_OPTIONS, shortId, sortOptions, statusText, targetText } from './shared';

const { Text } = Typography;

function SourceCell({ record }) {
    const tags = [record.conversation_tag, record.task_tag].filter(Boolean);
    if (tags.length) {
        return (
            <span className="vulnerability-source-tags">
                {tags.map(tag => (
                    <Tag key={tag} size="small" color="blue" type="light">{tag}</Tag>
                ))}
            </span>
        );
    }
    if (record.conversation_id) {
        return (
            <Text type="tertiary" className="vulnerability-inline-code" title={record.conversation_id}>
                {shortId(record.conversation_id, 10)}
            </Text>
        );
    }
    return <Text type="tertiary">—</Text>;
}

export default function VulnTable({
    t, data, loading, page, pageSize, total, selection, onSelectionChange,
    onOpen, onEdit, onDelete, onDownload, sort, onSort, canWrite, canDelete,
    onPageChange, onPageSizeChange, toolbar, onRefresh
}) {
    const columns = [
        {
            title: t('vulnerabilityPage.tableTitle', null, 'Finding'),
            dataIndex: 'title',
            render: (_, record) => (
                <div className="vulnerability-title-cell">
                    <span className="vulnerability-title-text" title={record.title}>{record.title || '—'}</span>
                    <span className="vulnerability-title-meta">
                        {record.type || '—'}
                        {record.case_id ? ` · ${t('vulnerabilityPage.mergedRecord', null, 'Merged')}` : ''}
                    </span>
                </div>
            )
        },
        {
            title: t('vulnerabilityPage.tableSeverity', null, 'Severity'),
            dataIndex: 'severity',
            width: 92,
            render: severity => <SeverityTag severity={severity} />
        },
        {
            title: t('vulnerabilityPage.tableStatus', null, 'Status'),
            dataIndex: 'status',
            width: 100,
            render: status => <StatusTag status={status} label={statusText(t, status)} />
        },
        {
            title: t('vulnerabilityPage.detailTarget', null, 'Target'),
            dataIndex: 'target',
            width: 220,
            render: (_, record) => {
                const target = targetText(record);
                const host = Array.isArray(record.targets) && record.targets.length
                    ? record.targets.map(item => item?.host).filter(Boolean).join(', ')
                    : '';
                return (
                    <div className="vulnerability-target-cell">
                        <span className="vulnerability-target-text" title={target || host}>{target || host || '—'}</span>
                        {target && host && host !== target ? (
                            <span className="vulnerability-target-host" title={host}>{host}</span>
                        ) : null}
                    </div>
                );
            }
        },
        {
            title: t('vulnerabilityPage.tableSource', null, 'Source'),
            dataIndex: 'conversation_tag',
            width: 170,
            render: (_, record) => <SourceCell record={record} />
        },
        {
            title: t('vulnerabilityPage.tableDate', null, 'Discovered'),
            dataIndex: 'created_at',
            width: 180,
            render: value => <span className="vulnerability-time">{formatDateTime(value)}</span>
        },
        {
            title: t('vulnerabilityPage.tableActions', null, 'Actions'),
            dataIndex: 'id',
            width: 200,
            render: (_, record) => (
                <div className="vulnerability-row-actions">
                    <Button size="small" theme="borderless" onClick={event => { event.stopPropagation(); onOpen(record.id); }}>
                        {t('vulnerabilityPage.rowView', null, 'Details')}
                    </Button>
                    <Button
                        size="small"
                        theme="borderless"
                        onClick={event => { event.stopPropagation(); onDownload(record); }}
                    >
                        {t('vulnerabilityPage.tableDownload', null, 'Download')}
                    </Button>
                    {canWrite && (
                        <Button
                            size="small"
                            theme="borderless"
                            onClick={event => { event.stopPropagation(); onEdit(record); }}
                        >
                            {t('common.edit', null, 'Edit')}
                        </Button>
                    )}
                    {canDelete && (
                        <Button
                            size="small"
                            theme="borderless"
                            type="danger"
                            onClick={event => { event.stopPropagation(); onDelete(record); }}
                        >
                            {t('common.delete', null, 'Delete')}
                        </Button>
                    )}
                </div>
            )
        }
    ];

    const tableToolbar = toolbar ? (
        <div className="vulnerability-table-toolbar">
            {toolbar}
            <Select
                className="vulnerability-sort-select"
                size="small"
                value={sort}
                optionList={sortOptions(t)}
                onChange={value => onSort(value || '')}
            />
        </div>
    ) : null;

    return (
        <DataTable
            columns={columns}
            dataSource={Array.isArray(data) ? data : []}
            loading={loading}
            rowKey="id"
            toolbar={tableToolbar}
            onRefresh={onRefresh}
            emptyText={t('vulnerabilityPage.noRecords', null, 'No vulnerability records')}
            scroll={{ x: 1200 }}
            rowSelection={canDelete ? {
                selectedRowKeys: selection,
                onChange: keys => onSelectionChange(Array.isArray(keys) ? keys : [])
            } : undefined}
            onRow={record => ({
                onClick: event => {
                    if (event.target?.closest?.('button, a, input, label, .semi-checkbox')) return;
                    onOpen(record.id);
                }
            })}
            pagination={{
                currentPage: page,
                pageSize,
                total: Number(total) || 0,
                showSizeChanger: true,
                pageSizeOpts: PAGE_SIZE_OPTIONS,
                onPageChange: nextPage => onPageChange(Number(nextPage)),
                onPageSizeChange: nextSize => onPageSizeChange(Number(nextSize))
            }}
        />
    );
}

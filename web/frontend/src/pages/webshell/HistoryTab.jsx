/**
 * WebShell command history: records commands run on this connection and persists them with the connection state.
 */
import { Button, Space, Typography } from '@douyinfe/semi-ui';
import { useT } from '../../lib/i18n';
import { DataTable, CopyButton, confirmAction } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

const { Text } = Typography;

export default function HistoryTab({ history, onClear, onRemove, onRun }) {
    const t = useT();
    const rows = history.map((item, index) => ({ ...item, rowId: `${index}-${item.at}` }));

    const columns = [
        {
            title: t('webshell.colCommand', null, 'Command'),
            dataIndex: 'command',
            render: command => <code className="webshell-history-cmd">{command}</code>
        },
        {
            title: t('webshell.colExecutedAt', null, 'Executed at'),
            dataIndex: 'at',
            width: 200,
            render: at => formatDateTime(at)
        },
        {
            title: t('webshell.moreActions', null, 'More actions'),
            dataIndex: 'ops',
            width: 220,
            render: (_, row) => (
                <Space spacing={4}>
                    <CopyButton text={row.command} label={t('common.copied', null, 'Copied')} size="small" />
                    {onRun && <Button size="small" theme="borderless" onClick={() => onRun(row.command)}>{t('webshell.rerun', null, 'Run again')}</Button>}
                    <Button
                        size="small"
                        theme="borderless"
                        type="danger"
                        onClick={() => confirmAction({
                            title: t('webshell.deleteHistory', null, 'Delete this entry'),
                            content: row.command,
                            onOk: () => onRemove(row.rowId)
                        })}
                    >
                        {t('webshell.deleteFile', null, 'Delete')}
                    </Button>
                </Space>
            )
        }
    ];

    return (
        <div className="webshell-history">
            <div className="webshell-history-toolbar">
                <Text type="tertiary">{t('webshell.historyHint', null, 'Only commands run on this connection from this browser are recorded')}</Text>
                <Space spacing={8}>
                    {onClear && <Button size="small" disabled={!rows.length} onClick={() => onClear()}>{t('webshell.clearHistory', null, 'Clear history')}</Button>}
                </Space>
            </div>
            <DataTable
                columns={columns}
                dataSource={rows}
                rowKey="rowId"
                pagination={{ pageSize: 15 }}
                emptyText={t('webshell.noHistory', null, 'No command history yet')}
            />
        </div>
    );
}

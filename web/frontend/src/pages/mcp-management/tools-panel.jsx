/** MCP tool config: built-in/external tool list, enabled state and save (PUT /config + POST /config/apply). */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Select, Space, Switch, Tag, Typography } from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { DataTable, ErrorBanner, SectionCard, toastError, toastSuccess } from '../../components/ui';
import { useDebounced, useResource } from '../../components/hooks';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { toolKeyOf, sourceLabel } from './utils';

const { Text } = Typography;

export default function ToolsPanel({ canWrite, refreshKey = 0 }) {
    const t = useT();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [searchInput, setSearchInput] = useState('');
    const search = useDebounced(searchInput, 350);
    const [filter, setFilter] = useState('all');
    const [includeExternal, setIncludeExternal] = useState(true);
    const [drafts, setDrafts] = useState({});
    const [saving, setSaving] = useState(false);
    const catalogRef = useRef(new Map());

    const list = useResource(
        () => api.get('/config/tools', {
            page,
            page_size: pageSize,
            search,
            tool_filter: filter === 'all' ? '' : filter,
            include_external: includeExternal ? '' : '0'
        }),
        [page, pageSize, search, filter, includeExternal, refreshKey]
    );

    const tools = list.data?.tools || [];
    const total = Number(list.data?.total) || 0;
    const deferredTools = useDeferredValue(tools);

    useEffect(() => {
        (tools || []).forEach(tool => catalogRef.current.set(toolKeyOf(tool), tool));
    }, [tools]);

    const dirtyKeys = useMemo(() => Object.keys(drafts), [drafts]);

    const displayEnabled = useCallback(
        tool => (Object.prototype.hasOwnProperty.call(drafts, toolKeyOf(tool)) ? drafts[toolKeyOf(tool)] : tool.enabled),
        [drafts]
    );

    const setDraft = useCallback((tool, enabled) => {
        const key = toolKeyOf(tool);
        setDrafts(prev => {
            const next = { ...prev };
            if (enabled === tool.enabled) delete next[key];
            else next[key] = enabled;
            return next;
        });
    }, []);

    const setAllOnPage = useCallback((enabled) => {
        setDrafts(prev => {
            const next = { ...prev };
            (tools || []).forEach(raw => {
                const key = toolKeyOf(raw);
                if (raw.enabled === enabled) delete next[key];
                else next[key] = enabled;
            });
            return next;
        });
    }, [tools]);

    const resetDrafts = useCallback(() => setDrafts({}), []);

    const save = useCallback(async () => {
        const entries = Object.entries(drafts);
        if (!entries.length) return;
        setSaving(true);
        try {
            const payload = entries.map(([key, enabled]) => {
                const meta = catalogRef.current.get(key);
                return {
                    name: meta?.name || key.split('::').pop() || key,
                    enabled,
                    is_external: Boolean(meta?.is_external),
                    external_mcp: meta?.external_mcp || ''
                };
            });
            await api.put('/config', { tools: payload });
            await api.post('/config/apply', {});
            toastSuccess(t('mcp.toolsConfigSaved', null, 'Tool configuration saved!'));
            setDrafts({});
            list.reload({ silent: true });
        } catch (error) {
            toastError(error, t('mcp.saveToolsConfigFailed', null, 'Failed to save tool config'));
        } finally {
            setSaving(false);
        }
    }, [drafts, list.reload, t]); // eslint-disable-line react-hooks/exhaustive-deps

    const columns = [
        {
            title: t('mcpMonitor.columnTool', null, 'Tool'),
            dataIndex: 'name',
            render: value => <span className="mcp-management-mono mcp-management-tool-name">{value}</span>
        },
        {
            title: t('ui.mcpTools.source', null, 'Source'),
            dataIndex: 'is_external',
            width: 180,
            render: (value, record) => (
                <Tag size="small" color={value ? 'blue' : 'grey'}>{sourceLabel(record)}</Tag>
            )
        },
        {
            title: t('mcp.filterEnabled', null, 'Enabled'),
            dataIndex: 'enabled',
            width: 110,
            render: (value, record) => (
                <Switch
                    size="small"
                    checked={displayEnabled(record)}
                    disabled={!canWrite}
                    onChange={checked => setDraft(record, checked)}
                />
            )
        },
        {
            title: t('mcp.description', null, 'Description'),
            dataIndex: 'description',
            render: value => (
                <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 560 }}>
                    {value || t('mcp.noDescription', null, 'No description')}
                </Text>
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
        onPageChange: next => setPage(next),
        onPageSizeChange: size => { setPageSize(size); setPage(1); }
    };

    const filterOptions = [
        { value: 'all', label: t('mcp.filterAll', null, 'All') },
        { value: 'on', label: t('mcp.filterEnabled', null, 'Enabled') },
        { value: 'off', label: t('mcp.filterDisabled', null, 'Disabled') }
    ];

    return (
        <SectionCard
            title={t('mcp.toolConfig', null, 'MCP tool config')}
            description={`${t('mcp.currentPageEnabled', null, 'Enabled on current page')} ${(deferredTools || []).filter(item => displayEnabled(item)).length} / ${deferredTools.length} · ${t('mcp.totalEnabled', null, 'Total enabled')} ${list.data?.total_enabled ?? '—'}`}
            extra={(
                <Space spacing={8}>
                    {dirtyKeys.length > 0 && (
                        <Tag size="small" color="amber">{t('ui.mcpTools.unsaved', { count: dirtyKeys.length }, '{{count}} unsaved')}</Tag>
                    )}
                    {dirtyKeys.length > 0 && (
                        <Button size="small" theme="borderless" onClick={resetDrafts} disabled={saving}>
                            {t('ui.mcpTools.discard', null, 'Discard changes')}
                        </Button>
                    )}
                    <Button size="small" icon={<IconRefresh />} theme="borderless" onClick={() => list.reload()} loading={list.loading}>
                        {t('common.refresh', null, 'Refresh')}
                    </Button>
                    <Button
                        size="small"
                        theme="solid"
                        disabled={!canWrite || !dirtyKeys.length}
                        loading={saving}
                        onClick={save}
                    >
                        {t('mcp.saveToolConfig', null, 'Save tool config')}
                    </Button>
                </Space>
            )}
        >
            <ErrorBanner error={list.error} onRetry={() => list.reload()} />
            <DataTable
                columns={columns}
                dataSource={tools}
                rowKey={record => toolKeyOf(record)}
                loading={list.loading}
                pagination={pagination}
                size="small"
                emptyText={t('mcp.noTools', null, 'No tools')}
                toolbar={(
                    <Space spacing={8} wrap>
                        <Input
                            prefix={<IconSearch />}
                            showClear
                            style={{ width: 240 }}
                            value={searchInput}
                            placeholder={t('mcp.toolSearchPlaceholder', null, 'Enter tool name...')}
                            onChange={value => { setSearchInput(value); setPage(1); }}
                        />
                        <Select
                            value={filter}
                            style={{ width: 140 }}
                            optionList={filterOptions}
                            onChange={value => { setFilter(value); setPage(1); }}
                        />
                        <Checkbox
                            checked={includeExternal}
                            onChange={event => { setIncludeExternal(event.target.checked); setPage(1); }}
                        >
                            {t('ui.mcpTools.includeExternal', null, 'Include external MCP tools')}
                        </Checkbox>
                        <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => setAllOnPage(true)}>
                            {t('mcp.selectAll', null, 'Select all')}
                        </Button>
                        <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => setAllOnPage(false)}>
                            {t('mcp.deselectAll', null, 'Deselect all')}
                        </Button>
                    </Space>
                )}
            />
            <p className="mcp-management-hint">
                {t('ui.mcpTools.hint', null, 'Saving submits only the tools changed this time. After applying, the backend re-registers the MCP tools. Toggles for directly registered tools (not in config.yaml) are not persisted.')}
            </p>
        </SectionCard>
    );
}

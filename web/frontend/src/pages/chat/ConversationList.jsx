/** Left conversation list: search, project filter, pagination, create/rename/pin/delete/bulk delete. */
import { useEffect, useId, useMemo, useState } from 'react';
import {
    Button, Checkbox, Empty, Input, List, Pagination, Popconfirm, Select, Skeleton, Tooltip, Typography
} from '@douyinfe/semi-ui';
import { IconChevronDown, IconDelete, IconEdit, IconFolder, IconPlus, IconRefresh, IconSearch, IconStar } from '@douyinfe/semi-icons';
import { ErrorBanner } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { formatDateTime } from '../../lib/format';

const { Text } = Typography;

function ConversationRow({
    item, active, editing, editingTitle, onStartEdit, onEditingTitle, onCommitEdit, onCancelEdit,
    onSelect, onPin, onDelete, canWrite, canDelete, selected, onToggleSelect, batchMode
}) {
    const t = useT();
    const title = String(item.title || t('chat.untitled', null, 'Untitled conversation'));
    return (
        <div className={`chat-conv-item ${active ? 'is-active' : ''}`}>
            {batchMode && (
                <Checkbox
                    className="chat-conv-check"
                    aria-label={`${t('chat.selectConversation', null, 'Select conversation')}：${title}`}
                    checked={selected}
                    onChange={event => onToggleSelect(item.id, event.target.checked)}
                />
            )}
            {editing ? (
                <div className="chat-conv-edit">
                    <Input
                        size="small"
                        aria-label={t('chat.renameConversationTitle', null, 'Rename conversation')}
                        value={editingTitle}
                        autoFocus
                        onChange={onEditingTitle}
                        onEnterPress={onCommitEdit}
                        onKeyDown={event => {
                            if (event.key === 'Escape') onCancelEdit();
                        }}
                    />
                    <div className="chat-conv-edit-actions">
                        <Button size="small" theme="solid" onClick={onCommitEdit}>{t('common.save', null, 'Save')}</Button>
                        <Button size="small" theme="borderless" onClick={onCancelEdit}>{t('common.cancel', null, 'Cancel')}</Button>
                    </div>
                </div>
            ) : (
                <>
                    <button type="button" className="chat-conv-main" aria-current={active ? 'true' : undefined} title={title} onClick={() => onSelect(item.id)}>
                        <span className="chat-conv-title">
                            {item.pinned && <IconStar size="small" className="chat-conv-pin" />}
                            <span className="chat-conv-title-text">{title}</span>
                        </span>
                        <span className="chat-conv-meta">
                            {formatDateTime(item.updatedAt || item.createdAt)}
                        </span>
                    </button>
                    {!batchMode && (
                        <div className="chat-conv-actions">
                            {canWrite && (
                                <Tooltip content={t('chat.renameConversationTitle', null, 'Rename conversation')}>
                                    <Button size="small" theme="borderless" aria-label={t('chat.renameConversationTitle', null, 'Rename conversation')} icon={<IconEdit />} onClick={() => onStartEdit(item)} />
                                </Tooltip>
                            )}
                            {canWrite && (
                                <Tooltip content={item.pinned ? t('chat.unpin', null, 'Unpin') : t('chat.pin', null, 'Pin')}>
                                    <Button
                                        size="small"
                                        theme="borderless"
                                        icon={<IconStar />}
                                        aria-label={item.pinned ? t('chat.unpin', null, 'Unpin') : t('chat.pin', null, 'Pin')}
                                        type={item.pinned ? 'warning' : 'tertiary'}
                                        onClick={() => onPin(item)}
                                    />
                                </Tooltip>
                            )}
                            {canDelete && (
                                <Popconfirm
                                    title={t('chat.deleteConversationConfirm', null, 'Delete this conversation? Chat messages cannot be recovered, but recorded vulnerabilities will remain in the vulnerability library.')}
                                    onConfirm={() => onDelete(item)}
                                >
                                    <Button size="small" theme="borderless" type="danger" aria-label={t('chat.deleteConversationTitle', null, 'Delete conversation')} icon={<IconDelete />} />
                                </Popconfirm>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default function ConversationList({
    items, groups, expandedGroup, groupTotal, onToggleGroup, loading, error, onRetry,
    search, onSearch, projectId, onProjectChange, projects,
    page, pageSize, onPageChange,
    selectedId, onSelect, onCreate,
    onRename, onPin, onDelete, onBatchDelete,
    canWrite, canDelete
}) {
    const t = useT();
    const list = items;
    const groupContentId = useId();
    const [editingId, setEditingId] = useState('');
    const [editingTitle, setEditingTitle] = useState('');
    const [batchMode, setBatchMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);
    const allSelected = list.length > 0 && list.every(item => selectedIds.includes(item.id));
    const partiallySelected = !allSelected && list.some(item => selectedIds.includes(item.id));

    useEffect(() => {
        setSelectedIds([]);
        setBatchMode(false);
    }, [page, projectId, search, expandedGroup]);

    const projectOptions = useMemo(() => ([
        { value: '', label: t('chat.filterAllProjects', null, 'All projects') },
        ...(Array.isArray(projects) ? projects : []).map(project => ({
            value: project.id,
            label: project.name || project.id
        }))
    ]), [projects, t]);

    const toggleSelect = (id, checked) => {
        setSelectedIds(prev => (checked ? [...new Set([...prev, id])] : prev.filter(item => item !== id)));
    };

    const startEdit = item => {
        setEditingId(item.id);
        setEditingTitle(String(item.title || ''));
    };

    const commitEdit = () => {
        const id = editingId;
        const title = editingTitle.trim();
        setEditingId('');
        if (!id || !title) return;
        onRename(id, title);
    };

    const groupContents = (
        <>
            {loading && !list.length && <Skeleton placeholder={<Skeleton.Paragraph rows={6} />} loading />}
            {!loading && !error && !list.length && (
                <Empty
                    title={t('chat.noHistoryConversations', null, 'No conversation history yet')}
                    description={null}
                    className="chat-sidebar-empty"
                />
            )}
            <List
                dataSource={list}
                split={false}
                renderItem={item => (
                    <ConversationRow
                        key={item.id}
                        item={item}
                        active={item.id === selectedId}
                        editing={editingId === item.id}
                        editingTitle={editingTitle}
                        onStartEdit={startEdit}
                        onEditingTitle={setEditingTitle}
                        onCommitEdit={commitEdit}
                        onCancelEdit={() => setEditingId('')}
                        onSelect={onSelect}
                        onPin={onPin}
                        onDelete={onDelete}
                        canWrite={canWrite}
                        canDelete={canDelete}
                        batchMode={batchMode}
                        selected={selectedIds.includes(item.id)}
                        onToggleSelect={toggleSelect}
                    />
                )}
            />
        </>
    );

    return (
        <div className="chat-sidebar-inner">
            <div className="chat-sidebar-head">
                <Text strong className="chat-sidebar-title">{t('chat.conversations', null, 'Conversations')}</Text>
                <Button icon={<IconPlus />} theme="borderless" className="chat-new-chat" onClick={onCreate} disabled={!canWrite}>
                    {t('chat.newChat', null, 'New chat')}
                </Button>
            </div>
            <div className="chat-sidebar-filters">
                <Input
                    prefix={<IconSearch />}
                    aria-label={t('chat.searchHistory', null, 'Search history...')}
                    placeholder={t('chat.searchHistory', null, 'Search history...')}
                    value={search}
                    onChange={onSearch}
                    showClear
                />
                <Select
                    value={projectId}
                    optionList={projectOptions}
                    onChange={onProjectChange}
                    className="chat-sidebar-project"
                    aria-label={t('chat.filterByProject', null, 'Filter by project')}
                    placeholder={t('chat.filterByProject', null, 'Filter by project')}
                />
            </div>
            <div className="chat-sidebar-tools">
                <Text type="tertiary" size="small">{t('chat.recentConversations', null, 'Recent conversations')} · {groups.reduce((total, group) => total + group.total, 0)}</Text>
                <div className="chat-sidebar-tools-actions">
                    {canDelete && list.length > 0 && (
                        <Button
                            size="small"
                            theme={batchMode ? 'solid' : 'borderless'}
                            onClick={() => {
                                setBatchMode(!batchMode);
                                setSelectedIds([]);
                            }}
                        >
                            {batchMode ? t('common.cancel', null, 'Cancel') : t('chat.batchManage', null, 'Batch manage')}
                        </Button>
                    )}
                    <Button
                        size="small"
                        theme="borderless"
                        aria-label={t('chat.refreshConversationList', null, 'Refresh conversation list')}
                        title={t('chat.refreshConversationList', null, 'Refresh conversation list')}
                        icon={<IconRefresh />}
                        onClick={onRetry}
                    />
                </div>
            </div>
            {batchMode && (
                <div className="chat-batch-bar">
                    <Checkbox
                        className="chat-batch-select-all"
                        checked={allSelected}
                        indeterminate={partiallySelected}
                        disabled={loading || !list.length}
                        onChange={event => setSelectedIds(event.target.checked ? list.map(item => item.id) : [])}
                    >
                        {t('chat.selectPage', null, 'Select all on this page')}
                    </Checkbox>
                    <Text size="small">{t('chat.selectedCount', null, 'Selected')} {selectedIds.length}</Text>
                    <Button
                        size="small"
                        type="danger"
                        disabled={!selectedIds.length}
                        onClick={async () => {
                            await onBatchDelete(selectedIds);
                            setSelectedIds([]);
                            setBatchMode(false);
                        }}
                    >
                        {t('chat.batchDelete', null, 'Delete selected')}
                    </Button>
                </div>
            )}
            <div className="chat-conv-list">
                <ErrorBanner error={error} onRetry={onRetry} />
                {!groups.length && !loading && !error && (
                    <Empty title={t('chat.noHistoryConversations', null, 'No conversation history yet')} description={null} className="chat-sidebar-empty" />
                )}
                {groups.map(group => {
                    const expanded = group.id === expandedGroup;
                    const contentId = groupContentId + '-' + group.id;
                    return (
                        <div className="chat-conv-group" key={group.id}>
                            <button
                                type="button"
                                className="chat-conv-group-toggle"
                                aria-expanded={expanded}
                                aria-controls={contentId}
                                title={group.projectId ? group.title + ' · ' + group.projectId : group.title}
                                onClick={() => onToggleGroup(group.id)}
                            >
                                <IconFolder aria-hidden="true" />
                                <span className="chat-conv-group-name">{group.title}</span>
                                <span className="chat-conv-group-count">{group.total}</span>
                                <IconChevronDown aria-hidden="true" className="chat-conv-group-chevron" />
                            </button>
                            <div id={contentId} className="chat-conv-group-content" hidden={!expanded}>
                                {expanded && groupContents}
                            </div>
                        </div>
                    );
                })}
            </div>
            {expandedGroup && groupTotal > pageSize && (
                <div className="chat-sidebar-pager">
                    <Pagination
                        size="small"
                        total={groupTotal}
                        pageSize={pageSize}
                        currentPage={page}
                        onPageChange={onPageChange}
                        showSizeChanger={false}
                    />
                </div>
            )}
        </div>
    );
}

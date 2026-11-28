/**
 * Conversation attachment management: list/pagination/search, folder browsing, upload, create directory, preview, download, export and delete.
 */
import { useMemo, useRef, useState } from 'react';
import { Button, Input, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSearch, IconUpload } from '@douyinfe/semi-icons';
import { useAuth } from '../../lib/auth';
import { lazyLabels, translate, useT } from '../../lib/i18n';
import { useDebounced, useResource } from '../../components/hooks';
import {
    Drawer, PageHeader, SectionCard, DataTable, ErrorBanner,
    confirmAction, toastError, toastSuccess, toastWarning
} from '../../components/ui';
import { formatBytes, formatDateTime } from '../../lib/format';
import * as api from './api';
import PreviewDrawer from './PreviewDrawer';
import './page.css';

const { Text } = Typography;

const SOURCE_LABEL = lazyLabels('ui.chatFiles.source', {
    upload: 'Conversation attachments',
    reduction: 'Tool output',
    workspace: 'Workspace',
    conversation_artifact: 'Conversation artifacts'
});

const SOURCE_OPTIONS = [
    { value: 'all', get label() { return translate('ui.chatFiles.sourceAll', null, 'All'); } },
    { value: 'upload', get label() { return SOURCE_LABEL.upload; } },
    { value: 'reduction', get label() { return SOURCE_LABEL.reduction; } },
    { value: 'workspace', get label() { return SOURCE_LABEL.workspace; } },
    { value: 'conversation_artifact', get label() { return SOURCE_LABEL.conversation_artifact; } }
];

function dirOf(relativePath) {
    const parts = String(relativePath || '').split('/');
    parts.pop();
    return parts.join('/');
}

function baseName(relativePath) {
    const parts = String(relativePath || '').split('/');
    return parts[parts.length - 1] || relativePath;
}

export default function ChatFilesPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('files:write');
    const canDelete = hasPermission('files:delete') || canWrite;
    const fileInputRef = useRef(null);

    const [mode, setMode] = useState('list');
    const [conversation, setConversation] = useState('');
    const [project, setProject] = useState('');
    const [source, setSource] = useState('all');
    const [keyword, setKeyword] = useState('');
    const [currentDir, setCurrentDir] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [preview, setPreview] = useState(null);
    const [mkdir, setMkdir] = useState(null);
    const [uploading, setUploading] = useState(false);
    const search = useDebounced(keyword, 300);

    const query = useMemo(() => {
        const base = {
            conversation: conversation.trim() || undefined,
            project: project.trim() || undefined,
            source: source === 'all' ? undefined : source,
            search: search.trim() || undefined
        };
        return mode === 'browse'
            ? { ...base, page: 1, pageSize: 'all' }
            : { ...base, page, pageSize };
    }, [mode, conversation, project, source, search, page, pageSize]);

    const { data, loading, error, reload } = useResource(() => api.listFiles(query), [query]);
    const files = Array.isArray(data?.files) ? data.files : [];
    const folders = Array.isArray(data?.folders) ? data.folders : [];
    const total = Number(data?.total ?? files.length);

    const browsed = useMemo(() => {
        if (mode !== 'browse') return { folders: [], files };
        return {
            folders: folders.filter(folder => dirOf(folder) === currentDir),
            files: files.filter(file => dirOf(file.relativePath) === currentDir)
        };
    }, [mode, folders, files, currentDir]);

    const breadcrumb = useMemo(() => {
        const parts = currentDir ? currentDir.split('/') : [];
        const items = [{ label: t('chatFilesPage.browseRoot', null, 'Files'), path: '' }];
        parts.forEach((part, index) => items.push({ label: part, path: parts.slice(0, index + 1).join('/') }));
        return items;
    }, [currentDir, t]);

    const copyPath = async item => {
        try {
            const payload = await api.resolvePath(item.relativePath, 'file');
            await navigator.clipboard.writeText(payload?.absolutePath || item.relativePath);
            toastSuccess(t('chatFilesPage.pathCopied', null, 'Path copied — paste it into chat'));
        } catch (err) {
            toastError(err, t('chatFilesPage.errorGeneric', null, 'Something went wrong. Please try again.'));
        }
    };

    const download = async item => {
        try {
            await api.downloadFileByPath(item.relativePath, item.name);
        } catch (err) {
            toastError(err, t('chatFilesPage.errorGeneric', null, 'Something went wrong. Please try again.'));
        }
    };

    const remove = item => {
        confirmAction({
            title: t('chatFilesPage.confirmDelete', null, 'Delete this file?'),
            content: item.relativePath,
            onOk: async () => {
                try {
                    await api.deleteFile(item.relativePath);
                    toastSuccess(t('chatFilesPage.deleted', null, 'Deleted'));
                    reload();
                } catch (err) {
                    toastError(err);
                }
            }
        });
    };

    const pickFiles = () => fileInputRef.current?.click();

    const onFilesPicked = async event => {
        const list = Array.from(event.target.files || []);
        event.target.value = '';
        if (!list.length) return;
        setUploading(true);
        try {
            for (const file of list) {
                await api.uploadFile(file, { relativeDir: mode === 'browse' ? currentDir : '' });
            }
            toastSuccess(t('chatFilesPage.uploadOkHint', null, 'Uploaded. Use “Copy path” to copy the absolute path.'));
            reload();
        } catch (err) {
            toastError(err, t('chatFilesPage.errorGeneric', null, 'Something went wrong. Please try again.'));
        } finally {
            setUploading(false);
        }
    };

    const submitMkdir = async () => {
        const name = String(mkdir?.name || '').trim();
        if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
            toastWarning(t('chatFilesPage.mkdirInvalidName', null, 'Invalid name: cannot be empty or contain /, \\, or use . or ..'));
            return;
        }
        try {
            await api.makeDirectory(mode === 'browse' ? currentDir : '', name);
            toastSuccess(t('chatFilesPage.mkdirOk', null, 'Folder created'));
            setMkdir(null);
            reload();
        } catch (err) {
            toastError(err, t('chatFilesPage.errorGeneric', null, 'Something went wrong. Please try again.'));
        }
    };

    const exportCurrent = async () => {
        try {
            await api.exportFiles({
                conversation: conversation.trim() || undefined,
                project: project.trim() || undefined,
                source: source === 'all' ? undefined : source,
                search: search.trim() || undefined
            });
            toastSuccess(t('chatFilesPage.exportStarted', null, 'Started exporting current files'));
        } catch (err) {
            toastError(err, t('chatFilesPage.exportEmpty', null, 'No files to export'));
        }
    };

    const fileColumns = [
        {
            title: t('chatFilesPage.colName', null, 'Name'),
            dataIndex: 'name',
            render: (name, item) => (
                <button type="button" className="chat-files-name" onClick={() => setPreview(item)} title={item.relativePath}>
                    {name || baseName(item.relativePath)}
                </button>
            )
        },
        {
            title: t('chatFilesPage.sourceFilter', null, 'Source'),
            dataIndex: 'source',
            width: 110,
            render: value => <Tag size="small">{(SOURCE_LABEL[value] || value || SOURCE_LABEL.upload)}</Tag>
        },
        {
            title: t('chatFilesPage.colConversation', null, 'Conversation'),
            dataIndex: 'conversationTitle',
            width: 180,
            render: (value, item) => <Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{value || item.conversationId || '—'}</Text>
        },
        {
            title: t('chatFilesPage.colSubPath', null, 'Subfolder'),
            dataIndex: 'relativePath',
            width: 220,
            render: value => <span className="chat-files-path">{value}</span>
        },
        { title: t('chatFilesPage.colSize', null, 'Size'), dataIndex: 'size', width: 100, render: value => formatBytes(value) },
        {
            title: t('chatFilesPage.colModified', null, 'Modified'),
            dataIndex: 'modifiedUnix',
            width: 170,
            render: value => formatDateTime(value ? value * 1000 : null)
        },
        {
            title: t('chatFilesPage.colActions', null, 'Actions'),
            dataIndex: 'actions',
            width: 260,
            render: (_, item) => (
                <Space spacing={4} wrap>
                    <Button size="small" theme="borderless" onClick={() => setPreview(item)}>{t('chatFilesPage.preview', null, 'Preview')}</Button>
                    <Button size="small" theme="borderless" onClick={() => copyPath(item)}>{t('chatFilesPage.copyPath', null, 'Copy path')}</Button>
                    <Button size="small" theme="borderless" onClick={() => download(item)}>{t('chatFilesPage.download', null, 'Download')}</Button>
                    <Button size="small" theme="borderless" type="danger" disabled={!canDelete} onClick={() => remove(item)}>
                        {t('chatFilesPage.delete', null, 'Delete')}
                    </Button>
                </Space>
            )
        }
    ];

    const browseColumns = [
        {
            title: t('chatFilesPage.colName', null, 'Name'),
            dataIndex: 'name',
            render: (name, item) => (item.isDir ? (
                <button type="button" className="chat-files-name is-dir" onClick={() => setCurrentDir(item.path)}>
                    {name}/
                </button>
            ) : (
                <button type="button" className="chat-files-name" onClick={() => setPreview(item)} title={item.relativePath}>
                    {name}
                </button>
            ))
        },
        { title: t('chatFilesPage.colSize', null, 'Size'), dataIndex: 'size', width: 110, render: value => (value === undefined ? '—' : formatBytes(value)) },
        {
            title: t('chatFilesPage.colModified', null, 'Modified'),
            dataIndex: 'modifiedUnix',
            width: 180,
            render: value => (value ? formatDateTime(value * 1000) : '—')
        },
        {
            title: t('chatFilesPage.colActions', null, 'Actions'),
            dataIndex: 'actions',
            width: 240,
            render: (_, item) => (item.isDir ? (
                <Space spacing={4}>
                    <Button size="small" theme="borderless" onClick={() => setCurrentDir(item.path)}>{t('chatFilesPage.enterFolder', null, 'Open')}</Button>
                </Space>
            ) : (
                <Space spacing={4} wrap>
                    <Button size="small" theme="borderless" onClick={() => setPreview(item)}>{t('chatFilesPage.preview', null, 'Preview')}</Button>
                    <Button size="small" theme="borderless" onClick={() => copyPath(item)}>{t('chatFilesPage.copyPath', null, 'Copy path')}</Button>
                    <Button size="small" theme="borderless" onClick={() => download(item)}>{t('chatFilesPage.download', null, 'Download')}</Button>
                    <Button size="small" theme="borderless" type="danger" disabled={!canDelete} onClick={() => remove(item)}>
                        {t('chatFilesPage.delete', null, 'Delete')}
                    </Button>
                </Space>
            ))
        }
    ];

    const browseRows = [
        ...browsed.folders.map(folder => ({
            rowKey: `dir:${folder}`,
            isDir: true,
            path: folder,
            name: baseName(folder)
        })),
        ...browsed.files.map(item => ({ ...item, rowKey: item.relativePath }))
    ];

    const rows = mode === 'browse' ? browseRows : files;

    return (
        <div className="chat-files-page" id="page-chat-files">
            <PageHeader
                title={t('chatFilesPage.title', null, 'File Management')}
                description={t('chatFilesPage.intro', null, 'Files uploaded in chat appear here. Drag files into the list below, or click Upload to pick files (multiple allowed). Click “Copy path” to copy the server absolute path and paste it into a conversation so the model can reference the file.')}
                extra={[
                    <Button key="export" onClick={exportCurrent}>{t('chatFilesPage.export', null, 'Export Current Results')}</Button>,
                    <Button key="mkdir" icon={<IconPlus />} disabled={!canWrite} onClick={() => setMkdir({ name: '' })}>
                        {t('chatFilesPage.newFolderButton', null, 'New folder')}
                    </Button>,
                    <Button key="upload" theme="solid" type="primary" icon={<IconUpload />} loading={uploading} disabled={!canWrite} onClick={pickFiles}>
                        {t('chatFilesPage.upload', null, 'Upload')}
                    </Button>,
                    <Button key="refresh" icon={<IconRefresh />} onClick={reload} loading={loading}>{t('common.refresh', null, 'Refresh')}</Button>
                ]}
            />

            <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesPicked} />

            <ErrorBanner error={error} onRetry={reload} />

            <SectionCard title={t('chatFilesPage.filterTitle', null, 'Filters')}>
                <div className="chat-files-fields">
                    <div className="chat-files-field">
                        <span className="chat-files-field-label">{t('chatFilesPage.conversationFilter', null, 'Conversation ID')}</span>
                        <Input
                            value={conversation}
                            onChange={value => { setConversation(value); setPage(1); }}
                            placeholder={t('chatFilesPage.conversationPlaceholder', null, 'Leave empty for all')}
                            style={{ width: 200 }}
                        />
                    </div>
                    <div className="chat-files-field">
                        <span className="chat-files-field-label">{t('chatFilesPage.projectFilter', null, 'Project ID')}</span>
                        <Input
                            value={project}
                            onChange={value => { setProject(value); setPage(1); }}
                            placeholder={t('chatFilesPage.projectPlaceholder', null, 'Leave empty for all')}
                            style={{ width: 200 }}
                        />
                    </div>
                    <div className="chat-files-field">
                        <span className="chat-files-field-label">{t('chatFilesPage.searchName', null, 'File name')}</span>
                        <Input
                            value={keyword}
                            onChange={value => { setKeyword(value); setPage(1); }}
                            prefix={<IconSearch />}
                            placeholder={t('chatFilesPage.searchNamePlaceholder', null, 'Filter by file name')}
                            style={{ width: 200 }}
                        />
                    </div>
                    <div className="chat-files-field">
                        <span className="chat-files-field-label">{t('chatFilesPage.sourceFilter', null, 'Source')}</span>
                        <Select
                            value={source}
                            onChange={value => { setSource(value || 'all'); setPage(1); }}
                            optionList={SOURCE_OPTIONS}
                            style={{ width: 160 }}
                        />
                    </div>
                    <div className="chat-files-field">
                        <span className="chat-files-field-label">{t('chatFilesPage.groupBy', null, 'Group by')}</span>
                        <Select
                            value={mode}
                            onChange={value => { setMode(value || 'list'); setPage(1); setCurrentDir(''); }}
                            optionList={[
                                { value: 'list', label: t('chatFilesPage.groupNone', null, 'None (flat list)') },
                                { value: 'browse', label: t('chatFilesPage.groupByFolder', null, 'By folder (path navigation)') }
                            ]}
                            style={{ width: 200 }}
                        />
                    </div>
                </div>
            </SectionCard>

            {mode === 'browse' && (
                <nav className="chat-files-breadcrumb" aria-label="breadcrumb">
                    {breadcrumb.map((segment, index) => (
                        <span key={segment.path || 'root'} className="chat-files-breadcrumb-item">
                            {index > 0 && <span className="chat-files-breadcrumb-sep">/</span>}
                            <button type="button" onClick={() => setCurrentDir(segment.path)}>{segment.label}</button>
                        </span>
                    ))}
                </nav>
            )}

            <SectionCard
                title={mode === 'browse'
                    ? t('chatFilesPage.browseRoot', null, 'Files')
                    : t('chatFilesPage.listTitle', null, 'Attachments')}
                extra={<Text type="tertiary" size="small">{t('chatFilesPage.paginationInfo', null, 'Showing {{start}}-{{end}} of {{total}} files')
                    .replace('{{start}}', rows.length ? '1' : '0')
                    .replace('{{end}}', String(rows.length))
                    .replace('{{total}}', String(mode === 'browse' ? rows.length : total))}</Text>}
            >
                <DataTable
                    columns={mode === 'browse' ? browseColumns : fileColumns}
                    dataSource={rows}
                    rowKey={item => item.rowKey || item.relativePath}
                    loading={loading}
                    onRefresh={reload}
                    pagination={mode === 'browse' ? false : {
                        currentPage: page,
                        pageSize,
                        total,
                        onPageChange: next => setPage(next),
                        onPageSizeChange: size => { setPageSize(size); setPage(1); }
                    }}
                    emptyText={mode === 'browse'
                        ? t('chatFilesPage.folderEmpty', null, 'This folder is empty')
                        : t('chatFilesPage.empty', null, 'No chat uploads yet')}
                />
            </SectionCard>

            <PreviewDrawer item={preview} onClose={() => setPreview(null)} />

            <Drawer
                visible={Boolean(mkdir)}
                title={t('chatFilesPage.newFolderTitle', null, 'New folder')}
                width={420}
                onCancel={() => setMkdir(null)}
                onOk={submitMkdir}
            >
                <Text type="tertiary" size="small">
                    {t('chatFilesPage.newFolderLocation', null, 'Location')}：{mode === 'browse' && currentDir ? currentDir : '/'}
                </Text>
                <Input
                    value={mkdir?.name || ''}
                    onChange={value => setMkdir({ name: value })}
                    placeholder={t('chatFilesPage.newFolderNamePlaceholder', null, 'Name only, no slashes')}
                    style={{ marginTop: 8 }}
                />
            </Drawer>
        </div>
    );
}

import { useEffect, useState } from 'react';
import { Button, Form, Input, List, Space, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconPlus, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useDebounced, useResource } from '../../components/hooks';
import { DataTable, ErrorBanner, KeyValueList, MarkdownView, PageHeader, SectionCard, confirmAction, toastError, toastSuccess, Drawer } from '../../components/ui';
import { formatBytes, formatDateTime } from '../../lib/format';

const { Text } = Typography;

export default function SkillsManagementPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('skills:write');
    const canDelete = hasPermission('skills:delete');
    const [search, setSearch] = useState('');
    const debounced = useDebounced(search, 300);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [detail, setDetail] = useState(null);
    const [editor, setEditor] = useState(null);
    const [saving, setSaving] = useState(false);

    const skills = useResource(
        () => api.get('/skills', { search: debounced || undefined, limit: pageSize, offset: (page - 1) * pageSize }),
        [debounced, page, pageSize]
    );
    const rows = Array.isArray(skills.data?.skills) ? skills.data.skills : [];
    const total = Number(skills.data?.total || 0);

    const save = async () => {
        if (saving || !editor?.form) return;
        const values = await editor.form.validate().catch(() => null);
        if (!values) return;
        setSaving(true);
        try {
            await api.post('/skills', {
                name: values.name.trim(),
                description: values.description.trim(),
                content: values.content
            });
            toastSuccess(t('ui.skillsManagement.created', null, 'Skill created'));
            setEditor(null);
            skills.reload();
        } catch (error) {
            toastError(error, t('ui.skillsManagement.createFailed', null, 'Failed to create skill'));
        } finally {
            setSaving(false);
        }
    };

    const remove = row => confirmAction({
        title: t('ui.skillsManagement.deleteTitle', { name: row.name }, 'Delete skill "{{name}}"?'),
        content: t('ui.skillsManagement.deleteContent', null, 'The skill directory and all its files will be removed.'),
        onOk: async () => {
            await api.del(`/skills/${encodeURIComponent(row.id || row.name)}`);
            toastSuccess(t('ui.skillsManagement.deleted', null, 'Deleted'));
            skills.reload();
        }
    });

    const columns = [
        {
            title: t('ui.skillsManagement.skill', null, 'Skill'), dataIndex: 'name', render: (value, record) => (
                <Space vertical spacing={0} align="start">
                    <Text strong>{value || record.id}</Text>
                    <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 420 }}>{record.description}</Text>
                </Space>
            )
        },
        { title: t('ui.skillsManagement.version', null, 'Version'), dataIndex: 'version', width: 100, render: value => value || '—' },
        { title: t('ui.skillsManagement.files', null, 'Files'), dataIndex: 'file_count', width: 80, render: value => String(value ?? '—') },
        { title: t('ui.skillsManagement.size', null, 'Size'), dataIndex: 'file_size', width: 100, render: value => formatBytes(value) },
        { title: t('ui.skillsManagement.updatedAt', null, 'Updated at'), dataIndex: 'mod_time', width: 170, render: value => (value ? formatDateTime(value) : '—') },
        {
            title: t('ui.skillsManagement.actions', null, 'Actions'), width: 140, render: (_, record) => (
                <Space>
                    <Button size="small" theme="borderless" onClick={() => setDetail(record)}>{t('ui.skillsManagement.detail', null, 'Details')}</Button>
                    {canDelete && <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} onClick={() => remove(record)} />}
                </Space>
            )
        }
    ];

    return (
        <div>
            <PageHeader
                title={t('skills.managementTitle', null, 'Skill Management')}
                description={t('ui.skillsManagement.description', null, 'Skills are stored as directories under the skills root. SKILL.md describes triggers and usage.')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} onClick={() => skills.reload()} loading={skills.loading}>{t('ui.skillsManagement.refresh', null, 'Refresh')}</Button>
                        {canWrite && <Button theme="solid" type="primary" icon={<IconPlus />} onClick={() => setEditor({ form: {} })}>{t('ui.skillsManagement.newSkill', null, 'New skill')}</Button>}
                    </Space>
                )}
            />
            <SectionCard title={t('ui.skillsManagement.listTitle', { count: total }, 'Skills ({{count}})')}>
                <ErrorBanner error={skills.error} onRetry={() => skills.reload()} />
                <DataTable
                    columns={columns}
                    dataSource={rows}
                    rowKey={record => record.id || record.name}
                    loading={skills.loading}
                    pagination={{
                        currentPage: page,
                        pageSize,
                        total,
                        onPageChange: setPage,
                        onPageSizeChange: size => { setPageSize(size); setPage(1); }
                    }}
                    toolbar={<Input prefix={<IconSearch />} value={search} onChange={value => { setSearch(value); setPage(1); }} placeholder={t('ui.skillsManagement.searchPlaceholder', null, 'Search skill name or description')} style={{ width: 280 }} />}
                />
            </SectionCard>

            <Drawer title={t('ui.skillsManagement.newSkill', null, 'New skill')} visible={Boolean(editor)} key="new-skill" onCancel={() => setEditor(null)} onOk={save} confirmLoading={saving} width={720}>
                <Form getFormApi={form => setEditor(current => (current ? { ...current, form } : current))}>
                    <Form.Input field="name" label={t('ui.skillsManagement.dirName', null, 'Directory name')} placeholder={t('ui.skillsManagement.dirNameHint', null, 'Lowercase letters, digits, hyphens')} rules={[{ required: true, message: t('ui.skillsManagement.dirNameRequired', null, 'Enter a directory name') }, { pattern: /^[a-z0-9-]+$/, message: t('ui.skillsManagement.dirNamePattern', null, 'Only lowercase letters, digits and hyphens are allowed') }]} />
                    <Form.Input field="description" label={t('ui.skillsManagement.descriptionLabel', null, 'Description')} rules={[{ required: true, message: t('ui.skillsManagement.descriptionRequired', null, 'Enter a description') }]} />
                    <Form.TextArea field="content" label={t('ui.skillsManagement.bodyLabel', null, 'SKILL.md body')} rules={[{ required: true, message: t('ui.skillsManagement.bodyRequired', null, 'Enter the body') }]} autosize={{ minRows: 10, maxRows: 24 }} />
                </Form>
            </Drawer>

            <SkillDetail skill={detail} onClose={() => setDetail(null)} canWrite={canWrite} />
        </div>
    );
}

function SkillDetail({ skill, onClose, canWrite }) {
    const t = useT();
    const [files, setFiles] = useState([]);
    const [activeFile, setActiveFile] = useState('');
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!skill) return;
        setFiles([]);
        setActiveFile('');
        setContent('');
        api.get(`/skills/${encodeURIComponent(skill.id || skill.name)}/files`)
            .then(payload => setFiles(Array.isArray(payload?.files) ? payload.files : []))
            .catch(() => setFiles([]));
    }, [skill]);

    const openFile = async path => {
        setLoading(true);
        try {
            const payload = await api.get(`/skills/${encodeURIComponent(skill.id || skill.name)}/file`, { path });
            setActiveFile(path);
            setContent(payload?.content || '');
        } catch (error) {
            toastError(error, t('ui.skillsManagement.readFailed', null, 'Failed to read file'));
        } finally {
            setLoading(false);
        }
    };

    const saveFile = async () => {
        setSaving(true);
        try {
            await api.put(`/skills/${encodeURIComponent(skill.id || skill.name)}/file`, { path: activeFile, content });
            toastSuccess(t('ui.skillsManagement.fileSaved', null, 'File saved'));
        } catch (error) {
            toastError(error, t('ui.skillsManagement.saveFailed', null, 'Failed to save file'));
        } finally {
            setSaving(false);
        }
    };

    const fileList = files.map(item => (typeof item === 'string' ? item : item.path || item.name));

    return (
        <Drawer title={skill?.name || t('ui.skillsManagement.detailTitle', null, 'Skill details')} visible={Boolean(skill)} onCancel={onClose} width={860}>
            {skill && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <KeyValueList items={[
                        { label: t('ui.skillsManagement.dirName', null, 'Directory name'), value: skill.id || skill.dir_name },
                        { label: t('ui.skillsManagement.version', null, 'Version'), value: skill.version || '—' },
                        { label: t('ui.skillsManagement.path', null, 'Path'), value: skill.path },
                        { label: t('ui.skillsManagement.fileCount', null, 'File count'), value: skill.file_count },
                        { label: t('ui.skillsManagement.triggers', null, 'Triggers'), value: Array.isArray(skill.triggers) ? skill.triggers.join('、') : '—' },
                        { label: t('ui.skillsManagement.tags', null, 'Tags'), value: Array.isArray(skill.tags) ? skill.tags.join('、') : '—' }
                    ]} />
                    <Text type="tertiary">{skill.description}</Text>
                    <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 12 }}>
                        <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, maxHeight: 420, overflow: 'auto' }}>
                            <List
                                dataSource={fileList}
                                renderItem={item => (
                                    <List.Item
                                        main={<Text size="small" ellipsis={{ showTooltip: true }}>{item}</Text>}
                                        onClick={() => openFile(item)}
                                        style={{ cursor: 'pointer', background: item === activeFile ? 'var(--semi-color-primary-light-default)' : undefined }}
                                    />
                                )}
                                emptyContent={t('ui.skillsManagement.noFiles', null, 'No files')}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <Space>
                                <Text strong>{activeFile || t('ui.skillsManagement.pickFile', null, 'Select a file on the left to view its content')}</Text>
                                {canWrite && activeFile && <Button size="small" loading={saving} onClick={saveFile}>{t('ui.skillsManagement.save', null, 'Save')}</Button>}
                            </Space>
                            {activeFile
                                ? <TextArea value={content} onChange={setContent} autosize={{ minRows: 20, maxRows: 30 }} disabled={!canWrite} />
                                : <MarkdownView content={skill.description || '—'} />}
                            {loading && <Text type="tertiary">{t('ui.skillsManagement.reading', null, 'Reading…')}</Text>}
                        </div>
                    </div>
                </div>
            )}
        </Drawer>
    );
}

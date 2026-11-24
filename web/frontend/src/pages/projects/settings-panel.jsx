/** Project settings: metadata, test scope JSON, archive/restore and delete. */
import { useEffect, useState } from 'react';
import { Button, Divider, Input, Select, Space, Switch, TextArea, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { translate, useT } from '../../lib/i18n';
import { SectionCard, confirmAction, toastError, toastSuccess } from '../../components/ui';
import { PROJECT_STATUS, errText } from './helpers';

const { Text } = Typography;

const SCOPE_EXAMPLE = {
    targets: ['https://example.com'],
    exclude: ['*.cdn.example.com'],
    get notes() { return translate('ui.projectsSettings.scopeExampleNotes', null, 'Authorized for web application layer testing only'); }
};

export default function SettingsPanel({ project, canWrite, canDelete, onChanged, onDeleted }) {
    const t = useT();
    const [form, setForm] = useState({ name: '', description: '', scope_json: '', status: 'active', pinned: false });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!project) return;
        setForm({
            name: project.name || '',
            description: project.description || '',
            scope_json: project.scope_json || '',
            status: project.status || 'active',
            pinned: Boolean(project.pinned)
        });
    }, [project]);

    const update = patch => setForm(prev => ({ ...prev, ...patch }));

    const formatScope = () => {
        const raw = form.scope_json.trim();
        if (!raw) return;
        try {
            update({ scope_json: JSON.stringify(JSON.parse(raw), null, 2) });
        } catch (error) {
            toastError(t('projects.invalidJson', null, 'Invalid JSON format') + '：' + errText(error, ''));
        }
    };

    const insertExample = () => update({ scope_json: JSON.stringify(SCOPE_EXAMPLE, null, 2) });

    const save = async () => {
        const name = form.name.trim();
        if (!name) {
            toastError(t('projects.enterProjectName', null, 'Please enter project name'));
            return;
        }
        const scopeRaw = form.scope_json.trim();
        if (scopeRaw) {
            try {
                JSON.parse(scopeRaw);
            } catch (error) {
                toastError(t('projects.invalidScopeJson', null, 'Invalid scope JSON, please fix it first or click Format'));
                return;
            }
        }
        setSaving(true);
        try {
            await api.put(`/projects/${project.id}`, {
                name,
                description: form.description,
                scope_json: scopeRaw,
                status: form.status,
                pinned: Boolean(form.pinned)
            });
            toastSuccess(t('projects.saved', null, 'Saved'));
            onChanged?.();
        } catch (error) {
            toastError(errText(error, t('projects.saveFailed', null, 'Save failed')));
        } finally {
            setSaving(false);
        }
    };

    const archived = (project?.status || 'active') === 'archived';

    const toggleArchive = () => {
        confirmAction({
            title: archived ? t('projects.restoreProjectActive', null, 'Restore to active') : t('projects.archiveProject', null, 'Archive'),
            content: archived
                ? t('projects.confirmRestoreProjectActive', null, 'Restore to active?')
                : t('projects.confirmArchiveProject', null, 'After archiving, this project is hidden from active list by default. Continue?'),
            okText: t('common.confirm', null, 'Confirm'),
            danger: !archived,
            onOk: async () => {
                try {
                    await api.put(`/projects/${project.id}`, { status: archived ? 'active' : 'archived' });
                    toastSuccess(t('projects.saved', null, 'Saved'));
                    onChanged?.();
                } catch (error) {
                    toastError(errText(error, t('projects.operationFailed', null, 'Operation failed')));
                }
            }
        });
    };

    const remove = () => {
        confirmAction({
            title: t('projects.deleteProject', null, 'Delete project'),
            content: t('projects.confirmDeleteProject', null, 'Delete this project? Facts will be deleted and conversations unbound.'),
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    await api.del(`/projects/${project.id}`);
                    toastSuccess(t('projects.deleteProject', null, 'Delete project'));
                    onDeleted?.(project.id);
                } catch (error) {
                    toastError(errText(error, t('projects.deleteFailed', null, 'Delete failed')));
                }
            }
        });
    };

    if (!project) {
        return (
            <SectionCard title={t('projects.tabSettings', null, 'Settings')}>
                <Text type="tertiary">{t('projects.selectOrCreateTitle', null, 'Select or create a project')}</Text>
            </SectionCard>
        );
    }

    return (
        <SectionCard
            title={t('projects.settingsIntroTitle', null, 'Project settings')}
            description={t('projects.settingsIntroHint', null, 'Configure project metadata and Agent authorization boundary; takes effect immediately for bound conversations after saving.')}
            extra={(
                <Button type="primary" loading={saving} disabled={!canWrite} onClick={save}>
                    {t('projects.saveSettings', null, 'Save changes')}
                </Button>
            )}
        >
            <div className="project-form-grid">
                <div className="project-form-field">
                    <Text strong size="small">{t('projects.projectName', null, 'Project name')}</Text>
                    <Input value={form.name} disabled={!canWrite} onChange={value => update({ name: value })} />
                    <Text type="tertiary" size="small">{t('projects.saveChangesHint', null, 'Click save to sync changes to server')}</Text>
                </div>
                <div className="project-form-field">
                    <Text strong size="small">{t('projects.status', null, 'Status')}</Text>
                    <Select
                        value={form.status}
                        disabled={!canWrite}
                        optionList={PROJECT_STATUS}
                        onChange={value => update({ status: value })}
                        style={{ width: '100%' }}
                    />
                    <div className="project-switch-row">
                        <Switch checked={form.pinned} disabled={!canWrite} onChange={checked => update({ pinned: checked })} />
                        <Text size="small">{t('projects.pinProject', null, 'Pin project (show first in list)')}</Text>
                    </div>
                </div>
            </div>

            <div className="project-form-field">
                <Text strong size="small">{t('projects.projectDescription', null, 'Project description')}</Text>
                <TextArea
                    value={form.description}
                    rows={3}
                    maxCount={4000}
                    disabled={!canWrite}
                    placeholder={t('projects.editDescriptionPlaceholder', null, 'Client/task notes, contacts, collaboration…')}
                    onChange={value => update({ description: value })}
                />
            </div>

            <div className="project-form-field">
                <Space>
                    <Text strong size="small">{t('projects.scopeJsonLabel', null, 'Scope JSON')}</Text>
                    <Button size="small" theme="borderless" disabled={!canWrite} onClick={formatScope}>
                        {t('projects.formatJson', null, 'Format')}
                    </Button>
                    <Button size="small" theme="borderless" disabled={!canWrite} onClick={insertExample}>
                        {t('projects.example', null, 'Example')}
                    </Button>
                </Space>
                <TextArea
                    value={form.scope_json}
                    rows={8}
                    disabled={!canWrite}
                    placeholder={'{\n  "targets": ["https://example.com"]\n}'}
                    onChange={value => update({ scope_json: value })}
                />
                <Text type="tertiary" size="small">
                    {t('projects.scopeFootnote', null, 'Supports targets, exclude, notes and more. Empty means no scope limit.')}
                </Text>
            </div>

            <Divider margin="12px" />
            <div className="project-danger-zone">
                <div>
                    <Text strong>{t('projects.dangerZoneTitle', null, 'Danger zone')}</Text>
                    <div>
                        <Text type="tertiary" size="small">
                            {t('projects.dangerZoneHint', null, 'Archived projects are hidden unless \'Show archived\' is enabled; deletion removes all facts permanently.')}
                        </Text>
                    </div>
                </div>
                <Space>
                    <Button disabled={!canWrite} onClick={toggleArchive}>
                        {archived ? t('projects.restoreProjectActive', null, 'Restore to active') : t('projects.archiveProject', null, 'Archive')}
                    </Button>
                    <Button type="danger" disabled={!canDelete} onClick={remove}>
                        {t('projects.deleteProject', null, 'Delete project')}
                    </Button>
                </Space>
            </div>
        </SectionCard>
    );
}

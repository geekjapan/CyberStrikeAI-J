import { useEffect, useId, useState } from 'react';
import { Form, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { Drawer, ErrorBanner, toastSuccess } from '../../components/ui';

const { Text } = Typography;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 4000;

export default function ProjectFormModal({ visible, project, onCancel, onSaved }) {
    const t = useT();
    const formId = useId();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const editing = Boolean(project?.id);

    useEffect(() => { setError(null); }, [visible, project?.id]);

    const submit = async values => {
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            const body = { name: values.name.trim(), description: (values.description || '').slice(0, MAX_DESCRIPTION) };
            const saved = editing
                ? await api.put(`/projects/${project.id}`, body)
                : await api.post('/projects', body);
            toastSuccess(editing ? t('projects.saved', null, 'Saved') : t('projects.createProject', null, 'Create project'));
            onSaved?.(saved);
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            width={560}
            closable={!saving}
            closeOnEsc={!saving}
            onCancel={onCancel}
            cancelButtonProps={{ disabled: saving }}
            title={editing ? t('projects.modalEditTitle', null, 'Edit project') : t('projects.modalNewTitle', null, 'New project')}
            formId={formId}
            okText={editing ? t('projects.saveChanges', null, 'Save changes') : t('projects.createProject', null, 'Create project')}
            confirmLoading={saving}
        >
            <Text type="tertiary" size="small">
                {editing
                    ? t('projects.modalEditSubtitle', null, 'Update project name and description')
                    : t('projects.modalNewSubtitle', null, 'After creation, bind conversations to share fact board across chats')}
            </Text>
            <Form id={formId} key={`${visible}-${project?.id || 'new'}`} onSubmit={submit}
                initValues={{ name: project?.name || '', description: project?.description || '' }}>
                <Form.Input id={`${formId}-name`} field="name" maxLength={MAX_NAME}
                    label={t('projects.projectName', null, 'Project name')}
                    placeholder={t('projects.projectNamePlaceholder', null, 'e.g. Client A Web pentest')}
                    rules={[{ required: true, whitespace: true, message: t('projects.enterProjectName', null, 'Please enter project name') }]} />
                <Form.TextArea id={`${formId}-description`} field="description" rows={4} maxCount={MAX_DESCRIPTION}
                    label={t('projects.projectDescription', null, 'Project description')}
                    placeholder={t('projects.projectDescriptionPlaceholder', null, 'Client/task notes, team collaboration…')}
                    extraText={t('projects.descriptionLengthHint', null, 'For team reference only — the Agent does not read this. Keep it brief (max 4000 chars). Put anything the Agent should know in the fact board.')} />
                <ErrorBanner error={error} />
            </Form>
        </Drawer>
    );
}

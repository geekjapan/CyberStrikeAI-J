import { useId, useState } from 'react';
import { Button, Form, Input, Select, Space, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useDebounced, useResource } from '../../components/hooks';
import { Drawer, ErrorBanner, toastSuccess } from '../../components/ui';
import { lazyLabels, useT } from '../../lib/i18n';

const TYPE_LABELS = lazyLabels('ui.resourceGrant.type', {
    project: 'Project', conversation: 'Conversation', asset: 'Asset',
    vulnerability: 'Vulnerability', batch_task: 'Batch task'
});
const types = Object.keys(TYPE_LABELS);

export default function ResourceGrant({ users, onCancel, onSaved }) {
    const t = useT();
    const formId = useId();
    const [type, setType] = useState(types[0]);
    const [query, setQuery] = useState('');
    const [offset, setOffset] = useState(0);
    const [picked, setPicked] = useState([]);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const q = useDebounced(query, 250);
    const result = useResource(async () => ({
        type, q, offset, payload: await api.get('/rbac/resources', { type, q, limit: 20, offset })
    }), [type, q, offset]);
    const match = result.data?.type === type && result.data.q === q && result.data.offset === offset;
    const data = match ? result.data.payload : null;
    const resources = Array.isArray(data?.resources) ? data.resources : [];
    const optionMap = new Map([...picked, ...resources.map(item => [item.id, item.label || item.id])]);

    const submit = async values => {
        if (saving) return;
        setError(null);
        const manual = String(values.ids || '').split(/[\s,，;；]+/).filter(Boolean);
        const ids = [...new Set([...picked.map(([id]) => id), ...manual])];
        if (!ids.length || ids.length > 100) {
            setError(new Error(t('ui.resourceGrant.idsRange', null, 'Select or enter 1 to 100 resource IDs')));
            return;
        }
        setSaving(true);
        try {
            await api.post('/rbac/resource-assignments', {
                user_id: values.user_id, resource_type: type, resource_ids: ids
            });
            toastSuccess(t('ui.resourceGrant.saved', null, 'Resource grant saved'));
            onSaved();
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            visible
            title={t('ui.resourceGrant.title', null, 'Add resource grant')}
            width={560}
            closable={!saving}
            maskClosable={!saving}
            closeOnEsc={!saving}
            onCancel={onCancel}
            formId={formId}
            okText={t('ui.resourceGrant.okText', null, 'Save grant')}
            confirmLoading={saving}
            cancelButtonProps={{ disabled: saving }}
        >
            <Form id={formId} onSubmit={submit} initValues={{ resource_type: type }}>
                <Form.Select field="user_id" label={t('ui.resourceGrant.user', null, 'User')} filter
                    optionList={users.map(user => ({ value: user.id, label: user.display_name || user.username }))}
                    rules={[{ required: true, message: t('ui.resourceGrant.userRequired', null, 'Select a user') }]} />
                <Form.Select field="resource_type" label={t('ui.resourceGrant.resourceType', null, 'Resource type')}
                    optionList={types.map(value => ({ value, label: TYPE_LABELS[value] }))}
                    onChange={value => { setType(value); setPicked([]); setQuery(''); setOffset(0); }} />
                <Form.Slot label={t('ui.resourceGrant.searchLabel', null, 'Search by name or ID')}>
                    <Input aria-label={t('ui.resourceGrant.searchAria', null, 'Search resources')} value={query} onChange={value => { setQuery(value); setOffset(0); }} />
                </Form.Slot>
                <Form.Slot label={t('ui.resourceGrant.pickLabel', null, 'Select resources')}>
                    <Space wrap>
                        <Button size="small" disabled={offset === 0 || result.loading} onClick={() => setOffset(value => Math.max(0, value - 20))}>{t('ui.resourceGrant.prevPage', null, 'Previous page')}</Button>
                        <Typography.Text type="tertiary">{offset + resources.length} / {data?.total ?? '—'}</Typography.Text>
                        <Button size="small" disabled={!data?.has_more || result.loading} onClick={() => setOffset(value => value + 20)}>{t('ui.resourceGrant.nextPage', null, 'Next page')}</Button>
                    </Space>
                    <Select multiple style={{ width: '100%', marginTop: 8 }} loading={result.loading}
                        value={picked.map(([id]) => id)}
                        aria-label={t('ui.resourceGrant.pickLabel', null, 'Select resources')}
                        optionList={[...optionMap].map(([value, label]) => ({ value, label }))}
                        onChange={values => setPicked((values || []).map(id => [id, optionMap.get(id) || id]))} />
                </Form.Slot>
                <Form.TextArea field="ids" label={t('ui.resourceGrant.manualIds', null, 'Enter resource IDs manually')} placeholder={t('ui.resourceGrant.manualIdsHint', null, 'Separate multiple IDs with spaces or line breaks')} rows={2} />
                <ErrorBanner error={error || result.error} />
            </Form>
        </Drawer>
    );
}

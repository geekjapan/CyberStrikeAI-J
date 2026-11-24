/** Bulk edit: PUT /assets/bulk; only filled-in fields are submitted, blank fields keep their value. */
import { useEffect, useMemo, useState } from 'react';
import { Banner, Input, Select, Typography } from '@douyinfe/semi-ui';
import { api, errorMessage } from '../../../lib/http';
import { useT } from '../../../lib/i18n';
import { Drawer, toastSuccess } from '../../../components/ui';
import { CRITICALITY_OPTIONS, ENVIRONMENT_OPTIONS, STATUS_OPTIONS } from './assetConstants';
import { splitTags } from './assetTarget';

const { Text } = Typography;

const EMPTY = {
    status: '', environment: '', criticality: '',
    responsible_person: '', department: '', business_system: '',
    add_tags: '', remove_tags: ''
};

export default function AssetBulkEditModal({ visible, assetIds, onClose, onDone }) {
    const t = useT();
    const [values, setValues] = useState(EMPTY);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const ids = useMemo(() => (Array.isArray(assetIds) ? assetIds : []), [assetIds]);

    useEffect(() => {
        if (visible) {
            setValues(EMPTY);
            setError('');
            setBusy(false);
        }
    }, [visible]);

    const patch = next => setValues(prev => ({ ...prev, ...next }));

    const submit = async () => {
        if (busy || !ids.length) return;
        const body = { asset_ids: ids };
        ['status', 'environment', 'criticality', 'responsible_person', 'department', 'business_system']
            .forEach(key => {
                const value = String(values[key] || '').trim();
                if (value) body[key] = value;
            });
        const addTags = splitTags(values.add_tags);
        const removeTags = splitTags(values.remove_tags);
        if (addTags.length) body.add_tags = addTags;
        if (removeTags.length) body.remove_tags = removeTags;
        if (Object.keys(body).length === 1) {
            setError(t('ui.assetBulkEdit.needOneField', null, 'Fill in at least one field to change.'));
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await api.put('/assets/bulk', body);
            const updated = Number(result?.updated || ids.length);
            toastSuccess(t('ui.assetBulkEdit.updated', { count: updated }, 'Updated {{count}} assets'));
            onDone?.();
            onClose?.();
        } catch (submitError) {
            setError(errorMessage(submitError, t('ui.assetBulkEdit.failed', null, 'Bulk edit failed')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            title={t('assets.bulkEdit', null, 'Bulk edit')}
            width={620}
            onCancel={onClose}
            onOk={submit}
            confirmLoading={busy}
        >
            <Text type="tertiary">{t('ui.assetBulkEdit.hint', { count: ids.length }, '{{count}} assets will be changed. Blank fields keep their current values.')}</Text>
            <div className="asset-library-form-grid asset-library-form-grid--bulk">
                <Select
                    value={values.status || undefined}
                    placeholder={t('assets.status', null, 'Status')}
                    optionList={STATUS_OPTIONS}
                    showClear
                    onChange={value => patch({ status: value || '' })}
                />
                <Select
                    value={values.environment || undefined}
                    placeholder={t('assets.environment', null, 'Environment')}
                    optionList={ENVIRONMENT_OPTIONS}
                    showClear
                    onChange={value => patch({ environment: value || '' })}
                />
                <Select
                    value={values.criticality || undefined}
                    placeholder={t('assets.criticality', null, 'Criticality')}
                    optionList={CRITICALITY_OPTIONS}
                    showClear
                    onChange={value => patch({ criticality: value || '' })}
                />
                <Input
                    value={values.responsible_person}
                    placeholder={t('assets.responsiblePerson', null, 'Owner')}
                    onChange={value => patch({ responsible_person: value })}
                />
                <Input
                    value={values.department}
                    placeholder={t('assets.department', null, 'Department')}
                    onChange={value => patch({ department: value })}
                />
                <Input
                    value={values.business_system}
                    placeholder={t('assets.businessSystem', null, 'Business system')}
                    onChange={value => patch({ business_system: value })}
                />
                <Input
                    value={values.add_tags}
                    placeholder={t('ui.assetBulkEdit.addTagsPlaceholder', null, 'Tags to add (comma-separated)')}
                    onChange={value => patch({ add_tags: value })}
                />
                <Input
                    value={values.remove_tags}
                    placeholder={t('ui.assetBulkEdit.removeTagsPlaceholder', null, 'Tags to remove (comma-separated)')}
                    onChange={value => patch({ remove_tags: value })}
                />
            </div>
            {error && <Banner type="danger" bordered closeIcon={null} description={error} className="asset-library-form-error" />}
        </Drawer>
    );
}

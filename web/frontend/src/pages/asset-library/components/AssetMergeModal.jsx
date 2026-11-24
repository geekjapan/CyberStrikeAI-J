/** Merge duplicate assets: pick the primary asset, POST /assets/merge (the backend requires the assets to share a domain/IP/host). */
import { useEffect, useMemo, useState } from 'react';
import { Banner, Radio, RadioGroup, Space, Typography } from '@douyinfe/semi-ui';
import { api, errorMessage } from '../../../lib/http';
import { useT } from '../../../lib/i18n';
import { Drawer, toastSuccess } from '../../../components/ui';
import { assetTargetLabel } from './assetTarget';

const { Text } = Typography;

export default function AssetMergeModal({ visible, assets, onClose, onDone }) {
    const t = useT();
    const list = useMemo(() => (Array.isArray(assets) ? assets : []), [assets]);
    const [primaryId, setPrimaryId] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (visible) {
            setPrimaryId(list[0]?.id || '');
            setError('');
            setBusy(false);
        }
    }, [visible, list]);

    const submit = async () => {
        if (busy || list.length < 2) return;
        setBusy(true);
        setError('');
        try {
            const result = await api.post('/assets/merge', {
                asset_ids: list.map(item => item.id),
                primary_id: primaryId || list[0].id
            });
            const merged = Number(result?.merged || list.length);
            toastSuccess(t('ui.assetMerge.merged', { count: merged }, 'Merged {{count}} assets'));
            onDone?.();
            onClose?.();
        } catch (submitError) {
            setError(errorMessage(submitError, t('ui.assetMerge.failed', null, 'Failed to merge assets')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            title={t('assets.mergeDuplicates', null, 'Merge duplicates')}
            width={560}
            onCancel={onClose}
            onOk={submit}
            okText={t('assets.merge', null, 'Merge')}
            okButtonProps={{ disabled: list.length < 2 }}
            confirmLoading={busy}
        >
            {list.length < 2 ? (
                <Banner
                    type="warning"
                    bordered
                    closeIcon={null}
                    description={t('assets.mergeRequiresMultiple', null, 'Select at least two duplicate assets')}
                />
            ) : (
                <Space vertical align="start" spacing={8} style={{ width: '100%' }}>
                    <Text type="tertiary">
                        {t('assets.mergeHint', null, 'One primary asset is kept. Empty fields and tags from the other assets are merged into it, then the merged records are deleted. The selected assets must share a domain, IP, or host.')}
                    </Text>
                    <RadioGroup value={primaryId} onChange={event => setPrimaryId(event.target.value)}>
                        <Space vertical align="start" spacing={4}>
                            {list.map(item => (
                                <Radio key={item.id} value={item.id}>
                                    {assetTargetLabel(item)}
                                    {item.project_name ? ` · ${item.project_name}` : ''}
                                </Radio>
                            ))}
                        </Space>
                    </RadioGroup>
                </Space>
            )}
            {error && <Banner type="danger" bordered closeIcon={null} description={error} className="asset-library-form-error" />}
        </Drawer>
    );
}

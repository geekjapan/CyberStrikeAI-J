/** Tool whitelist: GET/PUT/POST /hitl/tool-whitelist (PUT replaces the whole table, POST merges and appends). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Space, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { ErrorBanner, SectionCard, toastError, toastSuccess } from '../../components/ui';
import { useResource } from '../../components/hooks';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { parseToolTokens, reviewerLabel } from './utils';

const { Text } = Typography;

export default function WhitelistPanel({ canWrite, refreshKey = 0 }) {
    const t = useT();
    const { data, loading, error, reload } = useResource(
        () => api.get('/hitl/tool-whitelist'),
        [refreshKey]
    );
    const [text, setText] = useState('');
    const [saving, setSaving] = useState('');

    useEffect(() => {
        if (data) setText((data.toolWhitelist || []).join('\n'));
    }, [data]);

    const tokens = useMemo(() => parseToolTokens(text), [text]);
    const baseline = useMemo(() => (data?.toolWhitelist || []).join('\n'), [data]);
    const dirty = text.trim() !== baseline.trim();

    const save = useCallback(async () => {
        setSaving('put');
        try {
            const payload = await api.put('/hitl/tool-whitelist', { toolWhitelist: tokens });
            toastSuccess(t('hitl.whitelistSaved', null, 'Whitelist saved.'));
            setText((payload?.toolWhitelist || tokens).join('\n'));
            reload({ silent: true });
        } catch (err) {
            toastError(err, t('hitl.whitelistSaveFailed', null, 'Failed to save whitelist'));
        } finally {
            setSaving('');
        }
    }, [reload, t, tokens]);

    const merge = useCallback(async () => {
        setSaving('post');
        try {
            const payload = await api.post('/hitl/tool-whitelist', { sensitiveTools: tokens });
            toastSuccess(payload?.hitlGlobalWhitelistMerged
                ? t('ui.hitlWhitelist.merged', null, 'Merged into the global allowlist')
                : t('ui.hitlWhitelist.mergeNoChange', null, 'No new tools were added; the allowlist is unchanged'));
            setText((payload?.hitlGlobalToolWhitelist || tokens).join('\n'));
            reload({ silent: true });
        } catch (err) {
            toastError(err, t('ui.hitlWhitelist.mergeFailed', null, 'Failed to merge allowlist'));
        } finally {
            setSaving('');
        }
    }, [reload, t, tokens]);

    return (
        <SectionCard
            title={t('hitl.whitelistLabel', null, 'Tool whitelist (no approval)')}
            description={t('hitl.whitelistHint', null, 'One per line or comma-separated. Saved to config.yaml global whitelist and takes effect immediately (synced with chat sidebar).')}
            extra={(
                <Space spacing={8}>
                    <Button size="small" icon={<IconRefresh />} theme="borderless" onClick={() => reload()} loading={loading}>
                        {t('common.refresh', null, 'Refresh')}
                    </Button>
                    <Button size="small" disabled={!canWrite || !dirty} loading={saving === 'put'} onClick={save}>
                        {t('common.save', null, 'Save')}
                    </Button>
                    <Button size="small" theme="light" disabled={!canWrite || !tokens.length} loading={saving === 'post'} onClick={merge}>
                        {t('ui.hitlWhitelist.mergeAppend', null, 'Merge and append')}
                    </Button>
                </Space>
            )}
        >
            <ErrorBanner error={error} onRetry={() => reload()} />
            <div className="hitl-whitelist-meta">
                <Text type="tertiary" size="small">
                    {t('ui.hitlWhitelist.totalItems', { count: tokens.length }, '{{count}} items')}
                    {data?.defaultReviewer ? ` · ${t('ui.hitlWhitelist.defaultReviewer', { reviewer: reviewerLabel(data.defaultReviewer) }, 'Default reviewer: {{reviewer}}')}` : ''}
                </Text>
                {dirty && <Tag size="small" color="amber">{t('ui.hitlWhitelist.unsaved', null, 'Unsaved changes')}</Tag>}
            </div>
            <TextArea
                rows={10}
                value={text}
                spellCheck={false}
                disabled={!canWrite}
                className="hitl-whitelist-textarea"
                placeholder="execute_command&#10;write_file&#10;browser_visit"
                onChange={value => setText(value)}
            />
            {tokens.length > 0 && (
                <div className="hitl-whitelist-tags">
                    {tokens.map(token => <Tag key={token} size="small" color="grey">{token}</Tag>)}
                </div>
            )}
        </SectionCard>
    );
}

/** Natural language -> query syntax: calls /fofa/parse; the result can be edited before filling back and running. */
import { useEffect, useState } from 'react';
import { Banner, Button, Space, Spin, TextArea, Typography } from '@douyinfe/semi-ui';
import { api } from '../../../lib/http';
import { useT } from '../../../lib/i18n';
import { Drawer, ErrorBanner } from '../../../components/ui';

const { Text } = Typography;

export default function FofaParseModal({ visible, provider, text, onClose, onApply }) {
    const t = useT();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [query, setQuery] = useState('');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!visible) return undefined;
        const natural = String(text || '').trim();
        if (!natural) return undefined;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setResult(null);
        setQuery('');
        api.post('/fofa/parse', { provider, text: natural })
            .then(payload => {
                if (cancelled) return;
                setResult(payload || {});
                setQuery(String(payload?.query || ''));
            })
            .catch(parseError => { if (!cancelled) setError(parseError); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [visible, provider, text, attempt]);

    const apply = run => {
        const value = String(query || '').trim();
        if (!value) return;
        onApply?.(value, Boolean(run));
    };

    const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [];

    return (
        <Drawer
            visible={visible}
            title={t('infoCollect.parseResultTitle', null, 'AI parse result')}
            width={640}
            onCancel={onClose}
            footer={(
                <Space>
                    <Button theme="borderless" onClick={onClose}>{t('common.cancel', null, 'Cancel')}</Button>
                    <Button onClick={() => apply(false)} disabled={!query.trim() || loading}>
                        {t('infoCollect.parseModalApply', null, 'Fill into query')}
                    </Button>
                    <Button theme="solid" type="primary" onClick={() => apply(true)} disabled={!query.trim() || loading}>
                        {t('infoCollect.parseModalApplyRun', null, 'Fill and query')}
                    </Button>
                </Space>
            )}
        >
            <Space vertical align="start" spacing={10} style={{ width: '100%' }}>
                <Text type="tertiary">
                    {t('infoCollect.naturalLanguageLabel', null, 'Natural language')}：{String(text || '').trim() || '—'}
                </Text>
                {loading && (
                    <Space>
                        <Spin size="small" />
                        <Text type="tertiary">{t('infoCollect.parsePending', null, 'AI parsing...')}</Text>
                    </Space>
                )}
                <ErrorBanner error={error} onRetry={() => setAttempt(value => value + 1)} />
                {result && (
                    <>
                        <TextArea
                            value={query}
                            rows={3}
                            className="info-collect-parse-query"
                            onChange={setQuery}
                        />
                        {result.explanation && (
                            <div className="info-collect-parse-block">
                                <Text strong size="small">{t('infoCollect.explanation', null, 'Explanation')}</Text>
                                <Text type="tertiary" size="small">{result.explanation}</Text>
                            </div>
                        )}
                        {warnings.length > 0 && (
                            <Banner
                                type="warning"
                                bordered
                                closeIcon={null}
                                description={warnings.join('；')}
                            />
                        )}
                    </>
                )}
            </Space>
        </Drawer>
    );
}

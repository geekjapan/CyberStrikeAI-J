/** Fact create / edit dialog: fact_key and summary are required, body holds the attack chain and POC, links maintain incoming edges. */
import { useEffect, useMemo, useState } from 'react';
import { Checkbox, Input, Select, TextArea, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { translate, useT } from '../../lib/i18n';
import { Drawer, toastError, toastSuccess } from '../../components/ui';
import {
    CONFIDENCE_OPTIONS, EDGE_TYPE_HINTS, FACT_CATEGORIES, errText, formatIncomingLinks
} from './helpers';

const { Text } = Typography;

const EMPTY = {
    fact_key: '',
    category: 'note',
    summary: '',
    body: '',
    confidence: 'tentative',
    pinned: false,
    related_vulnerability_id: '',
    links_text: ''
};

export default function FactFormModal({ visible, projectId, factKey, onCancel, onSaved }) {
    const t = useT();
    const [form, setForm] = useState(EMPTY);
    const [categoryOptions, setCategoryOptions] = useState(FACT_CATEGORIES);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [factId, setFactId] = useState('');

    const editing = Boolean(factKey);

    useEffect(() => {
        if (!visible) return;
        setForm(EMPTY);
        setCategoryOptions(FACT_CATEGORIES);
        setFactId('');
        setLoading(false);
        setSaving(false);
        if (!factKey) return;
        let cancelled = false;
        setLoading(true);
        api.get(`/projects/${projectId}/facts`, { fact_key: factKey, include_links: 'true' })
            .then(fact => {
                if (cancelled || !fact) return;
                const category = fact.category || 'note';
                if (!FACT_CATEGORIES.some(item => item.value === category)) {
                    setCategoryOptions([...FACT_CATEGORIES, { value: category, label: translate('ui.factForm.customCategory', { category }, '{{category}} (custom)') }]);
                }
                setFactId(fact.id || '');
                setForm({
                    fact_key: fact.fact_key || factKey,
                    category,
                    summary: fact.summary || '',
                    body: fact.body || '',
                    confidence: (fact.confidence || 'tentative').toLowerCase(),
                    pinned: Boolean(fact.pinned),
                    related_vulnerability_id: fact.related_vulnerability_id || '',
                    links_text: formatIncomingLinks(fact.incoming_links)
                });
            })
            .catch(error => {
                if (!cancelled) toastError(errText(error, t('projects.loadFactFailed', null, 'Failed to load fact')));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [visible, projectId, factKey]);

    const update = (patch) => setForm(prev => ({ ...prev, ...patch }));

    const linksHint = useMemo(() => EDGE_TYPE_HINTS.join(t('ui.factForm.listSeparator', null, '、')), [t]);

    const submit = async () => {
        const key = form.fact_key.trim();
        const summary = form.summary.trim();
        if (!key || !summary) {
            toastError(t('projects.factKeySummaryRequired', null, 'fact_key and summary are required'));
            return;
        }
        const payload = {
            fact_key: key,
            category: form.category || 'note',
            summary,
            body: form.body,
            confidence: form.confidence || 'tentative',
            pinned: Boolean(form.pinned),
            related_vulnerability_id: form.related_vulnerability_id.trim(),
            links_text: form.links_text
        };
        if (editing && !factId) {
            toastError(t('projects.loadFactFailed', null, 'Failed to load fact'));
            return;
        }
        setSaving(true);
        try {
            if (editing && factId) {
                await api.put(`/projects/${projectId}/facts/${factId}`, payload);
            } else {
                await api.post(`/projects/${projectId}/facts`, payload);
            }
            toastSuccess(t('projects.saved', null, 'Saved'));
            onSaved?.();
        } catch (error) {
            toastError(errText(error, t('projects.saveFailed', null, 'Save failed')));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            title={editing ? t('projects.editFact', null, 'Edit fact') : t('projects.addFact', null, 'Add fact')}
            onCancel={onCancel}
            onOk={submit}
            okText={editing ? t('projects.saveChanges', null, 'Save changes') : t('projects.saveFact', null, 'Save fact')}
            cancelText={t('common.cancel', null, 'Cancel')}
            confirmLoading={saving}
            width={720}
        >
            <Text type="tertiary" size="small">
                {t('projects.factModalSubtitle', null, 'Summary is indexed on board; body stores attack chain and POC for audit reproduction (separate from vulnerability records).')}
            </Text>

            <div className="project-form-grid">
                <div className="project-form-field">
                    <Text strong size="small">fact_key</Text>
                    <Input
                        value={form.fact_key}
                        disabled={loading}
                        placeholder="target/primary_domain"
                        onChange={value => update({ fact_key: value })}
                    />
                </div>
                <div className="project-form-field">
                    <Text strong size="small">{t('projects.category', null, 'Category')}</Text>
                    <Select
                        value={form.category}
                        optionList={categoryOptions}
                        onChange={value => update({ category: value })}
                        style={{ width: '100%' }}
                    />
                </div>
            </div>

            <div className="project-form-field">
                <Text strong size="small">{t('projects.summary', null, 'Summary')}</Text>
                <Input
                    value={form.summary}
                    placeholder={t('ui.factForm.summaryPlaceholder', { summary: t('projects.summary', null, '{{summary}}: what + where + how to verify') }, 'Summary')}
                    onChange={value => update({ summary: value })}
                />
            </div>

            <div className="project-form-grid">
                <div className="project-form-field">
                    <Text strong size="small">{t('projects.confidence', null, 'Confidence')}</Text>
                    <Select
                        value={form.confidence}
                        optionList={CONFIDENCE_OPTIONS}
                        onChange={value => update({ confidence: value })}
                        style={{ width: '100%' }}
                    />
                </div>
                <div className="project-form-field">
                    <Text strong size="small">{t('projects.relatedVulnIdLabel', null, 'Related vulnerability ID')}</Text>
                    <Input
                        value={form.related_vulnerability_id}
                        placeholder={t('projects.optional', null, 'Optional')}
                        onChange={value => update({ related_vulnerability_id: value })}
                    />
                </div>
            </div>

            <div className="project-form-field">
                <Text strong size="small">body</Text>
                <TextArea
                    value={form.body}
                    rows={10}
                    placeholder={t('ui.factForm.bodyPlaceholder', null, '## Verification steps\n1. …\n\n```http\nGET /path HTTP/1.1\n```')}
                    onChange={value => update({ body: value })}
                />
                <Text type="tertiary" size="small">
                    {t('projects.factBodyRelationsHint', null, 'Enter relationships such as discovered_on in the Links field below to create graph edges.')}
                </Text>
            </div>

            <div className="project-form-field">
                <Text strong size="small">{t('projects.factLinksLabel', null, 'Links (from → this fact)')}</Text>
                <TextArea
                    value={form.links_text}
                    rows={3}
                    placeholder={t('projects.factLinksPlaceholder', null, 'discovered_on: target/primary_domain')}
                    onChange={value => update({ links_text: value })}
                />
                <Text type="tertiary" size="small">
                    {t('projects.factLinksHint', null, 'One per line: type: source_fact_key (source → this fact). Common types: discovered_on, depends_on, leads_to, enables, exploits. Saving replaces all links.')}
                    {' '}{t('ui.factForm.commonTypes', { hint: linksHint }, 'Common types: {{hint}}.')}
                </Text>
            </div>

            <Checkbox checked={form.pinned} onChange={event => update({ pinned: event.target.checked })}>
                {t('projects.pinFact', null, 'Pin fact (prioritize in list and blackboard index)')}
            </Checkbox>
        </Drawer>
    );
}

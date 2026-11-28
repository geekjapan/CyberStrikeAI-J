/** Fact detail drawer: full body (Markdown), metadata and incoming/outgoing edges. */
import { Button, Empty, SideSheet, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import { ErrorBanner, KeyValueList, MarkdownView } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { CATEGORY_LABEL, CONFIDENCE_META, errorProp } from './helpers';

const { Text, Paragraph } = Typography;

function ConfidenceTag({ value }) {
    const meta = CONFIDENCE_META[String(value || '').toLowerCase()] || { label: value || '—', color: 'grey' };
    return <Tag size="small" color={meta.color}>{meta.label}</Tag>;
}

export default function FactDetailSheet({ projectId, factKey, visible, canWrite, revision = 0, onClose, onEdit }) {
    const t = useT();
    const detail = useResource(
        () => (factKey
            ? api.get(`/projects/${projectId}/facts`, { fact_key: factKey, include_links: 'true' })
            : Promise.resolve(null)),
        [projectId, factKey, revision]
    );
    const fact = detail.data;

    return (
        <SideSheet
            visible={visible}
            width={640}
            title={t('projects.factDetails', null, 'Fact details')}
            onCancel={onClose}
            footer={(
                <Space>
                    <Button disabled={!canWrite || !fact} onClick={() => onEdit?.(factKey)}>
                        {t('common.edit', null, 'Edit')}
                    </Button>
                    <Button onClick={onClose}>{t('common.close', null, 'Close')}</Button>
                </Space>
            )}
        >
            <ErrorBanner error={errorProp(detail.error)} onRetry={detail.reload} />
            {fact ? (
                <div className="project-detail-stack">
                    <div>
                        <Text strong>{fact.fact_key}</Text>
                        <div className="project-graph-side-tags">
                            <Tag size="small" color="cyan" type="light">
                                {CATEGORY_LABEL[String(fact.category || '').toLowerCase()] || fact.category || '—'}
                            </Tag>
                            <ConfidenceTag value={fact.confidence} />
                            {fact.pinned ? <Tag size="small" color="blue" type="light">{t('projects.pinned', null, 'Pinned')}</Tag> : null}
                        </div>
                    </div>
                    <KeyValueList
                        items={[
                            { label: t('projects.updated', null, 'Updated'), value: formatDateTime(fact.updated_at) },
                            { label: t('projects.confidence', null, 'Confidence'), value: <ConfidenceTag value={fact.confidence} /> },
                            fact.related_vulnerability_id
                                ? { label: t('projects.relatedVulnIdTitle', null, 'Related vulnerability ID'), value: fact.related_vulnerability_id }
                                : null,
                            fact.source_conversation_id
                                ? { label: t('projects.factMetaSourceConversation', { value: '' }, 'Source conversation: {{value}}'), value: fact.source_conversation_id }
                                : null
                        ]}
                    />
                    <div>
                        <Text strong>{t('projects.summary', null, 'Summary')}</Text>
                        <Paragraph className="project-fact-summary">{fact.summary || '—'}</Paragraph>
                    </div>
                    <div>
                        <Text strong>body</Text>
                        {fact.body
                            ? <MarkdownView content={fact.body} />
                            : <Text type="tertiary">{t('projects.emptyBody', null, '(empty body)')}</Text>}
                    </div>
                    {(fact.incoming_links || []).length > 0 && (
                        <div>
                            <Text strong>{t('projects.factIncomingLinksLabel', null, 'Incoming links (read-only)')}</Text>
                            <ul className="project-link-list">
                                {fact.incoming_links.map(edge => (
                                    <li key={edge.id}>
                                        <code>{edge.edge_type}</code> ← <code>{edge.source_fact_key}</code>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {(fact.outgoing_links || []).length > 0 && (
                        <div>
                            <Text strong>{t('projects.graphEdgeFromSelf', null, 'From this node')}</Text>
                            <ul className="project-link-list">
                                {fact.outgoing_links.map(edge => (
                                    <li key={edge.id}>
                                        <code>{edge.edge_type}</code> → <code>{edge.target_fact_key}</code>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            ) : (!detail.loading && !detail.error ? <Empty title={t('projects.noFacts', null, 'No facts yet. Click Add fact or let Agent write facts automatically')} /> : null)}
        </SideSheet>
    );
}

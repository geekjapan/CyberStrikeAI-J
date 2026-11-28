/** Vulnerability detail drawer: overview / reproduction and evidence / related items / report download (GET /:id/context provides the context). */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Collapse, Radio, RadioGroup, SideSheet, Space, Spin, Tabs, Timeline, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconEdit, IconPlay, IconRefresh } from '@douyinfe/semi-icons';
import { api, downloadFile } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { formatDateTime } from '../../lib/format';
import { useResource } from '../../components/hooks';
import {
    CopyButton, ErrorBanner, KeyValueList, MarkdownView, SeverityTag, StatusTag, toastError, toastSuccess
} from '../../components/ui';
import { historyText, hostPortText, hostText, shortId, statusText } from './shared';
import RetestModal from './RetestModal';

const { Text, Paragraph } = Typography;

function Section({ title, extra, children }) {
    return (
        <section className="vulnerability-section">
            <div className="vulnerability-section-head">
                <span className="vulnerability-section-title">{title}</span>
                {extra}
            </div>
            <div className="vulnerability-section-body">{children}</div>
        </section>
    );
}

function RelatedFacts({ vulnerability }) {
    const t = useT();
    const navigate = useNavigate();
    const [facts, setFacts] = useState([]);
    useEffect(() => {
        if (!vulnerability?.project_id || !vulnerability?.id) {
            setFacts([]);
            return undefined;
        }
        let cancelled = false;
        api.get(`/projects/${vulnerability.project_id}/facts`, { related_vulnerability_id: vulnerability.id, limit: 20 })
            .then(data => { if (!cancelled) setFacts(Array.isArray(data) ? data : []); })
            .catch(() => { if (!cancelled) setFacts([]); });
        return () => { cancelled = true; };
    }, [vulnerability?.project_id, vulnerability?.id]);
    if (!facts.length) return null;
    return (
        <Section title={t('ui.vulnerabilitiesDetailDrawer.sameProjectFacts', null, 'Facts from the same project')}>
            {facts.map(fact => (
                <div key={fact.id} className="vulnerability-history-item">
                    <Text>{fact.summary || fact.fact_key}</Text>
                    {fact.source_conversation_id ? (
                        <Button
                            size="small"
                            theme="borderless"
                            onClick={() => navigate(`/chat?conversation=${encodeURIComponent(fact.source_conversation_id)}`)}
                        >
                            {t('ui.vulnerabilitiesDetailDrawer.openSourceConversation', null, 'Open source conversation')}
                        </Button>
                    ) : null}
                </div>
            ))}
        </Section>
    );
}

function Narrative({ title, content, code }) {
    const text = String(content ?? '').trim();
    if (!text) return null;
    if (code) {
        return (
            <Section title={title} extra={<CopyButton text={text} size="small" />}>
                <pre className="vulnerability-code">{text}</pre>
            </Section>
        );
    }
    return (
        <Section title={title}>
            <MarkdownView content={text} />
        </Section>
    );
}

export default function DetailDrawer({
    visible, vulnId, refreshKey, onClose, onEdit, onDelete, onOpenVuln,
    canWrite, canDelete, t, projectNames
}) {
    const navigate = useNavigate();
    const [tab, setTab] = useState('overview');
    const [format, setFormat] = useState('docx');
    const [downloading, setDownloading] = useState(false);
    const [retestOpen, setRetestOpen] = useState(false);

    const context = useResource(
        () => api.get(`/vulnerabilities/${encodeURIComponent(vulnId)}/context`),
        [vulnId, refreshKey, visible],
        { skip: !visible || !vulnId }
    );

    useEffect(() => {
        setTab('overview');
        setFormat('docx');
    }, [vulnId]);

    // Only accept a payload matching the current id, so the previous record's details do not flash when switching records.
    const payload = context.data?.vulnerability?.id === vulnId ? context.data : null;
    const vuln = payload?.vulnerability || null;
    const history = Array.isArray(payload?.history) ? payload.history : [];
    const members = Array.isArray(payload?.members) ? payload.members : [];
    const assets = Array.isArray(payload?.assets) ? payload.assets : [];
    const projectName = vuln?.project_id ? (projectNames?.[vuln.project_id] || vuln.project_id) : '';

    const openConversation = conversationId => {
        if (!conversationId) return;
        navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`);
    };

    const handleDownload = async () => {
        if (!vuln || downloading) return;
        setDownloading(true);
        try {
            const name = await downloadFile(`/vulnerabilities/${encodeURIComponent(vuln.id)}/download`, { query: { format } });
            toastSuccess(`${t('vulnerabilityPage.downloadOkTitle', null, 'Downloaded')}${name ? ` · ${name}` : ''}`);
        } catch (error) {
            toastError(error, t('vulnerabilityPage.downloadFailed', null, 'Download failed'));
        } finally {
            setDownloading(false);
        }
    };

    const overviewItems = vuln ? [
        {
            label: t('vulnerabilityPage.detailVulnId', null, 'Vuln ID'),
            value: <span className="vulnerability-inline-code">{vuln.id}</span>
        },
        {
            label: t('vulnerabilityPage.tableSeverity', null, 'Severity'),
            value: <SeverityTag severity={vuln.severity} />
        },
        {
            label: t('vulnerabilityPage.status', null, 'Status'),
            value: <StatusTag status={vuln.status} label={statusText(t, vuln.status)} />
        },
        vuln.type ? { label: t('vulnerabilityPage.detailType', null, 'Type'), value: vuln.type } : null,
        vuln.target ? { label: t('vulnerabilityPage.detailTarget', null, 'Target'), value: <span className="vulnerability-inline-code">{vuln.target}</span> } : null,
        hostText(vuln) && hostText(vuln) !== vuln.target
            ? { label: t('vulnerabilityPage.detailHost', null, 'Host'), value: <span className="vulnerability-inline-code">{hostText(vuln)}</span> }
            : null,
        {
            label: t('vulnerabilityPage.detailProject', null, 'Project'),
            value: projectName || t('vulnerabilityPage.projectUnbound', null, 'No project')
        },
        vuln.conversation_tag ? { label: t('vulnerabilityPage.detailConversationTag', null, 'Conversation tag'), value: vuln.conversation_tag } : null,
        vuln.conversation_id ? {
            label: t('vulnerabilityPage.detailConversationId', null, 'Conversation ID'),
            value: <span className="vulnerability-inline-code">{vuln.conversation_id}</span>
        } : null,
        vuln.task_tag ? { label: t('vulnerabilityPage.detailTaskTag', null, 'Task tag'), value: vuln.task_tag } : null,
        vuln.task_id ? { label: t('vulnerabilityPage.detailTaskId', null, 'Task ID'), value: <span className="vulnerability-inline-code">{vuln.task_id}</span> } : null,
        vuln.task_queue_id ? { label: t('vulnerabilityPage.detailTaskQueueId', null, 'Task queue ID'), value: <span className="vulnerability-inline-code">{vuln.task_queue_id}</span> } : null,
        vuln.case_id ? { label: t('vulnerabilityPage.mergedRecord', null, 'Merged'), value: vuln.case_title || shortId(vuln.case_id, 12) } : null,
        { label: t('vulnerabilityMd.labelCreated', null, 'Created at'), value: formatDateTime(vuln.created_at) },
        { label: t('vulnerabilityMd.labelUpdated', null, 'Updated at'), value: formatDateTime(vuln.updated_at) }
    ].filter(Boolean) : [];

    const targetList = Array.isArray(vuln?.targets) ? vuln.targets : [];

    return (
        <SideSheet
            className="vulnerability-detail-drawer"
            visible={visible}
            onCancel={onClose}
            width={720}
            title={(
                <div className="vulnerability-drawer-title">
                    <span className="vulnerability-drawer-title-text" title={vuln?.title}>
                        {vuln?.title || t('vulnerabilityPage.inspectorTitle', null, 'Finding workspace')}
                    </span>
                    {vuln && (
                        <span className="vulnerability-drawer-meta">
                            <SeverityTag severity={vuln.severity} />
                            <StatusTag status={vuln.status} label={statusText(t, vuln.status)} />
                            {vuln.type ? <Text type="tertiary">{vuln.type}</Text> : null}
                        </span>
                    )}
                </div>
            )}
            footer={(
                <Space>
                    <Button onClick={onClose}>{t('common.close', null, 'Close')}</Button>
                    <Button icon={<IconRefresh />} onClick={() => context.reload()} loading={context.loading}>
                        {t('common.refresh', null, 'Refresh')}
                    </Button>
                    {canWrite && (
                        <Button
                            theme="solid"
                            type="primary"
                            icon={<IconPlay />}
                            disabled={!vuln || !vuln.conversation_id}
                            onClick={() => setRetestOpen(true)}
                        >
                            {t('vulnerabilityRetest.button', null, 'Retest')}
                        </Button>
                    )}
                    {canWrite && (
                        <Button icon={<IconEdit />} disabled={!vuln} onClick={() => onEdit(vuln)}>
                            {t('common.edit', null, 'Edit')}
                        </Button>
                    )}
                    {canDelete && (
                        <Button type="danger" icon={<IconDelete />} disabled={!vuln} onClick={() => onDelete(vuln)}>
                            {t('common.delete', null, 'Delete')}
                        </Button>
                    )}
                </Space>
            )}
        >
            <ErrorBanner error={context.error} onRetry={context.reload} />
            {!context.error && !vuln && (
                <div className="vulnerability-drawer-loading"><Spin size="large" /></div>
            )}
            {vuln && (
                <Tabs type="line" activeKey={tab} onChange={key => setTab(key)}>
                    <Tabs.TabPane tab={t('vulnerabilityPage.inspector_overview', null, 'Overview')} itemKey="overview">
                        <KeyValueList items={overviewItems} columns={2} />
                        <Narrative title={t('vulnerabilityMd.headingDescription', null, 'Description')} content={vuln.description} />
                        <Narrative title={t('vulnerabilityPage.detailImpact', null, 'Impact')} content={vuln.impact} />
                        <Narrative title={t('vulnerabilityPage.detailRecommendation', null, 'Remediation')} content={vuln.recommendation} />
                    </Tabs.TabPane>

                    <Tabs.TabPane tab={t('vulnerabilityPage.inspector_evidence', null, 'Evidence')} itemKey="evidence">
                        <Narrative title={t('vulnerabilityPage.detailPreconditions', null, 'Preconditions')} content={vuln.preconditions} />
                        <Narrative title={t('vulnerabilityPage.detailReproductionSteps', null, 'Reproduction steps')} content={vuln.reproduction_steps} />
                        <Narrative title={t('vulnerabilityPage.detailEvidence', null, 'Evidence / POC')} content={vuln.evidence} code />
                        <Narrative title={t('vulnerabilityPage.detailRetestNotes', null, 'Retest method')} content={vuln.retest_notes} />
                        <Narrative title={t('vulnerabilityPage.detailRetestLog', null, 'Retest log')} content={vuln.retest_log} code />
                        <RelatedFacts vulnerability={vuln} />
                        <Section title={t('vulnerabilityPage.inspector_history', null, 'History')}>
                            {history.length ? (
                                <Timeline>
                                    {history.map((item, index) => (
                                        <Timeline.Item
                                            key={`${item.kind}-${item.created_at}-${index}`}
                                            time={formatDateTime(item.created_at)}
                                            type={item.kind === 'retest' ? 'success' : 'default'}
                                        >
                                            <div className="vulnerability-history-item">
                                                <div className="vulnerability-history-head">
                                                    <Text strong>{historyText(t, item.kind)}</Text>
                                                    {item.status ? <StatusTag status={item.status} label={statusText(t, item.status)} /> : null}
                                                    {item.actor ? <Text type="tertiary">{item.actor}</Text> : null}
                                                </div>
                                                {item.evidence ? <pre className="vulnerability-code">{item.evidence}</pre> : null}
                                                {item.snapshot ? (
                                                    <Collapse className="vulnerability-snapshot">
                                                        <Collapse.Panel header={t('vulnerabilityPage.retestSnapshot', null, 'Evidence snapshot at retest')} itemKey="snapshot">
                                                            <Narrative title={t('vulnerabilityPage.detailReproductionSteps', null, 'Reproduction steps')} content={item.snapshot.reproduction_steps} />
                                                            <Narrative title={t('vulnerabilityPage.detailEvidence', null, 'Evidence / POC')} content={item.snapshot.evidence} code />
                                                        </Collapse.Panel>
                                                    </Collapse>
                                                ) : null}
                                                {item.conversation_id ? (
                                                    <Button size="small" theme="borderless" onClick={() => openConversation(item.conversation_id)}>
                                                        {t('vulnerabilityPage.openRetestChat', null, 'Open retest chat')}
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </Timeline.Item>
                                    ))}
                                </Timeline>
                            ) : (
                                <Paragraph type="tertiary">{t('vulnerabilityPage.noHistory', null, 'No structured history yet')}</Paragraph>
                            )}
                        </Section>
                    </Tabs.TabPane>

                    <Tabs.TabPane tab={t('vulnerabilityPage.detailRelations', null, 'Relations')} itemKey="relations">
                        <Section title={t('vulnerabilityPage.detailProject', null, 'Project')}>
                            {vuln.project_id ? (
                                <div className="vulnerability-related-row">
                                    <Text>{projectName}</Text>
                                    <Text type="tertiary" className="vulnerability-inline-code">{vuln.project_id}</Text>
                                </div>
                            ) : (
                                <Paragraph type="tertiary">{t('vulnerabilityPage.projectUnbound', null, 'No project')}</Paragraph>
                            )}
                        </Section>

                        <Section title={t('vulnerabilityPage.affectedTargets', null, 'Affected targets')}>
                            {targetList.length ? (
                                <ul className="vulnerability-related-list">
                                    {targetList.map(target => (
                                        <li key={`${target.raw}-${target.host}`} className="vulnerability-related-item">
                                            <Text strong>{target.host || target.domain || target.raw}</Text>
                                            {target.raw && target.raw !== target.host ? (
                                                <span className="vulnerability-inline-code">{target.raw}</span>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <Paragraph type="tertiary">{vuln.target || '—'}</Paragraph>
                            )}
                        </Section>

                        <Section title={t('vulnerabilityPage.linkedAssets', null, 'Matching inventory assets')}>
                            {assets.length ? (
                                <ul className="vulnerability-related-list">
                                    {assets.map(asset => (
                                        <li key={asset.id || `${asset.host}-${asset.port}`} className="vulnerability-related-item">
                                            <Text strong>{hostPortText(asset)}</Text>
                                            <Text type="tertiary" className="vulnerability-inline-code">{shortId(asset.id, 12)}</Text>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <Paragraph type="tertiary">{t('vulnerabilityPage.noLinkedAssets', null, 'No matching record in the asset library')}</Paragraph>
                            )}
                        </Section>

                        <Section title={t('vulnerabilityPage.detailConversationId', null, 'Conversation ID')}>
                            {vuln.conversation_id ? (
                                <div className="vulnerability-related-row">
                                    <span className="vulnerability-inline-code">{vuln.conversation_id}</span>
                                    <Button size="small" theme="borderless" onClick={() => openConversation(vuln.conversation_id)}>
                                        {t('vulnerabilityPage.openConversation', null, 'View conversation')}
                                    </Button>
                                </div>
                            ) : (
                                <Paragraph type="tertiary">{t('vulnerabilityPage.standaloneRecord', null, 'Standalone record (no linked conversation)')}</Paragraph>
                            )}
                            {vuln.task_id || vuln.task_queue_id ? (
                                <div className="vulnerability-related-row">
                                    <Text type="tertiary">{t('vulnerabilityPage.detailTaskId', null, 'Task ID')}</Text>
                                    <span className="vulnerability-inline-code">{vuln.task_id || vuln.task_queue_id}</span>
                                </div>
                            ) : null}
                        </Section>

                        {members.length ? (
                            <Section title={vuln.case_title || t('vulnerabilityPage.mergedRecord', null, 'Merged')}>
                                <div className="vulnerability-member-list">
                                    {members.map(member => (
                                        <Button
                                            key={member.id}
                                            size="small"
                                            theme="borderless"
                                            disabled={member.id === vuln.id}
                                            onClick={() => onOpenVuln(member.id)}
                                        >
                                            {member.title} · {statusText(t, member.status)}
                                        </Button>
                                    ))}
                                </div>
                            </Section>
                        ) : null}
                    </Tabs.TabPane>

                    <Tabs.TabPane tab={t('vulnerabilityDownload.title', null, 'Download vulnerability report')} itemKey="download">
                        <div className="vulnerability-download-panel">
                            <Paragraph type="tertiary">
                                {t('vulnerabilityDownload.hint', null, 'Choose a file format')}
                            </Paragraph>
                            <RadioGroup value={format} onChange={event => setFormat(event.target.value)}>
                                <Radio value="docx">{t('vulnerabilityDownload.word', null, 'Word（.docx）')}</Radio>
                                <Radio value="md">{t('vulnerabilityDownload.markdown', null, 'Markdown（.md）')}</Radio>
                            </RadioGroup>
                            <Button theme="solid" type="primary" loading={downloading} onClick={handleDownload}>
                                {t('vulnerabilityDownload.download', null, 'Download vulnerability report')}
                            </Button>
                            <Text type="tertiary">
                                {t('vulnerabilityPage.downloadHint', null, 'The report is generated by the server from the current record and includes the description, evidence, and remediation advice.')}
                            </Text>
                        </div>
                    </Tabs.TabPane>
                </Tabs>
            )}
            <RetestModal visible={retestOpen} vuln={vuln} onClose={() => setRetestOpen(false)} />
        </SideSheet>
    );
}

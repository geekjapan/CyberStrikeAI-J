/**
 * C2 payload generation: one-line reverse command (oneliner) and cross-platform Beacon build download.
 */
import { useMemo, useState } from 'react';
import { Button, Input, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import {
    PageHeader, SectionCard, DataTable, ErrorBanner, CopyButton,
    toastError, toastSuccess, toastWarning
} from '../../components/ui';
import { formatBytes } from '../../lib/format';
import * as c2 from '../c2-sessions/components/c2-api';
import { LISTENER_TYPES, ONELINER_KINDS } from '../c2-sessions/components/c2-shared';
import './page.css';

const { Text, Title } = Typography;

const OS_OPTIONS = [
    { value: 'linux', label: 'Linux' },
    { value: 'windows', label: 'Windows' },
    { value: 'darwin', label: 'macOS' }
];

const ARCH_OPTIONS = [
    { value: 'amd64', label: 'AMD64' },
    { value: 'arm64', label: 'ARM64' },
    { value: '386', label: '386' }
];

const typeLabel = value => LISTENER_TYPES.find(item => item.value === value)?.label || value || '—';

export default function C2PayloadsPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('c2:write');

    const { data, loading, error, reload } = useResource(() => c2.listListeners(), []);
    const listeners = Array.isArray(data?.listeners) ? data.listeners : [];

    const [onelinerForm, setOnelinerForm] = useState({ listenerId: '', kind: '', host: '' });
    const [oneliner, setOneliner] = useState(null);
    const [onelinerBusy, setOnelinerBusy] = useState(false);

    const [buildForm, setBuildForm] = useState({ listenerId: '', host: '', os: 'linux', arch: 'amd64' });
    const [buildResult, setBuildResult] = useState(null);
    const [buildBusy, setBuildBusy] = useState(false);
    const [artifacts, setArtifacts] = useState([]);

    const activeListener = useMemo(
        () => listeners.find(item => item.id === (onelinerForm.listenerId || listeners[0]?.id)) || null,
        [listeners, onelinerForm.listenerId]
    );
    const kindOptions = ONELINER_KINDS[activeListener?.type] || [];

    const listenerOptions = listeners.map(item => ({
        value: item.id,
        label: `${item.name || item.id} · ${typeLabel(item.type)}`
    }));

    const generateOneliner = async () => {
        const listenerId = onelinerForm.listenerId || listeners[0]?.id;
        if (!listenerId) {
            toastWarning(t('c2.payloads.toastPickListener', null, 'Select a listener first'));
            return;
        }
        const kind = onelinerForm.kind || kindOptions[0]?.value;
        if (!kind) {
            toastWarning(t('c2.payloads.noKindOption', null, 'No kinds available'));
            return;
        }
        setOnelinerBusy(true);
        try {
            const payload = await c2.buildOneliner({ listener_id: listenerId, kind, host: onelinerForm.host.trim() });
            setOneliner(payload);
        } catch (err) {
            toastError(err, t('c2.payloads.toastOnelinerFail', null, 'Failed to generate oneliner: {{msg}}'));
        } finally {
            setOnelinerBusy(false);
        }
    };

    const buildBeacon = async () => {
        const listenerId = buildForm.listenerId || listeners[0]?.id;
        if (!listenerId) {
            toastWarning(t('c2.payloads.toastPickListener', null, 'Select a listener first'));
            return;
        }
        setBuildBusy(true);
        try {
            const payload = await c2.buildPayload({
                listener_id: listenerId,
                host: buildForm.host.trim(),
                os: buildForm.os,
                arch: buildForm.arch,
                sleep_seconds: 5,
                jitter_percent: 0
            });
            const result = payload?.payload || null;
            setBuildResult(result);
            if (result) {
                const fileName = String(result.output_path || '').split(/[\\/]/).pop();
                setArtifacts(current => [
                    {
                        id: result.payload_id || fileName,
                        fileName,
                        listenerId,
                        os: result.os,
                        arch: result.arch,
                        size: result.size_bytes
                    },
                    ...current
                ]);
                toastSuccess(t('c2.payloads.toastBuildSuccess', null, 'Build succeeded: {{bytes}} bytes').replace('{{bytes}}', String(result.size_bytes || 0)));
            }
        } catch (err) {
            toastError(err, t('c2.payloads.toastBuildFail', null, 'Failed to build beacon: {{msg}}'));
        } finally {
            setBuildBusy(false);
        }
    };

    const download = async artifact => {
        if (!artifact.fileName?.startsWith('beacon_')) {
            toastWarning(t('c2.payloads.invalidArtifact', null, 'This artifact cannot be downloaded'));
            return;
        }
        try {
            await c2.downloadPayload(artifact.fileName, artifact.fileName);
            toastSuccess(t('c2.payloads.toastDownloadQueued', null, 'Download task queued'));
        } catch (err) {
            toastError(err, t('c2.payloads.download', null, 'Download'));
        }
    };

    const artifactColumns = [
        { title: t('c2.payloads.fileName', null, 'File'), dataIndex: 'fileName', render: value => <span className="c2-mono">{value || '—'}</span> },
        { title: t('c2.payloads.os', null, 'Target OS'), dataIndex: 'os', width: 100 },
        { title: t('c2.payloads.arch', null, 'Target Arch'), dataIndex: 'arch', width: 100 },
        { title: t('c2.payloads.size', null, 'Size'), dataIndex: 'size', width: 110, render: value => formatBytes(value) },
        {
            title: t('c2.tasks.colActions', null, 'Actions'),
            dataIndex: 'actions',
            width: 120,
            render: (_, artifact) => (
                <Button size="small" theme="borderless" onClick={() => download(artifact)}>{t('c2.payloads.download', null, 'Download')}</Button>
            )
        }
    ];

    return (
        <div className="c2-page" id="page-c2-payloads">
            <PageHeader
                title={t('c2.payloads.title', null, 'Payload Generator')}
                description={t('c2.payloads.pageDesc', null, 'Generate a one-line callback command, or cross-compile a full Beacon binary')}
                extra={[
                    <Button key="refresh" onClick={reload} loading={loading}>{t('common.refresh', null, 'Refresh')}</Button>
                ]}
            />

            <ErrorBanner error={error} onRetry={reload} />

            <div className="c2-payload-grid">
                <SectionCard title={t('c2.payloads.oneliner', null, 'Oneliner Payload')} description={t('c2.payloads.onelinerDesc', null, 'Generate a one-line reverse shell for the target (Bash / Python / PowerShell / Curl).')}>
                    <div className="c2-field">
                        <span className="c2-field-label">{t('c2.payloads.listener', null, 'Listener')}</span>
                        <Select
                            value={onelinerForm.listenerId || listeners[0]?.id || ''}
                            onChange={value => setOnelinerForm(form => ({ ...form, listenerId: value, kind: '' }))}
                            optionList={listenerOptions}
                            placeholder={t('c2.payloads.noListenersOption', null, 'No listeners available')}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div className="c2-field">
                        <span className="c2-field-label">{t('c2.payloads.kind', null, 'Kind')}</span>
                        <Select
                            value={onelinerForm.kind || kindOptions[0]?.value || ''}
                            onChange={value => setOnelinerForm(form => ({ ...form, kind: value }))}
                            optionList={kindOptions}
                            placeholder={t('c2.payloads.noKindOption', null, 'No kinds available')}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div className="c2-field">
                        <span className="c2-field-label">{t('c2.payloads.hostOptional', null, 'Callback host (optional)')}</span>
                        <Input
                            value={onelinerForm.host}
                            onChange={value => setOnelinerForm(form => ({ ...form, host: value }))}
                            placeholder={t('c2.payloads.placeholderListenerHost', null, 'Leave empty: listener callback host, else bind address')}
                        />
                    </div>
                    <Button theme="solid" type="primary" block disabled={!canWrite} loading={onelinerBusy} onClick={generateOneliner}>
                        {t('c2.payloads.generateOnelinerBtn', null, 'Generate Oneliner')}
                    </Button>
                    {oneliner?.oneliner && (
                        <div className="c2-oneliner-result">
                            <div className="c2-oneliner-head">
                                <Space spacing={6}>
                                    <Tag size="small">{oneliner.kind}</Tag>
                                    <Text type="tertiary" size="small">{oneliner.host}:{oneliner.port}</Text>
                                </Space>
                                <CopyButton text={oneliner.oneliner} label={t('c2.payloads.copy', null, 'Copy to Clipboard')} size="small" />
                            </div>
                            <pre className="c2-pre">{oneliner.oneliner}</pre>
                        </div>
                    )}
                </SectionCard>

                <SectionCard title={t('c2.payloads.build', null, 'Build Beacon')} description={t('c2.payloads.buildDesc', null, 'Cross-compile a full Beacon binary for Linux / Windows / macOS.')}>
                    <div className="c2-field">
                        <span className="c2-field-label">{t('c2.payloads.listener', null, 'Listener')}</span>
                        <Select
                            value={buildForm.listenerId || listeners[0]?.id || ''}
                            onChange={value => setBuildForm(form => ({ ...form, listenerId: value }))}
                            optionList={listenerOptions}
                            placeholder={t('c2.payloads.noListenersOption', null, 'No listeners available')}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div className="c2-field">
                        <span className="c2-field-label">{t('c2.payloads.hostOptional', null, 'Callback host (optional)')}</span>
                        <Input
                            value={buildForm.host}
                            onChange={value => setBuildForm(form => ({ ...form, host: value }))}
                            placeholder={t('c2.payloads.placeholderListenerHost', null, 'Leave empty: listener callback host, else bind address')}
                        />
                    </div>
                    <div className="c2-form-row">
                        <div className="c2-field">
                            <span className="c2-field-label">{t('c2.payloads.os', null, 'Target OS')}</span>
                            <Select value={buildForm.os} onChange={value => setBuildForm(form => ({ ...form, os: value }))} optionList={OS_OPTIONS} style={{ width: '100%' }} />
                        </div>
                        <div className="c2-field">
                            <span className="c2-field-label">{t('c2.payloads.arch', null, 'Target Arch')}</span>
                            <Select value={buildForm.arch} onChange={value => setBuildForm(form => ({ ...form, arch: value }))} optionList={ARCH_OPTIONS} style={{ width: '100%' }} />
                        </div>
                    </div>
                    <Button theme="solid" type="primary" block disabled={!canWrite} loading={buildBusy} onClick={buildBeacon}>
                        {t('c2.payloads.buildBeaconBtn', null, 'Build Beacon')}
                    </Button>
                    {buildResult && (
                        <div className="c2-build-result">
                            <Title heading={6}>{t('c2.payloads.buildSuccessTitle', null, 'Build succeeded')}</Title>
                            <Text type="tertiary" size="small">
                                {t('c2.payloads.buildMetaOsArch', null, 'OS: {{os}} | Arch: {{arch}}').replace('{{os}}', buildResult.os || '—').replace('{{arch}}', buildResult.arch || '—')}
                            </Text>
                            <Text type="tertiary" size="small">{t('c2.payloads.buildSize', null, 'Size: {{bytes}} bytes').replace('{{bytes}}', String(buildResult.size_bytes || 0))}</Text>
                            <pre className="c2-pre">{buildResult.output_path}</pre>
                            <Button size="small" onClick={() => download({ fileName: String(buildResult.output_path || '').split(/[\\/]/).pop(), ...buildResult })}>
                                {t('c2.payloads.download', null, 'Download')}
                            </Button>
                        </div>
                    )}
                </SectionCard>
            </div>

            <SectionCard title={t('c2.payloads.artifacts', null, 'Build artifacts from this session')}>
                <DataTable
                    columns={artifactColumns}
                    dataSource={artifacts}
                    rowKey="id"
                    pagination={{ pageSize: 10 }}
                    emptyText={t('c2.payloads.noArtifacts', null, 'No build artifacts yet')}
                />
            </SectionCard>
        </div>
    );
}

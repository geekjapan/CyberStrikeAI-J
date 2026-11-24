/**
 * Update source configuration, remote version check and update progress.
 */
import { useEffect, useState } from 'react';
import { Banner, Button, Input, Space, Tag, Timeline, Typography } from '@douyinfe/semi-ui';
import { IconDownload, IconRefresh } from '@douyinfe/semi-icons';
import { api, errorMessage } from '../../../lib/http';
import { useAuth } from '../../../lib/auth';
import { useT } from '../../../lib/i18n';
import { useResource } from '../../../components/hooks';
import { ErrorBanner, KeyValueList, SectionCard, toastSuccess, toastWarning } from '../../../components/ui';
import { formatDateTime, formatNumber, truncate } from '../../../lib/format';
import { Hint, LoadingBlock, Mono, PermissionBanner } from './common';

const { Text } = Typography;

function shortCommit(commit) {
    const value = String(commit || '');
    return value ? value.slice(0, 12) : '—';
}

function yesNo(t, value) {
    return value
        ? <Tag size="small" color="green">{t('common.yes', null, 'Yes')}</Tag>
        : <Tag size="small" color="grey">{t('common.no', null, 'No')}</Tag>;
}

function jobStateLabel(t, state) {
    if (state === 'running') return t('update.stateRunning', null, 'Running');
    if (state === 'succeeded') return t('update.stateSucceeded', null, 'Succeeded');
    if (state === 'failed') return t('update.stateFailed', null, 'Failed');
    return t('update.stateUnknown', null, 'Unknown state');
}

function jobStateColor(state) {
    if (state === 'succeeded') return 'green';
    if (state === 'failed') return 'red';
    if (state === 'running') return 'blue';
    return 'grey';
}

function updateBlocker(t, status) {
    if (!status.installed) return t('update.blockedNotGitTree');
    if (status.diverged) return t('update.blockedDiverged', { ahead: status.ahead, behind: status.behind });
    if (!status.updateAvailable && !status.buildPending) return '';
    if (status.rollbackPending) return t('updateUi.rollbackPending');
    if (status.blockingChanges?.length) return t('update.blockedLocalEdits', { n: status.blockingChanges.length });
    return '';
}

export default function UpdateSection() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canRead = hasPermission('update:read');
    const canManage = hasPermission('update:apply');

    const consoleRes = useResource(() => api.get('/system/update'), [canRead], { skip: !canRead });
    const [job, setJob] = useState(null);
    const [action, setAction] = useState('');
    const [checkResult, setCheckResult] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [activationBootID, setActivationBootID] = useState(null);
    const [sourceDraft, setSourceDraft] = useState(null);
    const [savingSource, setSavingSource] = useState(false);
    const [sourceError, setSourceError] = useState(null);

    useEffect(() => {
        if (consoleRes.data) setJob(consoleRes.data.job || null);
    }, [consoleRes.data]);

    const running = job?.state === 'running';
    const restarting = job?.state === 'succeeded' && job.restartRequested;
    const watchedJob = running || restarting ? job.id : null;
    const previousBootID = activationBootID || consoleRes.data?.bootID;
    const targetCommit = job?.result?.toCommit;
    const reloadStatus = consoleRes.reload;
    const needsRestart = consoleRes.data?.needsRestart;
    const source = consoleRes.data?.source;
    const sourceRepo = source?.repo || '';
    const sourceValue = sourceDraft ?? sourceRepo;
    const sourceChanged = sourceValue.trim() !== sourceRepo;
    const busy = Boolean(action || running || restarting);
    const sourceBusy = savingSource || busy || consoleRes.loading;

    useEffect(() => {
        if (!watchedJob) return;
        let cancelled = false;
        let timer;
        const poll = async () => {
            try {
                const { job: latest } = await api.get('/system/update/job', undefined, { timeout: 5000 });
                if (cancelled) return;
                if (latest?.id === watchedJob) {
                    setJob(latest);
                    if (latest.state !== 'running' && !latest.restartRequested) {
                        setCheckResult(null);
                        if (latest.state === 'succeeded') {
                            if (latest.result?.needsRestart) toastWarning(t('update.needsRestartToast'));
                            else toastSuccess(t('update.jobDoneToast'));
                        }
                        reloadStatus({ silent: true });
                        return;
                    }
                } else {
                    // The new process starts with an empty job list. Confirm the
                    // new boot before reloading the frontend bundle.
                    const status = await api.get('/system/update', undefined, { timeout: 5000 });
                    if (cancelled) return;
                    const newBoot = previousBootID && status.bootID && status.bootID !== previousBootID;
                    const matchesBuild = !targetCommit || !status.buildRevision || status.buildRevision.startsWith(targetCommit);
                    if (newBoot && matchesBuild && !status.needsRestart) {
                        window.location.reload();
                        return;
                    }
                }
            } catch {
                // Temporary connection failures during a restart are expected.
            }
            if (!cancelled) timer = setTimeout(poll, 2000);
        };
        poll();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [watchedJob, previousBootID, targetCommit, reloadStatus, t]);

    const update = async () => {
        if (!canManage || sourceBusy || sourceChanged) return;
        setAction('checking');
        setActionError(null);
        setCheckResult(null);
        let applyRequested = false;
        try {
            const { status } = await api.post('/system/update/check', {});
            if (!status) throw new Error(t('updateUi.statusMissing'));
            setCheckResult(status);
            if (status.checkError) return;

            const blocker = updateBlocker(t, status);
            if (blocker) {
                setActionError(new Error(blocker));
                return;
            }
            if (!status.updateAvailable && !status.buildPending) {
                if (needsRestart) toastWarning(t('update.needsRestartToast'));
                else if (status.ahead > 0) toastSuccess(t('updateUi.noNewerVersion'));
                else toastSuccess(t('updateUi.currentVersion'));
                return;
            }

            applyRequested = true;
            setAction('starting');
            const restart = Boolean(consoleRes.data?.autoRestart ?? consoleRes.data?.canRestart);
            const response = await api.post('/system/update/apply', { restart });
            if (!response?.job_id) throw new Error(t('updateUi.jobMissing'));
            setActivationBootID(response.bootID || null);
            setJob({ id: response.job_id, kind: 'apply', state: response.state || 'running', restartRequested: restart });
        } catch (error) {
            const existingJob = error.status === 409 && error.payload?.job;
            if (applyRequested && existingJob?.id) {
                setActivationBootID(error.payload.bootID || null);
                setJob(existingJob);
                return;
            }
            setActionError(new Error(t(applyRequested ? 'update.applyFailed' : 'update.checkFailed', { reason: errorMessage(error) })));
            if (applyRequested) reloadStatus({ silent: true });
        } finally {
            setAction('');
        }
    };

    const saveSource = async event => {
        event.preventDefault();
        if (!source || !canManage || !sourceChanged || sourceBusy) return;
        setSavingSource(true);
        setSourceError(null);
        try {
            const payload = await api.post('/system/update/source', { repo: sourceValue.trim() });
            if (!payload?.source || typeof payload.source.repo !== 'string') {
                throw new Error(t('updateUi.sourceResponseMissing', null, 'The server did not return the update source. Refresh to verify the configuration.'));
            }
            consoleRes.setData(previous => ({ ...previous, source: payload.source }));
            setSourceDraft(null);
            setCheckResult(null);
            setActionError(null);
            toastSuccess(t('update.sourceSaveOk', null, 'Update source saved'));
        } catch (error) {
            setSourceError(error);
        } finally {
            setSavingSource(false);
        }
    };

    if (!canRead) {
        return <PermissionBanner permission="update:read" label={t('settings.nav.update', null, 'One-Click Update')} />;
    }
    if (consoleRes.loading && !consoleRes.data) return <LoadingBlock rows={6} />;

    const snapshot = checkResult || consoleRes.data?.status || {};
    const binaryBuiltAt = consoleRes.data?.binaryBuiltAt;

    const facts = [
        { label: t('update.root', null, 'Install directory'), value: <Mono>{snapshot.root || '—'}</Mono> },
        { label: t('update.gitTree', null, 'git work tree'), value: yesNo(t, snapshot.installed) },
        { label: t('update.branch', null, 'Local branch'), value: snapshot.branch || '—' },
        { label: t('updateUi.repo', null, 'Update repository'), value: <Mono>{source?.repo || source?.defaultRepo || snapshot.repo || '—'}</Mono> },
        { label: t('update.commit', null, 'Current commit'), value: <Mono>{shortCommit(snapshot.commit)}</Mono> },
        { label: t('update.subject', null, 'Commit subject'), value: truncate(snapshot.subject || '—', 80) },
        { label: t('update.committedAt', null, 'Committed at'), value: snapshot.committedAt ? formatDateTime(snapshot.committedAt) : '—' },
        { label: t('update.runningBuild', null, 'Running build'), value: consoleRes.data?.buildRevision ? shortCommit(consoleRes.data.buildRevision) : '—' },
        { label: t('update.toolchainFound', null, 'Go toolchain present'), value: yesNo(t, snapshot.canBuild) },
        { label: t('update.binaryPresent', null, 'Binary present'), value: yesNo(t, snapshot.hasBinary) },
        { label: t('updateUi.buildPending', null, 'Build pending'), value: yesNo(t, snapshot.buildPending) },
        {
            label: t('update.restartPending', null, 'Restart required to activate'),
            value: needsRestart
                ? <Space spacing={4}><Tag size="small" color="amber">{t('common.yes', null, 'Yes')}</Tag>
                    {binaryBuiltAt && <Text type="tertiary" size="small">{formatDateTime(binaryBuiltAt)}</Text>}</Space>
                : <Tag size="small" color="green">{t('common.no', null, 'No')}</Tag>
        },
        { label: t('updateUi.localChanges', null, 'Locally changed files'), value: formatNumber((snapshot.localChanges || []).length) },
        { label: t('updateUi.blockingChanges', null, 'Files blocking updates'), value: formatNumber((snapshot.blockingChanges || []).length) }
    ];

    const incoming = Array.isArray(checkResult?.incoming) ? checkResult.incoming : [];

    return (
        <>
            <ErrorBanner error={consoleRes.error} onRetry={consoleRes.reload} />
            <SectionCard
                title={t('update.installTitle', null, 'This installation')}
                description={t('updateUi.pageHint')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} onClick={() => reloadStatus()} loading={consoleRes.loading} disabled={savingSource || busy}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button
                            theme="solid"
                            type="primary"
                            icon={<IconDownload aria-hidden="true" />}
                            loading={Boolean(action)}
                            disabled={!canManage || sourceBusy || sourceChanged}
                            onClick={update}
                        >
                            {t(action === 'checking' ? 'update.checking' : action === 'starting' ? 'updateUi.starting' : 'updateUi.updateButton')}
                        </Button>
                    </Space>
                )}
            >
                {!canManage && (
                    <Hint>{t('updateUi.updatePermission')}</Hint>
                )}
                {sourceChanged && <Hint>{t('updateUi.saveSourceFirst')}</Hint>}
                <KeyValueList items={facts} columns={3} />
                {snapshot.goToolchain && (
                    <Hint>{t('updateUi.toolchainPath', null, 'Go toolchain path')} <Mono>{snapshot.goToolchain}</Mono></Hint>
                )}
            </SectionCard>

            {source && (
                <SectionCard title={t('update.sourceTitle', null, 'Update source')}>
                    <form className="settings-update-source-form" onSubmit={saveSource}>
                        <label className="settings-field">
                            <Text size="small" type="tertiary">{t('update.sourceUrlLabel', null, 'Update source repository address')}</Text>
                            <Input
                                value={sourceValue}
                                onChange={value => {
                                    setSourceDraft(value);
                                    setSourceError(null);
                                }}
                                placeholder={source.defaultRepo}
                                readOnly={!canManage}
                                disabled={savingSource}
                            />
                        </label>
                        {canManage ? (
                            <>
                                <Hint>{t('update.sourceRepoHint', null, 'Leave empty to use the official repository; point it at your own fork or a mirror to follow that instead.')}</Hint>
                                <Hint>{t('updateUi.sourceSaveOnly', null, 'Saving changes update.repo in the configuration file. The next update uses the saved address.')}</Hint>
                                <div>
                                    <Button htmlType="submit" theme="solid" loading={savingSource}
                                        disabled={!sourceChanged || sourceBusy}>
                                        {t('update.sourceSaveBtn', null, 'Save source')}
                                    </Button>
                                </div>
                                {running && <Hint>{t('update.blockedJobRunning', null, 'An update is already running; wait for it to finish.')}</Hint>}
                            </>
                        ) : (
                            <Hint>{t('updateUi.sourcePermission', null, 'Saving a URL here requires update management permission. You can also change update.repo in the configuration file the service uses.')}</Hint>
                        )}
                        <ErrorBanner error={sourceError} />
                    </form>
                </SectionCard>
            )}

            <SectionCard title={t('update.remoteTitle', null, 'Against the update source')}>
                <ErrorBanner error={actionError} onRetry={canManage && !sourceBusy && !sourceChanged ? update : undefined} />
                {!checkResult && !actionError && (
                    <Text type="tertiary">{t('updateUi.versionUnchecked', null, 'The remote version has not been checked.')}</Text>
                )}
                {checkResult && (
                    <>
                        {checkResult.checkError ? (
                            <Banner
                                type="warning"
                                bordered
                                closeIcon={null}
                                description={t('update.checkFailed', { reason: checkResult.checkError }, 'Check failed: {{reason}}')}
                            />
                        ) : (
                            <Space wrap spacing={8}>
                                {checkResult.installed && (
                                    <Tag size="small" color={checkResult.updateAvailable || checkResult.buildPending || needsRestart ? 'amber' : 'green'}>
                                        {checkResult.updateAvailable ? t('update.behindCount', { n: checkResult.behind })
                                            : checkResult.buildPending ? t('updateUi.buildPending')
                                            : needsRestart ? t('update.restartNeeded')
                                            : t(checkResult.ahead > 0 ? 'updateUi.noNewerVersion' : 'updateUi.currentVersion')}
                                    </Tag>
                                )}
                                {checkResult.ahead > 0 && (
                                    <Tag size="small" color="blue">{t('update.aheadCount', { n: checkResult.ahead }, '{{n}} commits ahead locally')}</Tag>
                                )}
                                {checkResult.diverged && <Tag size="small" color="red">{t('updateUi.diverged', null, 'Local and remote histories have diverged')}</Tag>}
                                <Text type="tertiary">
                                    {t('update.remoteHead', null, 'Source head')}：<Mono>{shortCommit(checkResult.remoteCommit)}</Mono>
                                    {checkResult.targetBranch ? `（${checkResult.targetBranch}）` : ''}
                                </Text>
                            </Space>
                        )}
                        {(checkResult.remoteSubject || incoming.length > 0) && (
                            <div className="settings-incoming">
                                <Text type="tertiary" size="small">{t('update.incomingTitle', null, 'Incoming commits')}</Text>
                                <ul>
                                    {incoming.slice(0, 10).map((item, index) => (
                                        <li key={`${item.commit || 'commit'}-${index}`}>
                                            <Mono>{shortCommit(item.commit)}</Mono> {truncate(item.subject || '', 90)}
                                        </li>
                                    ))}
                                </ul>
                                {checkResult.incomingTotal > Math.min(10, incoming.length) && (
                                    <Hint>{t('update.incomingTruncated', { total: checkResult.incomingTotal, shown: Math.min(10, incoming.length) })}</Hint>
                                )}
                            </div>
                        )}
                    </>
                )}
            </SectionCard>

            <SectionCard
                title={t('update.jobTitle', null, 'Update progress')}
                extra={job ? <Tag size="small" color={jobStateColor(job.state)}>{jobStateLabel(t, job.state)}</Tag> : null}
            >
                {restarting && <Hint>{t('update.restartRequestedToast')}</Hint>}
                {needsRestart && !busy && <Hint>{t('update.needsRestartToast')}</Hint>}
                {snapshot.buildPending && !busy && <Hint>{t('updateUi.resumeBuild')}</Hint>}
                {!job && <Text type="tertiary">{t('update.noJob', null, 'No update has run yet')}</Text>}
                {job && (
                    <>
                        <KeyValueList
                            columns={3}
                            items={[
                                { label: t('updateUi.taskId', null, 'Job ID'), value: <Mono>{shortCommit(job.id)}</Mono> },
                                { label: t('updateUi.kind', null, 'Job type'), value: job.kind ? t('updateUi.kinds.' + job.kind, null, job.kind) : '—' },
                                { label: t('updateUi.started', null, 'Started at'), value: job.started ? formatDateTime(job.started) : '—' },
                                { label: t('updateUi.finished', null, 'Finished at'), value: job.finished ? formatDateTime(job.finished) : '—' },
                                { label: t('updateUi.restartRequested', null, 'Restart requested'), value: yesNo(t, job.restartRequested) },
                                { label: t('updateUi.restartError', null, 'Restart error'), value: job.restartError || '—' }
                            ]}
                        />
                        {Array.isArray(job.steps) && job.steps.length > 0 && (
                            <Timeline className="settings-update-steps">
                                {job.steps.map((step, index) => (
                                    <Timeline.Item key={`${step.phase}-${index}`}>
                                        <Text strong>{t('updateUi.phases.' + step.phase, null, step.phase)}</Text>
                                        <div><Text type="tertiary" size="small">{truncate(step.message || '', 160)}</Text></div>
                                        <Text type="tertiary" size="small">{step.at ? formatDateTime(step.at) : ''}</Text>
                                    </Timeline.Item>
                                ))}
                            </Timeline>
                        )}
                        {job.result && (
                            <KeyValueList
                                columns={3}
                                items={[
                                    { label: t('updateUi.fromCommit', null, 'Previous commit'), value: <Mono>{shortCommit(job.result.fromCommit)}</Mono> },
                                    { label: t('updateUi.toCommit', null, 'New commit'), value: <Mono>{shortCommit(job.result.toCommit)}</Mono> },
                                    { label: t('update.resultCommits', null, 'Commits brought in'), value: formatNumber(job.result.commits) },
                                    { label: t('update.resultFiles', null, 'Files touched'), value: formatNumber(job.result.filesTouched) },
                                    { label: t('updateUi.keptContent', null, 'Local files kept'), value: formatNumber((job.result.keptContent || []).length) },
                                    { label: t('updateUi.overwritten', null, 'Files overwritten'), value: formatNumber((job.result.overwritten || []).length) }
                                ]}
                            />
                        )}
                        {job.failure && (
                            <Banner
                                type="danger"
                                bordered
                                closeIcon={null}
                                description={(
                                    <div>
                                        <div>{job.failure.message || job.failure.reason}</div>
                                        {(job.failure.items || []).length > 0 && (
                                            <ul>
                                                {job.failure.items.slice(0, 6).map(item => <li key={item}>{item}</li>)}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            />
                        )}
                    </>
                )}
            </SectionCard>
        </>
    );
}

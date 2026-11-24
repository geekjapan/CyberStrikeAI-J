/** Create/edit asset: Form plus automatic target parsing (host/ip/domain/port/protocol linked). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, Form, Space } from '@douyinfe/semi-ui';
import { api, errorMessage } from '../../../lib/http';
import { useT } from '../../../lib/i18n';
import { Drawer, toastSuccess } from '../../../components/ui';
import {
    CRITICALITY_OPTIONS, ENVIRONMENT_OPTIONS, STATUS_OPTIONS
} from './assetConstants';
import {
    isIPv4, isIPv6, normalizeDomain, parseAssetTarget, splitAssetTargets, targetInputFromAsset
} from './assetTarget';

const FORM_CLASS = 'asset-library-editor';

function initialValues(asset, defaultProjectId) {
    return {
        target: targetInputFromAsset(asset),
        host: asset?.host || '',
        ip: asset?.ip || '',
        domain: asset?.domain || '',
        port: asset?.port ?? undefined,
        protocol: asset?.protocol || '',
        title: asset?.title || '',
        server: asset?.server || '',
        project_id: asset ? asset.project_id || '' : defaultProjectId,
        status: asset?.status || 'active',
        environment: asset?.environment || '',
        criticality: asset?.criticality || '',
        country: asset?.country || '',
        province: asset?.province || '',
        city: asset?.city || '',
        responsible_person: asset?.responsible_person || '',
        department: asset?.department || '',
        business_system: asset?.business_system || '',
        tags: Array.isArray(asset?.tags) ? asset.tags : []
    };
}

export default function AssetEditorModal({ visible, asset, defaultProjectId = '', fixedProject = false, projects, onClose, onSaved }) {
    const t = useT();
    const [formApi, setFormApi] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const parsedTarget = useRef(targetInputFromAsset(asset));

    const values = useMemo(() => initialValues(asset, defaultProjectId), [asset, defaultProjectId, visible]);
    const editing = Boolean(asset?.id);

    useEffect(() => {
        if (!visible) return;
        parsedTarget.current = targetInputFromAsset(asset);
        setError('');
        setBusy(false);
    }, [visible, asset]);

    const projectOptions = useMemo(
        () => (projects || []).map(project => ({ value: project.id, label: project.name || project.id })),
        [projects]
    );

    const applyTarget = (showError) => {
        if (!formApi) return null;
        const raw = String(formApi.getValue('target') || '').trim();
        try {
            const parsed = parseAssetTarget(raw);
            formApi.setValues({
                host: parsed.host,
                ip: parsed.ip,
                domain: parsed.domain,
                port: parsed.port || undefined,
                protocol: parsed.protocol
            });
            parsedTarget.current = raw;
            return parsed;
        } catch (parseError) {
            if (showError) setError(parseError.message);
            return null;
        }
    };

    const buildPayload = () => {
        const current = formApi.getValue();
        const rawTarget = String(current.target || '').trim();
        let payload = {
            host: String(current.host || '').trim(),
            ip: String(current.ip || '').trim().toLowerCase(),
            domain: String(current.domain || '').trim(),
            port: Number(current.port || 0),
            protocol: String(current.protocol || '').trim().toLowerCase(),
            title: String(current.title || '').trim(),
            server: String(current.server || '').trim(),
            status: current.status || 'active',
            source: asset?.source || 'manual',
            source_query: asset?.source_query || '',
            country: String(current.country || '').trim(),
            province: String(current.province || '').trim(),
            city: String(current.city || '').trim(),
            responsible_person: String(current.responsible_person || '').trim(),
            department: String(current.department || '').trim(),
            business_system: String(current.business_system || '').trim(),
            environment: current.environment || '',
            criticality: current.criticality || '',
            project_id: current.project_id || '',
            tags: Array.isArray(current.tags) ? current.tags.map(tag => String(tag).trim()).filter(Boolean) : []
        };
        if (rawTarget && rawTarget !== parsedTarget.current) {
            try {
                const parsed = parseAssetTarget(rawTarget);
                payload = {
                    ...payload,
                    host: payload.host || parsed.host,
                    ip: parsed.ip || payload.ip,
                    domain: parsed.domain || payload.domain,
                    port: parsed.port || payload.port,
                    protocol: parsed.protocol || payload.protocol
                };
            } catch (parseError) {
                throw new Error(parseError.message);
            }
        }
        return payload;
    };

    const buildCreatedAssets = () => {
        const targets = splitAssetTargets(formApi.getValue('targets'));
        if (!targets.length) throw new Error(t('assets.targetRequired', null, 'Enter an asset address'));
        if (targets.length > 200) throw new Error(t('ui.assetEditor.maxTargets', null, 'You can add up to 200 addresses at a time'));
        const projectID = fixedProject ? defaultProjectId : formApi.getValue('project_id') || '';
        return targets.map(target => {
            const parsed = parseAssetTarget(target);
            return {
                host: parsed.host || parsed.domain || parsed.ip,
                ip: parsed.ip,
                domain: parsed.domain,
                port: parsed.port,
                protocol: parsed.protocol,
                status: 'active',
                source: 'manual',
                project_id: projectID,
                tags: []
            };
        });
    };

    const submit = async () => {
        if (busy || !formApi) return;
        setError('');
        try {
            await formApi.validate();
        } catch (validation) {
            return;
        }
        let payload;
        let createdAssets;
        try {
            if (editing) payload = buildPayload();
            else createdAssets = buildCreatedAssets();
        } catch (buildError) {
            setError(buildError.message);
            return;
        }
        setBusy(true);
        try {
            if (editing) {
                await api.put(`/assets/${encodeURIComponent(asset.id)}`, payload);
                toastSuccess(t('assets.updatedSuccessfully', null, 'Asset updated'));
            } else {
                const result = await api.post('/assets/import', {
                    assets: createdAssets,
                    source: 'manual'
                });
                const created = Number(result?.created || 0);
                const updated = Number(result?.updated || 0);
                const skipped = Number(result?.skipped || 0);
                if (!created && !updated && skipped) {
                    throw new Error(t('assets.assetSkipped', null, 'Asset was not saved; it may exist without update permission'));
                }
                const parts = [];
                if (created) parts.push(t('ui.assetEditor.partCreated', { count: created }, '{{count}} added'));
                if (updated) parts.push(t('ui.assetEditor.partMerged', { count: updated }, '{{count}} merged'));
                if (skipped) parts.push(t('ui.assetEditor.partSkipped', { count: skipped }, '{{count}} skipped'));
                toastSuccess(parts.length ? t('ui.assetEditor.written', { parts: parts.join(t('ui.assetEditor.listSeparator', null, '，')) }, 'Saved to the asset library: {{parts}}') : t('assets.createdSuccessfully', null, ', '));
            }
            onSaved?.();
            onClose?.();
        } catch (submitError) {
            setError(errorMessage(submitError, t('assets.saveFailed', null, 'Failed to save asset')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            title={editing ? t('assets.editAssetTitle', null, 'Edit asset') : t('assets.addAssetTitle', null, 'Add asset')}
            width={editing ? 760 : 520}
            onCancel={onClose}
            onOk={submit}
            okText={editing ? t('common.save', null, 'Save') : t('assets.addAssetAction', null, 'Add asset')}
            confirmLoading={busy}
            closeOnEsc
        >
            {error && <Banner type="danger" bordered closeIcon={null} description={error} className="asset-library-form-error" />}
            <Form
                key={`${asset?.id || 'new-asset'}-${visible ? 'open' : 'closed'}`}
                className={FORM_CLASS}
                initValues={values}
                getFormApi={setFormApi}
                labelPosition="top"
                onSubmit={submit}
            >
                {!editing ? (
                    <>
                        <Form.TextArea
                            field="targets"
                            label={t('assets.assetAddress', null, 'Asset address')}
                            rows={8}
                            placeholder={'https://example.com/login\nexample.com:443\n1.1.1.1:22'}
                            helpText={t('ui.assetEditor.targetsHelp', null, 'One per line, or separated by spaces or commas. Paste URLs, domains, or IP:port directly.')}
                            rules={[{
                                required: true,
                                validator: (rule, value, callback) => {
                                    const targets = splitAssetTargets(value);
                                    if (!targets.length) {
                                        callback(new Error(t('assets.targetRequired', null, 'Enter an asset address')));
                                        return;
                                    }
                                    for (const target of targets) {
                                        try {
                                            parseAssetTarget(target);
                                        } catch (parseError) {
                                            callback(new Error(`${target}：${parseError.message}`));
                                            return;
                                        }
                                    }
                                    callback();
                                }
                            }]}
                        />
                        <Form.Select
                            field="project_id"
                            label={t('assets.project', null, 'Project')}
                            optionList={projectOptions}
                            disabled={fixedProject}
                            filter
                            showClear={!fixedProject}
                            placeholder={t('assets.unboundProject', null, 'Not bound')}
                            style={{ width: '100%' }}
                        />
                    </>
                ) : (
                    <>
                        <div className="asset-library-form-grid asset-library-form-grid--full">
                            <Form.Input
                                field="target"
                                label={t('assets.assetAddress', null, 'Asset address')}
                                placeholder="https://example.com:443 / example.com / 1.1.1.1:22"
                                helpText={t('assets.assetAddressHint', null, 'Any non-empty target is accepted; recognized URLs, domains, IPs, and ports are parsed automatically')}
                                onBlur={() => applyTarget(true)}
                                rules={[
                                    { required: true, message: t('assets.targetRequired', null, 'Enter an asset address') },
                                    {
                                        validator: (rule, value, callback) => {
                                            try {
                                                parseAssetTarget(value);
                                                callback();
                                            } catch (parseError) {
                                                callback(new Error(parseError.message));
                                            }
                                        }
                                    }
                                ]}
                            />
                        </div>
                        <div className="asset-library-form-grid">
                            <Form.Input field="host" label={t('assets.hostUrl', null, 'Full URL / Host')} />
                            <Form.Input
                                field="ip"
                                label="IP"
                                rules={[{
                                    validator: (rule, value, callback) => {
                                        if (!value || isIPv4(value) || isIPv6(value)) callback();
                                        else callback(new Error(t('assets.ipInvalid', null, 'Invalid IP address')));
                                    }
                                }]}
                            />
                            <Form.Input
                                field="domain"
                                label={t('assets.domain', null, 'Domain')}
                                rules={[{
                                    validator: (rule, value, callback) => {
                                        if (!value || (normalizeDomain(value) && !isIPv4(value) && !isIPv6(value))) callback();
                                        else callback(new Error(t('assets.domainInvalid', null, 'Invalid domain')));
                                    }
                                }]}
                            />
                            <Form.InputNumber
                                field="port"
                                label={t('assets.port', null, 'Port')}
                                min={0}
                                max={65535}
                                style={{ width: '100%' }}
                            />
                            <Form.Input
                                field="protocol"
                                label={t('assets.protocol', null, 'Protocol')}
                                rules={[{
                                    validator: (rule, value, callback) => {
                                        if (!value || /^[a-z][a-z0-9+.-]{0,31}$/.test(String(value).toLowerCase())) callback();
                                        else callback(new Error(t('assets.protocolInvalid', null, 'Invalid protocol')));
                                    }
                                }]}
                            />
                            <Form.Input field="title" label={t('assets.pageTitle', null, 'Page title')} />
                            <Form.Input field="server" label={t('assets.serverProduct', null, 'Service / product')} />
                            <Form.Select
                                field="project_id"
                                label={t('assets.project', null, 'Project')}
                                optionList={projectOptions}
                                filter
                                showClear
                                placeholder={t('assets.unboundProject', null, 'Not bound')}
                            />
                            <Form.Select field="status" label={t('assets.status', null, 'Status')} optionList={STATUS_OPTIONS} />
                            <Form.Select
                                field="environment"
                                label={t('assets.environment', null, 'Environment')}
                                optionList={ENVIRONMENT_OPTIONS}
                                showClear
                                placeholder="—"
                            />
                            <Form.Select
                                field="criticality"
                                label={t('assets.criticality', null, 'Criticality')}
                                optionList={CRITICALITY_OPTIONS}
                                showClear
                                placeholder="—"
                            />
                            <Form.Input field="country" label={t('assets.country', null, 'Country / region')} />
                            <Form.Input field="province" label={t('assets.province', null, 'Province / state')} />
                            <Form.Input field="city" label={t('assets.city', null, 'City')} />
                            <Form.Input field="responsible_person" label={t('assets.responsiblePerson', null, 'Owner')} />
                            <Form.Input field="department" label={t('assets.department', null, 'Department')} />
                            <Form.Input field="business_system" label={t('assets.businessSystem', null, 'Business system')} />
                        </div>
                        <Form.TagInput
                            field="tags"
                            label={t('assets.tagsLabel', null, 'Tags')}
                            placeholder={t('assets.tagsPlaceholder', null, 'Press Enter or comma to add')}
                            max={30}
                            maxLength={64}
                            addOnBlur
                            separator=",，"
                            style={{ width: '100%' }}
                        />
                        <Space className="asset-library-editor-actions">
                            <Button theme="borderless" onClick={() => applyTarget(true)}>
                                {t('assets.parseTarget', null, 'Parse asset address')}
                            </Button>
                        </Space>
                    </>
                )}
            </Form>
        </Drawer>
    );
}

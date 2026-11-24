import { useId, useMemo, useRef } from 'react';
import { Banner, Button, Popover, Select, Tag, TextArea, Tooltip, Typography } from '@douyinfe/semi-ui';
import { IconArrowUp, IconChevronDown, IconDesktop, IconFolder, IconPaperclip, IconPlus, IconShield, IconStop, IconUser } from '@douyinfe/semi-icons';
import { useT } from '../../lib/i18n';
import { currentLocale, isDefaultRole } from '../../lib/format';
import { modelChannelName } from '../../lib/model-channel';
import { ModelSettings } from './ChatSettings';
import { reasoningSummary } from './useModelPreferences';

const { Text } = Typography;

export const AGENT_MODES = ['single', 'deep', 'plan_execute', 'supervisor'];
const CREATE_PROJECT = '__create_project__';

export default function Composer({
    value,
    onChange,
    onSend,
    onStop,
    canStop,
    sending,
    checkingRun,
    canWrite,
    canExecute,
    mode,
    onModeChange,
    projectId,
    onProjectChange,
    onCreateProject,
    projects,
    projectDisabled,
    role,
    onRoleChange,
    roles,
    roleDisabled,
    model,
    canReadConfig,
    onOpenHitl,
    attachments,
    onPickFiles,
    onRemoveAttachment,
    uploading
}) {
    const t = useT();
    const fileRef = useRef(null);
    const modeLabelId = useId();
    const projectLabelId = useId();
    const roleLabelId = useId();
    const list = Array.isArray(attachments) ? attachments : [];
    const modeOptions = useMemo(() => [
        {
            value: 'single',
            title: t('chat.agentModePiSingle', null, 'Single agent'),
            description: t('chat.agentModePiSingleHint', null, 'Run a single agent using the runtime selected in Settings')
        },
        {
            value: 'deep',
            title: t('chat.agentModeDeep', null, 'Deep（DeepAgent）'),
            description: t('chat.agentModeDeepHint', null, 'Pi multi-agent for complex security testing, multi-stage task delegation, and synthesis')
        },
        {
            value: 'plan_execute',
            title: t('chat.agentModePlanExecuteLabel', null, 'Plan-Execute'),
            description: t('chat.agentModePlanExecuteHint', null, 'Plan → execute → replan (single executor with tools)')
        },
        {
            value: 'supervisor',
            title: t('chat.agentModeSupervisorLabel', null, 'Supervisor (Expert routing)'),
            description: t('chat.agentModeSupervisorHint', null, 'Expert-routing scenarios: route across multiple specialist sub-agents via transfer')
        }
    ].map(({ value, title, description }) => ({
        value,
        title,
        label: (
            <span className="chat-mode-option">
                <span>{title}</span>
                <span className="chat-mode-option-description">{description}</span>
            </span>
        )
    })), [t]);
    const projectOptions = [
        { value: '', label: t('chat.defaultWorkspace', null, 'Default workspace') },
        ...(Array.isArray(projects) ? projects : []).map(project => ({
            value: project.id,
            label: project.name || t('chat.boundProject', null, 'Linked project')
        }))
    ];
    if (projectId && !projectOptions.some(option => option.value === projectId)) {
        projectOptions.push({ value: projectId, label: t('chat.boundProject', null, 'Linked project') });
    }
    if (onCreateProject) {
        projectOptions.push({ value: CREATE_PROJECT, label: `+ ${t('projects.newProject', null, 'New project')}` });
    }
    const roleOptions = useMemo(() => {
        const list = (Array.isArray(roles) ? roles : []).filter(item => item?.name);
        const named = list
            .filter(item => item.enabled !== false && !isDefaultRole(item.name))
            .sort((a, b) => a.name.localeCompare(b.name, currentLocale()));
        const fallback = list.find(item => isDefaultRole(item.name));
        const toOption = item => ({
            value: isDefaultRole(item.name) ? '' : item.name,
            name: isDefaultRole(item.name) ? t('chat.defaultRole', null, 'Default') : item.name,
            icon: item.icon || '',
            description: item.description || '',
            label: (
                <span className="chat-role-option">
                    <span className="chat-role-option-title">
                        {item.icon ? <span className="chat-role-icon" aria-hidden="true">{item.icon}</span> : null}
                        <span>{isDefaultRole(item.name) ? t('chat.defaultRole', null, 'Default') : item.name}</span>
                    </span>
                    {item.description ? <span className="chat-role-option-description">{item.description}</span> : null}
                </span>
            )
        });
        const options = [toOption({
            name: 'Default',
            icon: fallback?.icon || '',
            description: fallback?.description || ''
        })];
        const seen = new Set(['']);
        for (const item of named) {
            if (seen.has(item.name)) continue;
            seen.add(item.name);
            options.push(toOption(item));
        }
        if (role && !seen.has(role)) {
            const current = list.find(item => item.name === role);
            options.push(toOption(current || { name: role, icon: '', description: '' }));
        }
        return options;
    }, [role, roles, t]);
    const selectedRole = roleOptions.find(option => option.value === (role || '')) || roleOptions[0];
    const uploadingCount = Number(uploading) || list.filter(item => item.uploading).length;
    const blocked = !canWrite || !canExecute;
    const busy = sending || checkingRun;
    const channelId = model.channel || model.config.data?.default_channel;
    const channelName = channelId
        ? modelChannelName(channelId, model.config.data?.channels?.[channelId])
        : t('chat.aiChannelDefaultShort', null, 'Default channel');
    const reasoningLabel = model.overrideBlocked
        ? reasoningSummary(t, 'default', '')
        : reasoningSummary(t, model.mode, model.effort);

    const handleKeyDown = event => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        if (event.nativeEvent?.isComposing) return;
        event.preventDefault();
        if (busy || blocked || roleDisabled || uploadingCount > 0) return;
        onSend();
    };

    return (
        <div className="chat-composer">
            {blocked && (
                <Banner
                    type="warning"
                    bordered
                    closeIcon={null}
                    className="chat-composer-banner"
                    description={!canWrite
                        ? t('chat.noWritePermission', null, 'The current account lacks the conversation write permission (chat:write); sending is disabled.')
                        : t('chat.noExecutePermission', null, 'The current account lacks the agent execution permission (agent:execute); sending is disabled.')}
                />
            )}
            <div className="chat-composer-shell">
                <div className="chat-composer-box">
                    <div className="chat-composer-context">
                        <span id={modeLabelId} hidden>{t('chat.agentModeSelectAria', null, 'Choose conversation execution mode')}</span>
                        <Select
                            value={mode}
                            optionList={modeOptions}
                            renderSelectedItem={option => <span title={option.title}>{option.title}</span>}
                            onChange={onModeChange}
                            prefix={<IconDesktop aria-hidden="true" />}
                            className="chat-context-select chat-composer-mode"
                            dropdownClassName="chat-mode-dropdown"
                            size="small"
                            position="topLeft"
                            aria-labelledby={modeLabelId}
                            disabled={busy || blocked}
                        />
                        <span className="chat-context-divider" aria-hidden="true" />
                        <span id={projectLabelId} hidden>{t('chat.chooseWorkspace', null, 'Choose the conversation workspace')}</span>
                        <Select
                            value={projectId}
                            optionList={projectOptions}
                            onChange={value => {
                                if (value === CREATE_PROJECT) onCreateProject?.();
                                else onProjectChange(value);
                            }}
                            prefix={<IconFolder aria-hidden="true" />}
                            className="chat-context-select chat-composer-project"
                            dropdownClassName="chat-project-dropdown"
                            dropdownMatchSelectWidth={false}
                            position="topLeft"
                            size="small"
                            renderSelectedItem={option => <span title={option.label}>{option.label}</span>}
                            aria-labelledby={projectLabelId}
                            disabled={busy || projectDisabled || !canWrite}
                        />
                        {onRoleChange && (
                            <>
                                <span className="chat-context-divider" aria-hidden="true" />
                                <span id={roleLabelId} hidden>{t('chat.selectRole', null, 'Select role')}</span>
                                <Select
                                    value={role || ''}
                                    optionList={roleOptions}
                                    onChange={onRoleChange}
                                    prefix={selectedRole?.icon
                                        ? <span className="chat-role-icon" aria-hidden="true">{selectedRole.icon}</span>
                                        : <IconUser aria-hidden="true" />}
                                    className="chat-context-select chat-composer-role"
                                    dropdownClassName="chat-role-dropdown"
                                    dropdownMatchSelectWidth={false}
                                    position="topLeft"
                                    size="small"
                                    renderSelectedItem={option => <span title={option.description || option.name}>{option.name}</span>}
                                    aria-labelledby={roleLabelId}
                                    disabled={busy || roleDisabled || !canWrite}
                                />
                            </>
                        )}
                    </div>
                    <input
                        ref={fileRef}
                        type="file"
                        multiple
                        hidden
                        onChange={event => {
                            if (event.target.files?.length) onPickFiles(Array.from(event.target.files));
                            event.target.value = '';
                        }}
                    />
                    {list.length > 0 && (
                        <div className="chat-file-list">
                            {list.map(file => (
                                <Tag
                                    key={file.id}
                                    className={`chat-file-chip ${file.error ? 'is-error' : ''} ${file.uploading ? 'is-uploading' : ''}`}
                                    size="large"
                                    color={file.error ? 'red' : (file.uploading ? 'amber' : 'blue')}
                                    closable
                                    onClose={() => onRemoveAttachment(file.id)}
                                >
                                    <IconPaperclip size="small" />
                                    <span className="chat-file-name" title={file.fileName}>{file.fileName}</span>
                                    <span className="chat-file-state">
                                        {file.uploading ? t('ui.composer.uploading', null, 'Uploading…') : (file.error ? t('ui.composer.uploadFailed', null, 'Upload failed') : t('ui.composer.uploaded', null, 'Uploaded'))}
                                    </span>
                                </Tag>
                            ))}
                        </div>
                    )}
                    <TextArea
                        className="chat-textarea"
                        borderless
                        value={value}
                        onChange={onChange}
                        onKeyDown={handleKeyDown}
                        disabled={blocked}
                        autosize={{ minRows: 2, maxRows: 8 }}
                        aria-label={t('chat.composerLabel', null, 'Message')}
                        placeholder={t('chat.composerPlaceholder', null, 'Describe the target, authorized scope, and what you need, or attach related material…')}
                    />
                    <div className="chat-composer-toolbar">
                        <div className="chat-composer-controls">
                            <Tooltip content={t('chat.selectFile', null, 'Select file')}>
                                <Button
                                    icon={<IconPlus />}
                                    theme="borderless"
                                    type="tertiary"
                                    aria-label={t('chat.attachmentsLabel', null, 'Attachments')}
                                    disabled={blocked}
                                    onClick={() => fileRef.current?.click()}
                                />
                            </Tooltip>
                            <Button
                                icon={<IconShield />}
                                theme="borderless"
                                type="tertiary"
                                className="chat-composer-hitl"
                                aria-label={t('chat.hitlTitle', null, 'Human-in-the-loop')}
                                disabled={!onOpenHitl}
                                onClick={onOpenHitl}
                            >
                                {t('chat.hitlTitle', null, 'Human-in-the-loop')}
                            </Button>
                        </div>
                        <div className="chat-composer-submit">
                            <Popover
                                trigger="click"
                                position="topRight"
                                className="chat-model-popover"
                                condition={!busy}
                                content={<ModelSettings model={model} busy={busy || blocked} canReadConfig={canReadConfig} />}
                            >
                                <Button
                                    theme="borderless"
                                    type="tertiary"
                                    className="chat-composer-model"
                                    aria-label={t('chat.modelSettingsAria', null, 'Choose AI channel, model, and reasoning settings')}
                                    title={`${channelName} · ${reasoningLabel}`}
                                    disabled={busy}
                                >
                                    <span className="chat-composer-model-name">{channelName}</span>
                                    <span className="chat-composer-effort">{reasoningLabel}</span>
                                    <IconChevronDown size="small" />
                                </Button>
                            </Popover>
                            {sending ? (
                                <Button
                                    type="danger"
                                    className="chat-composer-send"
                                    icon={<IconStop />}
                                    aria-label={t('chat.stop', null, 'Stop')}
                                    onClick={onStop}
                                    disabled={!canStop}
                                />
                            ) : (
                                <Tooltip content={t('chat.sendHint', null, 'Enter to send · Shift+Enter for a new line')}>
                                    <Button
                                        theme="solid"
                                        className="chat-composer-send"
                                        icon={<IconArrowUp />}
                                        aria-label={t('chat.send', null, 'Send')}
                                        disabled={blocked || checkingRun || roleDisabled || uploadingCount > 0}
                                        onClick={onSend}
                                    />
                                </Tooltip>
                            )}
                        </div>
                    </div>
                    {uploadingCount > 0 && (
                        <Text type="tertiary" size="small" role="status">
                            {t('chat.waitingAttachmentsUpload', null, 'Waiting for attachments to finish uploading…')}
                        </Text>
                    )}
                </div>
            </div>
        </div>
    );
}

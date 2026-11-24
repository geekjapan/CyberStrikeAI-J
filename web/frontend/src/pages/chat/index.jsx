/** Chat workbench: conversation list, message area, streaming send, approvals and execution plan. */
import { isDefaultRole } from '../../lib/format';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Collapse, Progress, SideSheet, Typography } from '@douyinfe/semi-ui';

import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { consumeRetestAutosend, peekRetestAutosend } from '../../lib/retest';
import { useDebounced, useInterval, useLocalStorage, useResource } from '../../components/hooks';
import { toastError, toastSuccess, toastWarning } from '../../components/ui';
import ProjectFormModal from '../projects/project-form';
import ChatHeader from './ChatHeader';
import ChatSettings from './ChatSettings';
import ConversationList from './ConversationList';
import MessageList from './MessageList';
import Composer, { AGENT_MODES } from './Composer';
import HitlDock from './HitlDock';
import PlanTasksSheet from './PlanTasksSheet';
import { useAgentRun } from './useAgentRun';
import { useConversationActions } from './useConversationActions';
import { useModelPreferences } from './useModelPreferences';
import './page.css';

const { Text } = Typography;

const PAGE_SIZE = 20;
const DEFAULT_WORKSPACE = '__none__';
const MODE_STORAGE_KEY = 'csai-chat-agent-mode';
const ROLE_STORAGE_KEY = 'csai-chat-role';

function chatRoleValue(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    return !name || isDefaultRole(name) ? '' : name;
}
const EMPTY_PLAN = { tasks: [], total: 0, completed: 0, activeStep: 0, running: false };
const EMPTY_DETAIL = { conversation: null, messages: [], loading: false, error: null };

function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => (
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(query).matches
            : false
    ));
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mql = window.matchMedia(query);
        const handler = event => setMatches(event.matches);
        setMatches(mql.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, [query]);
    return matches;
}

export default function Page() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('chat:write');
    const canCreateProject = hasPermission('project:write');
    const canExecute = hasPermission('agent:execute');
    const canDelete = hasPermission('chat:delete');
    const canReadTasks = hasPermission('tasks:read');
    const canStop = hasPermission('tasks:write');
    const canReadHitl = hasPermission('hitl:read');
    const canDecideHitl = hasPermission('hitl:write');
    const canReadConfig = hasPermission('config:read');
    const canReadRoles = hasPermission('roles:read');

    const [searchParams, setSearchParams] = useSearchParams();
    const conversationId = searchParams.get('conversation') || '';
    const conversationRef = useRef(conversationId);
    const boundByRun = useRef(null);
    useLayoutEffect(() => { conversationRef.current = conversationId; }, [conversationId]);

    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounced(search, 350);
    const [projectFilter, setProjectFilter] = useState('');
    const [projectGroup, setProjectGroup] = useState(DEFAULT_WORKSPACE);
    const [groupOpen, setGroupOpen] = useState(true);
    const [page, setPage] = useState(1);
    const [newProjectId, setNewProjectId] = useState('');
    const [projectSaving, setProjectSaving] = useState(false);
    const [projectFormOpen, setProjectFormOpen] = useState(false);
    const [storedMode, setStoredMode] = useLocalStorage(MODE_STORAGE_KEY, 'single');
    const mode = AGENT_MODES.includes(storedMode) ? storedMode : 'single';
    const [storedRole, setStoredRole] = useLocalStorage(ROLE_STORAGE_KEY, '');
    const [roleDrafts, setRoleDrafts] = useState(() => new Map());
    const pendingRoleRef = useRef('');
    const model = useModelPreferences(canReadConfig);
    const [hitlOpen, setHitlOpen] = useState(false);
    const [draftHitl, setDraftHitl] = useState(null);

    const [detail, setDetail] = useState(EMPTY_DETAIL);
    const [composers, setComposers] = useState(() => new Map());
    const { draft = '', attachments = [] } = composers.get(conversationId) || {};
    const updateComposer = useCallback((id, change) => {
        setComposers(previous => {
            const next = new Map(previous);
            next.set(id, change(previous.get(id) || {}));
            return next;
        });
    }, []);
    const setDraft = value => updateComposer(conversationId, current => ({ ...current, draft: value }));
    const [approvalSnapshot, setApprovalSnapshot] = useState(null);
    const hitlPending = canReadHitl && approvalSnapshot?.id === conversationId ? approvalSnapshot.items : [];
    const [hitlBusy, setHitlBusy] = useState('');
    const [plan, setPlan] = useState(EMPTY_PLAN);
    const [planLoading, setPlanLoading] = useState(false);
    const [planOpen, setPlanOpen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const narrow = useMediaQuery('(max-width: 900px)');

    const detailSeq = useRef(0);
    const hitlSeq = useRef(0);
    const planSeq = useRef(0);
    const activeTask = useResource(async () => {
        const payload = await api.get('/agent-loop/tasks');
        return { id: conversationId, running: Array.isArray(payload?.tasks) && payload.tasks.some(task => task.conversationId === conversationId) };
    }, [conversationId, canReadTasks], { skip: !conversationId || !canReadTasks });
    const backgroundRunning = canReadTasks && activeTask.data?.id === conversationId && activeTask.data.running;
    const checkingRun = Boolean(canReadTasks && conversationId && activeTask.data?.id !== conversationId && !activeTask.error);
    const lastActive = useRef(null);

    const conversations = useResource(
        async () => ({
            ...(await api.get('/conversations', {
                limit: PAGE_SIZE,
                offset: (page - 1) * PAGE_SIZE,
                search: debouncedSearch || undefined,
                project_id: projectGroup,
                group_by_project: 1
            })),
            projectGroup, page, search: debouncedSearch
        }),
        [page, debouncedSearch, projectGroup]
    );

    const reloadConversations = useRef(conversations.reload);
    useEffect(() => { reloadConversations.current = conversations.reload; }, [conversations.reload]);

    const projectsResource = useResource(() => api.get('/projects', { limit: 200 }), []);
    const rolesResource = useResource(() => api.get('/roles'), [canReadRoles], { skip: !canReadRoles });
    const projects = useMemo(() => (
        Array.isArray(projectsResource.data?.projects) ? projectsResource.data.projects : []
    ), [projectsResource.data]);
    const roles = useMemo(() => (
        (Array.isArray(rolesResource.data?.roles) ? rolesResource.data.roles : [])
            .filter(item => item && String(item.name || '').trim())
            .map(item => ({
                name: String(item.name).trim(),
                description: String(item.description || ''),
                icon: String(item.icon || ''),
                enabled: item.enabled !== false
            }))
    ), [rolesResource.data]);
    const handleProjectCreated = project => {
        setProjectFormOpen(false);
        if (!project?.id) return;
        projectsResource.setData(previous => ({
            ...previous,
            projects: [project, ...(previous?.projects || [])]
        }));
        void changeProject(project.id);
    };

    const groups = Array.isArray(conversations.data?.projectGroups) ? conversations.data.projectGroups : [];
    const currentGroup = conversations.data?.projectGroup === projectGroup && conversations.data?.search === debouncedSearch;
    const currentPage = currentGroup && conversations.data?.page === page;
    const listItems = currentPage && Array.isArray(conversations.data.conversations) ? conversations.data.conversations : [];
    const groupTotal = currentGroup ? conversations.data.total || 0 : 0;

    useEffect(() => {
        if (!currentPage) return;
        const lastPage = Math.max(1, Math.ceil(groupTotal / PAGE_SIZE));
        if (page > lastPage) setPage(lastPage);
    }, [currentPage, groupTotal, page]);

    const openGroup = useCallback(id => {
        setProjectGroup(id);
        setGroupOpen(true);
        setPage(1);
    }, []);

    const loadDetail = useCallback(async (id, { silent = false } = {}) => {
        const seq = ++detailSeq.current;
        if (!id) {
            setDetail(EMPTY_DETAIL);
            return null;
        }
        if (!silent) setDetail(prev => ({ ...prev, loading: true, error: null }));
        try {
            const payload = await api.get(`/conversations/${encodeURIComponent(id)}`, { include_process_details: 1 });
            if (seq !== detailSeq.current || conversationRef.current !== id) return null;
            setDetail({
                conversation: payload || null,
                messages: Array.isArray(payload?.messages) ? payload.messages : [],
                loading: false,
                error: null
            });
            return payload;
        } catch (error) {
            if (seq === detailSeq.current && conversationRef.current === id) {
                setDetail(prev => ({ ...prev, loading: false, error }));
            }
            return null;
        }
    }, []);

    const refreshHitl = useCallback(async () => {
        const id = conversationRef.current;
        const seq = ++hitlSeq.current;
        if (!id || !canReadHitl) return;
        try {
            const payload = await api.get('/hitl/pending', { conversationId: id, pageSize: 50 });
            if (seq !== hitlSeq.current || conversationRef.current !== id) return;
            const items = (Array.isArray(payload?.items) ? payload.items : []).filter(item =>
                !item.conversationId || item.conversationId === id
            );
            setApprovalSnapshot({ id, items });
        } catch (error) {
            /* An approval polling failure does not interrupt the conversation */
        }
    }, [canReadHitl]);

    const refreshPlan = useCallback(async () => {
        const id = conversationRef.current;
        if (!id) {
            setPlan(EMPTY_PLAN);
            return;
        }
        const seq = ++planSeq.current;
        setPlanLoading(true);
        try {
            const payload = await api.get(`/conversations/${encodeURIComponent(id)}/plan-tasks`);
            if (seq === planSeq.current && conversationRef.current === id) setPlan(payload && typeof payload === 'object' ? payload : EMPTY_PLAN);
        } catch (error) {
            /* The plan board refreshes on demand; failures are silent */
        } finally {
            if (seq === planSeq.current && conversationRef.current === id) setPlanLoading(false);
        }
    }, []);

    const bindConversation = useCallback(id => {
        setDraftHitl(null);
        boundByRun.current = id;
        conversationRef.current = id;
        setRoleDrafts(previous => {
            if (previous.has(id)) return previous;
            const next = new Map(previous);
            next.set(id, pendingRoleRef.current);
            return next;
        });
        setSearchParams({ conversation: id }, { replace: true });
        reloadConversations.current?.({ silent: true });
    }, [setSearchParams]);

    const settleRun = useCallback(() => {
        reloadConversations.current?.({ silent: true });
        refreshHitl();
        refreshPlan();
    }, [refreshHitl, refreshPlan]);

    const run = useAgentRun({
        conversationRef,
        bindConversation,
        requestDetailReload: loadDetail,
        onSettled: settleRun,
        onHitlEvent: refreshHitl,
        onPlanTool: refreshPlan,
        t
    });
    const { live, sending, lastEvents, reset: resetRun, isStreaming } = run;

    // Conversation switch: clear the streaming state and load history as needed
    useEffect(() => {
        // A very fast reply may finish before the route commit; the final events must still be kept when binding the conversation.
        const newlyBound = conversationId && boundByRun.current === conversationId;
        boundByRun.current = null;
        if (newlyBound || isStreaming(conversationId)) return;
        resetRun();
        detailSeq.current++;
        hitlSeq.current++;
        planSeq.current++;
        setDetail(EMPTY_DETAIL);
        setApprovalSnapshot(null);
        setHitlBusy('');
        setPlan(EMPTY_PLAN);
        setPlanLoading(false);
        setPlanOpen(false);
        if (!conversationId) return;
        loadDetail(conversationId);
        refreshHitl();
        refreshPlan();
    }, [conversationId, isStreaming, resetRun, loadDetail, refreshHitl, refreshPlan]);

    useInterval(() => {
        refreshHitl();
        refreshPlan();
        if (backgroundRunning) {
            activeTask.reload({ silent: true });
            if (!sending && conversationRef.current) loadDetail(conversationRef.current, { silent: true });
        }
    }, sending || backgroundRunning ? 4000 : 0);

    useEffect(() => {
        if (lastActive.current === conversationId && !backgroundRunning) {
            loadDetail(conversationId, { silent: true });
            reloadConversations.current?.({ silent: true });
        }
        lastActive.current = backgroundRunning ? conversationId : null;
    }, [backgroundRunning, conversationId, loadDetail]);

    const stop = async () => {
        if (!canStop) return;
        await run.stop();
        activeTask.reload({ silent: true });
    };

    const selectConversation = useCallback(id => {
        if (!id) return;
        if (id !== conversationRef.current) setSearchParams({ conversation: id });
        setSidebarOpen(false);
    }, [setSearchParams]);

    const reloadList = useCallback(() => {
        reloadConversations.current?.({ silent: true });
    }, []);

    const changeProject = async value => {
        if (!canWrite || sending || backgroundRunning || checkingRun || projectSaving) return;
        const projectId = value || '';
        const id = conversationRef.current;
        if (!id) {
            setNewProjectId(projectId);
            return;
        }
        if (detail.conversation?.id !== id || detail.loading || detail.error) return;
        setProjectSaving(true);
        try {
            await api.put(`/conversations/${encodeURIComponent(id)}/project`, { projectId });
            setDetail(previous => previous.conversation?.id === id
                ? { ...previous, conversation: { ...previous.conversation, projectId } }
                : previous);
            if (!projectFilter || projectFilter === projectId) openGroup(projectId || DEFAULT_WORKSPACE);
            reloadList();
        } catch (error) {
            toastError(error, t('chat.projectChangeFailed', null, 'Failed to update the conversation project'));
        } finally {
            setProjectSaving(false);
        }
    };

    const clearSelection = useCallback(() => setDetail(EMPTY_DETAIL), []);

    const {
        createConversation, renameConversation, togglePin, deleteConversation, batchDelete, deleteTurn
    } = useConversationActions({
        t,
        conversationRef,
        newProjectId,
        canWrite,
        reloadList,
        requestDetailReload: loadDetail,
        navigate: setSearchParams,
        onSelectionCleared: clearSelection
    });

    const decideHitl = useCallback(async (item, decision, comment) => {
        const id = conversationRef.current;
        if (!canDecideHitl || !item?.interruptId || approvalSnapshot?.id !== id ||
            !approvalSnapshot.items.some(row => String(row.id || row.interruptId) === item.interruptId)) return;
        setHitlBusy(item.interruptId);
        try {
            await api.post('/hitl/decision', {
                interruptId: item.interruptId,
                decision,
                comment: comment || ''
            });
            toastSuccess(decision === 'approve'
                ? t('chat.hitlApproved', null, 'This call was approved')
                : t('chat.hitlRejected', null, 'This call was rejected'));
            setApprovalSnapshot(previous => previous?.id === id
                ? { id, items: previous.items.filter(row => String(row.id || row.interruptId) !== item.interruptId) }
                : previous);
        } catch (error) {
            toastError(error, t('chat.hitlDecisionFailed', null, 'Failed to submit the decision'));
        } finally {
            if (conversationRef.current === id) {
                setHitlBusy('');
                refreshHitl();
            }
        }
    }, [approvalSnapshot, canDecideHitl, refreshHitl, t]);

    const dismissHitl = useCallback(async item => {
        const id = conversationRef.current;
        if (!canDecideHitl || !item?.interruptId || approvalSnapshot?.id !== id ||
            !approvalSnapshot.items.some(row => String(row.id || row.interruptId) === item.interruptId)) return;
        setHitlBusy(item.interruptId);
        try {
            await api.post('/hitl/dismiss', { interruptId: item.interruptId });
            toastSuccess(t('chat.hitlDismissed', null, 'Approval dismissed'));
            setApprovalSnapshot(previous => previous?.id === id
                ? { id, items: previous.items.filter(row => String(row.id || row.interruptId) !== item.interruptId) }
                : previous);
        } catch (error) {
            toastError(error, t('chat.hitlDismissFailed', null, 'Failed to dismiss the approval'));
        } finally {
            if (conversationRef.current === id) {
                setHitlBusy('');
                refreshHitl();
            }
        }
    }, [approvalSnapshot, canDecideHitl, refreshHitl, t]);

    const uploadFiles = useCallback(async files => {
        const id = conversationRef.current;
        const updateAttachments = change => updateComposer(id, current => ({
            ...current, attachments: change(current.attachments || [])
        }));
        const entries = files.map((file, index) => ({
            id: `att-${Date.now()}-${index}`,
            fileName: file.name,
            mimeType: file.type || '',
            serverPath: '',
            uploading: true,
            error: false
        }));
        updateAttachments(prev => [...prev, ...entries]);
        await Promise.all(entries.map(async (entry, index) => {
            const form = new FormData();
            form.append('file', files[index]);
            if (id) form.append('conversationId', id);
            try {
                const payload = await api.post('/chat-uploads', form);
                const absolutePath = String(payload?.absolutePath || '').trim();
                if (!absolutePath) throw new Error(t('ui.chatIndex.noFilePath', null, 'The server did not return a file path'));
                updateAttachments(prev => prev.map(item => (
                    item.id === entry.id ? { ...item, serverPath: absolutePath, uploading: false, error: false } : item
                )));
            } catch (error) {
                updateAttachments(prev => prev.map(item => (
                    item.id === entry.id ? { ...item, uploading: false, error: true } : item
                )));
                toastError(error, t('chat.attachmentUploadFailed', { name: entry.fileName }, 'Failed'));
            }
        }));
    }, [updateComposer, t]);

    const removeAttachment = useCallback(id => {
        updateComposer(conversationId, current => ({
            ...current, attachments: (current.attachments || []).filter(item => item.id !== id)
        }));
    }, [conversationId, updateComposer]);

    const hasRoleDraft = roleDrafts.has(conversationId);
    const savedConversation = detail.conversation?.id === conversationId ? detail.conversation : null;
    const roleResolved = !conversationId || hasRoleDraft || Boolean(savedConversation);
    const role = hasRoleDraft
        ? chatRoleValue(roleDrafts.get(conversationId))
        : (savedConversation
            ? chatRoleValue(savedConversation.roleName)
            : (conversationId ? '' : chatRoleValue(storedRole)));
    const changeRole = useCallback(value => {
        const next = chatRoleValue(value);
        setStoredRole(next);
        setRoleDrafts(previous => {
            const drafts = new Map(previous);
            drafts.set(conversationId, next);
            return drafts;
        });
    }, [conversationId, setStoredRole]);

    const submit = useCallback(() => {
        if (!canWrite || !canExecute || sending || backgroundRunning || checkingRun || projectSaving || model.waitingForChannel || !roleResolved) return;
        const text = draft.trim();
        if (!text && !attachments.length) {
            toastWarning(t('chat.emptyMessage', null, 'Enter a message or add an attachment'));
            return;
        }
        if (attachments.some(item => item.uploading)) {
            toastWarning(t('chat.waitingAttachmentsUpload', null, 'Waiting for attachments to finish uploading…'));
            return;
        }
        const ready = attachments.filter(item => item.serverPath && !item.error);
        if (attachments.length && ready.length !== attachments.length) {
            toastWarning(t('chat.attachmentsUploadIncomplete', null, 'Some attachments failed to upload. Remove the failed items or pick files again before sending.'));
            return;
        }

        const message = text || t('chat.filePrompt', null, 'Please analyze the attachments I uploaded.');
        const displayContent = ready.length
            ? `${message}\n${ready.map(item => `📎 ${item.fileName}`).join('\n')}`
            : message;
        setDetail(prev => ({
            ...prev,
            messages: [
                ...(prev.messages || []),
                { id: `local-${Date.now()}`, role: 'user', content: displayContent, createdAt: new Date().toISOString() }
            ]
        }));
        resetRun();
        updateComposer(conversationId, () => ({ draft: '', attachments: [] }));
        pendingRoleRef.current = role;
        run.send({
            message,
            attachments: ready,
            mode,
            projectId: newProjectId,
            role,
            ...model.request,
            hitl: !conversationId && canDecideHitl ? draftHitl || undefined : undefined
        });
    }, [attachments, backgroundRunning, canWrite, canExecute, canDecideHitl, checkingRun, conversationId, draft, draftHitl, mode, model, newProjectId, projectSaving, resetRun, role, roleResolved, run, sending, t, updateComposer]);

    // Arrived from the vulnerability page after it created a retest branch: auto-send the retest prompt resolved by the server (one-click run).
    const retestAutoSentRef = useRef(new Set());
    const retestNotifiedRef = useRef('');
    const retestDraftRestoredRef = useRef('');
    useEffect(() => {
        if (!conversationId) return;
        const entry = peekRetestAutosend(conversationId);
        if (!entry) return;
        const message = String(entry.prompt || '').trim();
        if (!message) {
            consumeRetestAutosend(conversationId);
            return;
        }
        if (detail.error || !canWrite || !canExecute) {
            // If sending is impossible, warn and give up auto-run; the server still keeps pending_prompt, which is filled back into the input for a manual resend.
            if (retestNotifiedRef.current !== conversationId) {
                retestNotifiedRef.current = conversationId;
                consumeRetestAutosend(conversationId);
                toastWarning(t('vulnerabilityRetest.startFailed', null, 'The retest was not sent. Its prompt is saved in the branch; return there to continue.'));
            }
            return;
        }
        if (sending || backgroundRunning || checkingRun || !roleResolved) return;
        // Wait until the branch details are loaded before sending: role/approval settings are inherited from the original conversation.
        if (detail.conversation?.id !== conversationId) return;
        consumeRetestAutosend(conversationId);
        const id = conversationRef.current;
        retestAutoSentRef.current.add(id);
        updateComposer(id, current => ({ ...current, draft: '', attachments: [] }));
        setDetail(prev => prev.conversation?.id === id ? {
            ...prev,
            messages: [
                ...(prev.messages || []),
                { id: `local-${Date.now()}`, role: 'user', content: message, createdAt: new Date().toISOString() }
            ]
        } : prev);
        resetRun();
        run.send({ message, mode, role, ...model.request });
    }, [conversationId, detail.conversation, detail.error, sending, backgroundRunning, checkingRun,
        roleResolved, canWrite, canExecute, mode, model, resetRun, role, run, t, updateComposer]);

    // When a retest branch is opened manually or the auto-send was interrupted: fill the server-saved pending_prompt back into the input.
    useEffect(() => {
        const conversation = detail.conversation;
        const pendingPrompt = String(conversation?.retest?.pending_prompt || '').trim();
        if (!conversationId || conversation?.id !== conversationId || !pendingPrompt) return;
        if (retestAutoSentRef.current.has(conversationId)) return;
        // Do not fill back while the one-click run is still waiting for prerequisites, so no prompt lingers in the input when sending.
        if (peekRetestAutosend(conversationId)) return;
        if (sending || backgroundRunning) return;
        if (String(draft || '').trim()) return;
        // Fill back only once: do not overwrite after the user clears it.
        if (retestDraftRestoredRef.current !== conversationId) {
            retestDraftRestoredRef.current = conversationId;
            updateComposer(conversationId, current => ({ ...current, draft: pendingPrompt }));
        }
    }, [conversationId, detail.conversation, draft, sending, backgroundRunning, updateComposer]);

    const conversation = detail.conversation;
    const revealedConversation = useRef('');
    useEffect(() => {
        if (!conversationId) {
            revealedConversation.current = '';
            return;
        }
        if (conversation?.id !== conversationId || revealedConversation.current === conversationId) return;
        revealedConversation.current = conversationId;
        const id = conversation.projectId || DEFAULT_WORKSPACE;
        if ((!projectFilter || projectFilter === id) && (projectGroup !== id || !groupOpen)) openGroup(id);
    }, [conversation, conversationId, groupOpen, openGroup, projectFilter, projectGroup]);

    const defaultTotal = groups.find(group => !group.projectId)?.total || 0;
    const workspaceGroups = [
        { id: DEFAULT_WORKSPACE, title: t('chat.defaultWorkspace', null, 'Default workspace'), total: defaultTotal },
        ...groups.filter(group => group.projectId).map(group => ({
            id: group.projectId,
            title: projects.find(project => project.id === group.projectId)?.name || t('chat.boundProject', null, 'Linked project'),
            total: group.total,
            projectId: group.projectId
        }))
    ];

    const sidebar = (
        <ConversationList
            items={groupOpen ? listItems : []}
            groups={workspaceGroups.filter(group => !projectFilter || group.id === projectFilter)}
            expandedGroup={groupOpen ? projectGroup : ''}
            groupTotal={groupTotal}
            onToggleGroup={id => {
                if (id === projectGroup && groupOpen) setGroupOpen(false);
                else if (id === projectGroup) setGroupOpen(true);
                else openGroup(id);
            }}
            loading={conversations.loading || (!currentPage && !conversations.error)}
            error={conversations.error}
            onRetry={() => conversations.reload()}
            search={search}
            onSearch={value => { setSearch(value); setPage(1); }}
            projectId={projectFilter}
            onProjectChange={value => { setProjectFilter(value || ''); openGroup(value || DEFAULT_WORKSPACE); }}
            projects={projects}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            selectedId={conversationId}
            onSelect={selectConversation}
            onCreate={createConversation}
            onRename={renameConversation}
            onPin={togglePin}
            onDelete={deleteConversation}
            onBatchDelete={batchDelete}
            canWrite={canWrite}
            canDelete={canDelete}
        />
    );

    return (
        <div className="chat-page">
            {!narrow && <aside className="chat-sidebar">{sidebar}</aside>}
            <section className="chat-main">
                <ChatHeader
                    conversation={conversation}
                    mode={mode}
                    hitlCount={hitlPending.length}
                    conversationId={conversationId}
                    narrow={narrow}
                    onToggleSidebar={() => setSidebarOpen(true)}
                    onRefresh={() => {
                        reloadConversations.current?.();
                        if (conversationId) loadDetail(conversationId);
                        refreshHitl();
                        refreshPlan();
                    }}
                />
                <div className="chat-panel">
                    <MessageList
                        conversationId={conversationId}
                        messages={detail.messages}
                        live={live}
                        loading={detail.loading || Boolean(conversationId && !detail.conversation && !detail.error)}
                        error={detail.error}
                        onRetry={() => (conversationId ? loadDetail(conversationId) : null)}
                        canDelete={canDelete}
                        onDeleteTurn={deleteTurn}
                    />
                    {plan.running && plan.total > 0 && (
                        <div className="chat-plan-strip">
                            <Text size="small">{t('chat.planTasks', null, 'Execution plan')}</Text>
                            <Progress
                                percent={Math.round((Number(plan.completed || 0) / Math.max(1, Number(plan.total))) * 100)}
                                showInfo={false}
                                size="small"
                                className="chat-plan-strip-bar"
                            />
                            <Text size="small" type="tertiary">
                                {plan.completed}/{plan.total}
                                {plan.activeStep ? ` · ${t('chat.planStep', { step: plan.activeStep }, 'Step {{step}}')}` : ''}
                            </Text>
                            <Button
                                size="small"
                                theme="borderless"
                                onClick={() => {
                                    refreshPlan();
                                    setPlanOpen(true);
                                }}
                            >
                                {t('chat.planDetails', null, 'Details')}
                            </Button>
                        </div>
                    )}
                    {lastEvents.length > 0 && !live && (
                        <Collapse className="chat-events-strip">
                            <Collapse.Panel itemKey="1" header={`${t('chat.rawEvents', null, 'Raw events of this turn')} · ${lastEvents.length}`}>
                                <pre className="chat-pre">
                                    {lastEvents.map((event, index) => `${index + 1}. ${JSON.stringify(event)}`).join('\n')}
                                </pre>
                            </Collapse.Panel>
                        </Collapse>
                    )}
                    <HitlDock
                        items={hitlPending}
                        readOnly={!canDecideHitl}
                        busyId={hitlBusy}
                        onRefresh={refreshHitl}
                        onDecide={decideHitl}
                        onDismiss={dismissHitl}
                    />
                    <Composer
                        value={draft}
                        onChange={setDraft}
                        onSend={submit}
                        onStop={stop}
                        canStop={canStop}
                        sending={sending || backgroundRunning}
                        checkingRun={checkingRun || projectSaving || model.waitingForChannel}
                        canWrite={canWrite}
                        canExecute={canExecute}
                        mode={mode}
                        onModeChange={value => setStoredMode(AGENT_MODES.includes(value) ? value : 'single')}
                        projectId={conversationId ? conversation?.projectId || '' : newProjectId}
                        onProjectChange={changeProject}
                        onCreateProject={canCreateProject && canWrite && !projectsResource.loading
                            ? () => setProjectFormOpen(true) : undefined}
                        projects={projects}
                        projectDisabled={projectsResource.loading || Boolean(conversationId && (detail.loading || !conversation || detail.error))}
                        role={role}
                        onRoleChange={changeRole}
                        roles={roles}
                        roleDisabled={!roleResolved}
                        model={model}
                        canReadConfig={canReadConfig}
                        onOpenHitl={canReadHitl ? () => setHitlOpen(true) : undefined}
                        attachments={attachments}
                        onPickFiles={uploadFiles}
                        onRemoveAttachment={removeAttachment}
                        uploading={attachments.filter(item => item.uploading).length}
                    />
                </div>
            </section>
            {projectFormOpen && (
                <ProjectFormModal
                    visible
                    onCancel={() => setProjectFormOpen(false)}
                    onSaved={handleProjectCreated}
                />
            )}
            {hitlOpen && canReadHitl && (
                <ChatSettings
                    key={conversationId}
                    onClose={() => setHitlOpen(false)}
                    narrow={narrow}
                    canEnableHitl={canDecideHitl}
                    conversationId={conversationId}
                    draftHitl={!conversationId ? draftHitl : null}
                    onDraftHitlChange={setDraftHitl}
                />
            )}
            <SideSheet
                visible={narrow && sidebarOpen}
                placement="left"
                width={300}
                onCancel={() => setSidebarOpen(false)}
                title={t('chat.conversations', null, 'Conversations')}
                bodyStyle={{ padding: 0 }}
            >
                {sidebar}
            </SideSheet>
            <PlanTasksSheet
                visible={planOpen}
                onClose={() => setPlanOpen(false)}
                plan={plan}
                loading={planLoading}
                onRefresh={refreshPlan}
            />
        </div>
    );
}

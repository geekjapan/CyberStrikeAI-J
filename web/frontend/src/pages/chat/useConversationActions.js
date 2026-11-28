/** Conversation-level write actions: create, rename, pin, delete, bulk delete, delete a turn. */
import { useCallback } from 'react';
import { api } from '../../lib/http';
import { confirmAction, toastError, toastSuccess, toastWarning } from '../../components/ui';

export function useConversationActions({
    t,
    conversationRef,
    newProjectId,
    canWrite,
    reloadList,
    requestDetailReload,
    navigate,
    onSelectionCleared
}) {
    const createConversation = useCallback(async () => {
        if (!canWrite) return;
        try {
            const payload = await api.post('/conversations', {
                title: t('chat.newChat', null, 'New chat'),
                projectId: newProjectId || undefined
            });
            const id = payload?.id;
            reloadList();
            if (id) navigate({ conversation: id });
            toastSuccess(t('chat.created', null, 'Conversation created'));
        } catch (error) {
            toastError(error, t('chat.createFailed', null, 'Failed to create conversation'));
        }
    }, [canWrite, navigate, newProjectId, reloadList, t]);

    const renameConversation = useCallback(async (id, title) => {
        try {
            await api.put(`/conversations/${encodeURIComponent(id)}`, { title });
            toastSuccess(t('chat.renamed', null, 'Renamed'));
            reloadList();
            if (id === conversationRef.current) requestDetailReload(id, { silent: true });
        } catch (error) {
            toastError(error, t('chat.renameFailed', null, 'Rename failed'));
        }
    }, [conversationRef, reloadList, requestDetailReload, t]);

    const togglePin = useCallback(async item => {
        try {
            await api.put(`/conversations/${encodeURIComponent(item.id)}/pinned`, { pinned: !item.pinned });
            reloadList();
        } catch (error) {
            toastError(error, t('chat.pinFailed', null, 'Failed to change the pin'));
        }
    }, [reloadList, t]);

    const deleteConversation = useCallback(async item => {
        try {
            await api.del(`/conversations/${encodeURIComponent(item.id)}`);
            toastSuccess(t('chat.deleted', null, 'Conversation deleted'));
            if (item.id === conversationRef.current) {
                onSelectionCleared();
                navigate({}, { replace: true });
            }
            reloadList();
        } catch (error) {
            toastError(error, t('chat.deleteFailed', null, 'Failed to delete conversation'));
        }
    }, [conversationRef, navigate, onSelectionCleared, reloadList, t]);

    const batchDelete = useCallback(async ids => {
        const results = await Promise.allSettled(ids.map(id => api.del(`/conversations/${encodeURIComponent(id)}`)));
        const failed = results.filter(result => result.status === 'rejected').length;
        if (failed) toastWarning(t('chat.batchDeletePartial', { failed }, '{{failed}} conversations could not be deleted'));
        else toastSuccess(t('chat.batchDeleted', { count: ids.length }, 'Deleted {{count}} conversations'));
        if (ids.includes(conversationRef.current)) {
            onSelectionCleared();
            navigate({}, { replace: true });
        }
        reloadList();
    }, [conversationRef, navigate, onSelectionCleared, reloadList, t]);

    const deleteTurn = useCallback(message => {
        const id = conversationRef.current;
        if (!id || !message?.id) return;
        confirmAction({
            title: t('chat.deleteTurnTitle', null, 'Delete this turn'),
            content: t('chat.deleteTurnConfirm', null, 'Delete this entire turn (user message and assistant reply)? This cannot be undone. The next reply will use only the remaining messages; saved context snapshots will be cleared.'),
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    await api.post(`/conversations/${encodeURIComponent(id)}/delete-turn`, { messageId: message.id });
                    toastSuccess(t('chat.turnDeleted', null, 'Turn deleted'));
                    await requestDetailReload(id, { silent: true });
                    reloadList();
                } catch (error) {
                    toastError(error, t('chat.deleteTurnFailed', null, 'Failed to delete turn'));
                }
            }
        });
    }, [conversationRef, reloadList, requestDetailReload, t]);

    return { createConversation, renameConversation, togglePin, deleteConversation, batchDelete, deleteTurn };
}

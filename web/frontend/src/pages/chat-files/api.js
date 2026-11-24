/**
 * Conversation attachment (chat_uploads) API wrapper: list, upload, directory, content, download, export and path resolution.
 */
import { api, downloadFile } from '../../lib/http';

export function listFiles(query) {
    return api.get('/chat-uploads', query);
}

export function uploadFile(file, { relativeDir } = {}) {
    const form = new FormData();
    form.append('file', file, file.name);
    if (relativeDir) form.append('relativeDir', relativeDir);
    return api.post('/chat-uploads', form);
}

export function makeDirectory(parent, name) {
    return api.post('/chat-uploads/mkdir', { parent: parent || '', name });
}

export function deleteFile(path) {
    return api.del('/chat-uploads', { body: { path } });
}

export function getContent(path) {
    return api.get('/chat-uploads/content', { path });
}

export function resolvePath(path, kind = 'file') {
    return api.get('/chat-uploads/path', { path, kind });
}

export function exportFiles(query) {
    return downloadFile('/chat-uploads/export', { query, filename: 'chat-files-export.zip' });
}

export function downloadFileByPath(path, filename) {
    return downloadFile('/chat-uploads/download', { query: { path }, filename });
}

/** Fetch binary content (for image preview) and return an objectURL; the caller must revoke it. */
export async function fetchBlobUrl(path) {
    const response = await api.raw('/chat-uploads/download', { query: { path }, timeout: 120000 });
    const blob = await response.blob();
    return { url: URL.createObjectURL(blob), type: blob.type, size: blob.size };
}

/**
 * WebShell page API wrapper: connection management, state persistence, command execution, file operations and AI history.
 * All requests go through the shared http layer and never use fetch directly.
 */
import { api } from '../../lib/http';

/** Mask the backend returns in place of a password; submitting it back unchanged means "keep the original password". */
export const MASKED_SECRET = '********';

export function listConnections(query) {
    return api.get('/webshell/connections', query);
}

export function createConnection(body) {
    return api.post('/webshell/connections', body);
}

export function updateConnection(id, body) {
    return api.put(`/webshell/connections/${encodeURIComponent(id)}`, body);
}

export function deleteConnection(id) {
    return api.del(`/webshell/connections/${encodeURIComponent(id)}`);
}

export function getConnectionState(id) {
    return api.get(`/webshell/connections/${encodeURIComponent(id)}/state`);
}

export function saveConnectionState(id, state) {
    return api.put(`/webshell/connections/${encodeURIComponent(id)}/state`, { state });
}

export function execCommand({ connection, command }) {
    return api.post('/webshell/exec', {
        connection_id: connection.id,
        url: connection.url,
        type: connection.type || 'php',
        method: (connection.method || 'post').toLowerCase(),
        cmd_param: connection.cmdParam || '',
        encoding: connection.encoding || 'auto',
        os: connection.os || 'auto',
        command
    });
}

export function fileOp({ connection, action, path, targetPath, content, chunkIndex }) {
    const body = {
        connection_id: connection.id,
        url: connection.url,
        type: connection.type || 'php',
        method: (connection.method || 'post').toLowerCase(),
        cmd_param: connection.cmdParam || '',
        encoding: connection.encoding || 'auto',
        os: connection.os || 'auto',
        action
    };
    if (path !== undefined) body.path = path;
    if (targetPath !== undefined) body.target_path = targetPath;
    if (content !== undefined) body.content = content;
    if (chunkIndex !== undefined) body.chunk_index = chunkIndex;
    return api.post('/webshell/file', body);
}

export function listAiConversations(id) {
    return api.get(`/webshell/connections/${encodeURIComponent(id)}/ai-conversations`);
}

export function getAiHistory(id) {
    return api.get(`/webshell/connections/${encodeURIComponent(id)}/ai-history`);
}

export function getConversation(id) {
    return api.get(`/conversations/${encodeURIComponent(id)}`, { include_process_details: 0 });
}

export async function listProjects() {
    try {
        const payload = await api.get('/projects', { limit: 200 });
        return Array.isArray(payload?.projects) ? payload.projects : [];
    } catch (error) {
        return [];
    }
}

/** Liveness token: a random string so a fixed echo is not misjudged by outer wrappers. */
export function probeToken() {
    return `__CSAI_PROBE_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}__`;
}

/** Decide whether the connection is usable with a single echo. */
export async function probeConnection(connection) {
    const token = probeToken();
    const result = await execCommand({ connection, command: `echo ${token}` });
    const ok = Boolean(result?.ok) && String(result?.output || '').includes(token);
    return { ok, output: result?.output || '', error: result?.error || '' };
}

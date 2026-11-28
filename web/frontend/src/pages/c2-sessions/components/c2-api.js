/**
 * API layer shared by the six C2 pages: listeners, sessions, tasks, payloads, events, traffic disguise.
 */
import { api, downloadFile } from '../../../lib/http';

const enc = encodeURIComponent;

/* ------------------------------ listeners ------------------------------ */
export const listListeners = query => api.get('/c2/listeners', query);
export const getListener = id => api.get(`/c2/listeners/${enc(id)}`);
export const createListener = body => api.post('/c2/listeners', body);
export const updateListener = (id, body) => api.put(`/c2/listeners/${enc(id)}`, body);
export const deleteListener = id => api.del(`/c2/listeners/${enc(id)}`);
export const startListener = id => api.post(`/c2/listeners/${enc(id)}/start`, {});
export const stopListener = id => api.post(`/c2/listeners/${enc(id)}/stop`, {});

/* ------------------------------ sessions ------------------------------ */
export const listSessions = query => api.get('/c2/sessions', query);
export const getSession = id => api.get(`/c2/sessions/${enc(id)}`);
export const deleteSession = id => api.del(`/c2/sessions/${enc(id)}`);
export const deleteSessions = ids => api.del('/c2/sessions', { body: { ids } });
export const setSessionSleep = (id, { sleepSeconds, jitterPercent }) =>
    api.put(`/c2/sessions/${enc(id)}/sleep`, { sleep_seconds: sleepSeconds, jitter_percent: jitterPercent });
export const setSessionNote = (id, note) => api.put(`/c2/sessions/${enc(id)}/note`, { note });

/* ------------------------------ tasks ------------------------------ */
export const listTasks = query => api.get('/c2/tasks', query);
export const getTask = id => api.get(`/c2/tasks/${enc(id)}`);
export const createTask = body => api.post('/c2/tasks', body);
export const createSessionTask = (sessionId, body) => api.post(`/c2/sessions/${enc(sessionId)}/tasks`, body);
export const cancelTask = id => api.post(`/c2/tasks/${enc(id)}/cancel`, {});
export const waitTask = (id, timeout = 30) => api.get(`/c2/tasks/${enc(id)}/wait`, { timeout }, { timeout: (timeout + 10) * 1000 });
export const deleteTasks = ids => api.del('/c2/tasks', { body: { ids } });
export const downloadTaskResult = (id, filename) => downloadFile(`/c2/tasks/${enc(id)}/result-file`, { filename });

/* ------------------------------ payloads ------------------------------ */
export const buildOneliner = body => api.post('/c2/payloads/oneliner', body);
export const buildPayload = body => api.post('/c2/payloads/build', body);
export const downloadPayload = (id, filename) => downloadFile(`/c2/payloads/${enc(id)}/download`, { filename });

/* ------------------------------ events ------------------------------ */
export const listEvents = query => api.get('/c2/events', query);
export const deleteEvents = ids => api.del('/c2/events', { body: { ids } });

/* ------------------------------ traffic disguise ------------------------------ */
export const listProfiles = () => api.get('/c2/profiles');
export const getProfile = id => api.get(`/c2/profiles/${enc(id)}`);
export const createProfile = body => api.post('/c2/profiles', body);
export const updateProfile = (id, body) => api.put(`/c2/profiles/${enc(id)}`, body);
export const deleteProfile = id => api.del(`/c2/profiles/${enc(id)}`);

/* ------------------------------ projects ------------------------------ */
export async function listProjects() {
    try {
        const payload = await api.get('/projects', { limit: 200 });
        return Array.isArray(payload?.projects) ? payload.projects : [];
    } catch (error) {
        return [];
    }
}

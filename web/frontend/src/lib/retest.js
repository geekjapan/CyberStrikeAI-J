/**
 * Cross-page handoff for vulnerability retests: after the vulnerability page creates a branch it writes a pending prompt;
 * the chat page takes it and sends it automatically when it loads that branch; sessionStorage lets it survive a refresh.
 */
export const RETEST_AUTOSEND_KEY = 'csai-retest-autosend';

function readEntry() {
    try {
        const raw = sessionStorage.getItem(RETEST_AUTOSEND_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

export function queueRetestAutosend(conversationId, prompt) {
    try {
        sessionStorage.setItem(RETEST_AUTOSEND_KEY, JSON.stringify({
            conversationId: String(conversationId || ''),
            prompt: String(prompt || '')
        }));
    } catch (error) { /* storage unavailable */ }
}

export function peekRetestAutosend(conversationId) {
    const entry = readEntry();
    return entry && entry.conversationId === conversationId ? entry : null;
}

export function consumeRetestAutosend(conversationId) {
    if (!peekRetestAutosend(conversationId)) return;
    try {
        sessionStorage.removeItem(RETEST_AUTOSEND_KEY);
    } catch (error) { /* storage unavailable */ }
}

// Send one message and require an assistant reply without an error.
// Needs a reachable model: see features/chat.md.  With the default launch
// (no model) this journey is expected to FAIL at the last check.
export default async ({ page, expect, shot, api, base }) => {
    const text = `Reply with the single word pong. (${Date.now()})`;
    await page.goto(`${base}/#/chat`);
    await page.getByRole('textbox', { name: 'Message' }).fill(text);
    // The run is over when the server closes the event stream; this does not depend on UI wording.
    const stream = page.waitForResponse(r => r.url().includes('/api/agent/stream'));
    await page.getByRole('button', { name: 'Send' }).click();
    const bubbles = page.locator('.chat-bubble');
    await expect(bubbles.first()).toContainText(text);
    await shot('sent');

    const body = await api('/api/conversations');
    const stored = body.conversations.find(c => c.title.startsWith('Reply with the single word pong'));
    if (!stored) throw new Error('message is on screen but no conversation in GET /api/conversations');

    await (await stream).finished();
    const reply = bubbles.nth(1);
    await expect(reply).toBeVisible();
    await page.waitForLoadState('networkidle');
    await shot('reply');
    const replyText = (await reply.innerText()).trim();
    const liveError = await page.locator('.chat-live-error').allTextContents();
    if (liveError.length || replyText.includes('❌')) {
        throw new Error(`assistant run failed: ${(liveError[0] || replyText.split('❌')[1]).trim().slice(0, 300)}`);
    }
    return { conversation: stored.id, reply: replyText.slice(-300) };
};

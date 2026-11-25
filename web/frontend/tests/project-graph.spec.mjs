import { test, expect, ready, PROJECT, UI_PERMISSIONS } from './fixtures.mjs';

const graphPath = `/api/projects/${PROJECT.id}/fact-graph`;

function makeNodes(type, count, title) {
    return Array.from({ length: count }, (_, index) => {
        const key = type === 'vulnerability' ? `vuln:sample-${index}` : `${type}/sample-${index}`;
        const name = `${title} ${index + 1}`;
        return { id: key, fact_key: key, type, category: type, label: name, summary: name, confidence: 'confirmed' };
    });
}

function denseGraph() {
    const targets = makeNodes('target', 18, 'Sample entry point');
    const infra = makeNodes('infra', 15, 'Environment and service records');
    const findings = makeNodes('finding', 47, 'Long-title anonymous finding with related fact description');
    const chains = makeNodes('chain', 16, 'Related fact chain branch');
    const vulns = makeNodes('vulnerability', 31, 'Related issue');
    const edges = [];
    const link = (source, target, type, confidence = 'confirmed') => {
        edges.push({ id: `example-${edges.length}`, source: source.id, target: target.id, type, confidence });
    };
    infra.forEach((node, i) => link(targets[i], node, 'depends_on'));
    findings.forEach((node, i) => link(targets[i % targets.length], node, 'discovered_on', 'tentative'));
    chains.forEach((node, i) => link(findings[i + 1], node, 'leads_to'));
    vulns.forEach((node, i) => link(findings[i], node, 'links_vuln'));
    for (let i = 0; i < 32; i++) link(findings[i + 1], targets[(i + 2) % targets.length], 'depends_on');
    return { nodes: [...targets, ...infra, ...findings, ...chains, ...vulns], edges };
}

test('project graph: readable fit, full overview previews and search work with a dense graph', async ({ page, mockApi }, testInfo) => {
    const graph = denseGraph();
    const selected = graph.nodes.find(node => node.id === 'finding/sample-0');
    const detail = { ...selected, body: 'Anonymous fact body used to verify the detail entry point.' };
    graph.nodes.find(node => node.type === 'chain').summary += ` (see ${selected.fact_key})`;
    mockApi.respond('GET', graphPath, { json: graph });
    mockApi.respond('GET', `/api/projects/${PROJECT.id}/facts`, { json: detail });
    await page.goto(`/static/app/#/projects?id=${PROJECT.id}&tab=graph`);
    const main = await ready(page);
    const canvas = main.getByRole('group', { name: 'Attack path canvas' });
    const labels = canvas.getByRole('button');
    await expect(labels.first()).toBeVisible();
    await expect(main.getByText('Nodes: 127 | Edges: 141', { exact: true })).toBeVisible();

    const reads = mockApi.calls('GET', graphPath).length;
    const fit = main.getByRole('button', { name: 'Fit to canvas' });
    const summaryCard = canvas.locator('.graph-node--detail').filter({ hasText: /^Finding/ }).first();
    await expect(fit).toHaveAttribute('aria-pressed', 'true');
    await expect(summaryCard.locator('.graph-node-title')).toHaveCSS('font-size', '15px');

    const overview = main.getByRole('button', { name: 'Full overview', exact: true });
    await overview.click();
    await expect(overview).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.locator('.graph-node--compact').first()).toBeVisible();
    const boxes = await labels.evaluateAll(items => items.map(item => {
        const { left, top, right, bottom } = item.getBoundingClientRect();
        return { left, top, right, bottom, fontSize: getComputedStyle(item).fontSize };
    }));
    expect(boxes.length).toBeGreaterThan(4);
    expect(boxes.length).toBeLessThanOrEqual(graph.nodes.length);
    for (const [index, box] of boxes.entries()) {
        expect(box.fontSize).toBe('14px');
        for (const other of boxes.slice(index + 1)) {
            expect(box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top).toBe(false);
        }
    }
    await expect(canvas.getByRole('button', { name: selected.label, exact: true })).toHaveCount(0);
    await canvas.scrollIntoViewIfNeeded();
    const point = await canvas.locator('.project-graph-canvas').evaluate((element, id) => {
        const { x, y } = element._cyreg.cy.$id(id).renderedPosition();
        const bounds = element.getBoundingClientRect();
        return { x: bounds.left + x, y: bounds.top + y };
    }, selected.id);
    await page.mouse.move(point.x, point.y);
    const preview = canvas.getByRole('tooltip');
    await expect(preview.getByText(selected.label, { exact: true })).toBeVisible();
    await expect(preview.getByText(selected.fact_key, { exact: true })).toBeVisible();
    await main.locator('.project-graph-card').screenshot({ path: testInfo.outputPath('project-graph-overview.png') });

    await fit.click();
    await expect(fit).toHaveAttribute('aria-pressed', 'true');
    await expect(preview).toHaveCount(0);
    await expect(summaryCard.locator('.graph-node-title')).toHaveCSS('font-size', '15px');
    await main.locator('.project-graph-card').screenshot({ path: testInfo.outputPath('project-graph-readable-fit.png') });

    await canvas.scrollIntoViewIfNeeded();
    const anchor = canvas.getByRole('button', { name: 'Sample entry point 1', exact: true });
    const beforeDrag = await anchor.boundingBox();
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + 12, bounds.y + 12);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 72, bounds.y + 28, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await anchor.boundingBox()).x).toBeGreaterThan(beforeDrag.x + 30);

    const search = main.getByRole('textbox', { name: 'Search nodes' });
    await search.fill('Non-matching node');
    await expect(main.getByText('No matching nodes')).toBeVisible();
    await search.fill(selected.fact_key);
    const result = main.locator('.project-graph-search-results').getByRole('button', { name: new RegExp(selected.label) });
    await expect(result).toBeVisible();
    await result.click();

    const side = main.getByRole('complementary', { name: 'Node details' });
    await expect(side.getByText(selected.fact_key)).toBeVisible();
    await expect(main.getByText('Direct connections · Nodes: 3 | Edges: 2')).toBeVisible();
    await expect(side.getByText('← Incoming', { exact: true })).toBeVisible();
    await expect(side.getByText('→ Outgoing', { exact: true })).toBeVisible();
    const selectedCard = canvas.getByRole('button', { name: selected.label });
    await expect(selectedCard).toHaveAttribute('aria-pressed', 'true');
    await expect(selectedCard.getByText('Finding', { exact: true })).toHaveCSS('font-size', '12px');
    const summary = selectedCard.getByText(selected.label, { exact: true });
    await expect(summary).toHaveCSS('font-size', '15px');
    await expect(selectedCard.getByText(selected.fact_key, { exact: true })).toBeVisible();
    await main.locator('.project-graph-card').screenshot({ path: testInfo.outputPath('project-graph-focus.png') });

    const beforeZoom = await selectedCard.boundingBox();
    await selectedCard.hover();
    await page.mouse.wheel(0, -150);
    await expect.poll(async () => (await selectedCard.boundingBox()).width).toBeGreaterThan(beforeZoom.width);
    await expect.poll(() => summary.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(15);

    await side.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.getByText(detail.body)).toBeVisible();
    await page.locator('.semi-sidesheet').getByRole('button', { name: 'Close', exact: true }).click();

    await side.getByRole('button', { name: 'Related issue 1', exact: true }).click();
    await expect(side.getByText('vuln:sample-0')).toBeVisible();
    await expect(side.getByRole('button', { name: 'Details', exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'Back to overview' }).click();
    await expect(side).toHaveCount(0);

    // The fact key takes precedence over a different node whose summary mentions it.
    await search.fill(selected.fact_key);
    await search.press('Enter');
    await expect(side.getByText(selected.fact_key, { exact: true })).toBeVisible();
    expect(mockApi.calls('GET', graphPath)).toHaveLength(reads);
    expect(mockApi.writes()).toEqual([]);
});

test.describe('project graph on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, appPermissions: UI_PERMISSIONS.filter(value => value !== 'project:write') });

    test('zoom controls, keyboard search, filters and read-only relationship list work in dark mode', async ({ page, mockApi }, testInfo) => {
        const target = makeNodes('target', 1, 'Mobile entry point')[0];
        const finding = makeNodes('finding', 1, 'Mobile finding')[0];
        const prior = { ...makeNodes('note', 1, 'Historical node')[0], confidence: 'deprecated' };
        const edge = { id: 'mobile-edge', source: finding.id, target: target.id, type: 'depends_on', confidence: 'tentative' };
        mockApi.respond('GET', graphPath, (_, url) => ({
            json: {
                nodes: url.searchParams.get('view') === 'full' && url.searchParams.get('exclude_deprecated') === '0'
                    ? [target, finding, prior] : [target, finding],
                edges: [edge]
            }
        }));
        mockApi.respond('GET', `/api/projects/${PROJECT.id}/fact-edges`, { json: [{
            id: edge.id, source_fact_key: edge.source, target_fact_key: edge.target, edge_type: edge.type, confidence: edge.confidence
        }] });
        await page.addInitScript(() => localStorage.setItem('cyberstrike-theme', 'dark'));
        await page.goto(`/static/app/#/projects?id=${PROJECT.id}&tab=graph`);
        const main = await ready(page);
        const card = main.locator('.project-graph-card');
        const canvas = card.getByRole('group', { name: 'Attack path canvas' });
        await expect(canvas.getByRole('button', { name: target.label })).toBeVisible();
        await card.getByRole('button', { name: 'Zoom in', exact: true }).click();
        await card.getByRole('button', { name: 'Zoom out', exact: true }).click();
        await card.getByRole('button', { name: 'Fit to canvas' }).click();

        const search = card.getByRole('textbox', { name: 'Search nodes' });
        await search.fill(finding.id);
        await search.press('Enter');
        const side = card.getByRole('complementary', { name: 'Node details' });
        await expect(side.getByRole('button', { name: 'Edit' })).toBeDisabled();
        await expect(side.getByText('→ Outgoing')).toBeVisible();
        expect(await card.evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(await card.evaluate(node => node.clientWidth) + 1);
        await card.screenshot({ path: testInfo.outputPath('project-graph-mobile-dark.png') });

        await card.locator('.semi-select').click();
        await page.getByRole('option', { name: 'Full graph' }).click();
        await card.getByText('Hide deprecated', { exact: true }).click();
        await expect(card.getByText('Nodes: 3 | Edges: 1', { exact: true })).toBeVisible();
        await expect(side).toHaveCount(0);
        await card.getByRole('button', { name: 'Links', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Delete' })).toBeDisabled();
        expect(mockApi.writes()).toEqual([]);
    });
});

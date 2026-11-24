/** Shared display mappings for the MCP management page. */
import { translate } from '../../lib/i18n';

export const CONNECTION_STATUS = {
    connected: { color: 'green', get label() { return translate('ui.mcpUtils.connected', null, 'Connected'); } },
    connecting: { color: 'blue', get label() { return translate('ui.mcpUtils.connecting', null, 'Connecting'); } },
    disconnected: { color: 'amber', get label() { return translate('ui.mcpUtils.disconnected', null, 'Disconnected'); } },
    disabled: { color: 'grey', get label() { return translate('ui.mcpUtils.disabled', null, 'Disabled'); } },
    error: { color: 'red', get label() { return translate('ui.mcpUtils.error', null, 'Connection failed'); } }
};

export function connectionMeta(status) {
    return CONNECTION_STATUS[String(status || '').toLowerCase()] || { color: 'grey', label: status || translate('ui.mcpUtils.unknown', null, 'Unknown') };
}

export function transportOf(config) {
    if (!config) return 'http';
    return String(config.type || config.transport || (config.command ? 'stdio' : 'http')).toLowerCase();
}

export function toolKeyOf(tool) {
    if (!tool) return '';
    if (tool.is_external && tool.external_mcp) return `${tool.external_mcp}::${tool.name}`;
    return tool.name || '';
}

export function sourceLabel(tool) {
    if (!tool) return '—';
    return tool.is_external
        ? translate('ui.mcpUtils.sourceExternal', { name: tool.external_mcp || translate('ui.mcpUtils.unknown', null, 'External · {{name}}') }, 'Unknown')
        : translate('ui.mcpUtils.sourceBuiltin', null, 'Built-in');
}

export function parseToolListInput(text) {
    return String(text || '')
        .split(/[\n,;]/)
        .map(item => item.trim())
        .filter(Boolean);
}

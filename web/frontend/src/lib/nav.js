/**
 * Navigation config: id is the route segment (#/<id>) and matches the backend page and permission keys.
 */
import {
    IconArticle, IconBolt, IconBook, IconBranch, IconBriefcase, IconCheckList,
    IconComment, IconFlag, IconFolder, IconHome, IconLock, IconPuzzle,
    IconServer, IconSetting, IconShield, IconTerminal, IconUser, IconUserGroup
} from '@douyinfe/semi-icons';

export const NAV_TREE = [
    { id: 'dashboard', i18n: 'nav.dashboard', fallback: 'Dashboard', icon: IconHome },
    { id: 'chat', i18n: 'nav.chat', fallback: 'Chat', icon: IconComment },
    {
        id: 'security', i18n: 'nav.security', fallback: 'Security', icon: IconShield,
        anyPermission: ['hitl:read', 'config:read'],
        children: [
            { id: 'hitl', i18n: 'nav.hitl', fallback: 'Human-in-the-loop', permission: 'hitl:read' },
            { id: 'tool-guard', i18n: 'nav.toolGuard', fallback: 'Call blocking', permission: 'config:read' }
        ]
    },
    { id: 'projects', i18n: 'nav.projects', fallback: 'Projects', icon: IconBriefcase },
    {
        id: 'assets', i18n: 'nav.assets', fallback: 'Asset Management', icon: IconFlag,
        anyPermission: ['asset:read', 'fofa:execute'],
        children: [
            { id: 'asset-overview', i18n: 'nav.assetOverview', fallback: 'Asset Overview' },
            { id: 'asset-library', i18n: 'nav.assetLibrary', fallback: 'Asset Library' },
            { id: 'info-collect', i18n: 'nav.infoCollect', fallback: 'Recon' }
        ]
    },
    { id: 'vulnerabilities', i18n: 'nav.vulnerabilities', fallback: 'Vulnerabilities', icon: IconShield },
    { id: 'tasks', i18n: 'nav.tasks', fallback: 'Tasks', icon: IconCheckList },
    { id: 'workflows', i18n: 'nav.workflows', fallback: 'Workflows', icon: IconBranch },
    { id: 'webshell', i18n: 'nav.webshell', fallback: 'WebShell Management', icon: IconTerminal },
    {
        id: 'c2', i18n: 'nav.c2', fallback: 'C2', icon: IconBolt,
        children: [
            { id: 'c2-listeners', i18n: 'nav.c2Listeners', fallback: 'Listeners' },
            { id: 'c2-sessions', i18n: 'nav.c2Sessions', fallback: 'Sessions' },
            { id: 'c2-tasks', i18n: 'nav.c2Tasks', fallback: 'Tasks' },
            { id: 'c2-payloads', i18n: 'nav.c2Payloads', fallback: 'Payload' },
            { id: 'c2-events', i18n: 'nav.c2Events', fallback: 'Events' },
            { id: 'c2-profiles', i18n: 'nav.c2Profiles', fallback: 'Traffic profiles' }
        ]
    },
    { id: 'chat-files', i18n: 'nav.chatFiles', fallback: 'File Management', icon: IconFolder },
    {
        id: 'mcp', i18n: 'nav.mcp', fallback: 'MCP', icon: IconServer,
        children: [
            { id: 'mcp-monitor', i18n: 'nav.mcpMonitor', fallback: 'MCP Monitor' },
            { id: 'mcp-management', i18n: 'nav.mcpManagement', fallback: 'MCP Management' }
        ]
    },
    {
        id: 'knowledge', i18n: 'nav.knowledge', fallback: 'Knowledge', icon: IconBook,
        children: [
            { id: 'knowledge-retrieval-logs', i18n: 'nav.knowledgeRetrievalLogs', fallback: 'Retrieval history' },
            { id: 'knowledge-management', i18n: 'nav.knowledgeManagement', fallback: 'Knowledge Management' }
        ]
    },
    {
        id: 'skills', i18n: 'nav.skills', fallback: 'Skills', icon: IconPuzzle,
        children: [
            { id: 'skills-monitor', i18n: 'nav.skillsMonitor', fallback: 'Skills monitor' },
            { id: 'skills-management', i18n: 'nav.skillsManagement', fallback: 'Skills Management' }
        ]
    },
    {
        id: 'agents', i18n: 'nav.agents', fallback: 'Agents', icon: IconUserGroup,
        children: [
            { id: 'agents-management', i18n: 'nav.agentsManagement', fallback: 'Agent management' }
        ]
    },
    {
        id: 'roles', i18n: 'nav.roles', fallback: 'Roles', icon: IconUser,
        children: [
            { id: 'roles-management', i18n: 'nav.rolesManagement', fallback: 'Roles Management' }
        ]
    },
    { id: 'platform-rbac', i18n: 'nav.platformRbac', fallback: 'Platform Access', icon: IconLock },
    { id: 'settings', i18n: 'nav.settings', fallback: 'System settings', icon: IconSetting },
    { id: 'api-docs', i18n: 'apiDocs.title', fallback: 'API Docs', icon: IconArticle }
];

export const NAV_SECTIONS = [
    { id: 'workspace', i18n: 'nav.groupWorkspace', fallback: 'Workspace', pages: ['dashboard', 'chat', 'security'] },
    { id: 'operations', i18n: 'nav.groupOperations', fallback: 'Operations', pages: ['projects', 'assets', 'vulnerabilities', 'tasks', 'workflows', 'webshell', 'c2', 'chat-files'] },
    { id: 'capabilities', i18n: 'nav.groupCapabilities', fallback: 'Capabilities', pages: ['mcp', 'knowledge', 'skills', 'agents', 'roles'] },
    { id: 'platform', i18n: 'nav.groupPlatform', fallback: 'Platform', pages: ['platform-rbac', 'settings', 'api-docs'] }
];

/** Flat tab list, used for title resolution and nav highlighting. */
export const NAV_PAGES = NAV_TREE.flatMap(item => (item.children ? item.children.map(child => ({ ...child, parent: item.id })) : [item]));

export function findPage(id) {
    return NAV_PAGES.find(item => item.id === id) || NAV_TREE.find(item => item.id === id) || null;
}

export const DEFAULT_PAGE = 'dashboard';

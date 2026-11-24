import { useMemo, useState } from 'react';
import {
    Button, Checkbox, Form, Input, Space, Tabs, Tag, Typography
} from '@douyinfe/semi-ui';
import { IconDelete, IconEdit, IconPlus, IconRefresh } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import {
    Drawer, DataTable, ErrorBanner, PageHeader, SectionCard, confirmAction, toastError, toastSuccess
} from '../../components/ui';

import ResourceGrant from './ResourceGrant';
import { formatDateTime } from '../../lib/format';

const { Text } = Typography;

function PermissionPicker({ value = [], options, onChange }) {
    const groups = useMemo(() => {
        const map = new Map();
        options.forEach(key => {
            const [resource] = key.split(':');
            if (!map.has(resource)) map.set(resource, []);
            map.get(resource).push(key);
        });
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [options]);
    return (
        <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 12 }}>
            {groups.map(([resource, keys]) => (
                <div key={resource} style={{ marginBottom: 10 }}>
                    <Text type="tertiary" style={{ fontSize: 12, textTransform: 'uppercase' }}>{resource}</Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                        {keys.map(key => (
                            <Checkbox
                                key={key}
                                checked={value.includes(key)}
                                onChange={event => {
                                    const next = new Set(value);
                                    if (event.target.checked) next.add(key);
                                    else next.delete(key);
                                    onChange([...next]);
                                }}
                            >
                                {key.split(':')[1]}
                            </Checkbox>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function PlatformRbacPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('rbac:write');
    const [tab, setTab] = useState('roles');
    const [roleEditor, setRoleEditor] = useState(null);
    const [userEditor, setUserEditor] = useState(null);
    const [grantOpen, setGrantOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const metadata = useResource(() => api.get('/rbac/metadata'), []);
    const roles = useResource(() => api.get('/rbac/roles'), []);
    const users = useResource(() => api.get('/rbac/users'), []);
    const assignments = useResource(() => api.get('/rbac/resource-assignments'), []);

    const permissionKeys = metadata.data?.permissions ? Object.keys(metadata.data.permissions) : [];
    const roleRows = Array.isArray(roles.data?.roles) ? roles.data.roles : [];
    const userRows = Array.isArray(users.data?.users) ? users.data.users : [];
    const assignmentRows = Array.isArray(assignments.data?.assignments) ? assignments.data.assignments : [];
    const roleOptions = roleRows.map(role => ({ value: role.id, label: role.name }));

    const roleNames = new Map(roleRows.map(role => [role.id, role.name]));
    const userNames = new Map(userRows.map(user => [user.id, user.display_name || user.username]));

    const saveRole = async () => {
        if (saving || !roleEditor?.form) return;
        const values = await roleEditor.form.validate().catch(() => null);
        if (!values) return;
        setSaving(true);
        try {
            const payload = {
                name: values.name.trim(),
                description: values.description || '',
                scope: values.scope || '',
                permissions: roleEditor.permissions || []
            };
            if (roleEditor.role?.id) await api.put(`/rbac/roles/${encodeURIComponent(roleEditor.role.id)}`, payload);
            else await api.post('/rbac/roles', payload);
            toastSuccess(t('ui.platformRbac.roleSaved', null, 'Role saved'));
            setRoleEditor(null);
            roles.reload();
            metadata.reload();
        } catch (error) {
            toastError(error, t('ui.platformRbac.roleSaveFailed', null, 'Failed to save role'));
        } finally {
            setSaving(false);
        }
    };

    const saveUser = async () => {
        if (saving || !userEditor?.form) return;
        const values = await userEditor.form.validate().catch(() => null);
        if (!values) return;
        setSaving(true);
        try {
            const payload = {
                display_name: values.display_name || '',
                enabled: values.enabled !== false,
                roles: values.roles || []
            };
            if (userEditor.user?.id) {
                if (values.password) payload.password = values.password;
                await api.put(`/rbac/users/${encodeURIComponent(userEditor.user.id)}`, payload);
            } else {
                await api.post('/rbac/users', { ...payload, username: values.username.trim(), password: values.password });
            }
            toastSuccess(t('ui.platformRbac.userSaved', null, 'User saved'));
            setUserEditor(null);
            users.reload();
        } catch (error) {
            toastError(error, t('ui.platformRbac.userSaveFailed', null, 'Failed to save user'));
        } finally {
            setSaving(false);
        }
    };

    const removeRole = role => confirmAction({
        title: t('ui.platformRbac.deleteRole', { name: role.name }, 'Delete role "{{name}}"?'),
        onOk: async () => {
            await api.del(`/rbac/roles/${encodeURIComponent(role.id)}`);
            toastSuccess(t('ui.platformRbac.deleted', null, 'Deleted'));
            roles.reload();
        }
    });

    const removeUser = user => confirmAction({
        title: t('ui.platformRbac.deleteUser', { username: user.username }, 'Delete user "{{username}}"?'),
        onOk: async () => {
            await api.del(`/rbac/users/${encodeURIComponent(user.id)}`);
            toastSuccess(t('ui.platformRbac.deleted', null, 'Deleted'));
            users.reload();
        }
    });

    const removeAssignment = row => confirmAction({
        title: t('ui.platformRbac.deleteGrant', null, 'Delete this resource grant?'),
        content: `${row.resourceType || ''} ${row.resourceId || ''}`,
        onOk: async () => {
            await api.del(`/rbac/resource-assignments/${encodeURIComponent(row.id)}`);
            toastSuccess(t('ui.platformRbac.deleted', null, 'Deleted'));
            assignments.reload();
        }
    });

    return (
        <div>
            <PageHeader
                title={t('auth.rbacTitle', null, 'Platform Access')}
                description={t('ui.platformRbac.description', null, 'Platform accounts, roles and resource grants. Roles determine API permission keys; resource grants determine the visible data scope.')}
                extra={<Button icon={<IconRefresh />} onClick={() => { roles.reload(); users.reload(); assignments.reload(); metadata.reload(); }}>{t('ui.platformRbac.refresh', null, 'Refresh')}</Button>}
            />
            <Tabs type="line" activeKey={tab} onChange={setTab}>
                <Tabs.TabPane itemKey="roles" tab={t('ui.platformRbac.roleTab', { count: roleRows.length }, 'Role permissions ({{count}})')}>
                    <SectionCard
                        extra={canWrite && <Button theme="solid" type="primary" icon={<IconPlus />} onClick={() => setRoleEditor({ role: null, permissions: [], form: {} })}>{t('ui.platformRbac.newRole', null, 'New role')}</Button>}
                    >
                        <ErrorBanner error={roles.error} onRetry={() => roles.reload()} />
                        <DataTable
                            columns={[
                                { title: t('ui.platformRbac.role', null, 'Role'), dataIndex: 'name', render: (value, record) => <Space vertical spacing={0} align="start"><Text strong>{value}</Text><Text type="tertiary">{record.description || '—'}</Text></Space> },
                                { title: t('ui.platformRbac.scope', null, 'Data scope'), dataIndex: 'scope', width: 130, render: value => (value ? <Tag size="small">{value}</Tag> : '—') },
                                { title: t('ui.platformRbac.permissionCount', null, 'Permissions'), dataIndex: 'permissions', width: 100, render: value => (Array.isArray(value) ? value.length : 0) },
                                { title: t('ui.platformRbac.builtIn', null, 'Built-in'), dataIndex: 'is_system', width: 100, render: value => (value ? <Tag size="small" color="blue">{t('ui.platformRbac.yes', null, 'Yes')}</Tag> : t('ui.platformRbac.no', null, 'No')) },
                                {
                                    title: t('ui.platformRbac.actions', null, 'Actions'), width: 160, render: (_, record) => (
                                        <Space>
                                            {canWrite && !record.is_system && <Button size="small" theme="borderless" icon={<IconEdit />} onClick={() => setRoleEditor({ role: record, permissions: record.permissions || [], form: {} })}>{t('ui.platformRbac.edit', null, 'Edit')}</Button>}
                                            {canWrite && !record.is_system && <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} onClick={() => removeRole(record)} />}
                                        </Space>
                                    )
                                }
                            ]}
                            dataSource={roleRows}
                            rowKey="id"
                            loading={roles.loading}
                            pagination={{ pageSize: 20 }}
                        />
                    </SectionCard>
                </Tabs.TabPane>
                <Tabs.TabPane itemKey="users" tab={t('ui.platformRbac.userTab', { count: userRows.length }, 'Platform users ({{count}})')}>
                    <SectionCard extra={canWrite && <Button theme="solid" type="primary" icon={<IconPlus />} onClick={() => setUserEditor({ user: null, form: {} })}>{t('ui.platformRbac.newUser', null, 'New user')}</Button>}>
                        <ErrorBanner error={users.error} onRetry={() => users.reload()} />
                        <DataTable
                            columns={[
                                { title: t('ui.platformRbac.username', null, 'Username'), dataIndex: 'username', render: (value, record) => <Space vertical spacing={0} align="start"><Text strong>{value}</Text><Text type="tertiary">{record.display_name || '—'}</Text></Space> },
                                { title: t('ui.platformRbac.role', null, 'Role'), dataIndex: 'roles', width: 260, render: value => (Array.isArray(value) && value.length ? <Space wrap spacing={4}>{value.map(role => <Tag size="small" key={role}>{roleNames.get(role) || role}</Tag>)}</Space> : '—') },
                                { title: t('ui.platformRbac.status', null, 'Status'), dataIndex: 'enabled', width: 100, render: value => (value === false ? <Tag size="small" color="grey">{t('ui.platformRbac.disabled', null, 'Disabled')}</Tag> : <Tag size="small" color="green">{t('ui.platformRbac.enabled', null, 'Enabled')}</Tag>) },
                                {
                                    title: t('ui.platformRbac.actions', null, 'Actions'), width: 160, render: (_, record) => (
                                        <Space>
                                            {canWrite && <Button size="small" theme="borderless" icon={<IconEdit />} onClick={() => setUserEditor({ user: record, form: {} })}>{t('ui.platformRbac.edit', null, 'Edit')}</Button>}
                                            {canWrite && <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} onClick={() => removeUser(record)} />}
                                        </Space>
                                    )
                                }
                            ]}
                            dataSource={userRows}
                            rowKey="id"
                            loading={users.loading}
                            pagination={{ pageSize: 20 }}
                        />
                    </SectionCard>
                </Tabs.TabPane>
                <Tabs.TabPane itemKey="assignments" tab={t('ui.platformRbac.grantTab', { count: assignmentRows.length }, 'Resource grants ({{count}})')}>
                    <SectionCard extra={canWrite && <Button theme="solid" icon={<IconPlus />} onClick={() => setGrantOpen(true)}>{t('ui.platformRbac.newGrant', null, 'Add resource grant')}</Button>}>
                        <ErrorBanner error={assignments.error} onRetry={() => assignments.reload()} />
                        <DataTable
                            columns={[
                                { title: t('ui.platformRbac.resourceType', null, 'Resource type'), dataIndex: 'resourceType', width: 140, render: value => value || '—' },
                                { title: t('ui.platformRbac.resource', null, 'Resource'), dataIndex: 'resourceId', render: (value, record) => record.resourceLabel || value || '—' },
                                { title: t('ui.platformRbac.user', null, 'User'), dataIndex: 'userId', render: value => userNames.get(value) || value || '—' },
                                { title: t('ui.platformRbac.createdAt', null, 'Created at'), dataIndex: 'createdAt', width: 180, render: value => formatDateTime(value) },
                                {
                                    title: t('ui.platformRbac.actions', null, 'Actions'), width: 100, render: (_, record) => (
                                        canWrite && <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} onClick={() => removeAssignment(record)} />
                                    )
                                }
                            ]}
                            dataSource={assignmentRows}
                            rowKey="id"
                            loading={assignments.loading}
                            pagination={{ pageSize: 20 }}
                        />
                    </SectionCard>
                </Tabs.TabPane>
            </Tabs>

            {canWrite && grantOpen && (
                <ResourceGrant users={userRows} onCancel={() => setGrantOpen(false)} onSaved={() => {
                    setGrantOpen(false);
                    assignments.reload();
                }} />
            )}

            <Drawer
                title={roleEditor?.role ? t('ui.platformRbac.editRole', null, 'Edit role') : t('ui.platformRbac.newRole', null, 'New role')}
                visible={Boolean(roleEditor)}
                key={roleEditor?.role?.id || 'new-rbac-role'}
                onCancel={() => setRoleEditor(null)}
                onOk={saveRole}
                confirmLoading={saving}
                width={820}
            >
                {roleEditor && (
                    <Form
                        getFormApi={form => setRoleEditor(current => (current ? { ...current, form } : current))}
                        initValues={roleEditor.role ? {
                            name: roleEditor.role.name,
                            description: roleEditor.role.description,
                            scope: roleEditor.role.scope
                        } : {}}
                    >
                        <Form.Input field="name" label={t('ui.platformRbac.roleName', null, 'Role name')} rules={[{ required: true, message: t('ui.platformRbac.roleNameRequired', null, 'Enter a role name') }]} />
                        <Form.Input field="description" label={t('ui.platformRbac.descriptionLabel', null, 'Description')} />
                        <Form.Select
                            field="scope"
                            label={t('ui.platformRbac.scope', null, 'Data scope')}
                            optionList={(metadata.data?.scopes || ['all', 'assigned', 'own']).map(item => ({ value: item, label: item }))}
                        />
                        <Form.Slot label={t('ui.platformRbac.permissions', null, 'Permissions')}>
                            <PermissionPicker
                                value={roleEditor.permissions}
                                options={permissionKeys}
                                onChange={next => setRoleEditor(current => ({ ...current, permissions: next }))}
                            />
                        </Form.Slot>
                    </Form>
                )}
            </Drawer>

            <Drawer
                title={userEditor?.user ? t('ui.platformRbac.editUser', null, 'Edit user') : t('ui.platformRbac.newUser', null, 'New user')}
                visible={Boolean(userEditor)}
                key={userEditor?.user?.id || 'new-rbac-user'}
                onCancel={() => setUserEditor(null)}
                onOk={saveUser}
                confirmLoading={saving}
                width={620}
            >
                {userEditor && (
                    <Form
                        getFormApi={form => setUserEditor(current => (current ? { ...current, form } : current))}
                        initValues={userEditor.user ? {
                            username: userEditor.user.username,
                            display_name: userEditor.user.display_name,
                            enabled: userEditor.user.enabled !== false,
                            roles: userEditor.user.roles || []
                        } : { enabled: true, roles: [] }}
                    >
                        <Form.Input field="username" label={t('ui.platformRbac.username', null, 'Username')} disabled={Boolean(userEditor.user)} rules={[{ required: true, message: t('ui.platformRbac.usernameRequired', null, 'Enter a username') }]} />
                        <Form.Input field="display_name" label={t('ui.platformRbac.displayName', null, 'Display name')} />
                        <Form.Input field="password" label={userEditor.user ? t('ui.platformRbac.resetPassword', null, 'Reset password (leave blank to keep)') : t('ui.platformRbac.password', null, 'Password')} mode="password" rules={userEditor.user ? [] : [{ required: true, min: 8, message: t('ui.platformRbac.passwordMin', null, 'At least 8 characters') }]} />
                        <Form.Select field="roles" label={t('ui.platformRbac.role', null, 'Role')} multiple optionList={roleOptions} />
                        <Form.Slot label={t('ui.platformRbac.enabled', null, 'Enabled')}><Form.Switch field="enabled" /></Form.Slot>
                    </Form>
                )}
            </Drawer>
        </div>
    );
}

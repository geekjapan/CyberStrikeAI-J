/**
 * System settings: tabbed sections; each section fetches its own data and handles its own errors, independently of the others.
 * Deep link #/settings?section=token-usage (same as the legacy page).
 */
import { useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Tabs } from '@douyinfe/semi-ui';
import { PageHeader } from '../../components/ui';
import { useT } from '../../lib/i18n';
import BasicSection from './sections/BasicSection';
import ModelsSection from './sections/ModelsSection';
import TokenUsageSection from './sections/TokenUsageSection';
import StorageSection from './sections/StorageSection';
import UpdateSection from './sections/UpdateSection';
import AuditSection from './sections/AuditSection';
import AppearanceSection from './sections/AppearanceSection';
import './page.css';

const SECTION_KEYS = ['basic', 'models', 'token-usage', 'storage', 'update', 'audit', 'appearance'];

export default function SettingsPage() {
    const t = useT();
    const { mobile } = useOutletContext();
    const [params, setParams] = useSearchParams();

    const requested = params.get('section');
    const activeKey = useMemo(
        () => (SECTION_KEYS.includes(requested) ? requested : 'basic'),
        [requested]
    );

    const change = key => {
        const next = new URLSearchParams(params);
        next.set('section', key);
        setParams(next, { replace: true });
    };

    return (
        <div className="settings-page">
            <PageHeader
                title={t('settings.title', null, 'System settings')}
                description={t('settings.pageDesc', null, 'Configuration, model probing, token usage, storage cleanup, audit log, and interface preferences. Each section loads on its own; a failure in one does not affect the others.')}
            />
            <Tabs
                type="line"
                tabPosition={mobile ? 'top' : 'left'}
                collapsible={mobile}
                lazyRender
                activeKey={activeKey}
                onChange={change}
                className="settings-tabs"
            >
                <Tabs.TabPane itemKey="basic" tab={t('settings.nav.basic', null, 'Basic')}>
                    <BasicSection />
                </Tabs.TabPane>
                <Tabs.TabPane itemKey="models" tab={t('settings.nav.models', null, 'Models & tools')}>
                    <ModelsSection />
                </Tabs.TabPane>
                <Tabs.TabPane itemKey="token-usage" tab={t('settings.nav.tokenUsage', null, 'Token usage')}>
                    <TokenUsageSection />
                </Tabs.TabPane>
                <Tabs.TabPane itemKey="storage" tab={t('settings.nav.storage', null, 'Storage cleanup')}>
                    <StorageSection />
                </Tabs.TabPane>
                <Tabs.TabPane itemKey="update" tab={t('settings.nav.update', null, 'One-Click Update')}>
                    <UpdateSection />
                </Tabs.TabPane>
                <Tabs.TabPane itemKey="audit" tab={t('settings.nav.audit', null, 'Audit logs')}>
                    <AuditSection />
                </Tabs.TabPane>
                <Tabs.TabPane itemKey="appearance" tab={t('settings.nav.appearance', null, 'Appearance')}>
                    <AppearanceSection />
                </Tabs.TabPane>
            </Tabs>
        </div>
    );
}

/** Shared widgets of the settings sections: permission notice, loading skeleton, read-only key-value row. */
import { Banner, Skeleton, Typography } from '@douyinfe/semi-ui';
import { useT } from '../../../lib/i18n';

const { Text } = Typography;

export function PermissionBanner({ permission, label }) {
    const t = useT();
    return (
        <Banner
            type="warning"
            bordered
            closeIcon={null}
            description={t(
                'settings.permissionMissing',
                { permission, section: label || t('settings.thisSection', null, 'this section') },
                'The current account lacks the {{permission}} permission and cannot open "{{section}}".'
            )}
        />
    );
}

export function LoadingBlock({ rows = 4 }) {
    return (
        <div className="settings-loading-block">
            <Skeleton placeholder={<Skeleton.Paragraph rows={rows} />} loading>
                <div style={{ height: rows * 18 }} />
            </Skeleton>
        </div>
    );
}

export function Hint({ children }) {
    return <Text type="tertiary" size="small" className="settings-hint">{children}</Text>;
}

export function Mono({ children }) {
    return <span className="settings-mono">{children}</span>;
}

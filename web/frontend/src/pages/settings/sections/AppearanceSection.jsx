/** Appearance: theme (system/light/dark, useTheme) and interface language (useI18n.setLanguage). */
import { RadioGroup, Radio, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useTheme } from '../../../lib/theme';
import { LANGUAGES, useI18n, useT } from '../../../lib/i18n';
import { SectionCard } from '../../../components/ui';
import { Hint } from './common';

const { Text } = Typography;

export default function AppearanceSection() {
    const t = useT();
    const { preference, theme, setPreference } = useTheme();
    const { lang, setLanguage } = useI18n();

    return (
        <>
            <SectionCard
                title={t('theme.titleSystem', null, 'Current: system theme. Click to switch to light.')}
                description={t('settings.appearanceThemeDesc', null, 'Theme and language are saved only in this browser (localStorage), not in the server configuration.')}
            >
                <RadioGroup
                    value={preference}
                    onChange={event => setPreference(event.target.value)}
                    direction="horizontal"
                >
                    <Radio value="system">{t('theme.system', null, 'System')}</Radio>
                    <Radio value="light">{t('theme.light', null, 'Light')}</Radio>
                    <Radio value="dark">{t('theme.dark', null, 'Dark')}</Radio>
                </RadioGroup>
                <Space spacing={8} className="settings-appearance-status">
                    <Tag size="small" color="blue">
                        {t('settings.currentTheme', null, 'In effect')}：{theme === 'dark' ? t('theme.dark', null, 'Dark') : t('theme.light', null, 'Light')}
                    </Tag>
                    <Hint>{`preference = ${preference}`}</Hint>
                </Space>
            </SectionCard>

            <SectionCard
                title={t('settings.languageTitle', null, 'Interface language')}
                description={t('settings.languageDesc', null, 'Switch to a separate language pack; missing entries fall back to English.')}
            >
                <Space spacing={12} align="center">
                    <Select
                        value={lang}
                        onChange={value => setLanguage(value)}
                        optionList={LANGUAGES.map(item => ({ value: item.id, label: item.label }))}
                        style={{ width: 220 }}
                    />
                    <Text type="tertiary">{lang}</Text>
                </Space>
            </SectionCard>
        </>
    );
}

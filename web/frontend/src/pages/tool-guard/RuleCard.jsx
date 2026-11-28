/** Edit body of one interception rule: enable/disable, move up/down, delete, three fields and single-rule validation. */
import { Button, Input, Space, Switch, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconArrowDown, IconArrowUp, IconDelete } from '@douyinfe/semi-icons';
import { useT } from '../../lib/i18n';
import TestPanel from './TestPanel';

const { Text } = Typography;

export default function RuleCard({ rule, index, total, canWrite, canTest, onChange, onDelete, onMove }) {
    const t = useT();
    return (
        <div className="tool-guard-rule-body">
            <div className="tool-guard-rule-toolbar">
                <Space spacing={8}>
                    <Switch
                        size="small"
                        checked={rule.enabled}
                        disabled={!canWrite}
                        onChange={next => onChange({ enabled: next })}
                        aria-label={t('toolGuard.ruleEnabled', null, 'Enabled')}
                    />
                    <Text size="small" type="tertiary">
                        {rule.enabled ? t('toolGuard.ruleOn', null, 'Enabled') : t('toolGuard.ruleOff', null, 'Disabled')}
                    </Text>
                </Space>
                <Space spacing={6}>
                    <Button
                        size="small"
                        theme="borderless"
                        icon={<IconArrowUp />}
                        disabled={!canWrite || index === 0}
                        onClick={() => onMove(-1)}
                    >
                        {t('toolGuard.moveUp', null, 'Move up')}
                    </Button>
                    <Button
                        size="small"
                        theme="borderless"
                        icon={<IconArrowDown />}
                        disabled={!canWrite || index === total - 1}
                        onClick={() => onMove(1)}
                    >
                        {t('toolGuard.moveDown', null, 'Move down')}
                    </Button>
                    <Button
                        size="small"
                        type="danger"
                        theme="borderless"
                        icon={<IconDelete />}
                        disabled={!canWrite}
                        onClick={onDelete}
                    >
                        {t('toolGuard.deleteRule', null, 'Delete')}
                    </Button>
                </Space>
            </div>

            <div className="tool-guard-editor-grid">
                <label className="tool-guard-field">
                    <Text type="tertiary" size="small">{t('toolGuard.ruleName', null, 'Rule name')}</Text>
                    <Input
                        value={rule.name}
                        maxLength={200}
                        disabled={!canWrite}
                        onChange={value => onChange({ name: value })}
                        placeholder={t('toolGuard.ruleName', null, 'Rule name')}
                    />
                </label>
                <label className="tool-guard-field tool-guard-field-wide">
                    <Text type="tertiary" size="small">{t('toolGuard.pattern', null, 'Pattern (RE2)')}</Text>
                    <TextArea
                        value={rule.pattern}
                        rows={3}
                        spellCheck={false}
                        disabled={!canWrite}
                        onChange={value => onChange({ pattern: value })}
                        className="tool-guard-mono"
                        placeholder="(?i)(169\\.254\\.169\\.254|metadata\\.google\\.internal)"
                    />
                </label>
                <label className="tool-guard-field tool-guard-field-wide">
                    <Text type="tertiary" size="small">{t('toolGuard.message', null, 'Blocking message')}</Text>
                    <TextArea
                        value={rule.message}
                        rows={2}
                        disabled={!canWrite}
                        onChange={value => onChange({ message: value })}
                        placeholder={t('toolGuard.defaultPreview', null, 'Uses the default blocking message when matched')}
                    />
                    <Text type="tertiary" size="small">
                        {t('toolGuard.messageHint', null, 'Messages support {match} (matched text), {tool} (tool name), and {rule} (rule name).')}
                    </Text>
                </label>
            </div>

            <TestPanel config={null} rule={rule} compact disabled={!canTest} />
        </div>
    );
}

/**
 * Rule trial match: POST /tool-guard/test (the backend compiles and runs the match with RE2, calling no tools).
 * One component serves "validate all rules" and single-rule validation; they differ only in the submitted config scope.
 */
import { useState } from 'react';
import { Banner, Button, Input, Space, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { ErrorBanner } from '../../components/ui';
import { requestConfig, singleRuleConfig } from './utils';

const { Text } = Typography;

const DEFAULT_TOOL = 'http_request';
const DEFAULT_ARGS = '{"url": "https://example.gov.cn"}';

export default function TestPanel({ config, rule = null, disabled = false, compact = false }) {
    const t = useT();
    const single = Boolean(rule);
    const [toolName, setToolName] = useState(DEFAULT_TOOL);
    const [argsText, setArgsText] = useState(DEFAULT_ARGS);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const run = async () => {
        if (disabled || busy) return;
        setError(null);
        setResult(null);
        if (!single && !config) {
            setError(new Error(t('toolGuard.loadFirst', null, 'Load the blocking configuration first')));
            return;
        }
        if (!toolName.trim()) {
            setError(new Error(t('toolGuard.toolRequired', null, 'Enter a tool name to test')));
            return;
        }
        let args;
        try {
            args = JSON.parse(argsText);
            if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('not an object');
        } catch (parseError) {
            setError(new Error(t('toolGuard.invalidArguments', null, 'Tool arguments must be a valid JSON object')));
            return;
        }
        setBusy(true);
        try {
            const payload = {
                config: single ? singleRuleConfig(rule) : requestConfig(config),
                toolName: toolName.trim(),
                arguments: args
            };
            const response = await api.post('/tool-guard/test', payload);
            if (!response || typeof response.blocked !== 'boolean') {
                throw new Error(t('toolGuard.invalidTestResponse', null, 'The server returned an invalid test result'));
            }
            setResult(response);
        } catch (requestError) {
            setError(requestError);
        } finally {
            setBusy(false);
        }
    };

    const blocked = result?.blocked;
    const match = result?.match;
    const disabledScope = !single && config && config.enabled === false;

    return (
        <div className={compact ? 'tool-guard-test tool-guard-test-compact' : 'tool-guard-test'}>
            <Space vertical spacing={6} align="start">
                <Text strong>
                    {single
                        ? t('toolGuard.testScopeSingle', { name: rule.name || t('toolGuard.unnamedRule', null, 'Single rule: {{name}}') }, 'Untitled rule')
                        : t('toolGuard.testScopeAll', null, 'All rules')}
                </Text>
                <Text type="tertiary" size="small">
                    {single
                        ? t('toolGuard.testSingleHint', null, 'Tests only this rule, ignoring global and rule switches. Does not save or execute tools.')
                        : t('toolGuard.testAllHint', null, 'Tests all rules in their current order and enabled states. Does not save or execute tools.')}
                </Text>
            </Space>

            <div className="tool-guard-test-form">
                <label className="tool-guard-field">
                    <Text type="tertiary" size="small">{t('toolGuard.testTool', null, 'Tool name')}</Text>
                    <Input value={toolName} onChange={value => { setToolName(value); setResult(null); }} placeholder="http_request" />
                </label>
                <label className="tool-guard-field tool-guard-field-wide">
                    <Text type="tertiary" size="small">{t('toolGuard.testArguments', null, 'Tool arguments (JSON object)')}</Text>
                    <TextArea
                        value={argsText}
                        onChange={value => { setArgsText(value); setResult(null); }}
                        rows={3}
                        spellCheck={false}
                        className="tool-guard-args"
                    />
                </label>
            </div>

            <Button
                theme="solid"
                type="primary"
                loading={busy}
                disabled={disabled}
                onClick={run}
                className="tool-guard-test-run"
            >
                {busy ? t('toolGuard.testing', null, 'Testing…') : t('toolGuard.test', null, 'Test match')}
            </Button>

            <ErrorBanner error={error} />

            {result && (
                <div className={`tool-guard-test-result ${blocked ? 'is-blocked' : 'is-pass'}`}>
                    <Space spacing={8} wrap>
                        <Tag color={blocked ? 'red' : (disabledScope ? 'grey' : 'green')} size="small">
                            {blocked ? 'blocked' : 'passed'}
                        </Tag>
                        <Text strong>
                            {single
                                ? (blocked
                                    ? t('toolGuard.singleMatched', null, 'This rule matched')
                                    : t('toolGuard.singleNotMatched', null, 'This rule did not match'))
                                : (blocked
                                    ? t('toolGuard.blocked', null, 'Rule matched: this call will be blocked')
                                    : (disabledScope
                                        ? t('toolGuard.disabledResult', null, 'Call blocking is disabled: this configuration will not block calls')
                                        : t('toolGuard.notBlocked', null, 'No enabled rule matched')))}
                        </Text>
                    </Space>
                    {single && (
                        <Text type="tertiary" size="small">
                            {t('toolGuard.singleResultHint', null, 'This is a single-rule test. Actual blocking also depends on the global switch, enabled rules, and matching order.')}
                        </Text>
                    )}
                    {blocked && match && (
                        <div className="tool-guard-match">
                            <div>
                                <Text type="tertiary" size="small">{t('toolGuard.matchedRule', null, 'Matched rule')}</Text>
                                <div>{match.ruleName || match.ruleId || '—'}</div>
                            </div>
                            <div>
                                <Text type="tertiary" size="small">{t('toolGuard.matchedText', null, 'Matched text')}</Text>
                                <pre>{match.matchedText || '—'}</pre>
                            </div>
                            <div>
                                <Text type="tertiary" size="small">{t('toolGuard.matchedMessage', null, 'Returned blocking message')}</Text>
                                <div>{match.message || '—'}</div>
                            </div>
                        </div>
                    )}
                </div>
            )}
            {!result && !error && (
                <Text type="tertiary" size="small">{t('toolGuard.testReadyHint', null, 'Click Test match to see the result here.')}</Text>
            )}
            {single === false && !result && !error && disabledScope && (
                <Banner
                    type="info"
                    bordered
                    closeIcon={null}
                    description={t('toolGuard.disabledResult', null, 'Call blocking is disabled: this configuration will not block calls')}
                />
            )}
        </div>
    );
}

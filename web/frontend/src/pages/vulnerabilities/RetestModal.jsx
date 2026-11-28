/** Retest vulnerability: create an independent branch from the original conversation and jump to the chat page for one-click run (POST /vulnerabilities/:id/retest). */
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { Drawer, ErrorBanner } from '../../components/ui';
import { queueRetestAutosend } from '../../lib/retest';

const { Text } = Typography;
const MAX_PROMPT = 20000;

export function retestPromptDraft(vuln, t) {
    // Do not pass vars: keep placeholders such as {{vulnerability_id}} for the server to resolve when creating the branch.
    const base = t('vulnerabilityRetest.defaultPrompt', null,
        'Please verify whether vulnerability {{vulnerability_id}} has been fixed. Update its status when verification is complete.');
    const guidance = String(vuln?.retest_notes || '').trim();
    if (!guidance) return base;
    return `${base}\n\n${t('vulnerabilityRetest.guidanceHeading', null, 'Verification method (from the finding\'s retest notes):')}\n${guidance}`;
}

export default function RetestModal({ visible, vuln, onClose }) {
    const t = useT();
    const navigate = useNavigate();
    const formId = useId();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => { setError(null); }, [visible, vuln?.id]);

    const submit = async values => {
        if (saving || !vuln?.id) return;
        setSaving(true);
        setError(null);
        try {
            const result = await api.post(`/vulnerabilities/${encodeURIComponent(vuln.id)}/retest`, {
                prompt: String(values.prompt || '').trim()
            });
            // The server has resolved the placeholders; hand over to the chat page to auto-send on the branch.
            queueRetestAutosend(result.conversation.id, result.prompt);
            onClose?.();
            navigate(`/chat?conversation=${encodeURIComponent(result.conversation.id)}`);
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            width={640}
            closable={!saving}
            closeOnEsc={!saving}
            onCancel={saving ? undefined : onClose}
            cancelButtonProps={{ disabled: saving }}
            title={t('vulnerabilityRetest.title', null, 'Retest vulnerability')}
            formId={formId}
            okText={t('vulnerabilityRetest.confirm', null, 'Confirm and start retest')}
            confirmLoading={saving}
        >
            <Text strong>{vuln?.title}</Text>
            <Text type="tertiary" size="small">
                {t('vulnerabilityRetest.hint', null, 'Each confirmation creates an independent branch from the original conversation, preserving its project and history for follow-up turns.')}
            </Text>
            <Form id={formId} key={`${visible}-${vuln?.id || ''}`} onSubmit={submit}
                initValues={{ prompt: retestPromptDraft(vuln, t) }}>
                <Form.TextArea
                    id={`${formId}-prompt`}
                    field="prompt"
                    rows={8}
                    maxCount={MAX_PROMPT}
                    autosize
                    label={t('vulnerabilityRetest.promptLabel', null, 'Retest prompt')}
                    extraText={t('vulnerabilityRetest.placeholderHint', null, 'Placeholders are replaced when sending. You can also type them in follow-up messages.')}
                    rules={[{
                        required: true,
                        whitespace: true,
                        message: t('vulnerabilityRetest.promptRequired', null, 'Enter a retest prompt.')
                    }]}
                />
                <ErrorBanner error={error} />
            </Form>
        </Drawer>
    );
}

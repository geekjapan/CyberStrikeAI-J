import { useState } from 'react';
import { Banner, Button, Card, Form, Typography } from '@douyinfe/semi-ui';
import { IconArticle, IconBriefcase, IconLock, IconShield, IconUser } from '@douyinfe/semi-icons';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { errorMessage } from '../lib/http';

const { Title, Text, Paragraph } = Typography;

export default function LoginPage() {
    const { login } = useAuth();
    const t = useT();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function submit(values) {
        setLoading(true);
        setError('');
        try {
            await login(values.username, values.password);
        } catch (err) {
            setError(errorMessage(err, t('login.loginFailed', null, 'Sign-in failed')));
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="cs-login-page">
            <section className="cs-login-story">
                <div className="cs-login-brand">
                    <img src="/static/logo.png" alt="" className="cs-login-logo" />
                    <span className="cs-brand-name">CyberStrike<span>AI</span></span>
                </div>
                <div className="cs-login-intro">
                    <span className="cs-login-emblem" aria-hidden="true"><IconShield size="extra-large" /></span>
                    <Title heading={1} className="cs-login-headline">{t('login.headline', null, 'Every exploration, backed by evidence.')}</Title>
                    <Paragraph type="tertiary">{t('login.intro', null, 'From scoping targets to archiving evidence, do your security research in one workspace.')}</Paragraph>
                    <div className="cs-login-features">
                        <div className="cs-login-feature"><IconBriefcase size="large" /><div><strong>{t('login.projectTitle', null, 'Collaborate around projects')}</strong>{t('login.projectHint', null, 'Share targets, context, and progress across conversations')}</div></div>
                        <div className="cs-login-feature"><IconArticle size="large" /><div><strong>{t('login.evidenceTitle', null, 'Back conclusions with evidence')}</strong>{t('login.evidenceHint', null, 'Keep findings, sources, and acceptance records')}</div></div>
                    </div>
                </div>
                <Text type="tertiary" size="small">{t('login.platformTagline', null, 'AI-driven security research workspace')}</Text>
            </section>
            <section className="cs-login-form-panel">
                <Card className="cs-login-card" bordered={false}>
                    <Title heading={2} className="cs-login-form-heading">{t('login.welcome', null, 'Welcome back')}</Title>
                    <Text type="tertiary">{t('login.welcomeHint', null, 'Sign in to your security workspace and keep exploring.')}</Text>
                    <Form onSubmit={submit} className="cs-login-form">
                        {error && <Banner type="danger" description={error} closeIcon={null} className="cs-error-banner" />}
                        <Form.Input
                            field="username"
                            label={t('login.username', null, 'Username')}
                            prefix={<IconUser />}
                            placeholder={t('login.usernamePlaceholder', null, 'admin')}
                            size="large"
                            autoComplete="username"
                            rules={[{ required: true, message: t('login.usernameRequired', null, 'Enter your username') }]}
                        />
                        <Form.Input
                            field="password"
                            label={t('login.password', null, 'Password')}
                            prefix={<IconLock />}
                            type="password"
                            size="large"
                            autoComplete="current-password"
                            placeholder={t('login.passwordPlaceholder', null, 'Enter password')}
                            rules={[{ required: true, message: t('login.passwordRequired', null, 'Enter your password') }]}
                        />
                        <Button htmlType="submit" theme="solid" type="primary" size="large" block loading={loading}>
                            {t('login.submit', null, 'Sign in')}
                        </Button>
                    </Form>
                    <Text type="tertiary" className="cs-login-note">{t('login.authorizedOnly', null, 'Perform security testing only within an explicitly authorized scope')}</Text>
                </Card>
            </section>
        </main>
    );
}

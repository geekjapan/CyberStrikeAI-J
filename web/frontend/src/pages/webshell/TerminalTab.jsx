/**
 * WebShell virtual terminal: send commands one at a time and write the echo back to the output area.
 * Output stays in memory only; command history is persisted to the connection state by the parent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Space, Tag } from '@douyinfe/semi-ui';
import { IconSend } from '@douyinfe/semi-icons';
import { useT } from '../../lib/i18n';
import { toastError, toastSuccess, toastWarning } from '../../components/ui';
import { execCommand } from './api';

let seq = 0;
const nextId = () => { seq += 1; return seq; };

export default function TerminalTab({ connection, canWrite, onRecordCommand }) {
    const t = useT();
    const [entries, setEntries] = useState([]);
    const [command, setCommand] = useState('');
    const [running, setRunning] = useState(false);
    const logRef = useRef(null);

    const append = useCallback(entry => {
        setEntries(current => [...current, { id: nextId(), ...entry }]);
    }, []);

    useEffect(() => {
        setEntries([]);
        setCommand('');
    }, [connection?.id]);

    useEffect(() => {
        const node = logRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [entries]);

    const run = async raw => {
        const cmd = String(raw ?? command).trim();
        if (!cmd) return;
        if (!canWrite) {
            toastWarning(t('webshell.webshellWriteRequired', null, 'The current account is not allowed to run commands'));
            return;
        }
        setCommand('');
        append({ kind: 'cmd', text: cmd });
        onRecordCommand?.(cmd);
        setRunning(true);
        try {
            const result = await execCommand({ connection, command: cmd });
            if (result?.output) append({ kind: 'out', text: result.output });
            if (result?.error) append({ kind: 'err', text: result.error });
            if (!result?.ok && !result?.error) {
                append({ kind: 'err', text: t('webshell.execError', null, 'Execution failed') });
            }
        } catch (error) {
            append({ kind: 'err', text: error?.message || t('webshell.execError', null, 'Execution failed') });
            toastError(error);
        } finally {
            setRunning(false);
        }
    };

    const copyLog = async () => {
        const text = entries.map(entry => (entry.kind === 'cmd' ? `$ ${entry.text}` : entry.text)).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            toastSuccess(t('webshell.terminalCopyOk', null, 'Log copied'));
        } catch (error) {
            toastError(error, t('webshell.terminalCopyFail', null, 'Copy failed'));
        }
    };

    return (
        <div className="webshell-terminal">
            <div className="webshell-terminal-bar">
                <Space spacing={8}>
                    <Tag size="small" color={running ? 'amber' : 'green'}>
                        {running ? t('webshell.terminalRunning', null, 'Running') : t('webshell.terminalIdle', null, 'Idle')}
                    </Tag>
                    <Button size="small" theme="borderless" onClick={() => setEntries([])}>{t('webshell.clearScreen', null, 'Clear')}</Button>
                    <Button size="small" theme="borderless" onClick={copyLog}>{t('webshell.copyTerminalLog', null, 'Copy log')}</Button>
                </Space>
            </div>
            <div className="webshell-terminal-log" ref={logRef}>
                <div className="webshell-terminal-welcome">
                    {t('webshell.terminalWelcome', null, 'WebShell virtual terminal — type a command and press Enter (Ctrl+L clear)')}
                </div>
                {entries.map(entry => (
                    <pre key={entry.id} className={`webshell-terminal-line kind-${entry.kind}`}>
                        {entry.kind === 'cmd' ? `$ ${entry.text}` : entry.text}
                    </pre>
                ))}
                {running && <div className="webshell-terminal-pending">{t('webshell.running', null, 'Running…')}</div>}
            </div>
            <div className="webshell-terminal-input">
                <Input
                    value={command}
                    onChange={setCommand}
                    onEnterPress={() => (running ? toastWarning(t('webshell.waitFinish', null, 'Please wait for the current command to finish')) : run())}
                    onKeyDown={event => {
                        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
                            event.preventDefault();
                            setEntries([]);
                        }
                    }}
                    placeholder={t('webshell.commandPlaceholder', null, 'Type a command and press Enter to run')}
                    disabled={running || !canWrite}
                    prefix="$"
                />
                <Button
                    theme="solid"
                    type="primary"
                    icon={<IconSend />}
                    loading={running}
                    disabled={!canWrite}
                    onClick={() => run()}
                >
                    {t('webshell.runCommand', null, 'Run')}
                </Button>
            </div>
        </div>
    );
}

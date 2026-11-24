/** HITL payload context blocks: user message / thinking / reasoning / plan / last execution result. */
import { useT } from '../../lib/i18n';
import { contextBlocks, executionResult } from './utils';

export default function ContextBlocks({ payload }) {
    const t = useT();
    const blocks = contextBlocks(payload);
    const exec = executionResult(payload);
    if (!blocks.length && !exec) return null;
    return (
        <div className="hitl-context-blocks">
            {blocks.map(block => (
                <div className="hitl-context-block" key={block.key}>
                    <span className="hitl-context-label">{block.label}</span>
                    <pre className="hitl-context-text">{String(block.value)}</pre>
                </div>
            ))}
            {exec && (
                <div className={`hitl-context-block ${exec.success ? 'hitl-state-success' : 'hitl-state-failed'}`}>
                    <span className="hitl-context-label">{exec.success
                        ? t('ui.hitlBlocks.execResultSuccess', null, 'Execution result (success)')
                        : t('ui.hitlBlocks.execResultFailed', null, 'Execution result (failed)')}</span>
                    <pre className="hitl-context-text">{exec.text}</pre>
                </div>
            )}
        </div>
    );
}

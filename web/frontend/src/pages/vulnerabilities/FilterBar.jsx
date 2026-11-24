/** Vulnerability filter bar: keyword + severity/status/project/source/task tag; options come from filter-options. */
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { useDebounced } from '../../components/hooks';
import { hasActiveFilters, severityOptions, statusOptions } from './shared';

function withEmpty(label, options) {
    return [{ value: '', label }, ...options];
}

export default function FilterBar({ t, filters, options, projectOptions, hasGroupFilters, onChange, onReset }) {
    const [keyword, setKeyword] = useState(filters.q);
    const debounced = useDebounced(keyword, 380);
    const lastEmitted = useRef(filters.q);

    // Write back to the URL only after typing pauses, so each keystroke does not trigger a request.
    useEffect(() => {
        if (debounced === lastEmitted.current) return;
        lastEmitted.current = debounced;
        onChange('q', debounced);
    }, [debounced, onChange]);

    // Refill the input when an external reset/deep link changes q.
    useEffect(() => {
        if (filters.q === lastEmitted.current) return;
        lastEmitted.current = filters.q;
        setKeyword(filters.q);
    }, [filters.q]);

    const conversationTags = Array.isArray(options?.conversation_tags) ? options.conversation_tags : [];
    const taskTags = Array.isArray(options?.task_tags) ? options.task_tags : [];

    return (
        <div className="vulnerability-filter-bar">
            <Input
                className="vulnerability-filter-search"
                prefix={<IconSearch />}
                value={keyword}
                showClear
                placeholder={t('vulnerabilityPage.searchKeyword', null, 'Search title, description, type, target…')}
                aria-label={t('vulnerabilityPage.searchKeyword', null, 'Search title, description, type, target…')}
                onChange={value => setKeyword(value)}
            />
            <Select
                className="vulnerability-filter-select"
                value={filters.severity}
                placeholder={t('vulnerabilityPage.severity', null, 'Severity')}
                optionList={withEmpty(t('vulnerabilityPage.allSeverities', null, 'All severities'), severityOptions(t))}
                onChange={value => onChange('severity', value || '')}
            />
            <Select
                className="vulnerability-filter-select"
                value={filters.status}
                placeholder={t('vulnerabilityPage.status', null, 'Status')}
                optionList={withEmpty(t('dashboard.allStatuses', null, 'All statuses'), statusOptions(t))}
                onChange={value => onChange('status', value || '')}
            />
            <Select
                className="vulnerability-filter-select vulnerability-filter-select--wide"
                value={filters.project_id}
                placeholder={t('vulnerabilityPage.detailProject', null, 'Project')}
                filter
                optionList={withEmpty(t('vulnerabilityPage.allProjects', null, 'All projects'), projectOptions)}
                onChange={value => onChange('project_id', value || '')}
            />
            <Select
                className="vulnerability-filter-select"
                value={filters.conversation_tag}
                placeholder={t('vulnerabilityPage.conversationTag', null, 'Conversation tag')}
                filter
                optionList={withEmpty(
                    t('vulnerabilityPage.allSources', null, 'All sources'),
                    conversationTags.map(tag => ({ value: tag, label: tag }))
                )}
                onChange={value => onChange('conversation_tag', value || '')}
            />
            <Select
                className="vulnerability-filter-select"
                value={filters.task_tag}
                placeholder={t('vulnerabilityPage.taskTag', null, 'Task tag')}
                filter
                optionList={withEmpty(
                    t('vulnerabilityPage.allTaskTags', null, 'All task tags'),
                    taskTags.map(tag => ({ value: tag, label: tag }))
                )}
                onChange={value => onChange('task_tag', value || '')}
            />
            <div className="vulnerability-filter-actions">
                <Button
                    icon={<IconRefresh />}
                    theme="borderless"
                    disabled={!hasActiveFilters(filters) && !filters.sort && !hasGroupFilters}
                    onClick={onReset}
                >
                    {t('vulnerabilityPage.clearAll', null, 'Reset all')}
                </Button>
            </div>
        </div>
    );
}

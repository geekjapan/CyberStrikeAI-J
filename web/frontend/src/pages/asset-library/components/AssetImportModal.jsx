/** Bulk import: CSV / JSON text or file upload; validate and preview first, then submit to /assets/import. */
import { useMemo, useRef, useState } from 'react';
import {
    Banner, Button, RadioGroup, Space, Table, TextArea, Typography
} from '@douyinfe/semi-ui';
import { IconCloudUploadStroked } from '@douyinfe/semi-icons';
import { api, errorMessage } from '../../../lib/http';
import { useT } from '../../../lib/i18n';
import { Drawer, toastSuccess } from '../../../components/ui';
import { assetTargetLabel } from './assetTarget';
import { csvTemplate, downloadTextFile, recordsFromCsv, recordsFromJson } from './assetCsv';

const { Text } = Typography;

const PREVIEW_COLUMNS = (t) => [
    { title: t('assets.rowNumber', null, 'Row'), dataIndex: 'rowNumber', width: 70 },
    {
        title: t('assets.target', null, 'Target'),
        dataIndex: 'target',
        render: (_, record) => assetTargetLabel(record.asset || { target: record.values?.target })
    },
    {
        title: t('assets.project', null, 'Project'),
        dataIndex: 'project',
        render: (_, record) => record.projectName || record.values?.project || '—'
    },
    {
        title: t('assets.status', null, 'Status'),
        dataIndex: 'status',
        render: (_, record) => record.asset?.status || record.values?.status || '—'
    },
    {
        title: t('assets.validationResult', null, 'Validation'),
        dataIndex: 'error',
        render: value => (value
            ? <Text type="danger" size="small">{value}</Text>
            : <Text type="success" size="small">{t('assets.validationPassed', null, 'Valid')}</Text>)
    }
];

export default function AssetImportModal({ visible, projects, defaultProjectId, onClose, onDone }) {
    const t = useT();
    const [format, setFormat] = useState('csv');
    const [text, setText] = useState('');
    const [fileName, setFileName] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const fileInputRef = useRef(null);

    const parsed = useMemo(() => {
        if (!String(text || '').trim()) return { records: [], error: '' };
        try {
            const options = { projects, projectId: defaultProjectId, source: 'manual-import' };
            const records = format === 'csv'
                ? recordsFromCsv(text, options)
                : recordsFromJson(text, options);
            return { records, error: '' };
        } catch (parseError) {
            return { records: [], error: parseError.message };
        }
    }, [text, format, projects, defaultProjectId]);

    const records = parsed.records;
    const valid = records.filter(record => !record.error);
    const invalid = records.length - valid.length;
    const displayError = error || parsed.error;

    const reset = () => {
        setText('');
        setFileName('');
        setFormat('csv');
        setError('');
        setBusy(false);
    };

    const close = () => {
        if (busy) return;
        reset();
        onClose?.();
    };

    const handleFile = async file => {
        if (!file) return;
        setError('');
        const name = String(file.name || '');
        const extension = name.split('.').pop().toLowerCase();
        if (!['csv', 'json', 'txt'].includes(extension)) {
            setError(t('ui.assetImport.unsupportedFile', null, 'Only .csv, .json, and .txt files are supported'));
            return;
        }
        if (file.size > 100 * 1024 * 1024) {
            setError(t('assets.fileTooLarge', null, 'The file must not exceed 100 MB'));
            return;
        }
        try {
            const content = await file.text();
            setFormat(extension === 'json' ? 'json' : 'csv');
            setText(content);
            setFileName(name);
        } catch (readError) {
            setError(errorMessage(readError, t('assets.fileParseFailed', null, 'Could not parse the file; make sure it is valid and not corrupted')));
        }
    };

    const submit = async () => {
        if (busy || !valid.length) return;
        setError('');
        setBusy(true);
        try {
            const result = await api.post('/assets/import', {
                assets: valid.map(record => record.asset),
                source: 'manual-import',
                source_query: fileName || 'paste'
            });
            const skipped = Number(result?.skipped || 0) + invalid;
            toastSuccess(t('assets.bulkImportDone', {
                created: Number(result?.created || 0),
                updated: Number(result?.updated || 0),
                skipped
            }, 'Import complete: {{created}} created, {{updated}} updated, {{skipped}} skipped'));
            reset();
            onDone?.();
            onClose?.();
        } catch (submitError) {
            setError(errorMessage(submitError, t('assets.importFailed', null, 'Failed to import assets')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            title={t('assets.bulkImportTitle', null, 'Bulk import assets')}
            width={880}
            onCancel={close}
            onOk={submit}
            okText={t('assets.importValidRowsCount', { count: valid.length }, 'Import {{count}} valid rows')}
            okButtonProps={{ disabled: !valid.length }}
            confirmLoading={busy}
        >
            <Text type="tertiary">
                {t('assets.bulkImportSubtitle', null, 'Fill in a template, upload it, then review validation results before importing')}
            </Text>
            {displayError && (
                <Banner type="danger" bordered closeIcon={null} description={displayError} className="asset-library-form-error" />
            )}
            <Space vertical align="start" spacing={10} className="asset-library-import-body">
                <Space>
                    <RadioGroup
                        type="button"
                        value={format}
                        options={[
                            { value: 'csv', label: 'CSV' },
                            { value: 'json', label: 'JSON' }
                        ]}
                        onChange={event => { setFormat(event.target.value); setError(''); }}
                    />
                    <Button
                        icon={<IconCloudUploadStroked />}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {t('assets.chooseOrDropFile', null, 'Choose a file or drop it here')}
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.json,.txt"
                        className="asset-library-file-input"
                        onChange={event => {
                            handleFile(event.target.files?.[0]);
                            event.target.value = '';
                        }}
                    />
                    <Button
                        theme="borderless"
                        onClick={() => downloadTextFile('asset-import-template.csv', csvTemplate())}
                    >
                        {t('assets.downloadCsv', null, 'Download CSV template')}
                    </Button>
                    {fileName && <Text type="tertiary" size="small">{fileName}</Text>}
                </Space>
                <TextArea
                    value={text}
                    rows={8}
                    className="asset-library-import-textarea"
                    placeholder={format === 'csv'
                        ? 'target,project,tags,host,ip,domain,port,protocol,title,server,country,province,city,responsible_person,department,business_system,environment,criticality,status'
                        : '[{"host":"https://example.com","ip":"1.1.1.1","port":443,"protocol":"https","tags":["prod"]}]'}
                    onChange={value => { setText(value); setError(''); }}
                />
                {records.length > 0 && (
                    <div className="asset-library-import-preview">
                        <Text strong>
                            {t('assets.importPreviewSummary', {
                                total: records.length, valid: valid.length, invalid
                            }, '{{total}} rows: {{valid}} valid, {{invalid}} need attention')}
                        </Text>
                        <Table
                            columns={PREVIEW_COLUMNS(t)}
                            dataSource={records.slice(0, 10).map((record, index) => ({ ...record, id: index }))}
                            rowKey="id"
                            size="small"
                            pagination={false}
                        />
                        {records.length > 10 && (
                            <Text type="tertiary" size="small">
                                {t('assets.previewLimitedShort', { count: records.length }, 'Showing the first 10 rows only; all {{count}} rows are processed on submit')}
                            </Text>
                        )}
                    </div>
                )}
            </Space>
        </Drawer>
    );
}

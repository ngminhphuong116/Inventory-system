import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Descriptions,
  Divider,
  Empty,
  Input,
  List,
  Modal,
  Radio,
  Result,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  type UploadProps,
} from 'antd';
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  FileProtectOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { assertBackupFile, parseBackupDocument } from './backup-format';
import {
  createBackup,
  previewRestore,
  readBackupHistory,
  recordRestoreCancelled,
  restoreBackup,
  saveBackupDocument,
} from './backup-service';
import {
  BACKUP_NODE_DEFINITIONS,
  DEFAULT_RESTORE_NODES,
  type BackupDocument,
  type BackupHistoryEntry,
  type BackupNode,
  type RestoreMode,
  type RestorePreview,
  type RestoreResult,
} from './backup-types';
import './BackupRestorePanel.css';

const { Text, Title, Paragraph } = Typography;
const numberFormatter = new Intl.NumberFormat('vi-VN');
const dateFormatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' });

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nodeLabel(node: BackupNode): string {
  return BACKUP_NODE_DEFINITIONS.find((item) => item.key === node)?.label || node;
}

export default function BackupRestorePanel() {
  const { message } = AntApp.useApp();
  const [history, setHistory] = useState<BackupHistoryEntry[]>(readBackupHistory);
  const [creating, setCreating] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [backup, setBackup] = useState<BackupDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [selectedNodes, setSelectedNodes] = useState<BackupNode[]>([...DEFAULT_RESTORE_NODES]);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [replaceAcknowledged, setReplaceAcknowledged] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const totalRecords = useMemo(() => backup
    ? Object.values(backup.summary).reduce((total, count) => total + count, 0)
    : 0, [backup]);
  const selectedRecordCount = useMemo(() => backup
    ? selectedNodes.reduce((total, node) => total + backup.summary[node], 0)
    : 0, [backup, selectedNodes]);

  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      const document = await createBackup('manual');
      const saved = await saveBackupDocument(document, 'manual');
      if (saved.result.status === 'cancelled') {
        message.info('Đã tạo snapshot nhưng bạn chưa chọn nơi lưu tệp. Dữ liệu không bị thay đổi.');
        return;
      }
      if (saved.result.status === 'error') throw new Error(saved.result.message);
      setHistory(readBackupHistory());
      message.success(saved.result.message);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không thể tạo bản sao lưu.');
    } finally {
      setCreating(false);
    }
  };

  const handleFile: UploadProps['beforeUpload'] = async (file) => {
    setReadingFile(true);
    try {
      assertBackupFile(file);
      const document = await parseBackupDocument(await file.text());
      setBackup(document);
      setFileName(file.name);
      setFileSize(file.size);
      setSelectedNodes([...DEFAULT_RESTORE_NODES]);
      setMode('merge');
      setPreview(null);
      setRestoreResult(null);
      setConfirmation('');
      setReplaceAcknowledged(false);
      message.success('Tệp hợp lệ và checksum SHA-256 đã khớp.');
    } catch (error) {
      setBackup(null);
      setFileName('');
      setFileSize(0);
      message.error(error instanceof Error ? error.message : 'Không thể đọc tệp sao lưu.');
    } finally {
      setReadingFile(false);
    }
    return Upload.LIST_IGNORE;
  };

  const loadPreview = async () => {
    if (!backup || selectedNodes.length === 0) return;
    setPreviewing(true);
    try {
      const nextPreview = await previewRestore(backup, selectedNodes, mode);
      setPreview(nextPreview);
      setStep(1);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không thể phân tích dữ liệu hiện tại.');
    } finally {
      setPreviewing(false);
    }
  };

  const closeRestore = () => {
    if (restoring) return;
    if (modalOpen && !restoreResult) void recordRestoreCancelled();
    setModalOpen(false);
    setStep(0);
    setPreview(null);
    setConfirmation('');
    setReplaceAcknowledged(false);
  };

  const handleRestore = async () => {
    if (!backup || !preview) return;
    setRestoring(true);
    try {
      const safetyBackup = await createBackup('pre-restore');
      const saved = await saveBackupDocument(safetyBackup, 'pre-restore');
      if (saved.result.status !== 'success') {
        throw new Error(saved.result.status === 'cancelled'
          ? 'Đã dừng khôi phục vì bản sao lưu an toàn chưa được lưu xuống thiết bị.'
          : saved.result.message);
      }
      setHistory(readBackupHistory());
      const result = await restoreBackup({
        document: backup,
        selectedNodes,
        mode,
        confirmation: confirmation.trim(),
        replaceAcknowledged,
        preRestoreChecksum: safetyBackup.checksum,
      });
      setRestoreResult(result);
      setStep(3);
      message.success('Khôi phục hoàn tất và báo cáo toàn vẹn đã được tạo.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Khôi phục thất bại.');
    } finally {
      setRestoring(false);
    }
  };

  const confirmationValid = confirmation.trim() === 'KHOI PHUC' || confirmation.trim() === 'RESTORE';
  const restoreDisabled = !confirmationValid || (mode === 'replace' && !replaceAcknowledged);

  return (
    <section className="backup-restore-panel" aria-labelledby="backup-restore-title">
      <div className="backup-restore-heading">
        <div>
          <Title level={3} id="backup-restore-title">Sao lưu &amp; Khôi phục dữ liệu</Title>
          <Paragraph type="secondary">
            Tạo snapshot JSON có checksum hoặc phục hồi có kiểm soát. Chỉ hồ sơ dữ liệu được sao lưu; không gồm mật khẩu, token hay Firebase Authentication.
          </Paragraph>
        </div>
        <Tag icon={<SafetyCertificateOutlined />} color="green">Chỉ quản trị viên</Tag>
      </div>

      <div className="backup-zone">
        <div className="zone-copy">
          <Text strong>Sao lưu dữ liệu hiện tại</Text>
          <Text type="secondary">
            Snapshot được đọc mới nhất từ Firebase, sắp xếp khóa ổn định và ký SHA-256 trước khi lưu.
          </Text>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<CloudDownloadOutlined />}
          loading={creating}
          onClick={handleCreateBackup}
        >
          Tạo &amp; tải bản sao lưu
        </Button>
      </div>

      <div className="backup-history">
        <div className="history-title">
          <Text strong>Các tệp đã lưu gần đây trên thiết bị này</Text>
          <Tooltip title="Chỉ lưu tên tệp, thời gian, kích thước và checksum trong trình duyệt; không lưu nội dung dữ liệu.">
            <InfoCircleOutlined aria-label="Thông tin lịch sử cục bộ" />
          </Tooltip>
        </div>
        {history.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có bản sao lưu cục bộ" />
        ) : (
          <List
            size="small"
            dataSource={history}
            renderItem={(item) => (
              <List.Item>
                <div className="history-row">
                  <FileProtectOutlined />
                  <div className="history-file">
                    <Text ellipsis={{ tooltip: item.fileName }}>{item.fileName}</Text>
                    <Text type="secondary">{dateFormatter.format(new Date(item.createdAt))} · {formatBytes(item.size)}</Text>
                  </div>
                  <Tag>{item.reason === 'pre-restore' ? 'Trước khôi phục' : 'Thủ công'}</Tag>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>

      <Divider />

      <div className="restore-zone">
        <div className="restore-zone-heading">
          <div>
            <Text strong>Khôi phục từ tệp JSON</Text>
            <Text type="secondary">Tệp được kiểm tra định dạng, schema, node cho phép và checksum trước khi có thể tiếp tục.</Text>
          </div>
          <Tag icon={<WarningOutlined />} color="warning">Thao tác nhạy cảm</Tag>
        </div>
        <Upload.Dragger
          accept=".json,application/json"
          maxCount={1}
          showUploadList={false}
          beforeUpload={handleFile}
          disabled={readingFile || restoring}
        >
          <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
          <p className="ant-upload-text">Chọn hoặc kéo tệp sao lưu vào đây</p>
          <p className="ant-upload-hint">Chỉ tệp .json do ứng dụng tạo, tối đa 20 MB.</p>
        </Upload.Dragger>

        {backup && (
          <div className="validated-file" role="status">
            <div>
              <Space wrap>
                <Tag color="success" icon={<SafetyCertificateOutlined />}>Checksum hợp lệ</Tag>
                <Text strong>{fileName}</Text>
                <Text type="secondary">{formatBytes(fileSize)} · {numberFormatter.format(totalRecords)} bản ghi</Text>
              </Space>
              <Text type="secondary" className="checksum-line">SHA-256: {backup.checksum}</Text>
            </div>
            <Button icon={<ReloadOutlined />} onClick={() => {
              setModalOpen(true);
              setStep(0);
              setPreview(null);
              setRestoreResult(null);
            }}>
              Mở trình khôi phục
            </Button>
          </div>
        )}
      </div>

      <Modal
        title="Khôi phục dữ liệu có kiểm soát"
        open={modalOpen}
        width={820}
        closable={!restoring}
        maskClosable={false}
        keyboard={!restoring}
        onCancel={closeRestore}
        footer={step === 3 ? (
          <Button type="primary" onClick={closeRestore}>Đóng báo cáo</Button>
        ) : (
          <Space wrap>
            <Button onClick={closeRestore} disabled={restoring}>Hủy</Button>
            {step > 0 && <Button onClick={() => setStep(step - 1)} disabled={restoring}>Quay lại</Button>}
            {step === 0 && (
              <Button type="primary" onClick={loadPreview} loading={previewing} disabled={selectedNodes.length === 0}>
                Phân tích ảnh hưởng
              </Button>
            )}
            {step === 1 && <Button type="primary" onClick={() => setStep(2)}>Tiếp tục xác nhận</Button>}
            {step === 2 && (
              <Button danger type="primary" onClick={handleRestore} loading={restoring} disabled={restoreDisabled}>
                Tạo bản an toàn &amp; khôi phục
              </Button>
            )}
          </Space>
        )}
      >
        {step < 3 && (
          <Steps
            size="small"
            current={step}
            items={[{ title: 'Chọn dữ liệu' }, { title: 'Xem ảnh hưởng' }, { title: 'Xác nhận' }]}
          />
        )}

        {step === 0 && backup && (
          <div className="restore-step">
            <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered items={[
              { key: 'time', label: 'Thời điểm tạo', children: dateFormatter.format(new Date(backup.createdAt)) },
              { key: 'creator', label: 'Người tạo', children: backup.createdBy.email || backup.createdBy.uid },
              { key: 'project', label: 'Firebase project', children: backup.environment.projectId || 'Không rõ' },
              { key: 'mode', label: 'Phạm vi nguồn', children: backup.environment.mode },
            ]} />
            <div>
              <Text strong>Nhóm dữ liệu sẽ khôi phục</Text>
              <Checkbox.Group
                className="node-grid"
                value={selectedNodes}
                options={BACKUP_NODE_DEFINITIONS.map((node) => ({
                  label: `${node.label} (${numberFormatter.format(backup.summary[node.key])})`,
                  value: node.key,
                }))}
                onChange={(values) => {
                  setSelectedNodes(values as BackupNode[]);
                  setPreview(null);
                }}
              />
            </div>
            {(selectedNodes.includes('users') || selectedNodes.includes('auditLogs')) && (
              <Alert
                type="warning"
                showIcon
                message="Bạn đang chọn dữ liệu nhạy cảm không được bật mặc định"
                description="Hồ sơ users không chứa và không thể tạo lại mật khẩu/Firebase Auth. Audit nên được khôi phục cùng chứng từ và operations liên quan."
              />
            )}
            <div>
              <Text strong>Chế độ áp dụng</Text>
              <Radio.Group
                className="mode-options"
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as RestoreMode);
                  setPreview(null);
                  setReplaceAcknowledged(false);
                }}
              >
                <Radio value="merge"><Text strong>Gộp</Text> — thêm bản ghi mới; bản sao lưu thắng khi trùng ID.</Radio>
                <Radio value="replace"><Text strong>Thay thế</Text> — xóa dữ liệu hiện tại chỉ trong các node đã chọn.</Radio>
              </Radio.Group>
            </div>
          </div>
        )}

        {step === 1 && preview && (
          <div className="restore-step">
            {preview.warnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`${preview.warnings.length} cảnh báo cần xem`}
                description={<ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
              />
            )}
            <Table
              rowKey="node"
              size="small"
              pagination={false}
              scroll={{ x: 650, y: 300 }}
              dataSource={preview.diffs}
              columns={[
                { title: 'Nhóm dữ liệu', dataIndex: 'node', render: (node: BackupNode) => nodeLabel(node) },
                { title: 'Thêm', dataIndex: 'added', align: 'right' },
                { title: 'Cập nhật', dataIndex: 'updated', align: 'right' },
                { title: 'Giữ nguyên', dataIndex: 'unchanged', align: 'right' },
                { title: 'Xung đột', dataIndex: 'conflicts', align: 'right' },
                { title: 'Sẽ xóa', dataIndex: 'removed', align: 'right', render: (value: number) => value ? <Text type="danger">{value}</Text> : 0 },
              ]}
            />
          </div>
        )}

        {step === 2 && preview && (
          <div className="restore-step final-confirmation">
            <Alert
              type="error"
              showIcon
              message="Bước xác nhận cuối"
              description={`Đích: ${preview.environment.projectId || 'project không rõ'} · ${selectedNodes.length} node · ${numberFormatter.format(selectedRecordCount)} bản ghi từ tệp.`}
            />
            {mode === 'replace' && (
              <Checkbox checked={replaceAcknowledged} onChange={(event) => setReplaceAcknowledged(event.target.checked)}>
                Tôi hiểu chế độ Thay thế sẽ xóa các bản ghi hiện tại không có trong tệp, chỉ tại các node đã chọn.
              </Checkbox>
            )}
            <label className="confirmation-field">
              <Text strong>Nhập chính xác <Text code>KHOI PHUC</Text> hoặc <Text code>RESTORE</Text></Text>
              <Input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="KHOI PHUC"
                autoComplete="off"
                status={confirmation && !confirmationValid ? 'error' : undefined}
              />
            </label>
            <Text type="secondary">
              Trước khi ghi, ứng dụng bắt buộc tạo và lưu một tệp <Text code>pre-restore-backup</Text>. Nếu không lưu được, quy trình sẽ dừng.
            </Text>
          </div>
        )}

        {step === 3 && restoreResult && (
          <Result
            status={restoreResult.integrity.ok ? 'success' : 'warning'}
            title="Khôi phục đã hoàn tất"
            subTitle={`Restore job: ${restoreResult.jobId}. Kiểm tra toàn vẹn phát hiện ${restoreResult.integrity.issueCount} vấn đề; hệ thống không tự sửa dữ liệu.`}
            extra={(restoreResult.integrity.issues.length > 0 || restoreResult.metadataWarnings?.length) ? (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {restoreResult.metadataWarnings?.map((warning) => (
                  <Alert key={warning} type="warning" showIcon message={warning} />
                ))}
                {restoreResult.integrity.issues.length > 0 && (
                  <List
                    className="integrity-list"
                    size="small"
                    dataSource={restoreResult.integrity.issues}
                    renderItem={(issue) => (
                      <List.Item>
                        <Space align="start">
                          <Tag color={issue.level === 'error' ? 'error' : 'warning'}>{issue.code}</Tag>
                          <div><Text>{issue.message}</Text><br /><Text type="secondary">{issue.path}</Text></div>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Space>
            ) : undefined}
          />
        )}
      </Modal>
    </section>
  );
}

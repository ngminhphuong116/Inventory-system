import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd';
import {
  InboxOutlined,
  LockOutlined,
  ReloadOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { dbService, type UserType } from './Db';
import { useUserRole } from '../hooks/Useuserrole';
import {
  accountActionBlockReason,
  type AccountAction,
  type AccountRecord,
} from '../services/account-management';

const { Text } = Typography;

const statusLabel = (record: UserType) => {
  if (record.archived) return { color: 'default', text: 'Đã lưu trữ' };
  if (record.status === 'active') return { color: 'green', text: 'Hoạt động' };
  return { color: 'orange', text: 'Đã khóa' };
};

export default function UserManagement() {
  const { message, modal } = AntApp.useApp();
  const { isAdmin, userInfo } = useUserRole();
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pendingUid, setPendingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    return dbService.onUsers(
      (nextUsers) => {
        setUsers(nextUsers);
        setLoading(false);
      },
      (error) => {
        setLoadError(error.message || 'Không thể tải danh sách tài khoản.');
        setLoading(false);
      },
    );
  }, [isAdmin]);

  const actor = useMemo<AccountRecord>(() => ({
    key: userInfo?.uid || '',
    email: userInfo?.email || 'Chưa có email',
    role: userInfo?.role === 'admin' ? 'admin' : 'staff',
    lastLogin: 'Chưa có dữ liệu',
    status: 'active',
    archived: false,
  }), [userInfo]);

  const reasonFor = (record: UserType, action: AccountAction) =>
    accountActionBlockReason(actor, record, action);

  const updateStatus = async (record: UserType) => {
    setPendingUid(record.key);
    try {
      const nextStatus = record.status === 'active' ? 'disabled' : 'active';
      await dbService.updateUserStatus(record.key, nextStatus);
      message.success(nextStatus === 'disabled' ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.');
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : 'Không thể cập nhật tài khoản.');
      throw error;
    } finally {
      setPendingUid(null);
    }
  };

  const setArchived = async (record: UserType, archived: boolean) => {
    setPendingUid(record.key);
    try {
      await dbService.archiveUser(record.key, archived);
      message.success(
        archived
          ? 'Đã lưu trữ hồ sơ ứng dụng. Tài khoản Firebase Authentication vẫn tồn tại.'
          : 'Đã khôi phục hồ sơ ứng dụng.',
      );
    } catch (error: unknown) {
      message.error(
        error instanceof Error
          ? error.message
          : archived ? 'Không thể lưu trữ tài khoản.' : 'Không thể khôi phục tài khoản.',
      );
      throw error;
    } finally {
      setPendingUid(null);
    }
  };

  const confirmStatusChange = (record: UserType) => {
    const action: AccountAction = record.status === 'active' ? 'lock' : 'unlock';
    const blocked = reasonFor(record, action);
    if (blocked) {
      message.warning(blocked);
      return;
    }
    modal.confirm({
      title: record.status === 'active' ? 'Khóa tài khoản?' : 'Mở khóa tài khoản?',
      content: (
        <Space direction="vertical" size={4}>
          <Text><strong>Email:</strong> {record.email}</Text>
          <Text><strong>Chức vụ:</strong> {record.role.toUpperCase()}</Text>
          <Text type="secondary">
            {record.status === 'active'
              ? 'Người dùng sẽ bị chặn khỏi ứng dụng bởi hồ sơ RTDB và session guard.'
              : 'Người dùng có thể đăng nhập lại nếu Firebase Authentication còn hợp lệ.'}
          </Text>
        </Space>
      ),
      okText: record.status === 'active' ? 'Khóa tài khoản' : 'Mở khóa',
      okButtonProps: { danger: record.status === 'active' },
      cancelText: 'Hủy',
      onOk: () => updateStatus(record),
    });
  };

  const confirmArchiveChange = (record: UserType) => {
    const action: AccountAction = record.archived ? 'restore' : 'archive';
    const blocked = reasonFor(record, action);
    if (blocked) {
      message.warning(blocked);
      return;
    }
    modal.confirm({
      title: record.archived ? 'Khôi phục hồ sơ ứng dụng?' : 'Lưu trữ hồ sơ ứng dụng?',
      content: (
        <Space direction="vertical" size={4}>
          <Text><strong>Email:</strong> {record.email}</Text>
          <Text><strong>Chức vụ:</strong> {record.role.toUpperCase()}</Text>
          <Text type="secondary">
            {record.archived
              ? 'Hồ sơ sẽ hoạt động trở lại và lịch sử giao dịch vẫn được giữ nguyên.'
              : 'Chỉ hồ sơ RTDB bị đánh dấu lưu trữ. Firebase Authentication không bị xóa và các chứng từ cũ vẫn giữ liên kết người tạo.'}
          </Text>
        </Space>
      ),
      okText: record.archived ? 'Khôi phục' : 'Lưu trữ',
      okButtonProps: { danger: !record.archived },
      cancelText: 'Hủy',
      onOk: () => setArchived(record, !record.archived),
    });
  };

  const columns: TableColumnsType<UserType> = [
    {
      title: 'Email',
      dataIndex: 'email',
      render: (value: string) => value || 'Chưa có email',
    },
    {
      title: 'Chức vụ',
      dataIndex: 'role',
      width: 110,
      render: (role: UserType['role']) => (
        <Tag color={role === 'admin' ? 'red' : 'blue'}>{role.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'Trạng thái',
      width: 120,
      render: (_, record) => {
        const status = statusLabel(record);
        return <Tag color={status.color}>{status.text}</Tag>;
      },
    },
    {
      title: 'Hành động',
      width: 116,
      render: (_, record) => {
        const statusAction: AccountAction = record.status === 'active' ? 'lock' : 'unlock';
        const statusReason = reasonFor(record, statusAction);
        const archiveAction: AccountAction = record.archived ? 'restore' : 'archive';
        const archiveReason = reasonFor(record, archiveAction);
        const busy = pendingUid === record.key;
        return (
          <Space size={4}>
            {!record.archived && (
              <Tooltip title={statusReason || (record.status === 'active' ? 'Khóa tài khoản' : 'Mở khóa tài khoản')}>
                <span>
                  <Button
                    aria-label={record.status === 'active' ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}
                    size="small"
                    disabled={Boolean(statusReason) || busy}
                    loading={busy}
                    icon={record.status === 'active' ? <LockOutlined /> : <UnlockOutlined />}
                    onClick={() => confirmStatusChange(record)}
                  />
                </span>
              </Tooltip>
            )}
            <Tooltip title={archiveReason || (record.archived ? 'Khôi phục hồ sơ' : 'Lưu trữ hồ sơ')}>
              <span>
                <Button
                  aria-label={record.archived ? 'Khôi phục hồ sơ' : 'Lưu trữ hồ sơ'}
                  size="small"
                  danger={!record.archived}
                  disabled={Boolean(archiveReason) || busy}
                  loading={busy}
                  icon={record.archived ? <ReloadOutlined /> : <InboxOutlined />}
                  onClick={() => confirmArchiveChange(record)}
                />
              </span>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  if (!isAdmin) return null;

  return (
    <Card title="Quản lý tài khoản hệ thống" variant="borderless" style={{ borderRadius: 8 }}>
      {loadError && (
        <Alert
          type="error"
          showIcon
          message="Không thể tải danh sách tài khoản"
          description={loadError}
          style={{ marginBottom: 16 }}
        />
      )}
      <Table<UserType>
        rowKey="key"
        size="small"
        loading={loading}
        dataSource={users}
        columns={columns}
        pagination={{ pageSize: 4, hideOnSinglePage: users.length <= 4 }}
        locale={{
          emptyText: loading
            ? 'Đang tải tài khoản...'
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có tài khoản" />,
        }}
      />
      <Text type="secondary">
        Cơ chế khóa/lưu trữ dùng hồ sơ RTDB và session guard; không vô hiệu hóa hoặc xóa Firebase Authentication.
      </Text>
    </Card>
  );
}

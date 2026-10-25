import { Alert, Button, Descriptions, Modal, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ExclamationCircleOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import type {
  TicketConfirmationDraft,
  TicketConfirmationItem,
} from '../services/ticket-confirmation';
import { formatNumberVi, formatVnd } from '../utils/format';
import './TicketConfirmationModal.css';

interface TicketConfirmationModalProps {
  draft: TicketConfirmationDraft<unknown> | null;
  loading: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

const columns: ColumnsType<TicketConfirmationItem> = [
  {
    title: 'Mặt hàng',
    dataIndex: 'productName',
    key: 'productName',
    ellipsis: true,
  },
  {
    title: 'Số lượng',
    dataIndex: 'quantity',
    key: 'quantity',
    width: 100,
    align: 'right',
    render: formatNumberVi,
  },
  {
    title: 'Đơn giá',
    dataIndex: 'unitPrice',
    key: 'unitPrice',
    width: 140,
    align: 'right',
    render: formatVnd,
  },
  {
    title: 'Giảm dòng',
    dataIndex: 'lineDiscountAmount',
    key: 'lineDiscountAmount',
    width: 120,
    align: 'right',
    render: (value: number | undefined) => formatVnd(value || 0),
  },
  {
    title: 'Thành tiền',
    key: 'lineTotal',
    width: 150,
    align: 'right',
    render: (_, item) => (
      <strong>{formatVnd(item.lineTotal ?? item.quantity * item.unitPrice)}</strong>
    ),
  },
];

export default function TicketConfirmationModal({
  draft,
  loading,
  onBack,
  onConfirm,
}: TicketConfirmationModalProps) {
  const kind = draft?.kind;
  const inbound = kind === 'import';
  const sale = kind === 'sale';
  const title = inbound
    ? 'Kiểm tra phiếu nhập kho'
    : sale
      ? 'Kiểm tra phiếu bán hàng'
      : 'Kiểm tra phiếu xuất kho';
  const typeLabel = inbound ? 'Nhập kho' : sale ? 'Bán hàng' : 'Xuất kho';
  const actionIcon = inbound
    ? <ArrowDownOutlined />
    : sale
      ? <ShoppingCartOutlined />
      : <ArrowUpOutlined />;
  return (
    <Modal
      className="ticket-confirmation-modal"
      title={title}
      open={Boolean(draft)}
      width={700}
      closable={!loading}
      maskClosable={!loading}
      keyboard={!loading}
      onCancel={onBack}
      styles={{
        body: {
          maxHeight: 'calc(100dvh - 220px)',
          overflowY: 'auto',
          paddingTop: 18,
        },
      }}
      footer={(
        <Space>
          <Button disabled={loading} onClick={onBack}>
            Quay lại kiểm tra
          </Button>
          <Button
            type="primary"
            danger={kind === 'export'}
            loading={loading}
            icon={actionIcon}
            onClick={onConfirm}
          >
            Xác nhận lập phiếu
          </Button>
        </Space>
      )}
    >
      {draft && (
        <div className="ticket-confirmation-content">
          <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
            <Descriptions.Item label="Loại phiếu">
              <Tag color={inbound ? 'green' : sale ? 'blue' : 'red'}>
                {typeLabel}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Mã chứng từ">
              {draft.documentNo}
            </Descriptions.Item>
            <Descriptions.Item label="Ngày giờ">
              {draft.date}
            </Descriptions.Item>
            <Descriptions.Item label={draft.partnerLabel}>
              {draft.partnerName}
            </Descriptions.Item>
          </Descriptions>

          <Table<TicketConfirmationItem>
            rowKey="productId"
            size="small"
            columns={columns}
            dataSource={draft.items}
            pagination={false}
            scroll={{ x: 600 }}
          />

          <div className="ticket-confirmation-totals">
            <span>Tổng số lượng <strong>{formatNumberVi(draft.totalQuantity)}</strong></span>
            {sale && (
              <>
                <span>Tạm tính <strong>{formatVnd(draft.subtotal)}</strong></span>
                <span>Giảm sản phẩm <strong>−{formatVnd(draft.lineDiscountTotal)}</strong></span>
                <span>Giảm hóa đơn <strong>−{formatVnd(draft.invoiceDiscountAmount)}</strong></span>
              </>
            )}
            <span>{sale ? 'Khách cần trả' : 'Tổng giá trị'} <strong>{formatVnd(draft.totalAmount)}</strong></span>
          </div>

          <Alert
            type={inbound ? 'success' : 'warning'}
            showIcon
            icon={<ExclamationCircleOutlined />}
            message={
              inbound
                ? 'Tồn kho sẽ được cộng sau khi xác nhận.'
                : sale
                  ? 'Hóa đơn bán hàng sẽ được ghi nhận và tồn kho sẽ bị trừ sau khi xác nhận.'
                  : 'Tồn kho sẽ bị trừ sau khi xác nhận.'
            }
          />
        </div>
      )}
    </Modal>
  );
}

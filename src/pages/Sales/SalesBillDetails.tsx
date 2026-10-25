import { Descriptions, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { SalesTicketType } from '../../components/Db';
import { formatNumberVi, formatVnd } from '../../utils/format';
import {
  normalizeSaleBill,
  type NormalizedTransactionItem,
} from '../../utils/transaction-money';

interface SalesBillDetailsProps {
  record: SalesTicketType;
}

const columns: ColumnsType<NormalizedTransactionItem> = [
  { title: 'Mã SP', dataIndex: 'productCode', key: 'productCode', width: 110 },
  { title: 'Tên sản phẩm', dataIndex: 'productName', key: 'productName', ellipsis: true },
  { title: 'SL', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'right', render: formatNumberVi },
  { title: 'Giá niêm yết', dataIndex: 'listedPrice', key: 'listedPrice', width: 135, align: 'right', render: formatVnd },
  { title: 'Giá thực tế', dataIndex: 'unitPrice', key: 'unitPrice', width: 130, align: 'right', render: formatVnd },
  { title: 'Giảm dòng', dataIndex: 'lineDiscountAmount', key: 'lineDiscountAmount', width: 120, align: 'right', render: formatVnd },
  { title: 'Thành tiền', dataIndex: 'lineTotal', key: 'lineTotal', width: 140, align: 'right', render: (value) => <strong>{formatVnd(value)}</strong> },
];

export default function SalesBillDetails({ record }: SalesBillDetailsProps) {
  const bill = normalizeSaleBill(record);
  return (
    <div className="sales-bill-details">
      <Table<NormalizedTransactionItem>
        rowKey={(item, index) => `${item.productId}-${index ?? 0}`}
        size="small"
        columns={columns}
        dataSource={bill.items}
        pagination={false}
        scroll={{ x: 900 }}
      />
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }} bordered>
        <Descriptions.Item label="Tổng số lượng">{formatNumberVi(bill.totalQuantity)}</Descriptions.Item>
        <Descriptions.Item label="Tạm tính">{formatVnd(bill.subtotal)}</Descriptions.Item>
        <Descriptions.Item label="Giảm sản phẩm">−{formatVnd(bill.lineDiscountTotal)}</Descriptions.Item>
        <Descriptions.Item label="Giảm hóa đơn">−{formatVnd(bill.invoiceDiscountAmount)}</Descriptions.Item>
        <Descriptions.Item label="Khách cần trả" span={4}>
          <strong>{formatVnd(bill.totalAmount)}</strong>
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

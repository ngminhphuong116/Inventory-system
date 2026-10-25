import { Alert, Button, InputNumber, Select, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, WarningOutlined } from '@ant-design/icons';
import { formatNumberVi, formatVnd, parseVndInput } from '../../utils/format';
import {
  isCartItemValid,
  type CartItem,
  type DiscountType,
} from './sales-cart';

interface SalesCartTableProps {
  items: CartItem[];
  onChange: (productId: string, patch: Partial<CartItem>) => void;
  onRemove: (productId: string) => void;
}

const discountOptions: Array<{ value: DiscountType; label: string }> = [
  { value: 'none', label: 'Không giảm' },
  { value: 'amount', label: 'Số tiền' },
  { value: 'percent', label: 'Phần trăm' },
];

export default function SalesCartTable({
  items,
  onChange,
  onRemove,
}: SalesCartTableProps) {
  const columns: ColumnsType<CartItem> = [
    {
      title: 'STT',
      key: 'index',
      width: 58,
      align: 'center',
      render: (_, __, index) => index + 1,
    },
    {
      title: 'Mã SP',
      dataIndex: 'productCode',
      key: 'productCode',
      width: 105,
      ellipsis: true,
      render: (value: string) => value || '—',
    },
    {
      title: 'Tên sản phẩm',
      dataIndex: 'productName',
      key: 'productName',
      width: 210,
      render: (name: string, item) => (
        <div className="sales-cart-product">
          <Tooltip title={name} mouseEnterDelay={0.4}>
            <strong>{name}</strong>
          </Tooltip>
          {item.unitCost !== undefined && item.unitPrice < item.unitCost && (
            <span className="sales-cart-warning">
              <WarningOutlined /> Giá thực tế thấp hơn giá vốn {formatVnd(item.unitCost)}
            </span>
          )}
        </div>
      ),
    },
    {
      title: 'Tồn',
      dataIndex: 'availableStock',
      key: 'availableStock',
      width: 90,
      align: 'right',
      render: (stock: number, item) => `${formatNumberVi(stock)} ${item.unit}`,
    },
    {
      title: 'Số lượng',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 112,
      render: (quantity: number, item) => (
        <div>
          <InputNumber<number>
            aria-label={`Số lượng ${item.productName}`}
            min={1}
            max={Math.max(1, item.availableStock)}
            precision={0}
            value={quantity}
            status={quantity < 1 || quantity > item.availableStock ? 'error' : undefined}
            onChange={(value) => {
              if (value !== null) onChange(item.productId, { quantity: Number(value) });
            }}
          />
          {quantity > item.availableStock && (
            <span className="sales-cart-field-error">Vượt tồn {item.availableStock}</span>
          )}
        </div>
      ),
    },
    {
      title: 'Giá niêm yết',
      dataIndex: 'listedPrice',
      key: 'listedPrice',
      width: 135,
      align: 'right',
      render: formatVnd,
    },
    {
      title: 'Giá thực tế',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 150,
      render: (unitPrice: number, item) => (
        <InputNumber<number>
          aria-label={`Đơn giá thực tế ${item.productName}`}
          min={0}
          precision={0}
          value={unitPrice}
          formatter={(value) => formatNumberVi(Number(value || 0))}
          parser={parseVndInput}
          onChange={(value) => {
            if (value !== null) onChange(item.productId, { unitPrice: Number(value) });
          }}
        />
      ),
    },
    {
      title: 'Giảm giá dòng',
      key: 'lineDiscount',
      width: 230,
      render: (_, item) => (
        <div className="sales-cart-discount">
          <Select<DiscountType>
            aria-label={`Kiểu giảm giá ${item.productName}`}
            value={item.lineDiscountType}
            options={discountOptions}
            onChange={(value) => onChange(item.productId, {
              lineDiscountType: value,
              lineDiscountValue: 0,
            })}
          />
          <InputNumber<number>
            aria-label={`Giá trị giảm giá ${item.productName}`}
            min={0}
            max={item.lineDiscountType === 'percent' ? 100 : item.subtotalBeforeDiscount}
            precision={0}
            disabled={item.lineDiscountType === 'none'}
            value={item.lineDiscountValue}
            formatter={item.lineDiscountType === 'amount'
              ? (value) => formatNumberVi(Number(value || 0))
              : undefined}
            parser={item.lineDiscountType === 'amount' ? parseVndInput : undefined}
            addonAfter={item.lineDiscountType === 'percent' ? '%' : undefined}
            onChange={(value) => onChange(item.productId, {
              lineDiscountValue: Number(value ?? 0),
            })}
          />
        </div>
      ),
    },
    {
      title: 'Thành tiền',
      dataIndex: 'lineTotal',
      key: 'lineTotal',
      width: 145,
      align: 'right',
      render: (value: number) => <strong>{formatVnd(value)}</strong>,
    },
    {
      title: '',
      key: 'action',
      width: 56,
      fixed: 'right',
      align: 'center',
      render: (_, item) => (
        <Button
          type="text"
          danger
          aria-label={`Xóa ${item.productName} khỏi giỏ`}
          title="Xóa khỏi giỏ"
          icon={<DeleteOutlined />}
          onClick={() => onRemove(item.productId)}
        />
      ),
    },
  ];

  return (
    <>
      {items.some((item) => !isCartItemValid(item)) && (
        <Alert
          className="sales-cart-alert"
          type="error"
          showIcon
          message="Giỏ hàng có dòng chưa hợp lệ. Hãy kiểm tra số lượng, tồn kho và đơn giá."
        />
      )}
      <Table<CartItem>
        className="operation-table sales-cart-table"
        rowKey="productId"
        size="small"
        columns={columns}
        dataSource={items}
        pagination={false}
        scroll={{ x: 1300, y: 390 }}
        locale={{ emptyText: 'Chưa có sản phẩm. Hãy tìm và thêm hàng vào giỏ.' }}
        rowClassName={(item) => !isCartItemValid(item) ? 'sales-cart-row--invalid' : ''}
      />
    </>
  );
}

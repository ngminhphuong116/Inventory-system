import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  type RefSelectProps,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  PlusOutlined,
  PrinterOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  dbService,
  type ProductType,
  type SalesTicketType,
  type VoucherType,
} from '../../components/Db';
import { useUserRole } from '../../hooks/Useuserrole';
import { openSalesReceiptPreview } from '../../components/SalesReceipt';
import {
  formatDateTimeVi,
  formatNumberVi,
  formatVnd,
  parseVndInput,
} from '../../utils/format';
import { createOperationId, formatFirebaseError } from '../../services/data-integrity';
import TicketConfirmationModal from '../../components/TicketConfirmationModal';
import {
  TicketConfirmationGate,
  type TicketConfirmationDraft,
} from '../../services/ticket-confirmation';
import { normalizeSaleBill } from '../../utils/transaction-money';
import SalesCartTable from './SalesCartTable';
import SalesBillDetails from './SalesBillDetails';
import {
  addProductToCart,
  isCartItemValid,
  recalculateCartItem,
  summarizeCart,
  type CartItem,
  type DiscountType,
  type InvoiceDiscount,
} from './sales-cart';
import '../Dashboard/Dashboard.css';
import '../../styles/operation-flow.css';
import './Sales.css';

interface ContextType { darkMode: boolean; }

const defaultInvoiceDiscount: InvoiceDiscount = {
  type: 'none',
  value: 0,
  amount: 0,
};

const invoiceDiscountOptions: Array<{ value: DiscountType; label: string }> = [
  { value: 'none', label: 'Không giảm' },
  { value: 'amount', label: 'Theo số tiền' },
  { value: 'percent', label: 'Theo phần trăm' },
];

function voucherDiscountAmount(voucher: VoucherType, base: number) {
  if (base < voucher.minOrder) return 0;
  const raw = voucher.type === 'percentage'
    ? Math.floor((base * voucher.value) / 100)
    : voucher.value;
  const capped = voucher.maxBox === undefined ? raw : Math.min(raw, voucher.maxBox);
  return Math.min(base, Math.max(0, capped));
}

function billProductSummary(record: SalesTicketType) {
  const bill = normalizeSaleBill(record);
  const firstName = bill.items[0]?.productName || record.productName || 'Sản phẩm';
  return bill.items.length > 1
    ? `${firstName} + ${bill.items.length - 1} sản phẩm`
    : firstName;
}

export default function SalesPage() {
  const [metaForm] = Form.useForm();
  const [productForm] = Form.useForm();
  const { message, modal } = AntApp.useApp();
  const { darkMode } = useOutletContext<ContextType>();
  const { isAdmin, userInfo, hasPermission } = useUserRole();
  const productSelectRef = useRef<RefSelectProps>(null);

  const [products, setProducts] = useState<ProductType[]>([]);
  const [tickets, setTickets] = useState<SalesTicketType[]>([]);
  const [vouchers, setVouchers] = useState<VoucherType[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState<InvoiceDiscount>(defaultInvoiceDiscount);
  const [voucherCode, setVoucherCode] = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState<VoucherType | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<
    TicketConfirmationDraft<Omit<SalesTicketType, 'key'>> | null
  >(null);

  const confirmationGateRef = useRef(
    new TicketConfirmationGate<Omit<SalesTicketType, 'key'>>(),
  );
  const savingRef = useRef(false);
  const operationIdRef = useRef<string | null>(null);
  const cancelOperationIdsRef = useRef<Record<string, string>>({});

  const selectedProductId = Form.useWatch('productId', productForm);
  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const liveCartItems = useMemo(() => cartItems.map((item) => {
    const latest = products.find((product) => product.id === item.productId);
    return recalculateCartItem({
      ...item,
      availableStock: latest ? Number(latest.quantity || 0) : 0,
    });
  }), [cartItems, products]);
  const lineSubtotal = useMemo(
    () => liveCartItems.reduce((sum, item) => sum + item.subtotalBeforeDiscount, 0),
    [liveCartItems],
  );
  const lineDiscountTotal = useMemo(
    () => liveCartItems.reduce((sum, item) => sum + item.lineDiscountAmount, 0),
    [liveCartItems],
  );
  const afterLineDiscount = Math.max(0, lineSubtotal - lineDiscountTotal);
  const effectiveInvoiceDiscount = useMemo<InvoiceDiscount>(() => {
    if (!appliedVoucher) return invoiceDiscount;
    return {
      type: 'amount',
      value: voucherDiscountAmount(appliedVoucher, afterLineDiscount),
      amount: voucherDiscountAmount(appliedVoucher, afterLineDiscount),
      code: appliedVoucher.code,
    };
  }, [afterLineDiscount, appliedVoucher, invoiceDiscount]);
  const cartSummary = useMemo(
    () => summarizeCart(liveCartItems, effectiveInvoiceDiscount),
    [effectiveInvoiceDiscount, liveCartItems],
  );
  const voucherStillValid = !appliedVoucher || afterLineDiscount >= appliedVoucher.minOrder;
  const canSell = Boolean(userInfo && hasPermission('sales'));
  const cartValid = liveCartItems.length > 0
    && liveCartItems.every(isCartItemValid)
    && Number.isSafeInteger(cartSummary.grandTotal)
    && cartSummary.grandTotal >= 0
    && voucherStillValid;

  useEffect(() => {
    const handleDataError = (error: Error) => {
      setLoadingTickets(false);
      message.error(formatFirebaseError(error));
    };
    const unsubP = dbService.onProducts(setProducts, handleDataError);
    const unsubT = dbService.onSalesTickets((data) => {
      setTickets(data);
      setLoadingTickets(false);
    }, false, handleDataError);
    const unsubV = dbService.onVouchers(setVouchers, handleDataError);
    return () => { unsubP(); unsubT(); unsubV(); };
  }, [message]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (cartItems.length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [cartItems.length]);

  const handleProductChange = (productId: string) => {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product) return;
    productForm.setFieldsValue({
      currentQuantity: product.quantity,
      addUnitPrice: product.salePrice,
      addQuantity: 1,
    });
  };

  const resetProductPicker = () => {
    productForm.setFieldsValue({
      productId: undefined,
      currentQuantity: undefined,
      addUnitPrice: 0,
      addQuantity: 1,
    });
    window.setTimeout(() => productSelectRef.current?.focus(), 0);
  };

  const handleAddToCart = async () => {
    try {
      const values = await productForm.validateFields(['productId', 'addQuantity', 'addUnitPrice']);
      const product = products.find((candidate) => candidate.id === values.productId);
      if (!product) throw new Error('Không tìm thấy sản phẩm đã chọn.');
      const next = addProductToCart(
        liveCartItems,
        product,
        values.addQuantity,
        values.addUnitPrice,
      );
      setCartItems(next);
      resetProductPicker();
      message.success(next.length === cartItems.length
        ? `Đã tăng số lượng ${product.name} trong giỏ.`
        : `Đã thêm ${product.name} vào giỏ.`);
    } catch (error: unknown) {
      const validationError = error as { errorFields?: unknown };
      if (validationError.errorFields) return;
      message.error(error instanceof Error ? error.message : 'Không thể thêm sản phẩm vào giỏ.');
    }
  };

  const updateCartItem = (productId: string, patch: Partial<CartItem>) => {
    setCartItems((current) => current.map((item) => item.productId === productId
      ? recalculateCartItem({ ...item, ...patch })
      : item));
  };

  const removeCartItem = (productId: string) => {
    setCartItems((current) => current.filter((item) => item.productId !== productId));
  };

  const clearCart = () => {
    modal.confirm({
      title: 'Xóa toàn bộ giỏ hàng?',
      content: 'Các sản phẩm và mức giá đang chỉnh sẽ bị xóa khỏi giỏ.',
      okText: 'Xóa giỏ hàng',
      cancelText: 'Giữ lại',
      okButtonProps: { danger: true },
      onOk: () => {
        setCartItems([]);
        setAppliedVoucher(null);
        setVoucherCode('');
        setInvoiceDiscount(defaultInvoiceDiscount);
      },
    });
  };

  const handleApplyVoucher = () => {
    const normalizedCode = voucherCode.trim().toUpperCase();
    if (!normalizedCode) {
      message.warning('Vui lòng nhập mã giảm giá.');
      return;
    }
    const voucher = vouchers.find((item) => item.code.trim().toUpperCase() === normalizedCode);
    if (!voucher) {
      message.error('Mã giảm giá không tồn tại hoặc đã hết hiệu lực.');
      return;
    }
    if (afterLineDiscount < voucher.minOrder) {
      message.error(`Mã này áp dụng cho hóa đơn từ ${formatVnd(voucher.minOrder)}.`);
      return;
    }
    setAppliedVoucher(voucher);
    setInvoiceDiscount(defaultInvoiceDiscount);
    message.success(`Đã áp dụng mã ${voucher.code}.`);
  };

  const prepareSalesTicket = async () => {
    if (!canSell || !userInfo) {
      message.error('Tài khoản không có quyền lập phiếu bán hàng.');
      return;
    }
    if (!cartValid) {
      message.error('Giỏ hàng chưa hợp lệ. Hãy kiểm tra tồn kho, số lượng, giá và giảm giá.');
      return;
    }
    try {
      const values = await metaForm.validateFields(['date', 'invoiceNo', 'customerName']);
      const ticketDate = values.date
        ? values.date.format('YYYY-MM-DD HH:mm')
        : dayjs().format('YYYY-MM-DD HH:mm');
      const invoiceNo = values.invoiceNo?.trim() || `BL-${Date.now().toString().slice(-8)}`;
      const firstItem = liveCartItems[0];
      const payloadItems = liveCartItems.map((item) => ({
        productId: item.productId,
        productCode: item.productCode,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        actualUnitPrice: item.unitPrice,
        listedPrice: item.listedPrice,
        salePrice: item.unitPrice,
        costPrice: item.unitCost,
        subtotal: item.subtotalBeforeDiscount,
        subtotalBeforeDiscount: item.subtotalBeforeDiscount,
        lineDiscountType: item.lineDiscountType,
        lineDiscountValue: item.lineDiscountValue,
        lineDiscountAmount: item.lineDiscountAmount,
        lineTotal: item.lineTotal,
      }));
      const payload: Omit<SalesTicketType, 'key'> = {
        date: ticketDate,
        invoiceNo,
        billCode: invoiceNo,
        customerName: values.customerName?.trim() || 'Khách bán lẻ vãng lai',
        productName: firstItem.productName,
        productId: firstItem.productId,
        quantity: cartSummary.totalQuantity,
        totalQuantity: cartSummary.totalQuantity,
        unitPrice: firstItem.unitPrice,
        actualUnitPrice: firstItem.unitPrice,
        listedPrice: firstItem.listedPrice,
        salePrice: firstItem.unitPrice,
        subtotal: cartSummary.subtotal,
        lineDiscountTotal: cartSummary.lineDiscountTotal,
        invoiceDiscountType: appliedVoucher
          ? (appliedVoucher.type === 'percentage' ? 'percent' : 'amount')
          : invoiceDiscount.type,
        invoiceDiscountValue: appliedVoucher?.value ?? invoiceDiscount.value,
        invoiceDiscountAmount: cartSummary.invoiceDiscountAmount,
        discountAmount: cartSummary.lineDiscountTotal + cartSummary.invoiceDiscountAmount,
        totalAmount: cartSummary.grandTotal,
        items: payloadItems,
        voucherUsed: appliedVoucher?.code || 'Không có',
        type: 'Bán lẻ quầy',
        createdBy: userInfo.name || userInfo.email,
        createdByEmail: userInfo.email,
      };
      const draft: TicketConfirmationDraft<typeof payload> = {
        kind: 'sale',
        documentNo: invoiceNo,
        date: ticketDate,
        partnerLabel: 'Khách hàng',
        partnerName: payload.customerName,
        items: liveCartItems.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineDiscountAmount: item.lineDiscountAmount,
          lineTotal: item.lineTotal,
        })),
        totalQuantity: cartSummary.totalQuantity,
        subtotal: cartSummary.subtotal,
        lineDiscountTotal: cartSummary.lineDiscountTotal,
        invoiceDiscountAmount: cartSummary.invoiceDiscountAmount,
        discountAmount: payload.discountAmount,
        totalAmount: cartSummary.grandTotal,
        payload,
      };
      confirmationGateRef.current.prepare(draft);
      setPendingDraft(draft);
    } catch (error: unknown) {
      const validationError = error as { errorFields?: unknown };
      if (validationError.errorFields) return;
      message.error(formatFirebaseError(error));
    }
  };

  const confirmCreateSalesTicket = async () => {
    if (!canSell || !userInfo) {
      message.error('Tài khoản không có quyền lập phiếu bán hàng.');
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      operationIdRef.current ??= createOperationId();
      await confirmationGateRef.current.confirm(async (draft) => {
        await dbService.addSalesTicket(draft.payload, operationIdRef.current!);
      });
      operationIdRef.current = null;
      setPendingDraft(null);
      setCartItems([]);
      setVoucherCode('');
      setAppliedVoucher(null);
      setInvoiceDiscount(defaultInvoiceDiscount);
      metaForm.resetFields();
      metaForm.setFieldsValue({ date: dayjs() });
      productForm.resetFields();
      productForm.setFieldsValue({
        addQuantity: 1,
        addUnitPrice: 0,
      });
      message.success('Đã tạo một hóa đơn và trừ tồn toàn bộ giỏ hàng thành công.');
      window.setTimeout(() => productSelectRef.current?.focus(), 0);
    } catch (error: unknown) {
      message.error(formatFirebaseError(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const closeConfirmation = () => {
    if (saving) return;
    confirmationGateRef.current.cancel();
    setPendingDraft(null);
  };

  const handleDeleteTicket = async (key: string, reason: string) => {
    if (!isAdmin) {
      message.warning('Bạn không có quyền hủy hóa đơn.');
      return;
    }
    try {
      cancelOperationIdsRef.current[key] ??= createOperationId();
      await dbService.cancelSalesTicket(key, reason, cancelOperationIdsRef.current[key]);
      delete cancelOperationIdsRef.current[key];
      message.success('Đã hủy hóa đơn và hoàn trả tồn kho.');
    } catch (error: unknown) {
      message.error(formatFirebaseError(error));
      throw error;
    }
  };

  const showCancelConfirmation = (key: string) => {
    let reason = '';
    modal.confirm({
      title: 'Hủy hóa đơn bán hàng',
      content: (
        <Input.TextArea
          autoFocus
          maxLength={300}
          placeholder="Nhập lý do hủy hóa đơn"
          onChange={(event) => { reason = event.target.value; }}
        />
      ),
      okText: 'Hủy hóa đơn',
      cancelText: 'Giữ lại',
      okButtonProps: { danger: true },
      onOk: () => {
        if (!reason.trim()) {
          message.warning('Vui lòng nhập lý do hủy hóa đơn.');
          return Promise.reject();
        }
        return handleDeleteTicket(key, reason.trim());
      },
    });
  };

  const handlePrint = async (record: SalesTicketType) => {
    try {
      await openSalesReceiptPreview(record);
    } catch (error) {
      console.error('Không thể mở xem trước phiếu bán hàng:', error);
      message.error('Không thể mở xem trước phiếu bán hàng. Vui lòng thử lại.');
    }
  };

  const columns = [
    { title: 'Mã Bill', dataIndex: 'invoiceNo', key: 'invoiceNo', width: 130 },
    { title: 'Thời gian', dataIndex: 'date', key: 'date', width: 155, render: formatDateTimeVi },
    {
      title: 'Người tạo', dataIndex: 'createdBy', key: 'createdBy', width: 150,
      render: (text: string) => <Tag color="blue">{text || 'Hệ thống'}</Tag>,
    },
    {
      title: 'Mặt hàng', key: 'productSummary', width: 230,
      render: (_: unknown, record: SalesTicketType) => billProductSummary(record),
    },
    {
      title: 'SL', key: 'quantity', width: 80, align: 'right' as const,
      render: (_: unknown, record: SalesTicketType) => formatNumberVi(normalizeSaleBill(record).totalQuantity),
    },
    {
      title: 'Mã giảm', dataIndex: 'voucherUsed', key: 'voucherUsed', width: 110,
      render: (code: string) => code && code !== 'Không có'
        ? <Tag color="green">{code}</Tag>
        : <span className="sales-empty-value">—</span>,
    },
    {
      title: 'Thành tiền', key: 'totalAmount', width: 150, align: 'right' as const,
      render: (_: unknown, record: SalesTicketType) => (
        <strong className="sales-bill-total">{formatVnd(normalizeSaleBill(record).totalAmount)}</strong>
      ),
    },
    {
      title: 'Thao tác', key: 'actions', width: 100, fixed: 'right' as const,
      render: (_: unknown, record: SalesTicketType) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            aria-label="Xem trước phiếu bán hàng"
            title="Xem trước phiếu bán hàng"
            icon={<PrinterOutlined />}
            onClick={() => void handlePrint(record)}
          />
          {isAdmin && (
            <Button
              type="text"
              size="small"
              danger
              aria-label="Hủy hóa đơn và hoàn trả tồn kho"
              icon={<CloseCircleOutlined />}
              title="Hủy hóa đơn và hoàn trả tồn kho"
              onClick={() => showCancelConfirmation(record.key)}
            />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className={`sales-page operation-page${darkMode ? ' operation-page--dark' : ''}`}>
      <header className="operation-page__header">
        <h1 className="operation-page__title">Quầy Bán Hàng &amp; Tính Tiền (POS)</h1>
      </header>

      <Card className="operation-card sales-meta-card" variant="borderless">
        <Form
          className="operation-form"
          form={metaForm}
          layout="vertical"
          autoComplete="off"
          initialValues={{ date: dayjs(), addQuantity: 1, addUnitPrice: 0 }}
        >
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Thời gian" name="date" rules={[{ required: true, message: 'Chọn thời gian hóa đơn' }]}>
                <DatePicker showTime format="YYYY-MM-DD HH:mm" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Số hóa đơn" name="invoiceNo">
                <Input maxLength={80} placeholder="Để trống để tạo tự động" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Tên khách mua hàng" name="customerName">
                <Input maxLength={200} placeholder="Mặc định: Khách bán lẻ vãng lai" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card className="operation-card sales-compose-card" variant="borderless">
        <div className="sales-compose-layout">
          <section className="sales-product-picker" aria-labelledby="sales-product-picker-title">
            <div className="sales-section-heading">
              <h2 id="sales-product-picker-title">Thêm sản phẩm</h2>
              <p>Tìm theo tên, mã sản phẩm hoặc mã vạch.</p>
            </div>
            <Form className="operation-form" form={productForm} layout="vertical">
              <Form.Item
                label="Sản phẩm"
                name="productId"
                rules={[{ required: true, message: 'Vui lòng chọn sản phẩm' }]}
              >
                <Select
                  ref={productSelectRef}
                  placeholder="Tìm sản phẩm..."
                  showSearch
                  autoFocus
                  disabled={products.length === 0 || saving}
                  onChange={handleProductChange}
                  onInputKeyDown={(event) => {
                    if (event.key === 'Enter' && selectedProductId) {
                      event.preventDefault();
                      void handleAddToCart();
                    }
                  }}
                  filterOption={(input, option) => {
                    const product = products.find((item) => item.id === option?.value);
                    const haystack = [product?.name, product?.code, product?.barcode]
                      .filter(Boolean)
                      .join(' ')
                      .toLocaleLowerCase('vi-VN');
                    return haystack.includes(input.trim().toLocaleLowerCase('vi-VN'));
                  }}
                  options={products.map((product) => ({
                    value: product.id,
                    label: `${product.code ? `${product.code} · ` : ''}${product.name} · Còn ${formatNumberVi(product.quantity)} ${product.unit}`,
                  }))}
                />
              </Form.Item>
              <Form.Item label="Tồn kho hiện tại" name="currentQuantity">
                <InputNumber disabled addonAfter={selectedProduct?.unit || ''} />
              </Form.Item>
              <Form.Item
                label="Đơn giá mặc định"
                name="addUnitPrice"
                rules={[{
                  validator: (_, value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('Đơn giá phải là số không âm.')),
                }]}
              >
                <InputNumber<number>
                  min={0}
                  precision={0}
                  formatter={(value) => formatNumberVi(Number(value || 0))}
                  parser={parseVndInput}
                />
              </Form.Item>
              <Form.Item
                label="Số lượng"
                name="addQuantity"
                rules={[{
                  validator: (_, value) => Number.isSafeInteger(Number(value)) && Number(value) > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('Số lượng phải là số nguyên lớn hơn 0.')),
                }]}
              >
                <InputNumber min={1} max={selectedProduct?.quantity} precision={0} />
              </Form.Item>
              <Button
                className="app-action-button app-action-button--primary"
                type="primary"
                block
                icon={<PlusOutlined />}
                disabled={!selectedProduct || saving}
                onClick={() => void handleAddToCart()}
              >
                Thêm vào giỏ
              </Button>
            </Form>
          </section>

          <section className="sales-cart-area" aria-labelledby="sales-cart-title">
            <header className="sales-cart-heading">
              <div>
                <h2 id="sales-cart-title">
                  Giỏ hàng · {cartItems.length} mặt hàng · {formatNumberVi(cartSummary.totalQuantity)} sản phẩm
                </h2>
                <p>Chỉnh số lượng, giá thực tế và giảm giá ngay trên từng dòng.</p>
              </div>
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={cartItems.length === 0 || saving}
                onClick={clearCart}
              >
                Xóa toàn bộ giỏ
              </Button>
            </header>

            <SalesCartTable
              items={liveCartItems}
              onChange={updateCartItem}
              onRemove={removeCartItem}
            />

            <div className="sales-checkout">
              <div className="sales-discount-controls">
                <strong>Giảm giá hóa đơn</strong>
                <div className="sales-discount-row">
                  <Select<DiscountType>
                    aria-label="Kiểu giảm giá hóa đơn"
                    value={invoiceDiscount.type}
                    options={invoiceDiscountOptions}
                    disabled={Boolean(appliedVoucher)}
                    onChange={(type) => setInvoiceDiscount({ type, value: 0, amount: 0 })}
                  />
                  <InputNumber<number>
                    aria-label="Giá trị giảm giá hóa đơn"
                    min={0}
                    max={invoiceDiscount.type === 'percent' ? 100 : afterLineDiscount}
                    precision={0}
                    disabled={invoiceDiscount.type === 'none' || Boolean(appliedVoucher)}
                    value={invoiceDiscount.value}
                    formatter={invoiceDiscount.type === 'amount'
                      ? (value) => formatNumberVi(Number(value || 0))
                      : undefined}
                    parser={invoiceDiscount.type === 'amount' ? parseVndInput : undefined}
                    addonAfter={invoiceDiscount.type === 'percent' ? '%' : undefined}
                    onChange={(value) => setInvoiceDiscount((current) => ({
                      ...current,
                      value: Number(value ?? 0),
                    }))}
                  />
                </div>
                <Space.Compact block>
                  <Input
                    aria-label="Mã giảm giá"
                    maxLength={80}
                    placeholder="Nhập mã giảm giá hiện có"
                    value={voucherCode}
                    disabled={Boolean(appliedVoucher)}
                    onChange={(event) => setVoucherCode(event.target.value)}
                    onPressEnter={handleApplyVoucher}
                  />
                  <Button
                    type="primary"
                    disabled={Boolean(appliedVoucher) || cartItems.length === 0}
                    onClick={handleApplyVoucher}
                  >
                    {appliedVoucher ? <CheckCircleOutlined /> : 'Áp dụng'}
                  </Button>
                </Space.Compact>
                {appliedVoucher && (
                  <div className="sales-voucher-status">
                    <span>
                      {voucherStillValid
                        ? `Đã áp dụng ${appliedVoucher.code}: −${formatVnd(cartSummary.invoiceDiscountAmount)}`
                        : `Hóa đơn không còn đạt mức tối thiểu ${formatVnd(appliedVoucher.minOrder)}`}
                    </span>
                    <Button
                      type="link"
                      danger
                      size="small"
                      onClick={() => {
                        setAppliedVoucher(null);
                        setVoucherCode('');
                      }}
                    >
                      Hủy mã
                    </Button>
                  </div>
                )}
              </div>

              <div className="sales-summary" aria-label="Tổng tiền hóa đơn">
                <div className="sales-summary-row"><span>Tạm tính</span><strong>{formatVnd(cartSummary.subtotal)}</strong></div>
                <div className="sales-summary-row"><span>Giảm giá sản phẩm</span><strong>−{formatVnd(cartSummary.lineDiscountTotal)}</strong></div>
                <div className="sales-summary-row"><span>Giảm giá hóa đơn</span><strong>−{formatVnd(cartSummary.invoiceDiscountAmount)}</strong></div>
                <div className="sales-summary-row sales-summary-row--total"><span>Khách cần trả</span><strong>{formatVnd(cartSummary.grandTotal)}</strong></div>
                <Button
                  className="operation-form__submit sales-submit"
                  type="primary"
                  icon={<ShoppingCartOutlined />}
                  size="large"
                  block
                  loading={saving}
                  disabled={!cartValid || !canSell || saving}
                  onClick={() => void prepareSalesTicket()}
                >
                  Xác nhận &amp; Xuất hóa đơn
                </Button>
              </div>
            </div>
          </section>
        </div>
      </Card>

      <Card
        className="operation-card sales-bill-list"
        title="Danh sách Bill bán tại quầy"
        variant="borderless"
      >
        {loadingTickets
          ? <Spin style={{ display: 'block', margin: '40px auto' }} />
          : (
            <Table<SalesTicketType>
              className="operation-table"
              size="middle"
              columns={columns}
              dataSource={tickets}
              rowKey="key"
              pagination={{ pageSize: 6 }}
              scroll={{ x: 1100 }}
              expandable={{
                expandedRowRender: (record) => <SalesBillDetails record={record} />,
                rowExpandable: (record) => normalizeSaleBill(record).items.length > 0,
              }}
            />
          )}
      </Card>

      <TicketConfirmationModal
        draft={pendingDraft}
        loading={saving}
        onBack={closeConfirmation}
        onConfirm={() => void confirmCreateSalesTicket()}
      />
    </div>
  );
}

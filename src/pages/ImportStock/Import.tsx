import { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Row, Col, Card, Form, Select, Input, InputNumber,
  App as AntApp, Button, Table, DatePicker, Spin,
} from 'antd';
import { CloseCircleOutlined, DownloadOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { dbService, type ProductType, type ImportTicketType } from '../../components/Db';
import { useUserRole } from '../../hooks/Useuserrole';
import { printTicket } from '../../components/Printticket';
import { formatDateTimeVi, formatVnd, formatNumberVi, parseVndInput } from '../../utils/format';
import { createOperationId, formatFirebaseError } from '../../services/data-integrity';
import TicketConfirmationModal from '../../components/TicketConfirmationModal';
import {
  TicketConfirmationGate,
  type TicketConfirmationDraft,
} from '../../services/ticket-confirmation';
import {
  getTransactionItems,
  getTransactionTotal,
  requireTransactionValues,
  transactionQuantityRule,
  transactionUnitPriceRule,
} from '../../utils/transaction-money';
import "../Dashboard/Dashboard.css";
import "../../styles/operation-flow.css";

interface ContextType { darkMode: boolean; }

export default function ImportPage() {
  const [form] = Form.useForm();
  const { message, modal } = AntApp.useApp();
  const { darkMode } = useOutletContext<ContextType>();
  const { isAdmin, userInfo } = useUserRole();

  const [products, setProducts] = useState<ProductType[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<ProductType[]>([]);
  const [tickets, setTickets] = useState<ImportTicketType[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<
    TicketConfirmationDraft<Omit<ImportTicketType, 'key'>> | null
  >(null);
  const confirmationGateRef = useRef(
    new TicketConfirmationGate<Omit<ImportTicketType, 'key'>>(),
  );
  const savingRef = useRef(false);
  const operationIdRef = useRef<string | null>(null);
  const cancelOperationIdsRef = useRef<Record<string, string>>({});

  // ✅ Realtime từ Firebase
  useEffect(() => {
    const handleDataError = (error: Error) => {
      setLoadingTickets(false);
      message.error(formatFirebaseError(error));
    };
    const unsubP = dbService.onProducts(setProducts, handleDataError);
    const unsubT = dbService.onImportTickets((data) => {
      const sortedTickets = [...data].sort((a, b) => {
        return (b.date || "").localeCompare(a.date || "");
      });
      setTickets(sortedTickets);
      setLoadingTickets(false);
    }, false, handleDataError);
    return () => { unsubP(); unsubT(); };
  }, [message]);

  const uniqueSuppliers = Array.from(new Set(products.map((p) => p.supplier))).filter(Boolean);

  const handleSupplierChange = (supplierName: string) => {
    setFilteredProducts(products.filter((p) => p.supplier === supplierName));
    form.setFieldsValue({ productId: undefined, unitPrice: 0, quantity: 0, totalAmount: 0 });
  };

  const handleProductChange = (productId: string) => {
    const p = products.find((p) => p.id === productId);
    if (p) {
      form.setFieldsValue({ unitPrice: p.importPrice });
      const qty = form.getFieldValue('quantity') || 0;
      form.setFieldsValue({ totalAmount: qty * p.importPrice });
    }
  };

  const handleValuesChange = (_: any, all: any) => {
    form.setFieldsValue({ totalAmount: (all.quantity || 0) * (all.unitPrice || 0) });
  };

  const onFinish = (values: any) => {
    if (!isAdmin) {
      message.error('Chỉ quản trị viên được lập phiếu nhập kho.');
      return;
    }
    const selectedProd = products.find((p) => p.id === values.productId);
    if (!selectedProd) return;

    let normalized: ReturnType<typeof requireTransactionValues>;
    try {
      normalized = requireTransactionValues(values.quantity, values.unitPrice);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Dữ liệu phiếu nhập không hợp lệ.');
      return;
    }
    const { quantity, unitPrice, subtotal } = normalized;
    const ticketDate = values.date
      ? values.date.format('YYYY-MM-DD HH:mm')
      : dayjs().format('YYYY-MM-DD HH:mm');

    const payload: Omit<ImportTicketType, 'key'> = {
      date: ticketDate,
      supplier: values.supplier,
      productName: selectedProd.name,
      productId: selectedProd.id,
      quantity,
      unitPrice,
      importPrice: unitPrice,
      subtotal,
      totalAmount: subtotal,
      items: [{
        productId: selectedProd.id,
        productCode: selectedProd.code || '',
        productName: selectedProd.name,
        unit: selectedProd.unit || '',
        quantity,
        unitPrice,
        importPrice: unitPrice,
        subtotal,
        lineTotal: subtotal,
      }],
      invoiceNo: values.invoiceNo || `HDN-${Date.now().toString().slice(-6)}`,
      createdBy: userInfo?.email || '',
    };
    const draft: TicketConfirmationDraft<typeof payload> = {
      kind: 'import',
      documentNo: payload.invoiceNo,
      date: payload.date,
      partnerLabel: 'Nhà cung cấp',
      partnerName: payload.supplier,
      items: [{
        productId: payload.productId,
        productName: payload.productName,
        quantity,
        unitPrice,
      }],
      totalQuantity: quantity,
      subtotal,
      totalAmount: subtotal,
      payload,
    };
    confirmationGateRef.current.prepare(draft);
    setPendingDraft(draft);
  };

  const confirmCreateTicket = async () => {
    if (!isAdmin) {
      message.error('Chỉ quản trị viên được lập phiếu nhập kho.');
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      operationIdRef.current ??= createOperationId();
      await confirmationGateRef.current.confirm(
        async (draft) => {
          await dbService.addImportTicket(draft.payload, operationIdRef.current!);
        },
      );
      operationIdRef.current = null;
      setPendingDraft(null);
      form.resetFields();
      setFilteredProducts([]);
      message.success('Nhập kho thành công!');
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

  const handleDelete = async (key: string, reason: string) => {
    if (!isAdmin) {
      message.error('Chỉ quản trị viên được hủy phiếu nhập kho.');
      return;
    }
    try {
      cancelOperationIdsRef.current[key] ??= createOperationId();
      await dbService.cancelImportTicket(key, reason, cancelOperationIdsRef.current[key]);
      delete cancelOperationIdsRef.current[key];
      message.success('Đã hủy phiếu nhập và hoàn tác tồn kho.');
    } catch (error: unknown) {
      message.error(formatFirebaseError(error));
      throw error;
    }
  };

  const showCancelConfirmation = (key: string) => {
    let reason = '';
    modal.confirm({
      title: 'Hủy phiếu nhập',
      content: (
        <Input.TextArea
          autoFocus
          maxLength={300}
          placeholder="Nhập lý do hủy phiếu"
          onChange={(event) => { reason = event.target.value; }}
        />
      ),
      okText: 'Hủy phiếu',
      cancelText: 'Giữ lại',
      okButtonProps: { danger: true },
      onOk: () => {
        if (!reason.trim()) {
          message.warning('Vui lòng nhập lý do hủy phiếu.');
          return Promise.reject();
        }
        return handleDelete(key, reason.trim());
      },
    });
  };

  const handlePrint = (record: any) => {
    printTicket({ ...record, type: record.type || 'Nhập kho' });
  };

  const columns = [
    { title: 'Hóa đơn', dataIndex: 'invoiceNo', key: 'invoiceNo', width: '13%' },
    { title: 'Ngày', dataIndex: 'date', key: 'date', width: '14%', render: formatDateTimeVi },
    { title: 'Nhà cung cấp', dataIndex: 'supplier', key: 'supplier', width: '16%' },
    { title: 'Mặt hàng', dataIndex: 'productName', key: 'productName', width: '17%' },
    { title: 'SL', dataIndex: 'quantity', key: 'quantity', width: '7%', align: 'right' as const, render: formatNumberVi },
    { title: 'Giá nhập', dataIndex: 'importPrice', key: 'importPrice', width: '11%',
      align: 'right' as const, render: (_: number, record: ImportTicketType) => (
        formatVnd(getTransactionItems(record, 'import')[0]?.unitPrice)
      ) },
    { title: 'Thành tiền', dataIndex: 'totalAmount', key: 'totalAmount', width: '12%',
      align: 'right' as const, render: (_: number, record: ImportTicketType) => (
        <strong style={{ color: '#52c41a' }}>{formatVnd(getTransactionTotal(record, 'import'))}</strong>
      ) },
    {
      title: 'Thao tác', key: 'actions', width: '10%',
      render: (_: any, record: ImportTicketType) => (
        <Row gutter={4}>
          <Col>
            <Button type="text" icon={<PrinterOutlined style={{ color: '#1890ff' }} />}
              onClick={() => handlePrint(record)} />
          </Col>
          <Col>
            {isAdmin && (
              <Button
                type="text"
                danger
                icon={<CloseCircleOutlined />}
                title="Hủy phiếu nhập và hoàn tác tồn kho"
                onClick={() => showCancelConfirmation(record.key)}
              />
            )}
          </Col>
        </Row>
      ),
    },
  ];

  return (
    <div className={`import-page operation-page${darkMode ? ' operation-page--dark' : ''}`}>
      <header className="operation-page__header">
      <h1 className="operation-page__title">
        Quản lý Nhập kho
      </h1>
      </header>
      <Row className="operation-grid" gutter={[24, 24]}>
        {isAdmin && <Col xs={24} lg={9}>
          <Card className="operation-card" title="Lập phiếu nhập hàng" variant="borderless">
            <Form className="operation-form" form={form} layout="vertical" onFinish={onFinish} onValuesChange={handleValuesChange}
              autoComplete="off" initialValues={{ date: dayjs(), quantity: 0, unitPrice: 0, totalAmount: 0 }}>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item label="Ngày nhập" name="date" rules={[{ required: true }]}>
                    <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item label="Mã Hóa đơn" name="invoiceNo">
                    <Input placeholder="Tự sinh nếu bỏ trống" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Nhà cung cấp" name="supplier"
                rules={[{ required: true, message: 'Vui lòng chọn nhà cung cấp' }]}>
                <Select placeholder="Chọn nhà cung cấp" onChange={handleSupplierChange}>
                  {uniqueSuppliers.map((s) => (
                    <Select.Option key={s} value={s}>{s}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="Mặt hàng sản phẩm" name="productId"
                rules={[{ required: true, message: 'Vui lòng chọn mặt hàng' }]}>
                <Select placeholder="Chọn mặt hàng" onChange={handleProductChange}
                  disabled={filteredProducts.length === 0}>
                  {filteredProducts.map((p) => (
                    <Select.Option key={p.id} value={p.id}>{p.name} ({p.code})</Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item label="Tổng số lượng" name="quantity"
                    rules={[transactionQuantityRule]}>
                    <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item label="Giá nhập (đ)" name="unitPrice" rules={[transactionUnitPriceRule]}>
                    <InputNumber<number> min={0} precision={0} style={{ width: '100%' }}
                      formatter={(v) => formatNumberVi(Number(v || 0))}
                      parser={parseVndInput} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Thành tiền (đ)" name="totalAmount">
                <InputNumber<number> disabled style={{ width: '100%', fontWeight: 600 }}
                  formatter={(v) => formatNumberVi(Number(v || 0))} />
              </Form.Item>
              <Form.Item style={{ marginTop: 8 }}>
                <Button className="operation-form__submit" type="primary" htmlType="submit" icon={<DownloadOutlined />} block size="large" loading={saving}>
                  Xác nhận lập phiếu nhập
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>}
        <Col xs={24} lg={isAdmin ? 15 : 24}>
          <Card className="operation-card" title="Danh sách phiếu nhập kho" variant="borderless">
            {loadingTickets
              ? <Spin style={{ display: 'block', margin: '40px auto' }} />
              : <Table className="operation-table" size="middle" columns={columns} dataSource={tickets} rowKey="key"
                  pagination={{ pageSize: 6 }} scroll={{ x: 850 }} />
            }
          </Card>
        </Col>
      </Row>
      <TicketConfirmationModal
        draft={pendingDraft}
        loading={saving}
        onBack={closeConfirmation}
        onConfirm={() => void confirmCreateTicket()}
      />
    </div>
  );
}

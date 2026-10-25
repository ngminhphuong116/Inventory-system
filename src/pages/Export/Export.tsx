import { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Row, Col, Card, Form, Select, Input, InputNumber,
  App as AntApp, Button, Table, DatePicker, Spin,
} from 'antd';
import { CloseCircleOutlined, UploadOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { dbService, type ProductType, type ExportTicketType } from '../../components/Db';
import { useUserRole } from '../../hooks/Useuserrole';
import { printTicket } from '../../components/Printticket';
import { formatDateTimeVi, formatNumberVi, formatVnd, parseVndInput } from '../../utils/format';
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

export default function ExportPage() {
  const [form] = Form.useForm();
  const { message, modal } = AntApp.useApp();
  const { darkMode } = useOutletContext<ContextType>();
  const { isAdmin, userInfo } = useUserRole();

  const [products, setProducts] = useState<ProductType[]>([]);
  const [tickets, setTickets] = useState<ExportTicketType[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<
    TicketConfirmationDraft<Omit<ExportTicketType, 'key'>> | null
  >(null);
  const confirmationGateRef = useRef(
    new TicketConfirmationGate<Omit<ExportTicketType, 'key'>>(),
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
    const unsubT = dbService.onExportTickets((data) => {
      const sortedTickets = [...data].sort((a, b) => {
        return (b.date || "").localeCompare(a.date || "");
      });
      setTickets(sortedTickets);
      setLoadingTickets(false);
    }, false, handleDataError);
    return () => { unsubP(); unsubT(); };
  }, [message]);

  const handleProductChange = (productId: string) => {
    const p = products.find((p) => p.id === productId);
    if (p) {
      form.setFieldsValue({ currentQuantity: p.quantity, unitPrice: p.salePrice });
      const qty = form.getFieldValue('quantity') || 0;
      form.setFieldsValue({ totalAmount: qty * p.salePrice });
    }
  };

  const handleValuesChange = (_: any, all: any) => {
    form.setFieldsValue({ totalAmount: (all.quantity || 0) * (all.unitPrice || 0) });
  };

  const onFinish = (values: any) => {
    if (!isAdmin) {
      message.error('Chỉ quản trị viên được lập phiếu xuất kho.');
      return;
    }
    const selectedProd = products.find((p) => p.id === values.productId);
    if (!selectedProd) return;

    let normalized: ReturnType<typeof requireTransactionValues>;
    try {
      normalized = requireTransactionValues(values.quantity, values.unitPrice);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Dữ liệu phiếu xuất không hợp lệ.');
      return;
    }
    const { quantity, unitPrice, subtotal } = normalized;

    if (quantity > selectedProd.quantity) {
      message.error(`Không thể xuất! Tồn kho chỉ còn ${selectedProd.quantity}`);
      return;
    }

    const ticketDate = values.date
      ? values.date.format('YYYY-MM-DD HH:mm')
      : dayjs().format('YYYY-MM-DD HH:mm');

    const payload: Omit<ExportTicketType, 'key'> = {
      date: ticketDate,
      customer: values.customer || 'Khách hàng vãng lai',
      productName: selectedProd.name,
      productId: selectedProd.id,
      quantity,
      unitPrice,
      exportPrice: unitPrice,
      salePrice: unitPrice,
      subtotal,
      totalAmount: subtotal,
      items: [{
        productId: selectedProd.id,
        productCode: selectedProd.code || '',
        productName: selectedProd.name,
        unit: selectedProd.unit || '',
        quantity,
        unitPrice,
        exportPrice: unitPrice,
        salePrice: unitPrice,
        subtotal,
        lineTotal: subtotal,
      }],
      invoiceNo: values.invoiceNo || `HDX-${Date.now().toString().slice(-6)}`,
      createdBy: userInfo?.email || '',
    };
    const draft: TicketConfirmationDraft<typeof payload> = {
      kind: 'export',
      documentNo: payload.invoiceNo,
      date: payload.date,
      partnerLabel: 'Khách hàng / Đơn vị nhận',
      partnerName: payload.customer,
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
      message.error('Chỉ quản trị viên được lập phiếu xuất kho.');
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      operationIdRef.current ??= createOperationId();
      await confirmationGateRef.current.confirm(
        async (draft) => {
          await dbService.addExportTicket(draft.payload, operationIdRef.current!);
        },
      );
      operationIdRef.current = null;
      setPendingDraft(null);
      form.resetFields();
      message.success('Đã lập phiếu xuất và trừ tồn kho thành công.');
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
      message.error('Chỉ quản trị viên được hủy phiếu xuất kho.');
      return;
    }
    try {
      cancelOperationIdsRef.current[key] ??= createOperationId();
      await dbService.cancelExportTicket(key, reason, cancelOperationIdsRef.current[key]);
      delete cancelOperationIdsRef.current[key];
      message.success('Đã hủy phiếu xuất và hoàn trả tồn kho.');
    } catch (error: unknown) {
      message.error(formatFirebaseError(error));
      throw error;
    }
  };

  const showCancelConfirmation = (key: string) => {
    let reason = '';
    modal.confirm({
      title: 'Hủy phiếu xuất',
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
    printTicket({ ...record, type: record.type || 'Xuất kho' });
  };

  const columns = [
    { title: 'Hóa đơn', dataIndex: 'invoiceNo', key: 'invoiceNo', width: '13%' },
    { title: 'Ngày', dataIndex: 'date', key: 'date', width: '14%', render: formatDateTimeVi },
    { title: 'Khách hàng', dataIndex: 'customer', key: 'customer', width: '16%' },
    { title: 'Mặt hàng', dataIndex: 'productName', key: 'productName', width: '17%' },
    { title: 'SL', dataIndex: 'quantity', key: 'quantity', width: '6%', align: 'right' as const, render: formatNumberVi },
    { title: 'Giá bán', dataIndex: 'salePrice', key: 'salePrice', width: '11%',
      align: 'right' as const, render: (_: number, record: ExportTicketType) => (
        formatVnd(getTransactionItems(record, 'export')[0]?.unitPrice)
      ) },
    { title: 'Thành tiền', dataIndex: 'totalAmount', key: 'totalAmount', width: '13%',
      align: 'right' as const, render: (_: number, record: ExportTicketType) => (
        <strong style={{ color: '#ff4d4f' }}>{formatVnd(getTransactionTotal(record, 'export'))}</strong>
      ) },
    {
      title: 'Thao tác', key: 'actions', width: '10%',
      render: (_: any, record: ExportTicketType) => (
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
                title="Hủy phiếu xuất và hoàn trả tồn kho"
                onClick={() => showCancelConfirmation(record.key)}
              />
            )}
          </Col>
        </Row>
      ),
    },
  ];

  return (
    <div className={`export-page operation-page${darkMode ? ' operation-page--dark' : ''}`}>
      <header className="operation-page__header">
      <h1 className="operation-page__title">
        Quản lý Xuất kho
      </h1>
      </header>
      <Row className="operation-grid" gutter={[24, 24]}>
        {isAdmin && <Col xs={24} lg={9}>
          <Card className="operation-card" title="Lập phiếu xuất hàng" variant="borderless">
            <Form className="operation-form" form={form} layout="vertical" onFinish={onFinish} onValuesChange={handleValuesChange}
              autoComplete="off" initialValues={{ date: dayjs(), quantity: 0, unitPrice: 0, totalAmount: 0 }}>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item label="Ngày xuất" name="date" rules={[{ required: true }]}>
                    <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item label="Mã Hóa đơn" name="invoiceNo">
                    <Input placeholder="Tự sinh nếu bỏ trống" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Khách hàng / Đơn vị nhận" name="customer"
                rules={[{ required: true, message: 'Vui lòng nhập tên người nhận' }]}>
                <Input placeholder="VD: Công ty TNHH ABC..." />
              </Form.Item>
              <Form.Item label="Mặt hàng cần xuất" name="productId"
                rules={[{ required: true, message: 'Vui lòng chọn mặt hàng' }]}>
                <Select placeholder="Chọn sản phẩm" onChange={handleProductChange}
                  showSearch optionFilterProp="children">
                  {products.map((p) => (
                    <Select.Option key={p.id} value={p.id}>
                      {p.name} (Tồn: {p.quantity})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item label="Tồn kho thực tế" name="currentQuantity">
                    <InputNumber disabled style={{ width: '100%', color: '#fa8c16' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item label="Đơn giá xuất (đ)" name="unitPrice" rules={[transactionUnitPriceRule]}>
                    <InputNumber<number> min={0} precision={0} style={{ width: '100%' }}
                      formatter={(v) => formatNumberVi(Number(v || 0))}
                      parser={parseVndInput} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Tổng số lượng xuất" name="quantity"
                rules={[transactionQuantityRule]}>
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="Thành tiền (đ)" name="totalAmount">
                <InputNumber<number> disabled style={{ width: '100%', fontWeight: 600 }}
                  formatter={(v) => formatNumberVi(Number(v || 0))} />
              </Form.Item>
              <Form.Item style={{ marginTop: 8 }}>
                <Button className="operation-form__submit" type="primary" htmlType="submit" icon={<UploadOutlined />} block size="large" loading={saving}>
                  Xác nhận lập phiếu xuất
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>}
        <Col xs={24} lg={isAdmin ? 15 : 24}>
          <Card className="operation-card" title="Danh sách hóa đơn xuất kho" variant="borderless">
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

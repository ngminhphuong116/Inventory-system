import { useState, useEffect } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Alert, Card, Table, Tag, Select, Input, Row, Col, Button, Spin, Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, SearchOutlined, FileExcelOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { dbService, type ImportTicketType, type ExportTicketType, type SalesTicketType } from '../../components/Db';
import { formatVnd } from '../../utils/format';
import { formatFirebaseError } from '../../services/data-integrity';
import {
  formatRecordTimeVi,
  recordVietnamDateKey,
  sortRecordsNewestFirst,
  withSortTimestamp,
} from '../../utils/record-time';
import {
  getTransactionItems,
  getTransactionTotal,
  normalizeSaleBill,
  type TransactionKind,
} from '../../utils/transaction-money';
import SalesBillDetails from '../Sales/SalesBillDetails';
import { buildSalesExcelRows } from '../Sales/sales-excel';
import "../Dashboard/Dashboard.css";

interface ContextType { darkMode: boolean; }

// 'kind' dùng để phân biệt 3 loại giao dịch trong UI, tách biệt với field "type" có sẵn trong SalesTicketType
type HistoryItem =
  | (ImportTicketType & { kind: 'Import'; sortTimestamp: number })
  | (ExportTicketType & { kind: 'Export'; sortTimestamp: number })
  | (SalesTicketType & { kind: 'Sale'; sortTimestamp: number });

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export default function History() {
  const { darkMode } = useOutletContext<ContextType>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [allHistory, setAllHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const searchKey = searchParams.get('q') || '';
  const queryType = searchParams.get('type');
  const filterType = queryType === 'import'
    ? 'Import'
    : queryType === 'export'
      ? 'Export'
      : queryType === 'sale'
        ? 'Sale'
        : 'All';
  const filterDate = searchParams.get('date') === 'today' ? 'today' : 'all';
  const statusParam = searchParams.get('status');
  const filterStatus = statusParam === 'pending' || statusParam === 'cancelled' || statusParam === 'active'
    ? statusParam
    : 'all';

  const updateQuery = (key: string, value: string, defaultValue = 'all') => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  // ✅ Realtime từ Firebase — gộp cả nhập kho + xuất kho + bán hàng
  useEffect(() => {
    let importData: HistoryItem[] = [];
    let exportData: HistoryItem[] = [];
    let salesData: HistoryItem[] = [];
    let importLoaded = false;
    let exportLoaded = false;
    let salesLoaded = false;
    const handleDataError = (error: Error) => {
      setLoading(false);
      setDataError(formatFirebaseError(error));
    };

    const merge = () => {
      if (!importLoaded || !exportLoaded || !salesLoaded) return;
      setAllHistory(
        sortRecordsNewestFirst([...importData, ...exportData, ...salesData]),
      );
      setLoading(false);
    };

    const unsubI = dbService.onImportTickets((data) => {
      importData = data.map((t) => withSortTimestamp({ ...t, kind: 'Import' as const }));
      importLoaded = true;
      merge();
    }, true, handleDataError);
    const unsubE = dbService.onExportTickets((data) => {
      exportData = data.map((t) => withSortTimestamp({ ...t, kind: 'Export' as const }));
      exportLoaded = true;
      merge();
    }, true, handleDataError);
    const unsubS = dbService.onSalesTickets((data) => {
      salesData = data.map((t) => withSortTimestamp({ ...t, kind: 'Sale' as const }));
      salesLoaded = true;
      merge();
    }, true, handleDataError);

    return () => { unsubI(); unsubE(); unsubS(); };
  }, []);

  // Lấy tên đối tác (NCC / Khách hàng) tùy theo loại giao dịch
  const getPartnerName = (item: HistoryItem): string => {
    if (item.kind === 'Import') return (item as ImportTicketType & { kind: 'Import' }).supplier;
    if (item.kind === 'Export') return (item as ExportTicketType & { kind: 'Export' }).customer || '---';
    return (item as SalesTicketType & { kind: 'Sale' }).customerName || '---';
  };

  // Lấy đơn giá tùy theo loại giao dịch (dùng cho xuất Excel)
  const getUnitPrice = (item: HistoryItem): number => {
    const kind: TransactionKind = item.kind === 'Import'
      ? 'import'
      : item.kind === 'Export'
        ? 'export'
        : 'sale';
    return getTransactionItems(item, kind)[0]?.unitPrice ?? 0;
  };

  const getTotalAmount = (item: HistoryItem): number => {
    const kind: TransactionKind = item.kind === 'Import'
      ? 'import'
      : item.kind === 'Export'
        ? 'export'
        : 'sale';
    return getTransactionTotal(item, kind);
  };

  const filteredData = sortRecordsNewestFirst(allHistory.filter((item) => {
    const search = searchKey.toLowerCase();
    const partner = getPartnerName(item);
    const itemNames = item.kind === 'Sale'
      ? normalizeSaleBill(item as SalesTicketType).items.map((entry) => entry.productName).join(' ')
      : item.productName || '';
    const matchSearch =
      item.invoiceNo?.toLowerCase().includes(search) ||
      itemNames.toLowerCase().includes(search) ||
      partner?.toLowerCase().includes(search);
    const matchType = filterType === 'All' || item.kind === filterType;
    const matchDate =
      filterDate === 'all'
      || recordVietnamDateKey(item as unknown as Record<string, unknown>)
        === localDateKey(new Date());
    const status = (item as unknown as { status?: string }).status;
    const normalizedStatus = status || 'active';
    const matchStatus = filterStatus === 'all' || normalizedStatus === filterStatus;
    return matchSearch && matchType && matchDate && matchStatus;
  }));

  // ✅ Xuất Excel giữ nguyên logic của bạn, thêm cột cho Bán hàng
  const handleExportExcel = () => {
    if (filterType === 'Sale') {
      const sales = filteredData
        .filter((item): item is SalesTicketType & { kind: 'Sale'; sortTimestamp: number } => item.kind === 'Sale');
      const { billRows, itemRows } = buildSalesExcelRows(sales);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(billRows), 'Hóa đơn');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(itemRows), 'Chi tiết sản phẩm');
      XLSX.writeFile(workbook, 'lich-su-ban-hang.xlsx');
      return;
    }
    const rows = filteredData.map((item) => {
      const partner = getPartnerName(item);
      const kindLabel = item.kind === 'Import' ? 'Nhập kho' : item.kind === 'Export' ? 'Xuất kho' : 'Bán hàng';
      const sign = item.kind === 'Import' ? '+' : '-';
      return {
        'Mã Hóa Đơn': item.invoiceNo,
        'Thời Gian': formatRecordTimeVi(item as unknown as Record<string, unknown>),
        'Loại Giao Dịch': kindLabel,
        'Mặt Hàng': item.productName,
        'Số Lượng': `${sign}${item.quantity}`,
        'Đối Tác / Khách Hàng': partner || '---',
        'Thành Tiền (đ)': getTotalAmount(item),
        'Người tạo': ('createdBy' in item ? (item as any).createdBy : '') || '',
        'Đơn Giá (đ)': getUnitPrice(item),
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    const sheetName = filterType === 'Import' ? 'Nhập kho' : filterType === 'Export' ? 'Xuất kho' : 'Tất cả';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const fileName = filterType === 'Import' ? 'lich-su-nhap-kho.xlsx'
      : filterType === 'Export' ? 'lich-su-xuat-kho.xlsx'
      : 'lich-su-bien-dong-kho.xlsx';
    XLSX.writeFile(wb, fileName);
  };

  const columns = [
    { title: 'Mã Hóa Đơn', dataIndex: 'invoiceNo', key: 'invoiceNo', width: '13%' },
    {
      title: 'Thời Gian',
      dataIndex: 'date',
      key: 'date',
      width: '14%',
      render: (_: unknown, record: HistoryItem) =>
        formatRecordTimeVi(record as unknown as Record<string, unknown>),
    },
    {
      title: 'Loại', dataIndex: 'kind', key: 'kind', width: '11%',
      render: (kind: string) => {
        if (kind === 'Import') return <Tag icon={<ArrowDownOutlined />} color="success">Nhập kho</Tag>;
        if (kind === 'Export') return <Tag icon={<ArrowUpOutlined />} color="error">Xuất kho</Tag>;
        return <Tag icon={<ShoppingCartOutlined />} color="blue">Bán hàng</Tag>;
      },
    },
    {
      title: 'Mặt Hàng', key: 'productName', width: '17%',
      render: (_: unknown, record: HistoryItem) => {
        if (record.kind !== 'Sale') return record.productName;
        const bill = normalizeSaleBill(record as SalesTicketType);
        const first = bill.items[0]?.productName || record.productName;
        return bill.items.length > 1 ? `${first} + ${bill.items.length - 1} sản phẩm` : first;
      },
    },
    {
      title: 'Số Lượng', dataIndex: 'quantity', key: 'quantity', width: '8%',
      render: (qty: number, record: HistoryItem) => (
        <span style={{ fontWeight: 600, color: record.kind === 'Import' ? '#52c41a' : '#ff4d4f' }}>
          {record.kind === 'Import' ? '+' : '-'}{record.kind === 'Sale'
            ? normalizeSaleBill(record as SalesTicketType).totalQuantity
            : qty}
        </span>
      ),
    },
    {
      title: 'Đối Tác / Khách Hàng', key: 'partner', width: '16%',
      render: (_: any, record: HistoryItem) => getPartnerName(record),
    },
    {
      title: 'Thành Tiền', dataIndex: 'totalAmount', key: 'totalAmount', width: '13%',
      render: (_: number, record: HistoryItem) => (
        <strong style={{ color: record.kind === 'Import' ? '#52c41a' : '#ff4d4f' }}>
          {formatVnd(getTotalAmount(record))}
        </strong>
      ),
    },
    {
      title: 'Người tạo', key: 'createdBy', width: '13%',
      render: (_: any, record: HistoryItem) => ('createdBy' in record ? (record as any).createdBy : '') || '---',
    },
    {
      title: 'Trạng thái', dataIndex: 'status', key: 'status', width: '11%',
      render: (status: string | undefined, record: HistoryItem) => status === 'cancelled'
        ? (
            <Tooltip title={record.cancelReason || 'Không có lý do hủy'}>
              <Tag color="default">Đã hủy</Tag>
            </Tooltip>
          )
        : <Tag color="success">Đã ghi nhận</Tag>,
    },
  ];

  return (
    <div className="history-page">
      {dataError && (
        <Alert
          type="error"
          showIcon
          message="Không thể tải lịch sử giao dịch"
          description={dataError}
          style={{ marginBottom: 16 }}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 650, lineHeight: 1.25, letterSpacing: '-0.015em', margin: 0, color: darkMode ? '#fff' : '#000' }}>
          Lịch Sử Biến Động Kho
        </h1>
        <Button type="primary" icon={<FileExcelOutlined />} onClick={handleExportExcel}
          style={{ background: '#17904b', borderColor: '#17904b' }}>
          Xuất Excel
        </Button>
      </div>

      <Card variant="borderless" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Input placeholder="Tìm theo hóa đơn, sản phẩm, đối tác..."
              prefix={<SearchOutlined />} value={searchKey}
              onChange={(e) => updateQuery('q', e.target.value, '')} allowClear />
          </Col>
          <Col xs={12} md={4}>
            <Select
              aria-label="Lọc theo loại giao dịch"
              style={{ width: '100%' }}
              value={filterType}
              onChange={(value) => updateQuery('type', value === 'All' ? 'all' : value.toLowerCase())}
            >
              <Select.Option value="All">Tất cả giao dịch</Select.Option>
              <Select.Option value="Import">Chỉ Nhập Kho</Select.Option>
              <Select.Option value="Export">Chỉ Xuất Kho</Select.Option>
              <Select.Option value="Sale">Chỉ Bán Hàng</Select.Option>
            </Select>
          </Col>
          <Col xs={12} md={4}>
            <Select
              aria-label="Lọc theo ngày"
              style={{ width: '100%' }}
              value={filterDate}
              onChange={(value) => updateQuery('date', value)}
              options={[
                { value: 'all', label: 'Tất cả ngày' },
                { value: 'today', label: 'Hôm nay' },
              ]}
            />
          </Col>
          <Col xs={24} md={4}>
            <Select
              aria-label="Lọc theo trạng thái"
              style={{ width: '100%' }}
              value={filterStatus}
              onChange={(value) => updateQuery('status', value)}
              options={[
                { value: 'all', label: 'Tất cả trạng thái' },
                { value: 'active', label: 'Đã ghi nhận' },
                { value: 'cancelled', label: 'Đã hủy' },
                { value: 'pending', label: 'Chờ xử lý' },
              ]}
            />
          </Col>
        </Row>
      </Card>

      <Card variant="borderless">
        {loading
          ? <Spin style={{ display: 'block', margin: '40px auto' }} />
          : <Table columns={columns} dataSource={filteredData} rowKey="key"
              pagination={{ pageSize: 10 }} scroll={{ x: 950 }}
              expandable={{
                expandedRowRender: (record) => record.kind === 'Sale'
                  ? <SalesBillDetails record={record as SalesTicketType} />
                  : null,
                rowExpandable: (record) => record.kind === 'Sale',
              }} />
        }
      </Card>
    </div>
  );
}

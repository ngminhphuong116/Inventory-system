import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  Row, Col, Card, Form, Input, Select,
  App as AntApp, Button, Table, Tag, Space, Spin, Popconfirm
} from 'antd';
import {
  PlusOutlined, EditOutlined, InboxOutlined,
  SearchOutlined, ClearOutlined, LockOutlined, FileTextOutlined
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs'; // ✅ ĐÃ FIX LỖI 1: Import thư viện dayjs đầy đủ
import {
  dbService,
  type DirectoryType,
  type ProductType,
} from '../../components/Db';
import { useUserRole } from '../../hooks/Useuserrole';
import { formatVnd } from '../../utils/format';
import {
  createOperationId,
  formatFirebaseError,
  normalizeProductCode,
} from '../../services/data-integrity';
import {
  normalizeDirectoryNameKey,
  resolveSupplierReference,
} from '../../services/legacy-directory';
import ProductFormModal, {
  type ProductFormValues,
} from '../../components/Product/ProductFormModal';
import {
  selectDirectoryFormValue,
  upsertDirectoryEntry,
} from '../../components/Product/product-directory';
import {
  filterProducts,
  filtersToSearchParams,
  getStockStatus,
  normalizeStockStatus,
  pageForQuery,
  type ProductFilters,
  type StockStatus,
} from './stock-status';
import '../../styles/operation-flow.css';

interface ContextType { darkMode: boolean; }

export default function ProductPage() {
  const [form] = Form.useForm();
  const [searchForm] = Form.useForm();
  const { message } = AntApp.useApp();
  const { darkMode } = useOutletContext<ContextType>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, userInfo } = useUserRole();

  const [products, setProducts] = useState<ProductType[]>([]);
  const [categories, setCategories] = useState<DirectoryType[]>([]);
  const [suppliers, setSuppliers] = useState<DirectoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [directorySaving, setDirectorySaving] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newSupplierName, setNewSupplierName] = useState('');
  const productRequestIdRef = useRef<string | null>(null);
  const directoryRequestIdRef = useRef<string | null>(null);
  const queryString = searchParams.toString();
  const [pagination, setPagination] = useState({ queryString, page: 1 });
  const currentPage = pageForQuery(pagination, queryString);
  const searchValues = useMemo<ProductFilters>(() => {
    const query = new URLSearchParams(queryString);
    return {
      term: query.get('q') || undefined,
      category: query.get('category') || undefined,
      status: normalizeStockStatus(query.get('stockStatus')),
    };
  }, [queryString]);
  const filtered = useMemo(
    () => filterProducts(products, searchValues),
    [products, searchValues],
  );

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductType | null>(null);

  // 🔄 Realtime kết nối từ Firebase
  useEffect(() => {
    const handleDataError = (error: Error) => {
      setLoading(false);
      message.error(formatFirebaseError(error));
    };
    const unsubscribeProducts = dbService.onProducts((data) => {
      setProducts(data);
      setLoading(false);
    }, handleDataError);
    const unsubscribeCategories = dbService.onCategories(setCategories, handleDataError);
    const unsubscribeSuppliers = dbService.onSuppliers(setSuppliers, handleDataError);
    return () => {
      unsubscribeProducts();
      unsubscribeCategories();
      unsubscribeSuppliers();
    };
  }, [message]);

  // 🔍 Hàm Tìm kiếm & Bộ lọc
  useEffect(() => {
    searchForm.setFieldsValue(searchValues);
  }, [searchForm, searchValues]);

  const updateFilters = (values: ProductFilters) => {
    setSearchParams(filtersToSearchParams(values), { replace: true });
  };

  const handleSearch = (values: ProductFilters) => {
    updateFilters({ ...values, status: values.status || 'all' });
  };

  const resetSearch = () => {
    searchForm.resetFields();
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  // 📝 Mở Modal khi bấm sửa mã hàng
  const openEditModal = (p: ProductType) => {
    const category = categories.find(
      (entry) =>
        entry.id === p.categoryId
        || normalizeDirectoryNameKey(entry.name) === normalizeDirectoryNameKey(p.category),
    );
    const supplierReference = resolveSupplierReference(p, suppliers);
    setEditingId(p.id);
    setEditingProduct(p);
    form.setFieldsValue({
      ...p,
      categoryId: category?.id,
      supplierId: supplierReference.supplierId,
    });
    if (!category || category.source === 'embedded-product') {
      message.warning(
        'Sản phẩm đang dùng danh mục legacy. Giá trị vẫn được giữ; hãy chọn hoặc tạo danh mục chuẩn nếu muốn đổi.',
      );
    }
    setIsModalOpen(true);
  };

  // 💾 Hàm xử lý Lưu (Thêm mới / Cập nhật sản phẩm)
  const onFinish = async (values: ProductFormValues) => {
    if (!isAdmin) {
      message.error('Chỉ quản trị viên được thêm hoặc sửa sản phẩm.');
      return;
    }
    setSaving(true);
    try {
      const category = categories.find((entry) => entry.id === values.categoryId);
      const supplier = suppliers.find((entry) => entry.id === values.supplierId);
      if (!category) {
        throw new Error('Danh mục đã chọn không còn tồn tại. Vui lòng chọn lại.');
      }

      const embeddedCategoryIsCurrent = Boolean(
        editingProduct
        && category.source === 'embedded-product'
        && normalizeDirectoryNameKey(category.name)
          === normalizeDirectoryNameKey(editingProduct.category),
      );
      if (category.source === 'embedded-product' && !embeddedCategoryIsCurrent) {
        throw new Error(
          'Danh mục này chỉ được khôi phục từ sản phẩm cũ. Hãy bấm Thêm để tạo danh mục chính thức trước khi chọn.',
        );
      }
      const embeddedSupplierIsCurrent = Boolean(
        editingProduct
        && supplier?.source === 'embedded-product'
        && normalizeDirectoryNameKey(supplier.name)
          === normalizeDirectoryNameKey(editingProduct.supplier),
      );
      if (supplier?.source === 'embedded-product' && !embeddedSupplierIsCurrent) {
        throw new Error(
          'Nhà cung cấp này chỉ được khôi phục từ sản phẩm cũ. Hãy bấm Thêm để tạo bản ghi chính thức trước khi chọn.',
        );
      }

      const payload = {
        code: normalizeProductCode(values.code),
        name: values.name.trim(),
        unit: values.unit.trim(),
        categoryId: embeddedCategoryIsCurrent ? '' : category.id,
        category: category.name,
        importPrice: values.importPrice,
        salePrice: values.salePrice,
        supplierId: embeddedSupplierIsCurrent ? '' : supplier?.id || '',
        supplier: supplier?.name || '',
        quantity: 0,
        minStock: values.minStock,
        status: 'Critical',
        description: values.description ? values.description.trim() : ''
      };

      productRequestIdRef.current ??= createOperationId();
      if (editingId) {
        await dbService.updateProduct(editingId, payload, productRequestIdRef.current);
        message.success('Đã cập nhật thông tin sản phẩm thành công!');
      } else {
        const isDup = products.some(p => p.code.toUpperCase() === payload.code);
        if (isDup) {
          message.error('Mã hàng hóa này đã tồn tại trên hệ thống!');
          setSaving(false);
          return;
        }
        await dbService.addProduct(payload, productRequestIdRef.current);
        message.success('Đã thêm mã sản phẩm mới vào kho!');
      }

      productRequestIdRef.current = null;
      closeModal();
    } catch (error: unknown) {
      message.error(formatFirebaseError(error));
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    form.resetFields();
    setEditingId(null);
    setEditingProduct(null);
    setNewCategoryName('');
    setNewSupplierName('');
    productRequestIdRef.current = null;
    setIsModalOpen(false);
  };

  const handleArchiveProduct = async (id: string) => {
    if (!isAdmin) {
      message.error('Chỉ quản trị viên được lưu trữ sản phẩm.');
      return;
    }
    try {
      await dbService.archiveProduct(id);
      message.success('Đã lưu trữ sản phẩm khỏi danh sách hoạt động.');
    } catch (error: unknown) {
      message.error(formatFirebaseError(error));
    }
  };

  const addDirectoryEntry = async (type: 'category' | 'supplier') => {
    if (!isAdmin) {
      message.error('Chỉ quản trị viên được cập nhật danh mục và nhà cung cấp.');
      return;
    }
    const name = (type === 'category' ? newCategoryName : newSupplierName).trim();
    if (!name) {
      message.warning(
        type === 'category'
          ? 'Tên danh mục không được để trống.'
          : 'Tên nhà cung cấp không được để trống.',
      );
      return;
    }
    setDirectorySaving(true);
    try {
      directoryRequestIdRef.current ??= createOperationId();
      const result = type === 'category'
        ? await dbService.addCategory(name, directoryRequestIdRef.current)
        : await dbService.addSupplier(name, directoryRequestIdRef.current);
      const optimisticEntry: DirectoryType = {
        id: result.id,
        key: result.id,
        name,
        source: (
          (type === 'category' ? categories : suppliers)
            .find((entry) => entry.source !== 'embedded-product')?.source
          || 'scoped'
        ),
        originNode: type === 'category' ? 'categories' : 'suppliers',
      };
      if (type === 'category') {
        setCategories((current) => upsertDirectoryEntry(current, optimisticEntry));
      } else {
        setSuppliers((current) => upsertDirectoryEntry(current, optimisticEntry));
      }
      selectDirectoryFormValue(form, type, result.id);
      if (type === 'category') setNewCategoryName('');
      else setNewSupplierName('');
      directoryRequestIdRef.current = null;
      message.success(
        result.duplicate
          ? 'Đã chọn bản ghi có cùng tên.'
          : type === 'category'
            ? 'Đã tạo danh mục.'
            : 'Đã tạo nhà cung cấp.',
      );
    } catch (error: unknown) {
      message.error(formatFirebaseError(error));
    } finally {
      setDirectorySaving(false);
    }
  };

  // 📊 Hàm xuất báo cáo ra file Excel chuẩn
  const exportToExcel = () => {
    if (filtered.length === 0) {
      message.warning('Không có dữ liệu phù hợp để xuất file!');
      return;
    }
    const header = [["MÃ HÀNG", "TÊN SẢN PHẨM", "ĐƠN VỊ", "DANH MỤC", "GIÁ NHẬP", "GIÁ BÁN", "NHÀ CUNG CẤP", "TỒN KHO", "MỨC TỐI THIỂU", "TRẠNG THÁI", "MÔ TẢ"]];
    const rows = filtered.map(p => [
      p.code, p.name, p.unit, p.category, p.importPrice, p.salePrice, p.supplier, p.quantity, p.minStock, p.status, p.description || ''
    ]);
    const ws = XLSX.utils.aoa_to_sheet([...header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Danh_muc_san_pham");
    XLSX.writeFile(wb, `DanhMuc_HangHoa_${dayjs().format('YYYYMMDD')}.xlsx`);
    message.success('Đã xuất báo cáo danh mục sản phẩm ra file Excel!');
  };

  const categoryFilterNames = Array.from(
    new Set([
      ...categories.map((entry) => entry.name),
      ...products.map((product) => product.category).filter(Boolean),
    ]),
  ).sort((a, b) => a.localeCompare(b, 'vi'));

  const columns = [
    { title: 'Mã hàng', dataIndex: 'code', key: 'code', width: '10%', sorter: (a: any, b: any) => a.code.localeCompare(b.code) },
    { title: 'Tên sản phẩm', dataIndex: 'name', key: 'name', width: '18%', sorter: (a: any, b: any) => a.name.localeCompare(b.name) },
    { title: 'Đơn vị', dataIndex: 'unit', key: 'unit', width: '8%' },
    { title: 'Danh mục', dataIndex: 'category', key: 'category', width: '10%', render: (cat: string) => <Tag color="blue">{cat}</Tag> },
    { title: 'Giá nhập', dataIndex: 'importPrice', key: 'importPrice', width: '11%', align: 'right' as const, sorter: (a: any, b: any) => a.importPrice - b.importPrice, render: formatVnd },
    { title: 'Giá bán', dataIndex: 'salePrice', key: 'salePrice', width: '11%', align: 'right' as const, sorter: (a: any, b: any) => a.salePrice - b.salePrice, render: (v: number) => <strong style={{ color: '#2f54eb' }}>{formatVnd(v)}</strong> },
    { title: 'Nhà cung cấp', dataIndex: 'supplier', key: 'supplier', width: '14%' },
    { title: 'Tồn kho', dataIndex: 'quantity', key: 'quantity', width: '10%', sorter: (a: any, b: any) => a.quantity - b.quantity,
      render: (qty: number, record: ProductType) => {
        const stockStatus = getStockStatus(record);
        const color = stockStatus === 'out'
          ? 'red'
          : stockStatus === 'critical'
            ? 'volcano'
            : stockStatus === 'warning' ? 'orange' : 'green';
        return <Tag color={color} style={{ fontWeight: 600 }}>{qty.toLocaleString('vi-VN')}</Tag>;
      }
    },
    {
      title: 'Hành động', key: 'actions', width: '8%',
      render: (_: any, record: ProductType) => (
        <Row gutter={8} justify="center">
          <Col>
            <Button
              type="text"
              size="small"
              disabled={!isAdmin}
              icon={isAdmin ? <EditOutlined style={{ color: '#fa8c16' }} /> : <LockOutlined />}
              onClick={() => openEditModal(record)}
              title={isAdmin ? 'Sửa hàng' : 'Cần quyền Admin để sửa'}
            />
          </Col>
          <Col>
            {isAdmin ? (
              <Popconfirm
                title="Lưu trữ sản phẩm này?"
                description="Sản phẩm sẽ bị ẩn khỏi danh sách hoạt động nhưng lịch sử nhập, xuất và bán hàng vẫn được giữ nguyên."
                onConfirm={() => handleArchiveProduct(record.id)}
                okText="Lưu trữ"
                cancelText="Hủy"
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<InboxOutlined />}
                  title="Lưu trữ sản phẩm"
                  aria-label={`Lưu trữ sản phẩm ${record.name}`}
                />
              </Popconfirm>
            ) : (
              <Button type="text" size="small" icon={<LockOutlined style={{ color: '#bfbfbf' }} />} disabled title="Cần quyền Admin để lưu trữ" />
            )}
          </Col>
        </Row>
      ),
    },
  ];
  const visibleColumns = isAdmin
    ? columns
    : columns.filter((column) => column.key !== 'actions');

  return (
    <div className={`product-page inventory-page${darkMode ? ' inventory-page--dark' : ''}`}>
      <div className="inventory-page__toolbar">
        <Col>
          <h1 className="inventory-page__title">
            Danh mục sản phẩm
          </h1>
          <span className="inventory-page__account">Tài khoản: {userInfo?.email} ({isAdmin ? 'Admin' : 'Nhân viên'})</span>
        </Col>
        <Col>
          <Space wrap>
            {/* ✅ ĐÃ FIX LỖI 2: Xóa bỏ thuộc tính 'success="true"' bị TypeScript từ chối */}
            {isAdmin && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                setEditingProduct(null);
                setEditingId(null);
                form.setFieldsValue({
                  code: '',
                  name: '',
                  unit: '',
                  categoryId: undefined,
                  supplierId: undefined,
                  importPrice: 0,
                  salePrice: 0,
                  quantity: 0,
                  minStock: 5,
                  description: '',
                });
                setIsModalOpen(true);
              }}
                className="app-action-button app-action-button--primary"
              >
                Thêm mã hàng mới
              </Button>
            )}
            <Button className="app-action-button app-action-button--success" type="primary" icon={<FileTextOutlined />} onClick={exportToExcel}>
              Xuất Excel
            </Button>
          </Space>
        </Col>
      </div>

      <Card className="inventory-card" variant="borderless" style={{ marginBottom: 24 }} styles={{ body: { padding: '18px 24px' } }}>
        <Form className="inventory-filter" form={searchForm} layout="inline" onFinish={handleSearch}>
          <Form.Item name="term" style={{ width: 240, marginRight: 12 }}>
            <Input placeholder="Tìm kiếm tên, mã hàng..." prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />} allowClear />
          </Form.Item>
          <Form.Item name="category" style={{ width: 180, marginRight: 12 }}>
            <Select placeholder="Lọc danh mục" allowClear>
              {categoryFilterNames.map(cat => <Select.Option key={cat} value={cat}>{cat}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="status" style={{ width: 190, marginRight: 12 }}>
            <Select
              aria-label="Lọc trạng thái tồn kho"
              onChange={(status: StockStatus) => {
                const values = searchForm.getFieldsValue() as ProductFilters;
                updateFilters({ ...values, status: status || 'all' });
              }}
            >
              <Select.Option value="all">Tất cả trạng thái</Select.Option>
              <Select.Option value="normal">Bình thường</Select.Option>
              <Select.Option value="warning">Sắp hết</Select.Option>
              <Select.Option value="critical">Nguy cấp</Select.Option>
              <Select.Option value="out">Hết hàng</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button className="app-action-button app-action-button--primary" type="primary" htmlType="submit" icon={<SearchOutlined />}>Tìm kiếm</Button>
              <Button className="app-action-button" icon={<ClearOutlined />} onClick={resetSearch}>Làm mới</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card className="inventory-card" variant="borderless">
        {loading 
          ? <Spin style={{ display: 'block', margin: '40px auto' }} />
          : (
            <Table
              className="inventory-table"
              size="middle"
              columns={visibleColumns}
              dataSource={filtered}
              rowKey="id"
              pagination={{
                current: currentPage,
                pageSize: 8,
                onChange: (page) => setPagination({ queryString, page }),
              }}
              scroll={{ x: 1000 }}
            />
          )
        }
      </Card>

      {isAdmin && <ProductFormModal
        open={isModalOpen}
        editing={Boolean(editingId)}
        form={form}
        categories={categories}
        suppliers={suppliers}
        saving={saving}
        directorySaving={directorySaving}
        newCategoryName={newCategoryName}
        newSupplierName={newSupplierName}
        onCategoryNameChange={setNewCategoryName}
        onSupplierNameChange={setNewSupplierName}
        onAddCategory={() => void addDirectoryEntry('category')}
        onAddSupplier={() => void addDirectoryEntry('supplier')}
        onCancel={closeModal}
        onFinish={onFinish}
      />}
    </div>
  );
}

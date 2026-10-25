import type { ReactNode } from 'react';
import {
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  type FormInstance,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { DirectoryType } from '../Db';
import { formatNumberVi, parseVndInput } from '../../utils/format';
import { handleDirectoryPopupMouseDown } from './product-directory';
import './ProductFormModal.css';

export interface ProductFormValues {
  code: string;
  name: string;
  unit: string;
  categoryId: string;
  importPrice: number;
  salePrice: number;
  supplierId?: string;
  quantity?: number;
  minStock: number;
  description?: string;
}

interface ProductFormModalProps {
  open: boolean;
  editing: boolean;
  form: FormInstance<ProductFormValues>;
  categories: DirectoryType[];
  suppliers: DirectoryType[];
  saving: boolean;
  directorySaving: boolean;
  newCategoryName: string;
  newSupplierName: string;
  onCategoryNameChange: (value: string) => void;
  onSupplierNameChange: (value: string) => void;
  onAddCategory: () => void;
  onAddSupplier: () => void;
  onCancel: () => void;
  onFinish: (values: ProductFormValues) => void;
}

const popupContainer = () => document.body;

const sourceLabel = (entry: DirectoryType) => {
  if (entry.source === 'embedded-product') return null;
  if (entry.originNode === 'productCategories' || entry.originNode === 'partners') {
    return 'Dữ liệu legacy';
  }
  return null;
};

function directoryOptions(entries: DirectoryType[]): ReactNode[] {
  return entries.map((entry) => {
    const label = sourceLabel(entry);
    return (
      <Select.Option
        key={`${entry.originNode}:${entry.id}`}
        value={entry.id}
        label={entry.name}
      >
        <span className="product-directory-option">
          <span>{entry.name}</span>
          {label && <Tag>{label}</Tag>}
        </span>
      </Select.Option>
    );
  });
}

function DirectoryPopup({
  menu,
  value,
  placeholder,
  saving,
  onChange,
  onAdd,
}: {
  menu: ReactNode;
  value: string;
  placeholder: string;
  saving: boolean;
  onChange: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="product-directory-popup">
      {menu}
      <div
        className="product-directory-create"
        onMouseDown={handleDirectoryPopupMouseDown}
        onClick={(event) => event.stopPropagation()}
      >
        <Space.Compact block>
          <Input
            value={value}
            maxLength={200}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                onAdd();
              }
            }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={saving}
            onClick={onAdd}
          >
            Thêm
          </Button>
        </Space.Compact>
      </div>
    </div>
  );
}

export default function ProductFormModal({
  open,
  editing,
  form,
  categories,
  suppliers,
  saving,
  directorySaving,
  newCategoryName,
  newSupplierName,
  onCategoryNameChange,
  onSupplierNameChange,
  onAddCategory,
  onAddSupplier,
  onCancel,
  onFinish,
}: ProductFormModalProps) {
  const sharedSelectProps = {
    showSearch: true,
    listHeight: 224,
    popupMatchSelectWidth: true,
    getPopupContainer: popupContainer,
    filterOption: (input: string, option?: { label?: ReactNode }) => {
      const text = String(option?.label ?? '');
      return text.toLocaleLowerCase('vi-VN').includes(input.toLocaleLowerCase('vi-VN'));
    },
  };

  return (
    <Modal
      className="product-form-modal"
      title={editing ? 'Chỉnh sửa sản phẩm' : 'Tạo mã hàng hóa mới'}
      open={open}
      width={748}
      destroyOnHidden
      maskClosable={!saving}
      closable={!saving}
      keyboard={!saving}
      onCancel={onCancel}
      styles={{
        body: {
          maxHeight: 'calc(100dvh - 206px)',
          overflowY: 'auto',
          padding: '20px 24px 4px',
        },
        footer: {
          marginTop: 0,
          padding: '16px 24px',
          borderTop: '1px solid var(--product-modal-border, #e7ebf0)',
        },
      }}
      footer={(
        <Space size={10}>
          <Button
            className="product-modal-action"
            disabled={saving}
            onClick={onCancel}
          >
            Hủy bỏ
          </Button>
          <Button
            className="product-modal-action"
            type="primary"
            loading={saving}
            onClick={() => form.submit()}
          >
            {editing ? 'Cập nhật sản phẩm' : 'Xác nhận tạo mã'}
          </Button>
        </Space>
      )}
    >
      <Form<ProductFormValues>
        className="product-form-grid"
        form={form}
        layout="vertical"
        requiredMark="optional"
        autoComplete="off"
        onFinish={onFinish}
      >
        <Row gutter={[20, 0]}>
          <Col xs={24} md={12}>
            <Form.Item
              label="Mã hàng hóa"
              name="code"
              rules={[{ required: true, message: 'Vui lòng nhập mã hàng.' }]}
            >
              <Input
                autoFocus={!editing}
                disabled={editing}
                maxLength={80}
                placeholder="Ví dụ: NMP116"
                style={{ textTransform: 'uppercase' }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="Tên sản phẩm"
              name="name"
              rules={[{ required: true, message: 'Vui lòng nhập tên sản phẩm.' }]}
            >
              <Input maxLength={200} placeholder="Ví dụ: Thẻ trắng" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="Đơn vị tính"
              name="unit"
              rules={[{ required: true, message: 'Vui lòng nhập đơn vị tính.' }]}
            >
              <Input maxLength={50} placeholder="Cái, bộ, mét..." />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="Danh mục"
              name="categoryId"
              rules={[{ required: true, message: 'Vui lòng chọn danh mục.' }]}
            >
              <Select
                {...sharedSelectProps}
                placeholder={categories.length ? 'Chọn danh mục' : 'Chưa có danh mục'}
                popupRender={(menu) => (
                  <DirectoryPopup
                    menu={menu}
                    value={newCategoryName}
                    placeholder="Tên danh mục mới"
                    saving={directorySaving}
                    onChange={onCategoryNameChange}
                    onAdd={onAddCategory}
                  />
                )}
              >
                {directoryOptions(categories)}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="Giá nhập"
              name="importPrice"
              rules={[{ required: true, message: 'Vui lòng nhập giá nhập.' }]}
            >
              <InputNumber<number>
                min={0}
                precision={0}
                controls={false}
                formatter={formatNumberVi}
                parser={parseVndInput}
                addonAfter="₫"
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="Giá bán"
              name="salePrice"
              rules={[{ required: true, message: 'Vui lòng nhập giá bán.' }]}
            >
              <InputNumber<number>
                min={0}
                precision={0}
                controls={false}
                formatter={formatNumberVi}
                parser={parseVndInput}
                addonAfter="₫"
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="Tồn kho"
              name="quantity"
              extra="Điều chỉnh bằng phiếu nhập/xuất"
            >
              <InputNumber min={0} disabled controls={false} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="Tồn tối thiểu"
              name="minStock"
              rules={[{ required: true, message: 'Vui lòng nhập tồn tối thiểu.' }]}
            >
              <InputNumber min={0} precision={0} controls={false} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="Nhà cung cấp" name="supplierId">
              <Select
                {...sharedSelectProps}
                allowClear
                placeholder={suppliers.length ? 'Có thể để trống' : 'Chưa có nhà cung cấp'}
                popupRender={(menu) => (
                  <DirectoryPopup
                    menu={menu}
                    value={newSupplierName}
                    placeholder="Tên nhà cung cấp mới"
                    saving={directorySaving}
                    onChange={onSupplierNameChange}
                    onAdd={onAddSupplier}
                  />
                )}
              >
                {directoryOptions(suppliers)}
              </Select>
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="Mô tả / Ghi chú" name="description">
              <Input.TextArea
                rows={3}
                maxLength={500}
                showCount
                placeholder="Thông số kỹ thuật, vị trí kệ hoặc lưu ý khi xử lý..."
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

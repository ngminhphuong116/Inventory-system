import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function AccessDenied() {
  const navigate = useNavigate();
  return (
    <Result
      status="403"
      title="403 - Quyền truy cập bị từ chối"
      subTitle="Xin lỗi, bạn không có quyền truy cập vào chức năng Báo cáo tài chính này."
      extra={<Button type="primary" onClick={() => navigate('/')}>Quay về trang chủ</Button>}
    />
  );
}
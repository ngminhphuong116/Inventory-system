import { useEffect, useMemo, useState } from "react";
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  HistoryOutlined,
  InboxOutlined,
  LeftOutlined,
  RightOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Button,
  Alert,
  Empty,
  Progress,
  Skeleton,
  Spin,
  Table,
  Tag,
  Tooltip as AntTooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  dbService,
  type ExportTicketType,
  type ImportTicketType,
  type ProductType,
  type SalesTicketType,
} from "../../components/Db";
import { toSafeNumber } from "../../utils/format";
import { getTransactionTotal } from "../../utils/transaction-money";
import { formatFirebaseError } from "../../services/data-integrity";
import { useUserRole } from "../../hooks/Useuserrole";
import {
  buildOperationTrendData,
  DASHBOARD_HISTORY_DAYS,
  DASHBOARD_VISIBLE_DAYS,
  dateFromLocalKey,
  formatFullTrendDate,
  formatTrendRange,
  localDateKey,
  visibleTrendWindow,
} from "./dashboard-trend";
import { useDraggableTimeWindow } from "./useDraggableTimeWindow";
import "./Dashboard.css";

type ActivityType = "Nhập kho" | "Xuất kho" | "Bán hàng";
type ActivityRecord = (
  | ImportTicketType
  | ExportTicketType
  | SalesTicketType
) & {
  activityType: ActivityType;
};

interface DashboardContext {
  darkMode: boolean;
}

const HEALTH_COLORS = ["#2f7d5c", "#d9952f", "#cf4b4b"];

const formatNumber = (value: unknown) => toSafeNumber(value).toLocaleString("vi-VN");

const formatCurrency = (value: unknown) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(toSafeNumber(value));

const formatCompactCurrency = (rawValue: unknown) => {
  const value = toSafeNumber(rawValue);
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("vi-VN", {
      maximumFractionDigits: 2,
    })} tỷ ₫`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("vi-VN", {
      maximumFractionDigits: 1,
    })} triệu ₫`;
  }
  return formatCurrency(value);
};

function toDateKey(record: ActivityRecord) {
  if (record.createdAt) {
    const date = new Date(record.createdAt);
    if (!Number.isNaN(date.getTime())) return localDateKey(date);
  }

  const match = record.date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function TrendAxisTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const date = dateFromLocalKey(String(payload?.value || ''));
  if (!date) return null;
  const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()];
  const shortDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  return (
    <g transform={`translate(${x},${y})`}>
      <text className="dashboard-trend-axis-tick" textAnchor="middle">
        <tspan x="0" dy="0">{weekday}</tspan>
        <tspan className="dashboard-trend-axis-date" x="0" dy="15">{shortDate}</tspan>
      </text>
    </g>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { darkMode } = useOutletContext<DashboardContext>();
  const { isAdmin } = useUserRole();
  const [dataError, setDataError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductType[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sourceReady, setSourceReady] = useState({
    products: false,
    imports: false,
    exports: false,
    sales: false,
  });
  const [ticketCounts, setTicketCounts] = useState({
    importCount: 0,
    exportCount: 0,
    salesCount: 0,
  });

  useEffect(() => {
    let imports: ActivityRecord[] = [];
    let exports: ActivityRecord[] = [];
    let sales: ActivityRecord[] = [];

    const updateActivity = () => {
      const combined = [...imports, ...exports, ...sales].sort((a, b) => {
        const aTime = a.createdAt ?? (Date.parse(a.date) || 0);
        const bTime = b.createdAt ?? (Date.parse(b.date) || 0);
        return bTime - aTime || b.key.localeCompare(a.key);
      });
      setActivities(combined);
      setLastUpdated(new Date());
    };

    const handleDataError = (error: Error) => setDataError(formatFirebaseError(error));
    const unsubProducts = dbService.onProducts((data) => {
      setProducts(data);
      setLastUpdated(new Date());
      setSourceReady((current) => ({ ...current, products: true }));
    }, handleDataError);

    const unsubImports = dbService.onImportTickets((data) => {
      const activeImports = data.filter((item) => item.status !== "cancelled");
      imports = activeImports.map((item) => ({
        ...item,
        activityType: "Nhập kho",
      }));
      setTicketCounts((current) => ({
        ...current,
        importCount: activeImports.length,
      }));
      setSourceReady((current) => ({ ...current, imports: true }));
      updateActivity();
    }, false, handleDataError);

    const unsubExports = dbService.onExportTickets((data) => {
      const activeExports = data.filter((item) => item.status !== "cancelled");
      exports = activeExports.map((item) => ({
        ...item,
        activityType: "Xuất kho",
      }));
      setTicketCounts((current) => ({
        ...current,
        exportCount: activeExports.length,
      }));
      setSourceReady((current) => ({ ...current, exports: true }));
      updateActivity();
    }, false, handleDataError);

    const unsubSales = dbService.onSalesTickets((data) => {
      const activeSales = data.filter((item) => item.status !== "cancelled");
      sales = activeSales.map((item) => ({
        ...item,
        activityType: "Bán hàng",
      }));
      setTicketCounts((current) => ({
        ...current,
        salesCount: activeSales.length,
      }));
      setSourceReady((current) => ({ ...current, sales: true }));
      updateActivity();
    }, false, handleDataError);

    return () => {
      unsubProducts();
      unsubImports();
      unsubExports();
      unsubSales();
    };
  }, []);

  const loading = !dataError && !Object.values(sourceReady).every(Boolean);

  const stats = useMemo(() => {
    let warningCount = 0;
    let criticalCount = 0;

    products.forEach((product) => {
      const quantity = toSafeNumber(product.quantity);
      const minStock = toSafeNumber(product.minStock);

      if (quantity === 0) criticalCount += 1;
      else if (quantity <= minStock) warningCount += 1;
    });

    return {
      totalProducts: products.length,
      warningCount,
      criticalCount,
      normalCount: products.length - warningCount - criticalCount,
    };
  }, [products]);

  const alertProducts = useMemo(
    () =>
      products
        .filter((product) => toSafeNumber(product.quantity) <= toSafeNumber(product.minStock))
        .sort((a, b) => {
          const aMin = toSafeNumber(a.minStock);
          const bMin = toSafeNumber(b.minStock);
          const aRatio = aMin > 0 ? toSafeNumber(a.quantity) / aMin : 0;
          const bRatio = bMin > 0 ? toSafeNumber(b.quantity) / bMin : 0;
          return aRatio - bRatio;
        })
        .slice(0, 6),
    [products],
  );

  const trendData = useMemo(() => buildOperationTrendData(
    activities.map((record) => ({
      dateKey: toDateKey(record),
      activityType: record.activityType,
    })),
    new Date(),
    DASHBOARD_HISTORY_DAYS,
  ), [activities]);
  const {
    interactionRef: trendInteractionRef,
    windowStart: trendWindowStart,
    isDragging: isTrendDragging,
    tooltipSuppressed: isTrendTooltipSuppressed,
    canMoveOlder: canMoveTrendOlder,
    canMoveNewer: canMoveTrendNewer,
    moveWindow: moveTrendWindow,
    goToToday: goTrendToToday,
    interactionProps: trendInteractionProps,
  } = useDraggableTimeWindow({
    totalDays: trendData.length,
    visibleDays: DASHBOARD_VISIBLE_DAYS,
  });
  const visibleTrendData = useMemo(
    () => visibleTrendWindow(
      trendData,
      trendWindowStart,
      DASHBOARD_VISIBLE_DAYS,
    ),
    [trendData, trendWindowStart],
  );
  const trendRange = useMemo(
    () => formatTrendRange(visibleTrendData),
    [visibleTrendData],
  );

  const healthData = [
    { name: "An toàn", value: stats.normalCount },
    { name: "Sắp hết", value: stats.warningCount },
    { name: "Hết hàng", value: stats.criticalCount },
  ];

  const todaySales = useMemo(
    () =>
      isAdmin ? activities.filter(
        (record) =>
          record.activityType === "Bán hàng" &&
          toDateKey(record) === localDateKey(new Date()),
      ) : [],
    [activities, isAdmin],
  );

  const todayRevenue = useMemo(
    () =>
      isAdmin ? todaySales.reduce(
        (total, record) => total + getTransactionTotal(record, "sale"),
        0,
      ) : 0,
    [isAdmin, todaySales],
  );

  const activityColumns: ColumnsType<ActivityRecord> = [
    {
      title: "Thời gian",
      dataIndex: "date",
      key: "date",
      width: 142,
      render: (date: string) => <span className="dash-date">{date || "—"}</span>,
    },
    {
      title: "Giao dịch",
      dataIndex: "activityType",
      key: "activityType",
      width: 110,
      render: (type: ActivityType) => (
        <Tag
          variant="filled"
          color={
            type === "Nhập kho"
              ? "processing"
              : type === "Xuất kho"
                ? "orange"
                : "success"
          }
        >
          {type}
        </Tag>
      ),
    },
    {
      title: "Mặt hàng",
      dataIndex: "productName",
      key: "productName",
      ellipsis: true,
    },
    {
      title: "Số lượng",
      dataIndex: "quantity",
      key: "quantity",
      align: "right",
      width: 88,
      render: (quantity: number, record) => {
        const inbound = record.activityType === "Nhập kho";
        return (
          <strong
            className={inbound ? "dash-quantity-in" : "dash-quantity-out"}
          >
            {inbound ? "+" : "−"}
            {formatNumber(quantity)}
          </strong>
        );
      },
    },
  ];

  const kpis = [
    {
      key: "products",
      label: "Tổng sản phẩm",
      value: formatNumber(stats.totalProducts),
      helper: `${stats.normalCount} sản phẩm đang ở mức an toàn`,
      icon: <AppstoreOutlined />,
      tone: "blue",
      layout: "summary",
      destination: "/product",
    },
    {
      key: "low-stock",
      label: "Sắp hết hàng",
      value: formatNumber(stats.warningCount),
      helper:
        stats.warningCount > 0
          ? "Cần lên kế hoạch nhập thêm"
          : "Không có sản phẩm cần bổ sung",
      icon: <WarningOutlined />,
      tone: "amber",
      layout: "signal",
      destination: "/product?stockStatus=critical",
    },
    {
      key: "out-of-stock",
      label: "Hết hàng",
      value: formatNumber(stats.criticalCount),
      helper:
        stats.criticalCount > 0
          ? "Cần ưu tiên nhập kho"
          : "Tất cả sản phẩm đều còn hàng",
      icon: <CloseCircleOutlined />,
      tone: "red",
      layout: "signal",
      destination: "/product?stockStatus=out",
    },
    ...(isAdmin ? [{
      key: "today-revenue",
      label: "Doanh thu hôm nay",
      value: formatCompactCurrency(todayRevenue),
      fullValue: formatCurrency(todayRevenue),
      helper:
        todaySales.length > 0
          ? `Từ ${todaySales.length} đơn bán hàng`
          : "Chưa có giao dịch bán hàng",
      icon: <DollarOutlined />,
      tone: "green",
      layout: "financial",
      destination: "/report",
    }] : [{
      key: "transactions",
      label: "Số giao dịch",
      value: formatNumber(
        ticketCounts.importCount + ticketCounts.exportCount + ticketCounts.salesCount,
      ),
      helper: "Tổng lượt nhập, xuất và bán hàng",
      icon: <ShoppingOutlined />,
      tone: "blue",
      layout: "summary",
      destination: "/history",
    }]),
  ];

  if (dataError) {
    return (
      <div className={`dashboard-page${darkMode ? " dashboard-page-dark" : ""}`}>
        <Alert
          type="error"
          showIcon
          message="Không thể tải dữ liệu kho"
          description={dataError}
        />
      </div>
    );
  }

  return (
    /*
     * THESIS: Trung tâm điều hành kho ưu tiên tín hiệu cần hành động, không phải một lưới card trang trí.
     * OWN-WORLD: Bề mặt vận hành sáng, navy, màu trạng thái tiết chế và bảng dữ liệu dày vừa phải.
     * STORY: Đọc sức khỏe kho, nhận diện rủi ro, xem nhịp giao dịch rồi đi thẳng tới nghiệp vụ cần xử lý.
     * FIRST VIEWPORT: Tiêu đề và trạng thái cập nhật, bốn KPI, biểu đồ 7 ngày và phân bổ sức khỏe tồn kho.
     * FORM: Operations console theo mẫu tham chiếu, ưu tiên desktop Electron và dữ liệu Firebase thật.
     */
    <div className={`dashboard-page${darkMode ? " dashboard-page-dark" : ""}`}>
      <header className="dashboard-heading dashboard-hero">
        <div className="dashboard-hero-copy">
          <h1>Tổng quan kho hàng</h1>
          <p>Theo dõi tồn kho và nhịp vận hành trong một màn hình.</p>
        </div>
        <div className="dashboard-hero-tools">
          <div
            className={`dashboard-sync${loading ? " dashboard-sync-pending" : ""}`}
          >
            <span aria-hidden="true" />
            {!loading && lastUpdated
              ? `Cập nhật lúc ${lastUpdated.toLocaleTimeString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Đang đồng bộ dữ liệu"}
          </div>
          <div className="dashboard-quick-actions" aria-label="Thao tác nhanh">
            <Button
              icon={<HistoryOutlined />}
              onClick={() => navigate("/history")}
            >
              Xem lịch sử
            </Button>
            <Button
              type="primary"
              icon={<ShoppingOutlined />}
              onClick={() => navigate("/sales")}
            >
              Bán hàng
            </Button>
          </div>
        </div>
      </header>

      <section className="dashboard-kpis" aria-label="Chỉ số kho hàng">
        {kpis.map((kpi) => (
          <button
            type="button"
            className={`dashboard-kpi dashboard-kpi--${kpi.layout} kpi-${kpi.tone}`}
            key={kpi.key}
            disabled={loading}
            onClick={() => navigate(kpi.destination)}
            aria-label={
              loading
                ? `${kpi.label}, đang tải dữ liệu`
                : `${kpi.label}: ${kpi.fullValue || kpi.value}. Xem chi tiết`
            }
          >
            {loading ? (
              <div className="dashboard-kpi-skeleton" aria-hidden="true">
                <Skeleton.Input active size="small" />
                <Skeleton.Input active />
                <Skeleton.Input active size="small" />
              </div>
            ) : (
              <>
                <div className="dashboard-kpi-top">
                  <div className="dashboard-kpi-heading">
                    <span>{kpi.label}</span>
                    <p>{kpi.helper}</p>
                  </div>
                  <div className="dashboard-kpi-icon" aria-hidden="true">
                    {kpi.icon}
                  </div>
                </div>
                <div className="dashboard-kpi-metric">
                  <AntTooltip title={kpi.fullValue} mouseEnterDelay={0.35}>
                    <strong className="dashboard-kpi-value">{kpi.value}</strong>
                  </AntTooltip>
                  <span className="dashboard-kpi-action">
                    Chi tiết <ArrowRightOutlined />
                  </span>
                </div>
                <span className="dashboard-kpi-baseline" aria-hidden="true" />
              </>
            )}
          </button>
        ))}
      </section>

      {loading ? (
        <div className="dashboard-loading">
          <Spin size="large" />
          <span>Đang đồng bộ dữ liệu kho...</span>
        </div>
      ) : (
        <>
          <section className="dashboard-primary-grid">
            <article className="dashboard-panel dashboard-trend-panel">
              <header className="dashboard-panel-heading">
                <div>
                  <h2>Nhịp vận hành 7 ngày</h2>
                  <p>
                    Số lượt nhập, xuất và bán hàng theo ngày
                    <span className="dashboard-trend-range">{trendRange}</span>
                  </p>
                </div>
                <div className="dashboard-trend-tools">
                  <div className="dashboard-ticket-summary">
                    <AntTooltip title="Tổng phiếu nhập">
                      <span tabIndex={0}>
                        <InboxOutlined />
                        {ticketCounts.importCount}
                      </span>
                    </AntTooltip>
                    <AntTooltip title="Tổng phiếu xuất">
                      <span tabIndex={0}>
                        <ShoppingCartOutlined />
                        {ticketCounts.exportCount}
                      </span>
                    </AntTooltip>
                    <AntTooltip title="Tổng hóa đơn bán hàng">
                      <span tabIndex={0}>
                        <ShoppingOutlined />
                        {ticketCounts.salesCount}
                      </span>
                    </AntTooltip>
                  </div>
                  <div className="dashboard-trend-navigation" aria-label="Điều hướng khoảng ngày biểu đồ">
                    {canMoveTrendNewer && (
                      <Button size="small" type="text" onClick={goTrendToToday}>
                        Về hôm nay
                      </Button>
                    )}
                    <Button
                      size="small"
                      aria-label="Xem một ngày cũ hơn"
                      title="Xem một ngày cũ hơn"
                      icon={<LeftOutlined />}
                      disabled={!canMoveTrendOlder}
                      onClick={() => moveTrendWindow(-1)}
                    />
                    <Button
                      size="small"
                      aria-label="Xem một ngày mới hơn"
                      title="Xem một ngày mới hơn"
                      icon={<RightOutlined />}
                      disabled={!canMoveTrendNewer}
                      onClick={() => moveTrendWindow(1)}
                    />
                  </div>
                </div>
              </header>

              <div
                ref={trendInteractionRef}
                className={`dashboard-chart dashboard-trend-chart${isTrendDragging ? " dashboard-trend-chart--dragging" : ""}`}
                role="group"
                tabIndex={0}
                aria-roledescription="biểu đồ dòng thời gian có thể kéo ngang"
                aria-label={`Nhịp vận hành từ ${trendRange}. Kéo ngang, dùng Shift và con lăn, hoặc phím mũi tên để đổi ngày.`}
                {...trendInteractionProps}
              >
                {canMoveTrendOlder && (
                  <span className="dashboard-chart-edge dashboard-chart-edge--left" aria-hidden="true" />
                )}
                {canMoveTrendNewer && (
                  <span className="dashboard-chart-edge dashboard-chart-edge--right" aria-hidden="true" />
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={visibleTrendData}
                    margin={{ top: 14, right: 8, left: -22, bottom: 12 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 7"
                      vertical={false}
                      stroke={darkMode ? "#334155" : "#dce4ee"}
                      strokeOpacity={0.8}
                    />
                    <XAxis
                      dataKey="key"
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      height={42}
                      tick={<TrendAxisTick />}
                    />
                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: darkMode ? "#94a3b8" : "#66758a" }}
                    />
                    <Tooltip
                      active={isTrendTooltipSuppressed ? false : undefined}
                      labelFormatter={(label) => formatFullTrendDate(String(label))}
                      formatter={(value) => formatNumber(value)}
                      contentStyle={{
                        borderRadius: 10,
                        border: darkMode ? "1px solid #334155" : "1px solid #dce4ee",
                        boxShadow: "0 14px 32px rgba(15, 23, 42, 0.16)",
                        background: darkMode ? "#1f2937" : "#ffffff",
                      }}
                      cursor={{
                        stroke: darkMode ? "#64748b" : "#9fb1c6",
                        strokeWidth: 1,
                      }}
                      labelStyle={{
                        color: darkMode ? "#f1f5f9" : "#14213a",
                      }}
                      itemStyle={{
                        color: darkMode ? "#e2e8f0" : "#334155",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="Nhập kho"
                      stroke="#3974c6"
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: "#3974c6" }}
                      activeDot={{ r: 6, strokeWidth: 2, stroke: "#ffffff" }}
                      animationDuration={220}
                      animationEasing="ease-out"
                      isAnimationActive={!isTrendDragging}
                    />
                    <Line
                      type="monotone"
                      dataKey="Xuất kho"
                      stroke="#d9952f"
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: "#d9952f" }}
                      activeDot={{ r: 6, strokeWidth: 2, stroke: "#ffffff" }}
                      animationDuration={220}
                      animationEasing="ease-out"
                      isAnimationActive={!isTrendDragging}
                    />
                    <Line
                      type="monotone"
                      dataKey="Bán hàng"
                      stroke="#2f7d5c"
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: "#2f7d5c" }}
                      activeDot={{ r: 6, strokeWidth: 2, stroke: "#ffffff" }}
                      animationDuration={220}
                      animationEasing="ease-out"
                      isAnimationActive={!isTrendDragging}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <span className="dashboard-chart-hint" aria-hidden="true">
                  ↔ Kéo ngang để xem các ngày khác
                </span>
              </div>

              <table className="dashboard-chart-data">
                <caption>Dữ liệu vận hành từ {trendRange}</caption>
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Nhập kho</th>
                    <th>Xuất kho</th>
                    <th>Bán hàng</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTrendData.map((day) => (
                    <tr key={day.key}>
                      <th>{formatFullTrendDate(day.key)}</th>
                      <td>{day["Nhập kho"]}</td>
                      <td>{day["Xuất kho"]}</td>
                      <td>{day["Bán hàng"]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="dashboard-chart-legend" aria-hidden="true">
                <span className="legend-import">Nhập kho</span>
                <span className="legend-export">Xuất kho</span>
                <span className="legend-sales">Bán hàng</span>
              </div>
            </article>

            <article className="dashboard-panel dashboard-health-panel">
              <header className="dashboard-panel-heading">
                <div>
                  <h2>Sức khỏe tồn kho</h2>
                  <p>Phân bổ trạng thái theo mã hàng</p>
                </div>
              </header>

              <div className="dashboard-health-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={healthData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={57}
                      outerRadius={91}
                      paddingAngle={4}
                      cornerRadius={5}
                      stroke="none"
                    >
                      {healthData.map((item, index) => (
                        <Cell
                          key={item.name}
                          fill={HEALTH_COLORS[index]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: 10,
                        border: darkMode ? "1px solid #334155" : "1px solid #dce4ee",
                        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.14)",
                        background: darkMode ? "#1f2937" : "#ffffff",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dashboard-health-total">
                  <strong>{stats.totalProducts}</strong>
                  <span>mã hàng</span>
                </div>
              </div>

              <div className="dashboard-health-list">
                {healthData.map((item, index) => {
                  const percentage = stats.totalProducts
                    ? Math.round((item.value / stats.totalProducts) * 100)
                    : 0;
                  return (
                    <div key={item.name}>
                      <span
                        className="dashboard-health-dot"
                        style={{ background: HEALTH_COLORS[index] }}
                      />
                      <span>{item.name}</span>
                      <strong>{item.value}</strong>
                      <small>{percentage}%</small>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>

          <section className="dashboard-secondary-grid">
            <article className="dashboard-panel dashboard-alert-panel">
              <header className="dashboard-panel-heading">
                <div>
                  <h2>Ưu tiên bổ sung</h2>
                  <p>Các mặt hàng đã chạm hoặc thấp hơn mức tối thiểu</p>
                </div>
                <Button
                  type="link"
                  aria-label="Đi tới trang nhập kho"
                  title="Đi tới trang nhập kho"
                  onClick={() => navigate("/import")}
                >
                  Xem thêm <ArrowRightOutlined />
                </Button>
              </header>

              {alertProducts.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Tồn kho đang ở mức an toàn"
                />
              ) : (
                <div className="dashboard-alert-list">
                  {alertProducts.map((product) => {
                    const quantity = toSafeNumber(product.quantity);
                    const minStock = toSafeNumber(product.minStock);
                    const percent =
                      minStock > 0
                        ? Math.min(
                            100,
                            Math.round(
                              (quantity / minStock) * 100,
                            ),
                          )
                        : 0;
                    return (
                      <div className="dashboard-alert-item" key={product.id}>
                        <div className="dashboard-alert-copy">
                          <strong>{product.name}</strong>
                          <span>
                            {product.code || "Chưa có mã"} · Mức tối thiểu {minStock}
                          </span>
                        </div>
                        <div className="dashboard-alert-stock">
                          <strong>{quantity}</strong>
                          <span>{product.unit || "sản phẩm"}</span>
                        </div>
                        <Progress
                          percent={percent}
                          showInfo={false}
                          strokeColor={
                            quantity === 0 ? "#cf4b4b" : "#d9952f"
                          }
                          trailColor={darkMode ? "#334155" : "#e8edf3"}
                          size="small"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </article>

            <article className="dashboard-panel dashboard-activity-panel">
              <header className="dashboard-panel-heading">
                <div>
                  <h2>Giao dịch gần đây</h2>
                  <p>Nhật ký nhập, xuất và bán hàng mới nhất</p>
                </div>
                <Button
                  type="link"
                  aria-label="Xem toàn bộ lịch sử"
                  title="Xem toàn bộ lịch sử"
                  onClick={() => navigate("/history")}
                >
                  Xem tất cả <ArrowRightOutlined />
                </Button>
              </header>
              <Table<ActivityRecord>
                rowKey="key"
                columns={activityColumns}
                dataSource={activities.slice(0, 7)}
                pagination={false}
                size="small"
                scroll={{ x: 620 }}
                locale={{ emptyText: "Chưa có giao dịch nào được ghi nhận" }}
              />
            </article>
          </section>
        </>
      )}
    </div>
  );
}

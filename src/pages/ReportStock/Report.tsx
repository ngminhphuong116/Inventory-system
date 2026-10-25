import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  DatePicker,
  Empty,
  Result,
  Select,
  Skeleton,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CalendarOutlined,
  DollarOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  LockOutlined,
  ReloadOutlined,
  RiseOutlined,
  ShoppingCartOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useOutletContext } from 'react-router-dom';
import { dbService } from '../../components/Db';
import type {
  ExportTicketType,
  ImportTicketType,
  SalesTicketType,
} from '../../components/Db';
import { useUserRole } from '../../hooks/Useuserrole';
import { formatNumberVi, formatVnd } from '../../utils/format';
import { parseRecordTimestamp } from '../../utils/record-time';
import {
  buildFinancialReport,
  resolveReportDateRange,
  type DocumentDistributionItem,
  type ReportPeriod,
} from './report-data';
import { exportFinancialReportToExcel } from './report-excel';
import './Report.css';

const { RangePicker } = DatePicker;

interface ContextType {
  darkMode: boolean;
}

interface TooltipEntry {
  color?: string;
  name?: string;
  value?: number;
}

interface FinancialTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}

interface DistributionTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: DocumentDistributionItem;
  }>;
  total: number;
}

const DOCUMENT_COLORS = {
  sale: '#2563eb',
  import: '#16a34a',
  export: '#f97316',
} as const;

const compactMoney = (value: number) => {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString('vi-VN', {
      maximumFractionDigits: 1,
    })}tỷ`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('vi-VN', {
      maximumFractionDigits: 1,
    })}tr`;
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toLocaleString('vi-VN', {
      maximumFractionDigits: 0,
    })}k`;
  }
  return formatNumberVi(value);
};

function FinancialTooltip({ active, payload, label }: FinancialTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="report-chart-tooltip">
      <div className="report-chart-tooltip__date">{label}</div>
      {payload.map((entry) => (
        <div className="report-chart-tooltip__row" key={entry.name}>
          <span
            className="report-chart-tooltip__dot"
            style={{ background: entry.color }}
          />
          <span>{entry.name}</span>
          <strong>{formatVnd(entry.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function DistributionTooltip({ active, payload, total }: DistributionTooltipProps) {
  const item = payload?.[0]?.payload;
  if (!active || !item || total <= 0) return null;
  const percentage = (item.value / total) * 100;
  return (
    <div className="report-chart-tooltip report-chart-tooltip--distribution">
      <div className="report-chart-tooltip__row">
        <span
          className="report-chart-tooltip__dot"
          style={{ background: DOCUMENT_COLORS[item.kind] }}
        />
        <span>{item.name}</span>
        <strong>{formatNumberVi(item.value)} chứng từ</strong>
      </div>
      <div className="report-chart-tooltip__percentage">
        Tỷ lệ <strong>{percentage.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</strong>
      </div>
    </div>
  );
}

function InsightItem({
  icon,
  label,
  value,
  note,
  warning = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  warning?: boolean;
}) {
  return (
    <div className={`report-insight-item${warning ? ' report-insight-item--warning' : ''}`}>
      <span className="report-insight-item__icon">{icon}</span>
      <div>
        <span className="report-insight-item__label">{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

export default function Report() {
  const { message } = AntApp.useApp();
  const { darkMode } = useOutletContext<ContextType>();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null]>(() => {
    const range = resolveReportDateRange('month');
    return [dayjs(range.start), dayjs(range.end)];
  });
  const [timeType, setTimeType] = useState<ReportPeriod | 'custom'>('month');
  const [imports, setImports] = useState<ImportTicketType[]>([]);
  const [exports, setExports] = useState<ExportTicketType[]>([]);
  const [sales, setSales] = useState<SalesTicketType[]>([]);
  const [loaded, setLoaded] = useState({ imports: false, exports: false, sales: false });
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);

  useEffect(() => {
    if (!isAdmin) return undefined;

    const unsubscribers: Array<() => void> = [];

    try {
      unsubscribers.push(
        dbService.onImportTickets((data) => {
          setImports(Array.isArray(data) ? data : []);
          setLoaded((current) => ({ ...current, imports: true }));
        }),
        dbService.onExportTickets((data) => {
          setExports(Array.isArray(data) ? data : []);
          setLoaded((current) => ({ ...current, exports: true }));
        }),
        dbService.onSalesTickets((data) => {
          setSales(Array.isArray(data) ? data : []);
          setLoaded((current) => ({ ...current, sales: true }));
        }),
      );
    } catch (caughtError) {
      const message = caughtError instanceof Error
        ? caughtError.message
        : 'Không thể kết nối dữ liệu báo cáo.';
      Promise.resolve().then(() => {
        setError(message);
        setLoaded({ imports: true, exports: true, sales: true });
      });
    }

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [isAdmin, refreshKey]);

  const summary = useMemo(() => buildFinancialReport({
    imports,
    exports,
    sales,
    startTime: dates[0]
      ? parseRecordTimestamp(`${dates[0].format('YYYY-MM-DD')} 00:00:00`)
      : 0,
    endTime: dates[1]
      ? parseRecordTimestamp(`${dates[1].format('YYYY-MM-DD')} 23:59:59`)
      : Number.MAX_SAFE_INTEGER,
  }), [dates, exports, imports, sales]);

  const loading = roleLoading || !loaded.imports || !loaded.exports || !loaded.sales;
  const isEmpty = !loading && summary.totalOrders === 0;

  const handleTimeTypeChange = (value: string) => {
    if (value !== 'day' && value !== 'month' && value !== 'quarter') return;
    setTimeType(value);
    const range = resolveReportDateRange(value);
    setDates([dayjs(range.start), dayjs(range.end)]);
  };

  const handleKpiPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--report-glow-x', `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty('--report-glow-y', `${event.clientY - bounds.top}px`);
  }, []);

  const handleReload = useCallback(() => {
    setError('');
    setLoaded({ imports: false, exports: false, sales: false });
    setRefreshKey((current) => current + 1);
  }, []);

  const handleExportExcel = async () => {
    if (exportingRef.current) return;
    if (loading) {
      message.warning('Dữ liệu báo cáo đang được tải. Vui lòng chờ trong giây lát.');
      return;
    }
    if (!summary.totalOrders || !dates[0] || !dates[1]) {
      message.warning('Không có chứng từ trong kỳ để xuất Excel.');
      return;
    }

    exportingRef.current = true;
    setExporting(true);
    try {
      await exportFinancialReportToExcel({
        report: summary,
        startDate: dates[0].startOf('day').toDate(),
        endDate: dates[1].endOf('day').toDate(),
      });
      message.success('Đã xuất báo cáo tài chính ra file Excel.');
    } catch (caughtError) {
      console.error('Không thể xuất báo cáo Excel:', caughtError);
      message.error('Không thể tạo file Excel. Vui lòng thử lại.');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  if (!roleLoading && !isAdmin) {
    return (
      <div className={`report-page${darkMode ? ' report-page--dark' : ''}`}>
        <Result
          icon={<LockOutlined className="report-access-icon" />}
          title="Truy cập bị từ chối"
          subTitle="Trang Báo cáo tài chính chỉ dành cho quyền Admin."
        />
      </div>
    );
  }

  const kpis = [
    {
      key: 'income',
      label: 'Tổng thu',
      hint: 'Bán hàng và xuất kho',
      value: formatVnd(summary.totalIncome),
      icon: <ArrowUpOutlined />,
      tone: 'positive',
    },
    {
      key: 'outcome',
      label: 'Tổng chi',
      hint: 'Giá trị phiếu nhập',
      value: formatVnd(summary.totalOutcome),
      icon: <ArrowDownOutlined />,
      tone: 'negative',
    },
    {
      key: 'profit',
      label: 'Lợi nhuận gộp',
      hint: summary.missingCostSnapshots
        ? `${summary.missingCostSnapshots} chứng từ thiếu giá vốn`
        : 'Theo snapshot giá vốn',
      value: formatVnd(summary.grossProfit),
      icon: <DollarOutlined />,
      tone: summary.grossProfit >= 0 ? 'positive' : 'warning',
    },
    {
      key: 'orders',
      label: 'Tổng chứng từ',
      hint: `Vào ${formatNumberVi(summary.totalImportQty)} · Ra ${formatNumberVi(summary.totalExportQty)} SP`,
      value: formatNumberVi(summary.totalOrders),
      icon: <FileTextOutlined />,
      tone: 'summary',
    },
  ];

  return (
    <div className={`report-page${darkMode ? ' report-page--dark' : ''}`}>
      <div className="report-floating-gradient report-floating-gradient--one" />
      <div className="report-floating-gradient report-floating-gradient--two" />
      <div className="report-floating-gradient report-floating-gradient--three" />

      <div className="report-page__content">
        <header className="report-hero">
          <div>
            <div className="report-hero__kicker">
              <RiseOutlined />
              Tổng quan tài chính
            </div>
            <h1>Báo cáo tài chính cửa hàng</h1>
            <p>
              {dates[0]?.format('DD/MM/YYYY') || '—'}
              <span>—</span>
              {dates[1]?.format('DD/MM/YYYY') || '—'}
            </p>
          </div>

          <div className="report-toolbar" aria-label="Bộ lọc báo cáo">
            <div className="report-toolbar__label">
              <CalendarOutlined />
              Khoảng thời gian
            </div>
            <Select
              aria-label="Chọn nhanh khoảng thời gian"
              value={timeType}
              className="report-quick-filter"
              onChange={handleTimeTypeChange}
              options={[
                { value: 'day', label: 'Hôm nay' },
                { value: 'month', label: 'Tháng này' },
                { value: 'quarter', label: 'Quý này' },
                ...(timeType === 'custom'
                  ? [{ value: 'custom', label: 'Tùy chọn', disabled: true }]
                  : []),
              ]}
            />
            <RangePicker
              aria-label="Chọn khoảng ngày báo cáo"
              value={[dates[0], dates[1]]}
              format="DD/MM/YYYY"
              allowClear={false}
              onChange={(value) => {
                if (value?.[0] && value[1]) {
                  setDates([value[0], value[1]]);
                  setTimeType('custom');
                }
              }}
            />
            <Button
              className="report-reload-button"
              icon={<ReloadOutlined spin={loading && refreshKey > 0} />}
              onClick={handleReload}
              disabled={loading}
            >
              Làm mới
            </Button>
            <Button
              className="report-export-button"
              icon={<FileExcelOutlined />}
              loading={exporting}
              disabled={loading || exporting}
              onClick={handleExportExcel}
            >
              Xuất Excel
            </Button>
          </div>
        </header>

        {error && (
          <Alert
            className="report-error"
            type="error"
            showIcon
            message="Không thể tải báo cáo"
            description={error}
            action={(
              <Button size="small" onClick={handleReload}>
                Thử lại
              </Button>
            )}
          />
        )}

        <section className="report-kpi-grid" aria-label="Chỉ số tài chính">
          {loading
            ? Array.from({ length: 4 }, (_, index) => (
                <div className="report-kpi-card report-kpi-card--loading" key={index}>
                  <Skeleton active title={{ width: '42%' }} paragraph={{ rows: 2 }} />
                </div>
              ))
            : kpis.map((item) => (
                <article
                  className={`report-kpi-card report-kpi-card--${item.tone}`}
                  key={item.key}
                  onPointerMove={handleKpiPointerMove}
                >
                  <div className="report-kpi-card__top">
                    <div>
                      <span className="report-kpi-card__label">{item.label}</span>
                      <small>{item.hint}</small>
                    </div>
                    <span className="report-kpi-card__icon">{item.icon}</span>
                  </div>
                  <strong className="report-kpi-card__value">{item.value}</strong>
                  <div className="report-kpi-card__baseline" />
                </article>
              ))}
        </section>

        {isEmpty ? (
          <section className="report-empty-card">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={(
                <div>
                  <strong>Không có chứng từ trong kỳ</strong>
                  <span>Hãy chọn một khoảng ngày khác hoặc làm mới báo cáo.</span>
                </div>
              )}
            />
          </section>
        ) : (
          <>
            <section className="report-chart-grid">
              <article className="report-chart-card report-chart-card--cashflow">
                <div className="report-chart-card__heading">
                  <div>
                    <span className="report-chart-card__icon">
                      <ShoppingCartOutlined />
                    </span>
                    <div>
                      <h2>Tổng thu / Tổng chi theo ngày</h2>
                      <p>So sánh dòng tiền vào và ra trong kỳ báo cáo</p>
                    </div>
                  </div>
                  <span className="report-chart-card__meta">
                    {summary.chartData.length} ngày có giao dịch
                  </span>
                </div>
                {loading ? (
                  <Skeleton className="report-chart-skeleton" active paragraph={{ rows: 6 }} />
                ) : (
                  <div className="report-chart-stage">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={summary.chartData}
                        margin={{ top: 16, right: 14, left: 2, bottom: 2 }}
                        barGap={7}
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--report-grid)"
                          strokeDasharray="3 5"
                        />
                        <XAxis
                          dataKey="date"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: 'var(--report-muted)', fontSize: 12 }}
                          dy={8}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          width={58}
                          tick={{ fill: 'var(--report-muted)', fontSize: 12 }}
                          tickFormatter={compactMoney}
                        />
                        <Tooltip
                          cursor={{ fill: 'var(--report-chart-hover)' }}
                          content={<FinancialTooltip />}
                        />
                        <Legend
                          iconType="circle"
                          iconSize={8}
                          wrapperStyle={{ paddingTop: 18, color: 'var(--report-text)' }}
                        />
                        <Bar
                          dataKey="income"
                          name="Tổng thu"
                          fill="#16a34a"
                          radius={[6, 6, 2, 2]}
                          maxBarSize={34}
                          animationDuration={850}
                          animationEasing="ease-out"
                        />
                        <Bar
                          dataKey="outcome"
                          name="Tổng chi"
                          fill="#ef4444"
                          radius={[6, 6, 2, 2]}
                          maxBarSize={34}
                          animationDuration={850}
                          animationEasing="ease-out"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </article>

              <article className="report-chart-card report-chart-card--distribution">
                <div className="report-chart-card__heading">
                  <div>
                    <span className="report-chart-card__icon">
                      <FileTextOutlined />
                    </span>
                    <div>
                      <h2>Cơ cấu chứng từ trong kỳ</h2>
                      <p>Tỷ trọng chứng từ bán hàng, nhập kho và xuất kho</p>
                    </div>
                  </div>
                  <span className="report-chart-card__meta">
                    {formatNumberVi(summary.totalOrders)} chứng từ
                  </span>
                </div>
                {loading ? (
                  <Skeleton className="report-chart-skeleton" active paragraph={{ rows: 6 }} />
                ) : summary.totalOrders === 0 ? (
                  <div className="report-chart-empty">
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="Không có chứng từ trong kỳ"
                    />
                  </div>
                ) : (
                  <div
                    className="report-chart-stage report-donut-stage"
                    role="img"
                    aria-label={`Cơ cấu ${formatNumberVi(summary.totalOrders)} chứng từ trong kỳ`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                        <Pie
                          data={summary.documentDistribution}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="44%"
                          innerRadius="45%"
                          outerRadius="68%"
                          paddingAngle={summary.totalOrders > 1 ? 2 : 0}
                          cornerRadius={5}
                          stroke="var(--report-card)"
                          strokeWidth={3}
                          animationDuration={850}
                          animationEasing="ease-out"
                        >
                          {summary.documentDistribution.map((item) => (
                            <Cell
                              key={item.kind}
                              fill={DOCUMENT_COLORS[item.kind]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          content={<DistributionTooltip total={summary.totalOrders} />}
                        />
                        <Legend
                          verticalAlign="bottom"
                          align="center"
                          iconType="circle"
                          iconSize={8}
                          formatter={(value) => (
                            <span className="report-donut-legend-label">{value}</span>
                          )}
                          wrapperStyle={{ paddingTop: 10 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="report-donut-center" aria-hidden="true">
                      <strong>{formatNumberVi(summary.totalOrders)}</strong>
                      <span>chứng từ</span>
                    </div>
                  </div>
                )}
              </article>
            </section>

            <section className="report-insights">
              <div className="report-insights__heading">
                <div>
                  <span>Nhận định trong kỳ</span>
                  <h2>Điểm đáng chú ý từ dữ liệu hiện có</h2>
                </div>
                <small>Cập nhật theo bộ lọc thời gian phía trên</small>
              </div>
              <div className="report-insights__grid">
                <InsightItem
                  icon={<ArrowUpOutlined />}
                  label="Ngày thu cao nhất"
                  value={summary.highestIncomeDay?.date || 'Chưa xác định'}
                  note={formatVnd(summary.highestIncomeDay?.income)}
                />
                <InsightItem
                  icon={<ArrowDownOutlined />}
                  label="Ngày chi cao nhất"
                  value={summary.highestOutcomeDay?.date || 'Chưa xác định'}
                  note={formatVnd(summary.highestOutcomeDay?.outcome)}
                />
                <InsightItem
                  icon={<ShoppingCartOutlined />}
                  label="Sản phẩm nổi bật"
                  value={summary.topProduct?.name || 'Chưa có dữ liệu'}
                  note={`${formatNumberVi(summary.topProduct?.quantity)} sản phẩm đã xuất/bán`}
                />
                <InsightItem
                  icon={summary.missingCostSnapshots ? <WarningOutlined /> : <DollarOutlined />}
                  label="Độ phủ giá vốn"
                  value={summary.missingCostSnapshots
                    ? `${summary.missingCostSnapshots} chứng từ chưa đủ`
                    : 'Đầy đủ trong kỳ'}
                  note={summary.missingCostSnapshots
                    ? 'Không bịa lợi nhuận cho dữ liệu thiếu snapshot'
                    : 'Lợi nhuận được tính từ snapshot giao dịch'}
                  warning={summary.missingCostSnapshots > 0}
                />
              </div>
              {summary.invalidTimeRecords > 0 && (
                <div className="report-data-note">
                  <WarningOutlined />
                  {summary.invalidTimeRecords} chứng từ có thời gian không hợp lệ đã được loại khỏi kỳ báo cáo.
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "chart.js/auto";
import type { ChartData, ChartOptions, ScriptableContext } from "chart.js";
import { Line, Pie } from "react-chartjs-2";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { apiClient } from "../../lib/api";
import {
  formatCompactNumber,
  formatCurrency,
  formatDate,
  getOrderStatusMeta,
} from "../../lib/format";
import { AdminErrorState, AdminLoadingState, getErrorMessage } from "./adminShared";

interface DashboardApiPayload {
  stats?: {
    total_revenue: number;
    total_orders: number;
    total_products: number;
    total_customers: number;
  };
  total_revenue?: number;
  total_orders?: number;
  total_products?: number;
  total_customers?: number;
  revenue_series: { month: string; year?: number; revenue: number }[];
  category_share: { name: string; count: number; percentage: number; color: string }[];
  top_products: { id?: number; product_id?: number; name: string; sold: number; revenue: number }[];
  recent_orders: {
    order_code: string;
    customer_name: string;
    grand_total: number;
    status: string;
    payment_method: string;
    items_count?: number;
    created_at: string;
  }[];
  product_table: {
    id: number;
    name: string;
    category: string;
    price: number;
    stock?: number;
    stock_quantity?: number;
    status: string;
  }[];
}

export function AdminDashboardPage() {
  const [data, setData] = useState<DashboardApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<DashboardApiPayload>("/api/admin/dashboard");
      setData(res);
    } catch (err) {
      setError(getErrorMessage(err, "Không thể tải bảng điều khiển quản trị."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const revenueChartData = useMemo<ChartData<"line">>(() => {
    const series = data?.revenue_series ?? [];
    return {
      labels: series.map((pt) => pt.month),
      datasets: [
        {
          label: "Doanh thu",
          data: series.map((pt) => pt.revenue),
          borderColor: "#E63946",
          backgroundColor: (context: ScriptableContext<"line">) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return "rgba(230, 57, 70, 0.16)";
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, "rgba(230, 57, 70, 0.34)");
            gradient.addColorStop(1, "rgba(230, 57, 70, 0.02)");
            return gradient;
          },
          borderWidth: 3,
          fill: true,
          tension: 0.38,
          pointBackgroundColor: "#E63946",
          pointBorderColor: "#F5F6FA",
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 7,
        },
      ],
    };
  }, [data]);

  const revenueChartOptions = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(11, 13, 20, 0.92)",
          titleColor: "#F5F6FA",
          bodyColor: "#F5F6FA",
          borderColor: "rgba(230, 57, 70, 0.45)",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => `Doanh thu: ${formatCurrency(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "#1f2937" },
          ticks: {
            color: "#A3AEC2",
            font: { size: 11 },
            callback: (value) => formatCompactNumber(Number(value)),
          },
        },
        x: {
          grid: { color: "#1f2937" },
          ticks: {
            color: "#A3AEC2",
            font: { size: 11 },
          },
        },
      },
    }),
    []
  );

  const categoryChartData = useMemo<ChartData<"pie">>(() => {
    const shares = data?.category_share ?? [];
    return {
      labels: shares.map((item) => item.name),
      datasets: [
        {
          data: shares.map((item) => item.percentage),
          backgroundColor: shares.map((item) => item.color),
          borderColor: "#131722",
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    };
  }, [data]);

  const categoryChartOptions = useMemo<ChartOptions<"pie">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#E2E8F0",
            font: { size: 12, weight: 500 },
            padding: 16,
            usePointStyle: true,
            pointStyle: "circle",
          },
        },
        tooltip: {
          backgroundColor: "rgba(11, 13, 20, 0.92)",
          titleColor: "#F5F6FA",
          bodyColor: "#F5F6FA",
          borderColor: "rgba(255, 255, 255, 0.16)",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const share = data?.category_share[ctx.dataIndex];
              const countText = share ? ` (${share.count} SP)` : "";
              return `${ctx.label}: ${ctx.parsed}%${countText}`;
            },
          },
        },
      },
    }),
    [data]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="border-b border-white/10 pb-6">
          <h1 className="font-display text-3xl font-bold text-[#F5F6FA]">Bảng điều khiển</h1>
        </div>
        <AdminLoadingState label="Đang tải thống kê doanh thu & vận hành..." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <div className="border-b border-white/10 pb-6">
          <h1 className="font-display text-3xl font-bold text-[#F5F6FA]">Bảng điều khiển</h1>
        </div>
        <AdminErrorState
          message={error ?? "Không có dữ liệu bảng điều khiển."}
          onRetry={() => void loadDashboard()}
        />
      </div>
    );
  }

  const totalRevenue = data.stats?.total_revenue ?? data.total_revenue ?? 0;
  const totalOrders = data.stats?.total_orders ?? data.total_orders ?? 0;
  const totalProducts = data.stats?.total_products ?? data.total_products ?? 0;
  const totalCustomers = data.stats?.total_customers ?? data.total_customers ?? 0;

  const kpiCards = [
    {
      label: "Tổng doanh thu",
      value: formatCurrency(totalRevenue),
      icon: "dollar-sign",
      gradient: "from-emerald-500 to-teal-500",
    },
    {
      label: "Đơn hàng",
      value: totalOrders.toLocaleString("vi-VN"),
      icon: "shopping-cart",
      gradient: "from-blue-500 to-cyan-500",
    },
    {
      label: "Sản phẩm",
      value: totalProducts.toLocaleString("vi-VN"),
      icon: "package",
      gradient: "from-purple-500 to-pink-500",
    },
    {
      label: "Khách hàng",
      value: totalCustomers.toLocaleString("vi-VN"),
      icon: "users",
      gradient: "from-orange-500 to-red-500",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#F5F6FA]">Bảng điều khiển</h1>
        </div>
        <button
          type="button"
          onClick={() => void loadDashboard()}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-white/15 bg-[#131722] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-white/30 hover:bg-[#1B2130]"
        >
          <MangaIcon name="refresh-cw" className="h-4 w-4" />
          <span>Làm mới</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className="rounded-3xl border border-white/10 bg-[#131722]/90 p-5 shadow-xl backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-400">{card.label}</p>
                <p className="mt-2 whitespace-nowrap text-xl font-bold text-[#F5F6FA] 2xl:text-2xl">
                  {card.value}
                </p>
              </div>
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${card.gradient} text-white shadow-lg`}
              >
                <MangaIcon name={card.icon} className="h-6 w-6" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-6 shadow-2xl backdrop-blur-xl">
          <h2 className="font-display text-xl font-semibold text-[#F5F6FA]">
            Doanh thu 6 tháng
          </h2>
          <div className="mt-6 h-[290px]">
            <Line id="revenueChart" data={revenueChartData} options={revenueChartOptions} />
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-6 shadow-2xl backdrop-blur-xl">
          <h2 className="font-display text-xl font-semibold text-[#F5F6FA]">
            Phân loại sản phẩm
          </h2>
          <div className="mt-6 h-[290px]">
            {data.category_share.length > 0 ? (
              <Pie id="categoryChart" data={categoryChartData} options={categoryChartOptions} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Chưa có dữ liệu phân loại sản phẩm.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl">
          <h2 className="font-display text-lg font-semibold text-[#F5F6FA]">
            Top sản phẩm bán chạy
          </h2>
          <div className="mt-4 overflow-x-auto">
            {data.top_products.length > 0 ? (
              <table className="min-w-full divide-y divide-white/10 text-sm">
                <thead>
                  <tr>
                    <th className="py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Sản phẩm
                    </th>
                    <th className="py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Đã bán
                    </th>
                    <th className="py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Doanh thu
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {data.top_products.map((prod, index) => (
                    <tr
                      key={prod.product_id ?? prod.id ?? `${prod.name}-${index}`}
                      className="transition-colors hover:bg-white/5"
                    >
                      <td className="py-3 pr-3 font-semibold text-slate-100">{prod.name}</td>
                      <td className="py-3 text-right text-slate-300">
                        {prod.sold.toLocaleString("vi-VN")}
                      </td>
                      <td className="py-3 text-right font-semibold text-emerald-300">
                        {formatCurrency(prod.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">
                Chưa ghi nhận đơn hàng đã thanh toán.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-[#F5F6FA]">
              Đơn hàng mới
            </h2>
            <Link
              to="/admin/orders"
              className="text-xs font-semibold text-[#FF6B77] transition-colors hover:text-[#FF4D5A]"
            >
              Xem tất cả
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {data.recent_orders.length > 0 ? (
              data.recent_orders.slice(0, 4).map((order) => {
                const statusMeta = getOrderStatusMeta(order.status);
                const isMomo = order.payment_method.toLowerCase() === "momo";
                return (
                  <div
                    key={order.order_code}
                    className="rounded-2xl border border-white/10 bg-[#1B2130]/75 p-4 shadow-sm transition-all hover:border-white/20"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-sm font-semibold text-[#F5F6FA]">
                            {order.order_code}
                          </p>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                              isMomo
                                ? "border-pink-500/35 bg-pink-500/15 text-pink-300"
                                : "border-amber-500/35 bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {isMomo ? "MoMo" : "COD"}
                          </span>
                        </div>
                        <p className="truncate text-xs text-slate-400">{order.customer_name}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-1 text-xs font-semibold text-[#F59E0B]">
                        {formatCurrency(order.grand_total)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-400">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                      <span>
                        {order.items_count !== undefined ? `${order.items_count} SP · ` : ""}
                        {formatDate(order.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">
                Chưa có đơn hàng nào.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-[#F5F6FA]">
            Sản phẩm cập nhật gần đây
          </h2>
          <Link
            to="/admin/products"
            className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold text-white"
          >
            <MangaIcon name="package" className="h-4 w-4" />
            <span>Quản lý sản phẩm</span>
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-3 pr-4">Tên sản phẩm</th>
                <th className="py-3 pr-4">Danh mục</th>
                <th className="py-3 pr-4 text-right">Giá</th>
                <th className="py-3 pr-4 text-center">Tồn kho</th>
                <th className="py-3 text-center">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {data.product_table.map((row) => {
                const isActive = row.status === "active" || row.status === "dang_ban";
                const stock = row.stock_quantity ?? row.stock ?? 0;
                return (
                  <tr key={row.id} className="transition-colors hover:bg-white/5">
                    <td className="py-3 pr-4 font-semibold text-[#F5F6FA]">{row.name}</td>
                    <td className="py-3 pr-4 text-slate-300">{row.category}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-[#F59E0B]">
                      {formatCurrency(row.price)}
                    </td>
                    <td className="py-3 pr-4 text-center text-slate-300">{stock}</td>
                    <td className="py-3 text-center">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          isActive
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-red-500/20 text-red-300"
                        }`}
                      >
                        {isActive ? "Đang bán" : "Ngừng bán"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboardPage;

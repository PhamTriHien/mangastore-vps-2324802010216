import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { useToast } from "../../contexts/ToastContext";
import { apiClient } from "../../lib/api";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  getOrderStatusMeta,
} from "../../lib/format";
import type { OrderDto } from "../../types/api";
import {
  AdminErrorState,
  AdminLoadingState,
  getErrorMessage,
  handleCoverError,
  resolveImageUrl,
} from "./adminShared";

interface AdminOrderListItem {
  id: number;
  order_code: string;
  customer_name: string;
  email: string;
  phone: string;
  status: string;
  raw_status: string;
  payment_status: string;
  payment_method: string;
  grand_total: number;
  shipping_fee: number;
  items_count: number;
  address: string;
  created_at: string;
  updated_at: string;
}

interface AdminOrdersResponse {
  items: AdminOrderListItem[];
  total: number;
}

const ORDER_STATUS_FILTERS: readonly { value: string; label: string }[] = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "pending", label: "Chờ thanh toán (MoMo)" },
  { value: "cod_pending", label: "Chờ xác nhận (COD)" },
  { value: "cod_confirmed", label: "Đã xác nhận (COD)" },
  { value: "processing", label: "Đã thanh toán" },
  { value: "shipped", label: "Đang giao hàng" },
  { value: "cod_paid", label: "Đã thu tiền (COD)" },
  { value: "delivered", label: "Hoàn thành" },
  { value: "cancelled", label: "Đã hủy" },
];

const STATUS_OPTION_LABELS: Record<string, string> = {
  pending: "Chờ thanh toán",
  processing: "Đã thanh toán",
  cod_pending: "Chờ xác nhận (COD)",
  cod_confirmed: "Đã xác nhận (COD)",
  shipped: "Đang giao hàng",
  cod_paid: "Đã thu tiền (COD)",
  delivered: "Hoàn thành",
  cancelled: "Hủy đơn",
};

function getOrderTransitions(statusKey: string, paymentMethod: string): string[] {
  const norm = statusKey.toLowerCase();
  const pm = paymentMethod.trim().toLowerCase();
  const isCod = pm === "cod" || norm.startsWith("cod_");

  if (norm === "cancelled" || norm === "delivered") {
    return [];
  }
  if (norm === "pending") {
    return ["processing", "shipped", "delivered", "cancelled"];
  }
  if (norm === "processing") {
    return ["shipped", "delivered", "cancelled"];
  }
  if (norm === "cod_pending") {
    return ["cod_confirmed", "cancelled"];
  }
  if (norm === "cod_confirmed") {
    return ["shipped", "cancelled"];
  }
  if (norm === "shipped") {
    return isCod
      ? ["cod_paid", "delivered", "cancelled"]
      : ["delivered", "cancelled"];
  }
  if (norm === "cod_paid") {
    return ["delivered"];
  }
  return isCod
    ? ["cod_pending", "cod_confirmed", "shipped", "cod_paid", "delivered", "cancelled"]
    : ["pending", "processing", "shipped", "delivered", "cancelled"];
}

export function AdminOrdersPage() {
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [orders, setOrders] = useState<AdminOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingTransition, setPendingTransition] = useState<{
    order: AdminOrderListItem;
    nextStatus: string;
  } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [selectedOrder, setSelectedOrder] = useState<AdminOrderListItem | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchOrders = useCallback(
    async (overrides?: {
      search?: string;
      statusFilter?: string;
      dateFrom?: string;
      dateTo?: string;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const s = overrides?.search ?? search;
        const st = overrides?.statusFilter ?? statusFilter;
        const df = overrides?.dateFrom ?? dateFrom;
        const dt = overrides?.dateTo ?? dateTo;

        const params = new URLSearchParams();
        if (s.trim()) params.set("search", s.trim());
        if (st && st !== "all") params.set("status", st);
        if (df) params.set("date_from", df);
        if (dt) params.set("date_to", dt);

        const qs = params.toString();
        const res = await apiClient.get<AdminOrdersResponse>(
          `/api/admin/orders${qs ? `?${qs}` : ""}`
        );
        setOrders(res.items ?? []);
      } catch (err) {
        setError(getErrorMessage(err, "Không thể tải danh sách đơn hàng."));
      } finally {
        setLoading(false);
      }
    },
    [search, statusFilter, dateFrom, dateTo]
  );

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (!selectedOrder) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedOrder(null);
        setOrderDetail(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedOrder]);

  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void fetchOrders();
  };

  const handleResetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    void fetchOrders({ search: "", statusFilter: "all", dateFrom: "", dateTo: "" });
  };

  const handleOpenDetail = async (order: AdminOrderListItem) => {
    setSelectedOrder(order);
    setOrderDetail(null);
    setDetailLoading(true);
    try {
      const detail = await apiClient.get<OrderDto>(
        `/api/orders/${encodeURIComponent(order.order_code)}`
      );
      setOrderDetail(detail);
    } catch {
      setOrderDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleConfirmTransition = async () => {
    if (!pendingTransition) return;
    setUpdatingStatus(true);
    try {
      const res = await apiClient.post<{
        success: boolean;
        order_code: string;
        status: string;
        message: string;
      }>(
        `/api/admin/orders/${encodeURIComponent(pendingTransition.order.order_code)}/status`,
        { status: pendingTransition.nextStatus }
      );
      showToast(res.message || "Đã cập nhật trạng thái đơn hàng!", "success");
      setPendingTransition(null);
      await fetchOrders();
    } catch (err) {
      showToast(getErrorMessage(err, "Không thể cập nhật trạng thái đơn hàng."), "error");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const fullShippingAddress = orderDetail
    ? [
        orderDetail.address,
        orderDetail.ward,
        orderDetail.district,
        orderDetail.province,
      ]
        .filter((part) => Boolean(part && part.trim()))
        .join(", ")
    : selectedOrder?.address || "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#F5F6FA]">Quản lý đơn hàng</h1>
        </div>
        <p className="text-sm text-slate-400">
          Tổng số <strong className="text-[#F5F6FA]">{orders.length}</strong> đơn hàng
        </p>
      </div>

      <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl">
        <form
          onSubmit={handleFilterSubmit}
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_auto_auto_auto] lg:items-end"
        >
          <div>
            <label
              htmlFor="orders-search"
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Tìm kiếm
            </label>
            <div className="relative">
              <MangaIcon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                id="orders-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Mã đơn, tên khách, SĐT, email..."
                className="w-full rounded-xl border border-white/15 bg-[#1B2130] py-2.5 pl-10 pr-4 text-sm text-[#F5F6FA] placeholder:text-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="orders-status"
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Trạng thái
            </label>
            <select
              id="orders-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-2.5 text-sm text-[#F5F6FA] focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            >
              {ORDER_STATUS_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="orders-date-from"
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Từ ngày
            </label>
            <input
              id="orders-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-2.5 text-sm text-[#F5F6FA] focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div>
            <label
              htmlFor="orders-date-to"
              className="mb-1 block text-xs font-medium text-slate-300"
            >
              Đến ngày
            </label>
            <input
              id="orders-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#1B2130] px-4 py-2.5 text-sm text-[#F5F6FA] focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/20"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold text-white"
            >
              <MangaIcon name="filter" className="h-4 w-4" />
              <span>Lọc</span>
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#1B2130] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10"
            >
              <MangaIcon name="x" className="h-4 w-4" />
              <span>Xóa lọc</span>
            </button>
          </div>
        </form>

        {loading ? (
          <AdminLoadingState label="Đang tải danh sách đơn hàng..." />
        ) : error ? (
          <AdminErrorState message={error} onRetry={() => void fetchOrders()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-3 pr-3">Mã đơn</th>
                  <th className="py-3 pr-3">Khách hàng</th>
                  <th className="py-3 pr-3 text-center">Thanh toán</th>
                  <th className="py-3 pr-3 text-right">Số lượng</th>
                  <th className="py-3 pr-3 text-right">Tổng tiền</th>
                  <th className="py-3 pr-3 text-center">Trạng thái</th>
                  <th className="py-3 pr-3 text-center">Ngày đặt</th>
                  <th className="py-3 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {orders.length > 0 ? (
                  orders.map((order) => {
                    const statusMeta = getOrderStatusMeta(order.status);
                    const isMomo = order.payment_method.trim().toLowerCase() === "momo";
                    const transitions = getOrderTransitions(
                      statusMeta.key,
                      order.payment_method
                    );
                    const isCancelled = statusMeta.key === "cancelled";
                    const isDelivered = statusMeta.key === "delivered";

                    return (
                      <tr key={order.order_code} className="transition-colors hover:bg-white/5">
                        <td className="py-3 pr-3 font-mono font-semibold text-[#F5F6FA]">
                          {order.order_code}
                        </td>
                        <td className="py-3 pr-3">
                          <p className="font-medium text-[#F5F6FA]">{order.customer_name}</p>
                          <p className="text-xs text-slate-400">
                            {order.phone || order.email || "—"}
                          </p>
                        </td>
                        <td className="py-3 pr-3 text-center">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase ${
                              isMomo
                                ? "border-pink-500/35 bg-pink-500/15 text-pink-300"
                                : "border-amber-500/35 bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {isMomo ? "MoMo" : "COD"}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-right text-slate-300">
                          {order.items_count} SP
                        </td>
                        <td className="py-3 pr-3 text-right font-semibold text-[#F59E0B]">
                          {formatCurrency(order.grand_total)}
                        </td>
                        <td className="py-3 pr-3 text-center">
                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.badgeClass}`}
                          >
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-center text-slate-300">
                          {formatDate(order.created_at)}
                        </td>
                        <td className="py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleOpenDetail(order)}
                              title="Chi tiết đơn hàng"
                              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-1.5 text-xs font-semibold text-[#22D3EE] transition-colors hover:bg-cyan-500/25"
                            >
                              <MangaIcon name="eye" className="h-3.5 w-3.5" />
                              <span>Chi tiết</span>
                            </button>

                            {!isCancelled && !isDelivered && transitions.length > 0 ? (
                              <select
                                aria-label={`Cập nhật trạng thái đơn ${order.order_code}`}
                                value=""
                                onChange={(e) => {
                                  const nextStatus = e.target.value;
                                  if (!nextStatus) return;
                                  setPendingTransition({ order, nextStatus });
                                }}
                                className="rounded-lg border border-white/15 bg-[#1B2130] px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:border-[#E63946] focus:outline-none"
                              >
                                <option value="">Cập nhật...</option>
                                {transitions.map((optKey) => (
                                  <option key={optKey} value={optKey}>
                                    {STATUS_OPTION_LABELS[optKey] ?? optKey}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs italic text-slate-500">
                                {isCancelled ? "Đã hủy" : "Hoàn tất"}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="py-14 text-center text-slate-400">
                      <MangaIcon
                        name="shopping-cart"
                        className="mx-auto mb-3 h-12 w-12 text-slate-500"
                      />
                      <p className="font-semibold text-slate-200">
                        Không tìm thấy đơn hàng nào
                      </p>
                      <p className="mt-1 text-sm">Thử thay đổi bộ lọc tìm kiếm.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedOrder ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setSelectedOrder(null);
            setOrderDetail(null);
          }}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#131722] p-6 text-[#F5F6FA] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedOrder(null);
                setOrderDetail(null);
              }}
              aria-label="Đóng chi tiết đơn hàng"
              className="absolute right-4 top-4 rounded-xl bg-[#1B2130] p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <MangaIcon name="x" className="h-5 w-5" />
            </button>

            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#E63946]/30 bg-[#E63946]/15 text-[#FF6B77]">
                <MangaIcon name="receipt" className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-[#F5F6FA]">
                  Chi tiết đơn hàng
                </h3>
                <p className="font-mono text-sm font-semibold text-[#FF6B77]">
                  {selectedOrder.order_code}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-[#1B2130]/75 p-4">
                <h4 className="mb-3 flex items-center gap-2 font-semibold text-[#F5F6FA]">
                  <MangaIcon name="user" className="h-4 w-4 text-[#22D3EE]" />
                  <span>Thông tin giao hàng</span>
                </h4>
                <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-slate-400">Họ tên</p>
                    <p className="font-medium text-[#F5F6FA]">
                      {orderDetail?.full_name ?? selectedOrder.customer_name}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Số điện thoại</p>
                    <p className="font-medium text-[#F5F6FA]">
                      {orderDetail?.phone ?? (selectedOrder.phone || "—")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Email</p>
                    <p className="font-medium text-[#F5F6FA]">
                      {orderDetail?.email ?? (selectedOrder.email || "—")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Thanh toán</p>
                    <p className="font-medium uppercase text-[#F5F6FA]">
                      {selectedOrder.payment_method}
                      {orderDetail?.momo_trans_id
                        ? ` (${orderDetail.momo_trans_id})`
                        : ""}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-slate-400">Địa chỉ giao hàng</p>
                    <p className="font-medium text-[#F5F6FA]">{fullShippingAddress}</p>
                  </div>
                  {orderDetail?.notes ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-slate-400">Ghi chú</p>
                      <p className="font-medium text-slate-200">{orderDetail.notes}</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#1B2130]/75 p-4">
                <h4 className="mb-3 flex items-center gap-2 font-semibold text-[#F5F6FA]">
                  <MangaIcon name="package" className="h-4 w-4 text-[#F59E0B]" />
                  <span>Sản phẩm trong đơn ({selectedOrder.items_count})</span>
                </h4>

                {detailLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-[#E63946]" />
                    <span>Đang tải chi tiết sản phẩm...</span>
                  </div>
                ) : orderDetail?.items && orderDetail.items.length > 0 ? (
                  <div className="space-y-2.5">
                    {orderDetail.items.map((item, idx) => (
                      <div
                        key={`${item.product_id}-${idx}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#131722] p-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <img
                            src={resolveImageUrl(item.cover_url)}
                            alt={item.product_name}
                            onError={handleCoverError}
                            className="h-12 w-9 shrink-0 rounded-md object-cover"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-[#F5F6FA]">
                              {item.product_name}
                            </p>
                            <p className="text-xs text-slate-400">
                              {formatCurrency(item.unit_price)} × {item.quantity}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 font-semibold text-[#F59E0B]">
                          {formatCurrency(item.total_price)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">
                    Không thể tải danh sách sản phẩm chi tiết.
                  </p>
                )}

                <div className="mt-4 space-y-1.5 border-t border-white/10 pt-3 text-sm">
                  {orderDetail ? (
                    <>
                      <div className="flex justify-between text-slate-300">
                        <span>Tạm tính</span>
                        <span>{formatCurrency(orderDetail.sub_total)}</span>
                      </div>
                      {orderDetail.discount_amount > 0 ? (
                        <div className="flex justify-between text-emerald-300">
                          <span>
                            Giảm giá
                            {orderDetail.promotion_code
                              ? ` (${orderDetail.promotion_code})`
                              : ""}
                          </span>
                          <span>-{formatCurrency(orderDetail.discount_amount)}</span>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex justify-between text-slate-300">
                    <span>Phí vận chuyển</span>
                    <span>{formatCurrency(selectedOrder.shipping_fee)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-[#F59E0B]">
                    <span>Tổng thanh toán</span>
                    <span>{formatCurrency(selectedOrder.grand_total)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Ngày đặt</span>
                    <span>{formatDateTime(selectedOrder.created_at)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setSelectedOrder(null);
                  setOrderDetail(null);
                }}
                className="rounded-xl border border-white/15 bg-[#1B2130] px-6 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingTransition !== null}
        title="Cập nhật trạng thái đơn hàng"
        message={
          pendingTransition
            ? `Xác nhận chuyển đơn hàng ${pendingTransition.order.order_code} sang trạng thái "${
                STATUS_OPTION_LABELS[pendingTransition.nextStatus] ??
                pendingTransition.nextStatus
              }"?`
            : ""
        }
        confirmLabel="Xác nhận cập nhật"
        danger={pendingTransition?.nextStatus === "cancelled"}
        busy={updatingStatus}
        onConfirm={() => void handleConfirmTransition()}
        onCancel={() => {
          if (!updatingStatus) setPendingTransition(null);
        }}
      />
    </div>
  );
}

export default AdminOrdersPage;

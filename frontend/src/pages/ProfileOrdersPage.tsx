import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StoreLayout } from "../components/layout/StoreLayout";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { ApiError, apiClient } from "../lib/api";
import {
  formatCurrency,
  formatDateTime,
  getOrderStatusMeta,
} from "../lib/format";

interface ProfileOrderItem {
  id?: number;
  product_id: number;
  product_name: string;
  cover_url?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  has_reviewed?: boolean;
}

interface ProfileOrderDto {
  id: number;
  order_code: string;
  created_at: string;
  updated_at?: string | null;
  status: string;
  payment_status?: string | null;
  payment_method: string;
  sub_total: number;
  promotion_code?: string | null;
  discount_amount: number;
  shipping_fee: number;
  grand_total: number;
  full_name: string;
  phone: string;
  address: string;
  notes?: string | null;
  can_cancel?: boolean;
  items: ProfileOrderItem[];
}

type OrderFilterTab = "all" | "pending" | "shipping" | "completed" | "cancelled";

const COD_STEPS = [
  { label: "Chờ xử lý", icon: "clock" },
  { label: "Xác nhận", icon: "check-circle" },
  { label: "Vận chuyển", icon: "truck" },
  { label: "Thanh toán", icon: "banknote" },
  { label: "Hoàn thành", icon: "package-check" },
] as const;

const MOMO_STEPS = [
  { label: "Chờ thanh toán", icon: "clock" },
  { label: "Đã thanh toán", icon: "credit-card" },
  { label: "Xác nhận", icon: "check-circle" },
  { label: "Vận chuyển", icon: "truck" },
  { label: "Hoàn thành", icon: "package-check" },
] as const;

function getTrackerStep(order: ProfileOrderDto): {
  isCancelled: boolean;
  isMomo: boolean;
  activeStep: number;
  isCompleted: boolean;
} {
  const s = (order.status || "").toLowerCase();
  const p = (order.payment_status || "").toLowerCase();
  const isMomo = (order.payment_method || "").toLowerCase() === "momo";

  if (s === "da_huy" || s === "cancelled") {
    return { isCancelled: true, isMomo, activeStep: -1, isCompleted: false };
  }

  if (s === "hoan_thanh" || s === "completed" || s === "delivered") {
    return { isCancelled: false, isMomo, activeStep: 4, isCompleted: true };
  }

  if (isMomo) {
    if (s === "dang_giao" || s === "shipping") {
      return { isCancelled: false, isMomo, activeStep: 3, isCompleted: false };
    }
    if (s === "da_xac_nhan" || s === "confirmed") {
      return { isCancelled: false, isMomo, activeStep: 2, isCompleted: false };
    }
    if (
      s === "da_thanh_toan" ||
      s === "paid" ||
      p === "da_thanh_toan" ||
      p === "paid"
    ) {
      return { isCancelled: false, isMomo, activeStep: 1, isCompleted: false };
    }
    return { isCancelled: false, isMomo, activeStep: 0, isCompleted: false };
  }

  if (s === "da_thanh_toan" || s === "paid") {
    return { isCancelled: false, isMomo, activeStep: 3, isCompleted: false };
  }
  if (s === "dang_giao" || s === "shipping") {
    return { isCancelled: false, isMomo, activeStep: 2, isCompleted: false };
  }
  if (s === "da_xac_nhan" || s === "confirmed") {
    return { isCancelled: false, isMomo, activeStep: 1, isCompleted: false };
  }
  return { isCancelled: false, isMomo, activeStep: 0, isCompleted: false };
}

function canCancelOrder(order: ProfileOrderDto): boolean {
  if (typeof order.can_cancel === "boolean") return order.can_cancel;
  const s = (order.status || "").toLowerCase();
  return (
    s === "cho_xu_ly" ||
    s === "cho_thanh_toan" ||
    s === "pending" ||
    s === "cod_pending"
  );
}

function matchesFilter(order: ProfileOrderDto, tab: OrderFilterTab): boolean {
  if (tab === "all") return true;
  const meta = getOrderStatusMeta(order.status);
  if (tab === "cancelled") return meta.key === "cancelled";
  if (tab === "completed") return meta.key === "completed";
  if (tab === "shipping") return meta.key === "shipping";
  return (
    meta.key === "pending" ||
    meta.key === "paid" ||
    meta.key === "confirmed" ||
    meta.key === "cod_pending"
  );
}

export function ProfileOrdersPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { showToast } = useToast();

  const [orders, setOrders] = useState<ProfileOrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<OrderFilterTab>("all");
  const [cancelTarget, setCancelTarget] = useState<ProfileOrderDto | null>(
    null,
  );
  const [cancelling, setCancelling] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ orders: ProfileOrderDto[] }>(
        "/api/profile/orders",
      );
      setOrders(res.orders ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/auth", {
          replace: true,
          state: { from: "/profile/orders" },
        });
        return;
      }
      showToast(
        err instanceof Error ? err.message : "Không thể tải lịch sử đơn hàng.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [navigate, showToast]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth", {
        replace: true,
        state: { from: "/profile/orders" },
      });
      return;
    }
    void loadOrders();
  }, [authLoading, user, navigate, loadOrders]);

  const filteredOrders = useMemo(
    () => orders.filter((order) => matchesFilter(order, filterTab)),
    [orders, filterTab],
  );

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await apiClient.post(`/api/profile/orders/${cancelTarget.id}/cancel`, {
        reason: "Khách hàng yêu cầu hủy đơn hàng",
      });
      setOrders((prev) =>
        prev.map((order) =>
          order.id === cancelTarget.id
            ? { ...order, status: "da_huy", can_cancel: false }
            : order,
        ),
      );
      showToast(`Đã hủy đơn hàng #${cancelTarget.order_code}.`, "success");
      setCancelTarget(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Không thể hủy đơn hàng.",
        "error",
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <StoreLayout>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Profile Navigation */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            to="/profile"
            className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
          >
            <MangaIcon name="user" className="h-3.5 w-3.5" />
            Tổng quan
          </Link>
          <Link
            to="/profile/orders"
            className="ms-btn-2d ms-btn-2d-crimson px-4 py-2 text-xs"
          >
            <MangaIcon name="package" className="h-3.5 w-3.5" />
            Đơn hàng ({orders.length})
          </Link>
          <Link
            to="/profile/wishlist"
            className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
          >
            <MangaIcon name="heart" className="h-3.5 w-3.5" />
            Yêu thích
          </Link>
          <Link
            to="/profile/settings"
            className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
          >
            <MangaIcon name="settings" className="h-3.5 w-3.5" />
            Cài đặt & Địa chỉ
          </Link>
        </div>

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-display flex items-center gap-3 text-2xl font-extrabold text-white">
            <MangaIcon name="package" className="text-crimson-400 h-6 w-6" />
            Lịch sử đơn hàng
          </h1>

          <div className="flex flex-wrap gap-2">
            {(
              [
                { key: "all", label: "Tất cả" },
                { key: "pending", label: "Đang xử lý" },
                { key: "shipping", label: "Đang giao" },
                { key: "completed", label: "Hoàn thành" },
                { key: "cancelled", label: "Đã hủy" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterTab(tab.key)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  filterTab === tab.key
                    ? "border-crimson-500 bg-crimson-500/20 text-crimson-300"
                    : "border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading || authLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="ms-panel-2d h-64 animate-pulse bg-slate-900/70"
              />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="ms-panel-2d mx-auto max-w-xl px-6 py-12 text-center">
            <img
              src="/content/icons/spots/spot-empty-shelf.svg"
              alt="Chưa có đơn hàng"
              className="mx-auto mb-5 h-40 w-40 object-contain"
            />
            <h2 className="font-display mb-2 text-xl font-bold text-white">
              Chưa có đơn hàng phù hợp
            </h2>
            <p className="mb-6 text-sm text-slate-400">
              {filterTab === "all"
                ? "Bạn chưa đặt đơn hàng nào tại MangaStore."
                : "Không có đơn hàng nào ở trạng thái đang lọc."}
            </p>
            <Link
              to="/products"
              className="ms-btn-2d ms-btn-2d-crimson px-6 py-3 text-sm"
            >
              Khám phá truyện ngay
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredOrders.map((order) => {
              const statusMeta = getOrderStatusMeta(order.status);
              const tracker = getTrackerStep(order);
              const steps = tracker.isMomo ? MOMO_STEPS : COD_STEPS;
              const cancellable = canCancelOrder(order);

              return (
                <article
                  key={order.id}
                  className="ms-panel-2d overflow-hidden p-5 sm:p-6"
                >
                  {/* Order Header */}
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          to={`/order-success?orderCode=${encodeURIComponent(order.order_code)}`}
                          className="font-mono text-base font-extrabold text-cyan-300 hover:underline"
                        >
                          #{order.order_code}
                        </Link>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}
                        >
                          {statusMeta.label}
                        </span>
                        <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-[11px] font-medium text-slate-300">
                          {tracker.isMomo ? "Ví MoMo" : "COD"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Đặt lúc {formatDateTime(order.created_at)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-slate-400">Tổng cộng</p>
                        <p className="text-crimson-400 font-mono text-lg font-extrabold">
                          {formatCurrency(order.grand_total)}
                        </p>
                      </div>
                      {cancellable && (
                        <button
                          type="button"
                          onClick={() => setCancelTarget(order)}
                          className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-500/20"
                        >
                          Hủy đơn
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Dual 5-Step Progress Tracker / Cancelled Banner */}
                  {tracker.isCancelled ? (
                    <div className="my-5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
                      <div className="mb-3 flex items-center gap-2 text-xs font-bold text-rose-300">
                        <MangaIcon name="x-circle" className="h-4 w-4" />
                        Đơn hàng đã bị hủy — tiến trình giao hàng đã dừng
                      </div>
                      <div className="grid grid-cols-5 gap-2 opacity-60">
                        {steps.map((step) => (
                          <div
                            key={step.label}
                            className="flex flex-col items-center text-center"
                          >
                            <span className="mb-1 flex h-7 w-7 items-center justify-center rounded-full border border-rose-500/40 bg-slate-900 text-rose-400">
                              <MangaIcon name={step.icon} className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-[11px] text-slate-400 line-through">
                              {step.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="my-5 grid grid-cols-5 gap-1 sm:gap-2">
                      {steps.map((step, index) => {
                        const completed = index <= tracker.activeStep;
                        const isCurrent = index === tracker.activeStep;

                        return (
                          <div
                            key={step.label}
                            className="flex flex-col items-center text-center"
                          >
                            <div className="relative mb-1.5 flex w-full items-center justify-center">
                              {index > 0 && (
                                <span
                                  className={`absolute right-1/2 left-0 h-0.5 -translate-y-1/2 ${
                                    completed ? "bg-emerald-500" : "bg-slate-700"
                                  }`}
                                />
                              )}
                              {index < steps.length - 1 && (
                                <span
                                  className={`absolute right-0 left-1/2 h-0.5 -translate-y-1/2 ${
                                    index < tracker.activeStep
                                      ? "bg-emerald-500"
                                      : "bg-slate-700"
                                  }`}
                                />
                              )}
                              <span
                                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
                                  isCurrent
                                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                                    : completed
                                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                      : "border-slate-700 bg-slate-900 text-slate-500"
                                }`}
                              >
                                <MangaIcon
                                  name={step.icon}
                                  className="h-3.5 w-3.5"
                                />
                              </span>
                            </div>
                            <span
                              className={`text-[11px] font-semibold ${
                                completed ? "text-slate-100" : "text-slate-500"
                              }`}
                            >
                              {step.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Order Items */}
                  <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/60 px-4">
                    {order.items.map((item, idx) => (
                      <div
                        key={`${order.id}-${item.product_id}-${idx}`}
                        className="flex flex-wrap items-center justify-between gap-4 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Link
                            to={`/products/${item.product_id}`}
                            className="h-16 w-12 shrink-0 overflow-hidden rounded border border-slate-700 bg-slate-900"
                          >
                            <img
                              src={item.cover_url || "/covers/default-manga.svg"}
                              alt={item.product_name}
                              onError={(e) => {
                                e.currentTarget.src =
                                  "/covers/default-manga.svg";
                              }}
                              className="h-full w-full object-cover"
                            />
                          </Link>
                          <div className="min-w-0">
                            <Link
                              to={`/products/${item.product_id}`}
                              className="line-clamp-1 text-sm font-semibold text-white hover:text-cyan-300"
                            >
                              {item.product_name}
                            </Link>
                            <p className="text-xs text-slate-400">
                              {formatCurrency(item.unit_price)} × {item.quantity}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {tracker.isCompleted &&
                            (item.has_reviewed ? (
                              <Link
                                to={`/products/${item.product_id}?review=true#reviews`}
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
                              >
                                <MangaIcon
                                  name="check-circle"
                                  className="h-3.5 w-3.5"
                                />
                                Đã đánh giá · Sửa
                              </Link>
                            ) : (
                              <Link
                                to={`/products/${item.product_id}?review=true#reviews`}
                                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
                              >
                                <MangaIcon name="star" className="h-3.5 w-3.5" />
                                Đánh giá ngay
                              </Link>
                            ))}

                          <span className="font-mono text-sm font-bold text-white">
                            {formatCurrency(item.total_price)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Footer address & detail link */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <p className="line-clamp-1">
                      <strong className="text-slate-200">Giao tới:</strong>{" "}
                      {order.full_name} ({order.phone}) — {order.address}
                    </p>
                    <Link
                      to={`/order-success?orderCode=${encodeURIComponent(order.order_code)}`}
                      className="font-semibold text-cyan-400 hover:underline"
                    >
                      Xem biên lai chi tiết →
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Hủy đơn hàng?"
        message={
          cancelTarget
            ? `Bạn có chắc muốn hủy đơn hàng #${cancelTarget.order_code} trị giá ${formatCurrency(cancelTarget.grand_total)} không?`
            : ""
        }
        confirmLabel="Xác nhận hủy đơn"
        danger
        busy={cancelling}
        onConfirm={() => void handleConfirmCancel()}
        onCancel={() => {
          if (!cancelling) setCancelTarget(null);
        }}
      />
    </StoreLayout>
  );
}

export default ProfileOrdersPage;

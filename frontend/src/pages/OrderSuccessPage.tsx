import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useCartWishlist } from "../contexts/CartWishlistContext";
import { apiClient } from "../lib/api";
import {
  formatCurrency,
  formatDateTime,
  getOrderStatusMeta,
} from "../lib/format";
import type { OrderDto, OrderItemDto } from "../types/api";

interface MoMoReturnResponse {
  ok: boolean;
  paid: boolean;
  order_code?: string;
  message?: string;
}

interface OrderDetailResponse extends OrderDto {
  status_history?: Array<{
    status: string;
    note?: string | null;
    created_at?: string | null;
  }>;
}

type ExtendedOrderItem = OrderItemDto & {
  title?: string;
  price?: number;
  subtotal?: number;
};

const ORDER_STEPS = [
  { key: "placed", label: "Đặt hàng", icon: "clipboard-list" },
  { key: "confirmed", label: "Xác nhận", icon: "check-circle" },
  { key: "shipping", label: "Giao hàng", icon: "truck" },
  { key: "completed", label: "Hoàn thành", icon: "package-check" },
] as const;

function resolveStepIndex(status: string): number {
  const s = (status || "").toLowerCase();
  if (s === "hoan_thanh" || s === "completed" || s === "delivered") return 3;
  if (s === "dang_giao" || s === "shipping") return 2;
  if (s === "da_xac_nhan" || s === "confirmed" || s === "da_thanh_toan" || s === "paid")
    return 1;
  return 0;
}

export function OrderSuccessPage() {
  const [searchParams] = useSearchParams();
  const { orderCode: paramOrderCode } = useParams<{ orderCode?: string }>();
  const { refreshCounts } = useCartWishlist();

  const rawOrderCode =
    paramOrderCode ||
    searchParams.get("orderCode") ||
    searchParams.get("orderId") ||
    "";

  const hasMomoReturn =
    searchParams.has("resultCode") ||
    searchParams.has("extraData") ||
    (searchParams.has("orderId") && searchParams.has("requestId"));

  const [order, setOrder] = useState<OrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [momoNotice, setMomoNotice] = useState<{
    paid: boolean;
    message: string;
  } | null>(null);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    let targetCode = rawOrderCode;

    try {
      if (hasMomoReturn) {
        const momoRes = await apiClient.get<MoMoReturnResponse>(
          `/api/orders/momo-return?${searchParams.toString()}`,
        );
        if (momoRes.order_code) {
          targetCode = momoRes.order_code;
        }
        setMomoNotice({
          paid: Boolean(momoRes.paid),
          message:
            momoRes.message ||
            (momoRes.paid
              ? "Thanh toán MoMo đã được xác nhận thành công."
              : "Giao dịch MoMo chưa hoàn tất."),
        });
        await refreshCounts();
      }

      if (!targetCode) {
        setError("Không tìm thấy mã đơn hàng.");
        setLoading(false);
        return;
      }

      const detail = await apiClient.get<OrderDetailResponse>(
        `/api/orders/${encodeURIComponent(targetCode)}`,
      );
      setOrder(detail);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Không thể tải thông tin đơn hàng.",
      );
    } finally {
      setLoading(false);
    }
  }, [rawOrderCode, hasMomoReturn, searchParams, refreshCounts]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  const statusMeta = order ? getOrderStatusMeta(order.status) : null;
  const isCancelled = statusMeta?.key === "cancelled";
  const currentStep = order ? resolveStepIndex(order.status) : 0;

  return (
    <StoreLayout>
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        {loading ? (
          <div className="space-y-4">
            <div className="ms-panel-2d h-44 animate-pulse bg-slate-900/70" />
            <div className="ms-panel-2d h-72 animate-pulse bg-slate-900/70" />
          </div>
        ) : error || !order ? (
          <div className="ms-panel-2d mx-auto max-w-xl p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/15 text-rose-400">
              <MangaIcon name="x-circle" className="h-7 w-7" />
            </div>
            <h1 className="font-display mb-2 text-2xl font-bold text-white">
              Không thể hiển thị đơn hàng
            </h1>
            <p className="mb-6 text-sm text-slate-400">
              {error || "Đơn hàng không tồn tại hoặc bạn không có quyền xem."}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                to="/profile/orders"
                className="ms-btn-2d ms-btn-2d-crimson px-5 py-2.5 text-sm"
              >
                Xem đơn hàng của tôi
              </Link>
              <Link
                to="/"
                className="ms-btn-2d ms-btn-2d-dark px-5 py-2.5 text-sm"
              >
                Về trang chủ
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Hero confirmation */}
            <div className="ms-panel-2d p-6 text-center sm:p-8">
              <div
                className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border-2 ${
                  isCancelled
                    ? "border-rose-500/50 bg-rose-500/15 text-rose-400"
                    : "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                }`}
              >
                <MangaIcon
                  name={isCancelled ? "x-circle" : "check-circle-2"}
                  className="h-8 w-8"
                />
              </div>

              <h1 className="font-display text-2xl font-extrabold text-white sm:text-3xl">
                {isCancelled
                  ? "Đơn hàng đã bị hủy"
                  : "Đặt hàng thành công!"}
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                Mã đơn hàng:{" "}
                <span className="font-mono text-base font-extrabold text-cyan-300">
                  #{order.order_code}
                </span>
              </p>

              {momoNotice && (
                <div
                  className={`mx-auto mt-4 max-w-lg rounded-xl border px-4 py-2.5 text-xs font-medium ${
                    momoNotice.paid
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                      : "border-amber-500/40 bg-amber-500/15 text-amber-200"
                  }`}
                >
                  {momoNotice.message}
                </div>
              )}

              {/* 4-step tracker */}
              {!isCancelled && (
                <div className="mx-auto mt-8 grid max-w-2xl grid-cols-4 gap-2">
                  {ORDER_STEPS.map((step, index) => {
                    const active = index <= currentStep;
                    return (
                      <div key={step.key} className="flex flex-col items-center gap-2">
                        <div className="relative flex w-full items-center justify-center">
                          {index > 0 && (
                            <span
                              className={`absolute right-1/2 left-0 h-0.5 -translate-y-1/2 ${
                                active ? "bg-emerald-500" : "bg-slate-700"
                              }`}
                            />
                          )}
                          {index < ORDER_STEPS.length - 1 && (
                            <span
                              className={`absolute right-0 left-1/2 h-0.5 -translate-y-1/2 ${
                                index < currentStep ? "bg-emerald-500" : "bg-slate-700"
                              }`}
                            />
                          )}
                          <span
                            className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 ${
                              active
                                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                                : "border-slate-700 bg-slate-900 text-slate-500"
                            }`}
                          >
                            <MangaIcon name={step.icon} className="h-4 w-4" />
                          </span>
                        </div>
                        <span
                          className={`text-xs font-semibold ${
                            active ? "text-white" : "text-slate-500"
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Order metadata + shipping */}
            <div className="grid gap-6 md:grid-cols-2">
              <div className="ms-panel-2d space-y-3 p-6">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-white">
                  <MangaIcon name="map-pin" className="text-crimson-400 h-4 w-4" />
                  Thông tin giao hàng
                </h2>
                <div className="space-y-1.5 text-sm text-slate-300">
                  <p>
                    <span className="text-slate-400">Người nhận:</span>{" "}
                    <strong className="text-white">{order.full_name}</strong>
                  </p>
                  <p>
                    <span className="text-slate-400">Số điện thoại:</span>{" "}
                    <strong className="text-white">{order.phone}</strong>
                  </p>
                  <p>
                    <span className="text-slate-400">Địa chỉ:</span>{" "}
                    <span className="text-white">{order.address}</span>
                  </p>
                  {order.notes && (
                    <p>
                      <span className="text-slate-400">Ghi chú:</span>{" "}
                      <span className="text-slate-200">{order.notes}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="ms-panel-2d space-y-3 p-6">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-white">
                  <MangaIcon name="credit-card" className="h-4 w-4 text-cyan-400" />
                  Thanh toán & Trạng thái
                </h2>
                <div className="space-y-2 text-sm text-slate-300">
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Ngày đặt:</span>
                    <span className="text-white">
                      {formatDateTime(order.created_at)}
                    </span>
                  </p>
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Phương thức:</span>
                    <span className="font-semibold text-white">
                      {order.payment_method === "momo"
                        ? "Ví điện tử MoMo"
                        : "Thanh toán khi nhận hàng (COD)"}
                    </span>
                  </p>
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Trạng thái đơn:</span>
                    {statusMeta && (
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                    )}
                  </p>
                  {order.momo_trans_id && (
                    <p className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Mã GD MoMo:</span>
                      <span className="font-mono text-xs text-cyan-300">
                        {order.momo_trans_id}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Itemized receipt */}
            <div className="ms-panel-2d p-6">
              <h2 className="font-display mb-4 flex items-center gap-2 text-base font-bold text-white">
                <MangaIcon name="receipt" className="text-crimson-400 h-4 w-4" />
                Chi tiết sản phẩm ({order.items.length})
              </h2>

              <div className="divide-y divide-slate-800">
                {(order.items as ExtendedOrderItem[]).map((item, idx) => {
                  const title = item.title || item.product_name || "Sản phẩm";
                  const unitPrice = Number(item.price ?? item.unit_price ?? 0);
                  const lineTotal = Number(
                    item.subtotal ?? item.total_price ?? unitPrice * item.quantity,
                  );

                  return (
                    <div
                      key={`${item.product_id}-${idx}`}
                      className="flex items-center justify-between gap-4 py-3.5"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={item.cover_url || "/covers/default-manga.svg"}
                          alt={title}
                          onError={(e) => {
                            e.currentTarget.src = "/covers/default-manga.svg";
                          }}
                          className="h-16 w-12 shrink-0 rounded border border-slate-700 object-cover"
                        />
                        <div>
                          <Link
                            to={`/products/${item.product_id}`}
                            className="font-semibold text-white hover:text-cyan-300"
                          >
                            {title}
                          </Link>
                          <p className="text-xs text-slate-400">
                            {formatCurrency(unitPrice)} × {item.quantity}
                          </p>
                        </div>
                      </div>
                      <span className="font-mono text-sm font-bold text-white">
                        {formatCurrency(lineTotal)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-800 pt-4 text-sm">
                <div className="flex justify-between text-slate-300">
                  <span>Tạm tính</span>
                  <span className="font-mono">
                    {formatCurrency(order.sub_total)}
                  </span>
                </div>
                {order.discount_amount > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Giảm giá khuyến mãi</span>
                    <span className="font-mono">
                      -{formatCurrency(order.discount_amount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-300">
                  <span>Phí vận chuyển</span>
                  <span className="font-mono">
                    {order.shipping_fee === 0
                      ? "Miễn phí"
                      : formatCurrency(order.shipping_fee)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between border-t border-slate-800 pt-3">
                  <span className="font-bold text-white">Tổng cộng</span>
                  <span className="text-crimson-400 font-mono text-2xl font-extrabold">
                    {formatCurrency(order.grand_total)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <Link
                to="/profile/orders"
                className="ms-btn-2d ms-btn-2d-crimson px-6 py-3 text-sm"
              >
                <MangaIcon name="package" className="h-4 w-4" />
                Theo dõi đơn hàng
              </Link>
              <Link
                to="/products"
                className="ms-btn-2d ms-btn-2d-cyan px-6 py-3 text-sm"
              >
                <MangaIcon name="shopping-bag" className="h-4 w-4" />
                Tiếp tục mua sắm
              </Link>
            </div>
          </div>
        )}
      </section>
    </StoreLayout>
  );
}

export default OrderSuccessPage;

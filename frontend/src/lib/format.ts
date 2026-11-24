export function formatCurrency(amount: number | null | undefined): string {
  const num = Number(amount ?? 0);
  if (!Number.isFinite(num)) return "0đ";
  return `${Math.round(num).toLocaleString("vi-VN")}đ`;
}

export function formatCompactNumber(num: number | null | undefined): string {
  const value = Number(num ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(value));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface OrderStatusMeta {
  key: string;
  label: string;
  badgeClass: string;
}

const ORDER_STATUS_MAP: Record<string, OrderStatusMeta> = {
  cho_thanh_toan: {
    key: "pending",
    label: "Chờ thanh toán",
    badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  pending: {
    key: "pending",
    label: "Chờ thanh toán",
    badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  cho_xu_ly: {
    key: "cod_pending",
    label: "Chờ xác nhận (COD)",
    badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  cod_pending: {
    key: "cod_pending",
    label: "Chờ xác nhận (COD)",
    badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  xac_nhan: {
    key: "cod_confirmed",
    label: "Đã xác nhận (COD)",
    badgeClass: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  },
  cod_confirmed: {
    key: "cod_confirmed",
    label: "Đã xác nhận (COD)",
    badgeClass: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  },
  da_thanh_toan: {
    key: "processing",
    label: "Đã thanh toán",
    badgeClass: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  },
  processing: {
    key: "processing",
    label: "Đã thanh toán",
    badgeClass: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  },
  shipping: {
    key: "shipped",
    label: "Đang giao hàng",
    badgeClass: "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
  },
  cod_shipping: {
    key: "shipped",
    label: "Đang giao (COD)",
    badgeClass: "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
  },
  shipped: {
    key: "shipped",
    label: "Đang giao hàng",
    badgeClass: "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
  },
  da_thu_tien: {
    key: "cod_paid",
    label: "Đã thu tiền (COD)",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  cod_paid: {
    key: "cod_paid",
    label: "Đã thu tiền (COD)",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  delivered: {
    key: "delivered",
    label: "Hoàn thành",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  da_giao: {
    key: "delivered",
    label: "Hoàn thành",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  huy: {
    key: "cancelled",
    label: "Đã hủy",
    badgeClass: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  },
  cancelled: {
    key: "cancelled",
    label: "Đã hủy",
    badgeClass: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  },
};

export function getOrderStatusMeta(status: string): OrderStatusMeta {
  const norm = status.trim().toLowerCase();
  return (
    ORDER_STATUS_MAP[norm] ?? {
      key: norm,
      label: status,
      badgeClass: "border-slate-500/40 bg-slate-500/15 text-slate-300",
    }
  );
}

export const VN_PROVINCES: readonly string[] = [
  "An Giang", "Bà Rịa - Vũng Tàu", "Bắc Giang", "Bắc Kạn", "Bạc Liêu", "Bắc Ninh",
  "Bến Tre", "Bình Định", "Bình Dương", "Bình Phước", "Bình Thuận", "Cà Mau",
  "Cần Thơ", "Cao Bằng", "Đà Nẵng", "Đắk Lắk", "Đắk Nông", "Điện Biên",
  "Đồng Nai", "Đồng Tháp", "Gia Lai", "Hà Giang", "Hà Nam", "Hà Nội",
  "Hà Tĩnh", "Hải Dương", "Hải Phòng", "Hậu Giang", "Hòa Bình", "Hưng Yên",
  "Khánh Hòa", "Kiên Giang", "Kon Tum", "Lai Châu", "Lâm Đồng", "Lạng Sơn",
  "Lào Cai", "Long An", "Nam Định", "Nghệ An", "Ninh Bình", "Ninh Thuận",
  "Phú Thọ", "Phú Yên", "Quảng Bình", "Quảng Nam", "Quảng Ngãi", "Quảng Ninh",
  "Quảng Trị", "Sóc Trăng", "Sơn La", "Tây Ninh", "Thái Bình", "Thái Nguyên",
  "Thanh Hóa", "Thừa Thiên Huế", "Tiền Giang", "TP. Hồ Chí Minh", "Trà Vinh",
  "Tuyên Quang", "Vĩnh Long", "Vĩnh Phúc", "Yên Bái",
];

import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useAuth } from "../contexts/AuthContext";
import { useCartWishlist } from "../contexts/CartWishlistContext";
import { useToast } from "../contexts/ToastContext";
import { ApiError, apiClient } from "../lib/api";
import { formatCurrency, VN_PROVINCES } from "../lib/format";
import type { AddressSuggestion, ShippingAddressDto } from "../types/api";

interface RawCartItem {
  product_id: number;
  title: string;
  cover_url?: string | null;
  unit_price?: number;
  price?: number;
  quantity: number;
  stock_quantity?: number;
  max_stock?: number;
  is_available?: boolean;
}

interface RawCartResponse {
  items: RawCartItem[];
}

interface CheckoutItem {
  product_id: number;
  title: string;
  cover_url: string;
  unit_price: number;
  quantity: number;
}

interface CouponValidateResponse {
  valid: boolean;
  code: string;
  display_name?: string;
  discount_amount?: number;
  discount?: number;
  shipping_fee?: number;
  grand_total?: number;
  message: string;
}

interface PlaceOrderResponse {
  ok: boolean;
  order_id: number;
  order_code: string;
  payment_method: "cod" | "momo";
  status: string;
  payment_status: string;
  sub_total: number;
  discount_amount: number;
  shipping_fee: number;
  grand_total: number;
  pay_url?: string | null;
  qr_code_url?: string | null;
  deeplink?: string | null;
}

interface PaymentStatusResponse {
  ok: boolean;
  paid: boolean;
  pending: boolean;
  order_code: string;
  status: string;
  payment_status: string;
  trans_id: string | null;
  message: string;
}

interface SavedCheckoutDraft {
  full_name: string;
  phone: string;
  email: string;
  province: string;
  district: string;
  ward: string;
  address: string;
  notes: string;
  lat: number | null;
  lng: number | null;
}

const DRAFT_STORAGE_KEY = "checkout_shipping_info";
const DEFAULT_CENTER: [number, number] = [10.7769, 106.7009];
const FREE_SHIPPING_THRESHOLD = 150_000;
const STANDARD_SHIPPING_FEE = 30_000;

function matchProvince(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return "";
  const exact = VN_PROVINCES.find((p) => p.toLowerCase() === normalized);
  if (exact) return exact;
  return (
    VN_PROVINCES.find(
      (p) =>
        normalized.includes(p.toLowerCase()) ||
        p.toLowerCase().includes(normalized),
    ) || ""
  );
}

function buildFullAddress(
  addressLine: string,
  ward: string,
  district: string,
  province: string,
): string {
  const parts = [addressLine, ward, district, province]
    .map((p) => p.trim())
    .filter(Boolean);
  const deduped: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    const alreadyPresent = deduped.some((existing) =>
      existing.toLowerCase().includes(lower),
    );
    if (!alreadyPresent) deduped.push(part);
  }
  return deduped.join(", ");
}

function isDirectImageUrl(url: string): boolean {
  return (
    url.startsWith("data:image/") ||
    /\.(png|jpg|jpeg|svg|webp)(\?.*)?$/i.test(url)
  );
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { refreshCounts } = useCartWishlist();
  const { showToast } = useToast();

  const itemIdsParam = useMemo(() => {
    const raw = searchParams.get("items") || "";
    return raw
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((num) => Number.isFinite(num) && num > 0);
  }, [searchParams]);

  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<ShippingAddressDto[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [ward, setWard] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [notes, setNotes] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<"cod" | "momo">("cod");
  const [couponInput, setCouponInput] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    displayName: string;
    discountAmount: number;
    message: string;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const [mapQuery, setMapQuery] = useState("");
  const [mapSearching, setMapSearching] = useState(false);
  const [mapSuggestions, setMapSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mapLayer, setMapLayer] = useState<"osm" | "satellite">("osm");
  const [locatingGps, setLocatingGps] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [momoOrder, setMomoOrder] = useState<PlaceOrderResponse | null>(null);
  const [momoStatusText, setMomoStatusText] = useState(
    "Đang chờ xác nhận thanh toán từ MoMo...",
  );
  const [momoPollingCount, setMomoPollingCount] = useState(0);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const osmLayerRef = useRef<L.TileLayer | null>(null);
  const satLayerRef = useRef<L.TileLayer | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const applySavedAddress = useCallback(
    (addr: ShippingAddressDto) => {
      setFullName(addr.full_name || "");
      setPhone(addr.phone_number || "");
      setProvince(matchProvince(addr.province || "") || addr.province || "");
      setDistrict(addr.district || "");
      setWard(addr.ward || "");
      setAddressLine(addr.address_line || "");
      setSelectedAddressId(String(addr.id));
    },
    [],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth", {
        replace: true,
        state: { from: `${location.pathname}${location.search}` },
      });
      return;
    }

    let cancelled = false;
    const loadData = async () => {
      setLoading(true);
      try {
        const [cartRes, addrRes] = await Promise.all([
          apiClient.get<RawCartResponse>("/api/cart"),
          apiClient
            .get<{ addresses: ShippingAddressDto[] }>("/api/profile/addresses")
            .catch(() => ({ addresses: [] })),
        ]);
        if (cancelled) return;

        const available = (cartRes.items ?? [])
          .filter(
            (item) =>
              item.is_available !== false &&
              Number(item.stock_quantity ?? item.max_stock ?? 99) > 0,
          )
          .map((item) => ({
            product_id: item.product_id,
            title: item.title,
            cover_url: item.cover_url || "/covers/default-manga.svg",
            unit_price: Number(item.unit_price ?? item.price ?? 0),
            quantity: Math.max(1, item.quantity || 1),
          }));

        const chosen =
          itemIdsParam.length > 0
            ? available.filter((item) => itemIdsParam.includes(item.product_id))
            : available;

        if (chosen.length === 0) {
          showToast(
            "Không có sản phẩm hợp lệ để thanh toán. Vui lòng kiểm tra giỏ hàng.",
            "warning",
          );
          navigate("/cart", { replace: true });
          return;
        }

        setItems(chosen);
        const addrs = addrRes.addresses ?? [];
        setSavedAddresses(addrs);

        let hydratedFromDraft = false;
        try {
          const rawDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
          if (rawDraft) {
            const draft = JSON.parse(rawDraft) as Partial<SavedCheckoutDraft>;
            if (draft.full_name || draft.address || draft.phone) {
              setFullName(draft.full_name || user.username || "");
              setPhone(draft.phone || user.phone || "");
              setEmail(draft.email || user.email || "");
              setProvince(draft.province || "");
              setDistrict(draft.district || "");
              setWard(draft.ward || "");
              setAddressLine(draft.address || "");
              setNotes(draft.notes || "");
              if (
                typeof draft.lat === "number" &&
                typeof draft.lng === "number"
              ) {
                setLat(draft.lat);
                setLng(draft.lng);
              }
              hydratedFromDraft = true;
            }
          }
        } catch {
          // Ignore malformed draft
        }

        if (!hydratedFromDraft) {
          const defaultAddr =
            addrs.find((a) => a.is_default) || addrs[0] || null;
          if (defaultAddr) {
            applySavedAddress(defaultAddr);
            setEmail(user.email || "");
          } else {
            setFullName(user.username || "");
            setPhone(user.phone || "");
            setEmail(user.email || "");
          }
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          navigate("/auth", { replace: true });
          return;
        }
        showToast(
          err instanceof Error ? err.message : "Không thể tải thông tin thanh toán.",
          "error",
        );
        navigate("/cart", { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    user,
    navigate,
    location.pathname,
    location.search,
    itemIdsParam,
    showToast,
    applySavedAddress,
  ]);

  // Persist draft shipping form
  useEffect(() => {
    if (loading || !user) return;
    try {
      const payload: SavedCheckoutDraft = {
        full_name: fullName,
        phone,
        email,
        province,
        district,
        ward,
        address: addressLine,
        notes,
        lat,
        lng,
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage disabled
    }
  }, [
    loading,
    user,
    fullName,
    phone,
    email,
    province,
    district,
    ward,
    addressLine,
    notes,
    lat,
    lng,
  ]);

  const reverseGeocode = useCallback(async (targetLat: number, targetLng: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${targetLat}&lon=${targetLng}&accept-language=vi`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        display_name?: string;
        address?: {
          house_number?: string;
          road?: string;
          suburb?: string;
          quarter?: string;
          village?: string;
          town?: string;
          city_district?: string;
          county?: string;
          district?: string;
          city?: string;
          state?: string;
        };
      };
      const addr = data.address;
      if (!addr) {
        if (data.display_name) setAddressLine(data.display_name);
        return;
      }

      const streetParts = [addr.house_number, addr.road].filter(Boolean);
      if (streetParts.length > 0) {
        setAddressLine(streetParts.join(" "));
      } else if (data.display_name) {
        setAddressLine(data.display_name.split(",")[0] || data.display_name);
      }

      const detectedWard = addr.quarter || addr.suburb || addr.village || "";
      if (detectedWard) setWard(detectedWard);

      const detectedDistrict =
        addr.city_district || addr.district || addr.county || addr.town || "";
      if (detectedDistrict) setDistrict(detectedDistrict);

      const detectedCity = addr.city || addr.state || "";
      const matchedProv = matchProvince(detectedCity);
      if (matchedProv) setProvince(matchedProv);
    } catch {
      // Silently ignore reverse-geocode network failure
    }
  }, []);

  const updateMapPin = useCallback(
    (nextLat: number, nextLng: number, shouldPan = true) => {
      setLat(Number(nextLat.toFixed(6)));
      setLng(Number(nextLng.toFixed(6)));
      const map = mapInstanceRef.current;
      if (!map) return;

      if (!markerRef.current) {
        const customIcon = L.divIcon({
          className: "ms-leaflet-pin",
          html: `<div style="width:28px;height:28px;border-radius:9999px;background:#e62429;border:3px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;"><span style="width:8px;height:8px;border-radius:9999px;background:#fff;"></span></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        });
        const marker = L.marker([nextLat, nextLng], {
          icon: customIcon,
          draggable: true,
        }).addTo(map);
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          setLat(Number(pos.lat.toFixed(6)));
          setLng(Number(pos.lng.toFixed(6)));
          void reverseGeocode(pos.lat, pos.lng);
        });
        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng([nextLat, nextLng]);
      }

      if (shouldPan) {
        map.setView([nextLat, nextLng], Math.max(map.getZoom(), 15), {
          animate: true,
        });
      }
    },
    [reverseGeocode],
  );

  // Initialize Leaflet map once DOM is visible
  useEffect(() => {
    if (loading || !mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter: [number, number] =
      lat !== null && lng !== null ? [lat, lng] : DEFAULT_CENTER;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: lat !== null && lng !== null ? 15 : 13,
      zoomControl: true,
    });

    const osmLayer = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      },
    );
    const satLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "&copy; Esri",
        maxZoom: 19,
      },
    );

    osmLayer.addTo(map);
    osmLayerRef.current = osmLayer;
    satLayerRef.current = satLayer;
    mapInstanceRef.current = map;

    if (lat !== null && lng !== null) {
      updateMapPin(lat, lng, false);
    }

    map.on("click", (e: L.LeafletMouseEvent) => {
      updateMapPin(e.latlng.lat, e.latlng.lng, false);
      void reverseGeocode(e.latlng.lat, e.latlng.lng);
    });

    const timer = window.setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
      osmLayerRef.current = null;
      satLayerRef.current = null;
    };
  }, [loading, lat, lng, updateMapPin, reverseGeocode]);

  // Switch tile layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    const osm = osmLayerRef.current;
    const sat = satLayerRef.current;
    if (!map || !osm || !sat) return;

    if (mapLayer === "osm") {
      if (map.hasLayer(sat)) map.removeLayer(sat);
      if (!map.hasLayer(osm)) osm.addTo(map);
    } else {
      if (map.hasLayer(osm)) map.removeLayer(osm);
      if (!map.hasLayer(sat)) sat.addTo(map);
    }
  }, [mapLayer]);

  // Debounced Nominatim/Backend address search
  useEffect(() => {
    const q = mapQuery.trim();
    if (q.length < 3) {
      setMapSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const handle = window.setTimeout(async () => {
      setMapSearching(true);
      try {
        const res = await apiClient.get<AddressSuggestion[]>(
          `/api/address/search?q=${encodeURIComponent(q)}`,
        );
        setMapSuggestions(Array.isArray(res) ? res : []);
        setShowSuggestions(true);
      } catch {
        setMapSuggestions([]);
      } finally {
        setMapSearching(false);
      }
    }, 350);

    return () => window.clearTimeout(handle);
  }, [mapQuery]);

  const handleSelectSuggestion = (s: AddressSuggestion) => {
    setShowSuggestions(false);
    setMapQuery(s.short_name || s.display_name);
    if (s.short_name) setAddressLine(s.short_name);
    if (s.district) setDistrict(s.district);
    const matched = matchProvince(s.city || s.display_name || "");
    if (matched) setProvince(matched);

    const parsedLat = Number(s.lat);
    const parsedLng = Number(s.lon);
    if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
      updateMapPin(parsedLat, parsedLng, true);
    }
  };

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      showToast("Trình duyệt không hỗ trợ định vị GPS.", "warning");
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocatingGps(false);
        updateMapPin(pos.coords.latitude, pos.coords.longitude, true);
        void reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocatingGps(false);
        showToast(
          "Không lấy được vị trí hiện tại. Bạn có thể chạm trực tiếp lên bản đồ.",
          "warning",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const pricing = useMemo(() => {
    const subTotal = items.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    );
    const shippingFee =
      subTotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_FEE;
    const discountAmount = appliedCoupon?.discountAmount ?? 0;
    const grandTotal = Math.max(0, subTotal - discountAmount + shippingFee);
    return { subTotal, shippingFee, discountAmount, grandTotal };
  }, [items, appliedCoupon]);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      setCouponError("Vui lòng nhập mã giảm giá.");
      return;
    }
    setCouponBusy(true);
    setCouponError(null);
    try {
      const res = await apiClient.get<CouponValidateResponse>(
        `/api/coupons/validate?code=${encodeURIComponent(code)}&sub_total=${pricing.subTotal}`,
      );
      if (!res.valid) {
        setAppliedCoupon(null);
        setCouponError(res.message || "Mã giảm giá không hợp lệ.");
      } else {
        const discount = Number(res.discount_amount ?? res.discount ?? 0);
        setAppliedCoupon({
          code: res.code || code,
          displayName: res.display_name || code,
          discountAmount: discount,
          message: res.message || "Áp dụng mã giảm giá thành công.",
        });
        showToast("Áp dụng mã khuyến mãi thành công!", "success");
      }
    } catch (err) {
      setAppliedCoupon(null);
      setCouponError(
        err instanceof Error ? err.message : "Không thể kiểm tra mã giảm giá.",
      );
    } finally {
      setCouponBusy(false);
    }
  };

  const checkMomoPaymentOnce = useCallback(
    async (orderCode: string, silent = false) => {
      try {
        const statusRes = await apiClient.get<PaymentStatusResponse>(
          `/api/orders/${encodeURIComponent(orderCode)}/payment-status`,
        );
        if (statusRes.paid) {
          if (pollTimerRef.current !== null) {
            window.clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          localStorage.removeItem(DRAFT_STORAGE_KEY);
          await refreshCounts();
          showToast("Thanh toán MoMo thành công!", "success");
          navigate(`/order-success?orderCode=${encodeURIComponent(orderCode)}`, {
            replace: true,
          });
          return true;
        }
        setMomoStatusText(
          statusRes.message || "Đang chờ xác nhận giao dịch từ ví MoMo...",
        );
        if (!silent) {
          showToast("Giao dịch vẫn đang chờ thanh toán trên MoMo.", "info");
        }
        return false;
      } catch {
        if (!silent) {
          showToast("Không thể kiểm tra trạng thái lúc này.", "warning");
        }
        return false;
      }
    },
    [navigate, refreshCounts, showToast],
  );

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const startMomoPolling = (orderCode: string) => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
    }
    let attempts = 0;
    setMomoPollingCount(0);
    pollTimerRef.current = window.setInterval(() => {
      attempts += 1;
      setMomoPollingCount(attempts);
      if (attempts > 60) {
        if (pollTimerRef.current !== null) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setMomoStatusText(
          "Hết thời gian chờ tự động. Bạn vẫn có thể bấm kiểm tra lại hoặc xem trong lịch sử đơn hàng.",
        );
        return;
      }
      void checkMomoPaymentOnce(orderCode, true);
    }, 5000);
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      showToast("Vui lòng nhập họ tên người nhận.", "warning");
      return;
    }
    if (!phone.trim() || phone.trim().length < 9) {
      showToast("Vui lòng nhập số điện thoại hợp lệ.", "warning");
      return;
    }
    if (!addressLine.trim()) {
      showToast("Vui lòng nhập địa chỉ giao hàng cụ thể.", "warning");
      return;
    }

    const fullAddress = buildFullAddress(addressLine, ward, district, province);
    setSubmitting(true);
    try {
      const res = await apiClient.post<PlaceOrderResponse>("/api/orders", {
        selected_product_ids: items.map((i) => i.product_id),
        payment_method: paymentMethod,
        coupon_code: appliedCoupon?.code || null,
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        address: fullAddress,
        province: province || null,
        district: district.trim() || null,
        ward: ward.trim() || null,
        lat,
        lng,
        notes: notes.trim() || null,
      });

      if (paymentMethod === "momo" && (res.pay_url || res.qr_code_url)) {
        setMomoOrder(res);
        setMomoStatusText(
          "Quét mã QR hoặc mở cổng MoMo để hoàn tất thanh toán đơn hàng.",
        );
        startMomoPolling(res.order_code);
      } else {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        await refreshCounts();
        showToast("Đặt hàng thành công!", "success");
        navigate(
          `/order-success?orderCode=${encodeURIComponent(res.order_code)}`,
          { replace: true },
        );
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Đặt hàng không thành công.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StoreLayout>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb & 3-step tracker */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <nav className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <Link to="/" className="hover:text-white">
                Trang chủ
              </Link>
              <span>/</span>
              <Link to="/cart" className="hover:text-white">
                Giỏ hàng
              </Link>
              <span>/</span>
              <span className="text-crimson-400 font-semibold">Thanh toán</span>
            </nav>
            <h1 className="font-display text-2xl font-extrabold text-white sm:text-3xl">
              Thanh toán đơn hàng
            </h1>
          </div>

          <ol className="flex items-center gap-2 text-xs font-semibold sm:gap-4">
            <li className="flex items-center gap-1.5 text-emerald-400">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-emerald-400 bg-emerald-500/20">
                1
              </span>
              Giỏ hàng
            </li>
            <span className="h-px w-6 bg-slate-700" />
            <li className="text-crimson-400 flex items-center gap-1.5">
              <span className="border-crimson-400 bg-crimson-500/20 flex h-6 w-6 items-center justify-center rounded-full border">
                2
              </span>
              Thanh toán
            </li>
            <span className="h-px w-6 bg-slate-700" />
            <li className="flex items-center gap-1.5 text-slate-500">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-slate-900">
                3
              </span>
              Hoàn tất
            </li>
          </ol>
        </div>

        {loading ? (
          <div className="grid gap-8 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-7">
              <div className="ms-panel-2d h-96 animate-pulse bg-slate-900/70" />
              <div className="ms-panel-2d h-72 animate-pulse bg-slate-900/70" />
            </div>
            <div className="ms-panel-2d h-96 animate-pulse bg-slate-900/70 lg:col-span-5" />
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSubmitOrder(e)}
            className="grid items-start gap-8 lg:grid-cols-12"
          >
            {/* Left column: shipping, leaflet map, payment method */}
            <div className="space-y-6 lg:col-span-7">
              {/* Saved address selector */}
              {savedAddresses.length > 0 && (
                <div className="ms-panel-2d p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="font-display flex items-center gap-2 text-base font-bold text-white">
                      <MangaIcon name="home" className="h-4 w-4 text-cyan-400" />
                      Chọn nhanh từ sổ địa chỉ
                    </h2>
                    <Link
                      to="/profile/settings"
                      className="text-xs text-cyan-400 hover:underline"
                    >
                      Quản lý địa chỉ
                    </Link>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {savedAddresses.map((addr) => {
                      const active = selectedAddressId === String(addr.id);
                      return (
                        <button
                          key={addr.id}
                          type="button"
                          onClick={() => applySavedAddress(addr)}
                          className={`rounded-xl border p-3 text-left transition-all ${
                            active
                              ? "border-cyan-400 bg-cyan-500/10"
                              : "border-slate-700 bg-slate-900/70 hover:border-slate-500"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-white">
                              {addr.full_name}
                            </span>
                            {addr.is_default && (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                Mặc định
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {addr.phone_number}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-300">
                            {[
                              addr.address_line,
                              addr.ward,
                              addr.district,
                              addr.province,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Shipping info */}
              <div className="ms-panel-2d space-y-4 p-6">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
                  <MangaIcon name="user" className="text-crimson-400 h-5 w-5" />
                  Thông tin người nhận & Địa chỉ giao hàng
                </h2>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      Họ và tên <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Nguyễn Văn A"
                      className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      Số điện thoại <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="09xxxxxxxx"
                      className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      Email nhận thông báo
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@domain.com"
                      className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      Tỉnh / Thành phố
                    </label>
                    <select
                      value={province}
                      onChange={(e) => setProvince(e.target.value)}
                      className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none"
                    >
                      <option value="">-- Chọn Tỉnh / Thành phố --</option>
                      {VN_PROVINCES.map((prov) => (
                        <option key={prov} value={prov}>
                          {prov}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      Quận / Huyện
                    </label>
                    <input
                      type="text"
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      placeholder="Quận 1, TP. Thủ Đức..."
                      className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                      Phường / Xã
                    </label>
                    <input
                      type="text"
                      value={ward}
                      onChange={(e) => setWard(e.target.value)}
                      placeholder="Phường Bến Nghé..."
                      className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                    Địa chỉ chi tiết (Số nhà, tên đường){" "}
                    <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={addressLine}
                    onChange={(e) => setAddressLine(e.target.value)}
                    placeholder="Số 123 Đường Nguyễn Huệ..."
                    className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                    Ghi chú giao hàng
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Giao giờ hành chính, gọi trước khi tới..."
                    className="focus:border-crimson-400 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white outline-none"
                  />
                </div>
              </div>

              {/* Interactive Leaflet Map */}
              <div className="ms-panel-2d space-y-4 p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display flex items-center gap-2 text-base font-bold text-white">
                    <MangaIcon name="map-pin" className="h-5 w-5 text-cyan-400" />
                    Chọn vị trí giao hàng trên bản đồ
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setMapLayer((prev) =>
                          prev === "osm" ? "satellite" : "osm",
                        )
                      }
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-400"
                    >
                      <MangaIcon name="map" className="mr-1 inline h-3.5 w-3.5" />
                      {mapLayer === "osm" ? "Vệ tinh" : "Bản đồ phố"}
                    </button>
                    <button
                      type="button"
                      disabled={locatingGps}
                      onClick={handleLocateMe}
                      className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
                    >
                      <MangaIcon name="locate" className="mr-1 inline h-3.5 w-3.5" />
                      {locatingGps ? "Đang định vị..." : "Vị trí của tôi"}
                    </button>
                  </div>
                </div>

                {/* Address search bar */}
                <div className="relative">
                  <div className="flex items-center rounded-xl border border-slate-700 bg-slate-950 px-3">
                    <MangaIcon
                      name="search"
                      className="h-4 w-4 shrink-0 text-slate-400"
                    />
                    <input
                      type="text"
                      value={mapQuery}
                      onChange={(e) => setMapQuery(e.target.value)}
                      onFocus={() => {
                        if (mapSuggestions.length > 0) setShowSuggestions(true);
                      }}
                      placeholder="Tìm địa điểm, tên đường để ghim bản đồ..."
                      className="w-full bg-transparent px-2.5 py-2.5 text-sm text-white outline-none"
                    />
                    {mapSearching && (
                      <span className="text-xs text-slate-400">Đang tìm...</span>
                    )}
                  </div>

                  {showSuggestions && mapSuggestions.length > 0 && (
                    <div className="absolute right-0 left-0 z-30 mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
                      {mapSuggestions.map((sug, idx) => (
                        <button
                          key={`${sug.lat}-${sug.lon}-${idx}`}
                          type="button"
                          onClick={() => handleSelectSuggestion(sug)}
                          className="block w-full border-b border-slate-800 px-3.5 py-2.5 text-left text-xs hover:bg-slate-900"
                        >
                          <p className="font-semibold text-white">
                            {sug.short_name || sug.display_name}
                          </p>
                          <p className="mt-0.5 line-clamp-1 text-slate-400">
                            {sug.display_name}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  ref={mapContainerRef}
                  className="h-64 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950"
                />

                <p className="text-xs text-slate-400">
                  Nhấn hoặc kéo ghim đỏ trên bản đồ để tự động điền địa chỉ.
                  {lat !== null && lng !== null && (
                    <span className="ml-2 font-mono text-cyan-300">
                      ({lat.toFixed(5)}, {lng.toFixed(5)})
                    </span>
                  )}
                </p>
              </div>

              {/* Payment method */}
              <div className="ms-panel-2d space-y-4 p-6">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
                  <MangaIcon
                    name="credit-card"
                    className="text-crimson-400 h-5 w-5"
                  />
                  Phương thức thanh toán
                </h2>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-all ${
                      paymentMethod === "cod"
                        ? "border-crimson-500 bg-crimson-500/10"
                        : "border-slate-700 bg-slate-900/60 hover:border-slate-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="cod"
                      checked={paymentMethod === "cod"}
                      onChange={() => setPaymentMethod("cod")}
                      className="accent-crimson-500 mt-1"
                    />
                    <div>
                      <div className="flex items-center gap-2 font-bold text-white">
                        <MangaIcon
                          name="banknote"
                          className="h-4 w-4 text-emerald-400"
                        />
                        Thanh toán khi nhận hàng (COD)
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Kiểm tra truyện trước khi thanh toán tiền mặt cho shipper.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-all ${
                      paymentMethod === "momo"
                        ? "border-pink-500 bg-pink-500/10"
                        : "border-slate-700 bg-slate-900/60 hover:border-slate-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="momo"
                      checked={paymentMethod === "momo"}
                      onChange={() => setPaymentMethod("momo")}
                      className="mt-1 accent-pink-500"
                    />
                    <div>
                      <div className="flex items-center gap-2 font-bold text-white">
                        <MangaIcon
                          name="credit-card"
                          className="h-4 w-4 text-pink-400"
                        />
                        Ví điện tử MoMo
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Thanh toán nhanh qua ứng dụng MoMo hoặc quét mã QR.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Right column: Coupon & Summary */}
            <aside className="ms-panel-2d sticky top-24 space-y-5 p-6 lg:col-span-5">
              <h2 className="font-display flex items-center gap-2 text-lg font-extrabold text-white">
                <MangaIcon name="receipt" className="text-crimson-400 h-5 w-5" />
                Đơn hàng ({items.length} sản phẩm)
              </h2>

              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {items.map((item) => (
                  <div
                    key={item.product_id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <img
                        src={item.cover_url}
                        alt={item.title}
                        onError={(e) => {
                          e.currentTarget.src = "/covers/default-manga.svg";
                        }}
                        className="h-14 w-10 shrink-0 rounded border border-slate-700 object-cover"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">
                          {item.title}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatCurrency(item.unit_price)} × {item.quantity}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-bold text-white">
                      {formatCurrency(item.unit_price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Coupon box */}
              <div className="border-y border-slate-800 py-4">
                <label className="mb-2 block text-xs font-semibold text-slate-300">
                  Mã giảm giá / Khuyến mãi
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => {
                      setCouponInput(e.target.value);
                      setCouponError(null);
                    }}
                    placeholder="Nhập mã coupon..."
                    className="focus:border-cyan-400 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white uppercase outline-none"
                  />
                  <button
                    type="button"
                    disabled={couponBusy}
                    onClick={() => void handleApplyCoupon()}
                    className="ms-btn-2d ms-btn-2d-cyan px-4 py-2 text-xs disabled:opacity-50"
                  >
                    {couponBusy ? "Đang kiểm..." : "Áp dụng"}
                  </button>
                </div>

                {couponError && (
                  <p className="mt-2 text-xs text-rose-400">{couponError}</p>
                )}

                {appliedCoupon && (
                  <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-200">
                    <span>
                      Mã <strong>{appliedCoupon.code}</strong>: giảm{" "}
                      {formatCurrency(appliedCoupon.discountAmount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAppliedCoupon(null);
                        setCouponInput("");
                      }}
                      className="text-emerald-300 hover:text-white"
                    >
                      Bỏ mã
                    </button>
                  </div>
                )}
              </div>

              {/* Totals */}
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between text-slate-300">
                  <span>Tạm tính</span>
                  <span className="font-mono font-semibold text-white">
                    {formatCurrency(pricing.subTotal)}
                  </span>
                </div>
                {pricing.discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Giảm giá khuyến mãi</span>
                    <span className="font-mono font-semibold">
                      -{formatCurrency(pricing.discountAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-300">
                  <span>Phí vận chuyển</span>
                  <span
                    className={`font-mono font-semibold ${
                      pricing.shippingFee === 0 ? "text-emerald-400" : "text-white"
                    }`}
                  >
                    {pricing.shippingFee === 0
                      ? "Miễn phí"
                      : formatCurrency(pricing.shippingFee)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between border-t border-slate-800 pt-3">
                  <span className="font-bold text-white">Tổng thanh toán</span>
                  <span className="text-crimson-400 font-mono text-2xl font-extrabold">
                    {formatCurrency(pricing.grandTotal)}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="ms-btn-2d ms-btn-2d-crimson w-full py-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                <MangaIcon name="check-circle-2" className="h-4 w-4" />
                {submitting
                  ? "Đang xử lý đơn hàng..."
                  : paymentMethod === "momo"
                    ? "Đặt hàng & Thanh toán MoMo"
                    : "Xác nhận đặt hàng"}
              </button>

              <Link
                to="/cart"
                className="ms-btn-2d ms-btn-2d-dark w-full py-2.5 text-xs"
              >
                <MangaIcon name="arrow-left" className="h-4 w-4" />
                Quay lại giỏ hàng
              </Link>
            </aside>
          </form>
        )}
      </section>

      {/* MoMo Payment Modal */}
      {momoOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="ms-panel-2d w-full max-w-md space-y-5 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-pink-500/40 bg-pink-500/15 text-pink-400">
              <MangaIcon name="credit-card" className="h-6 w-6" />
            </div>

            <div>
              <h3 className="font-display text-xl font-extrabold text-white">
                Thanh toán ví MoMo
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Mã đơn:{" "}
                <strong className="font-mono text-cyan-300">
                  #{momoOrder.order_code}
                </strong>
              </p>
              <p className="mt-2 font-mono text-2xl font-extrabold text-pink-400">
                {formatCurrency(momoOrder.grand_total)}
              </p>
            </div>

            {momoOrder.qr_code_url && isDirectImageUrl(momoOrder.qr_code_url) && (
              <div className="mx-auto inline-block rounded-2xl bg-white p-3">
                <img
                  src={momoOrder.qr_code_url}
                  alt="Mã QR thanh toán MoMo"
                  className="h-44 w-44 object-contain"
                />
              </div>
            )}

            <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-xs text-slate-300">
              <p>{momoStatusText}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Tự động kiểm tra mỗi 5 giây (Lần {momoPollingCount})
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              {momoOrder.pay_url && (
                <a
                  href={momoOrder.pay_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ms-btn-2d ms-btn-2d-crimson w-full py-3 text-sm"
                >
                  Mở cổng thanh toán MoMo
                </a>
              )}

              {momoOrder.deeplink && (
                <a
                  href={momoOrder.deeplink}
                  className="ms-btn-2d ms-btn-2d-cyan w-full py-2.5 text-xs"
                >
                  Mở ứng dụng MoMo
                </a>
              )}

              <button
                type="button"
                onClick={() =>
                  void checkMomoPaymentOnce(momoOrder.order_code, false)
                }
                className="ms-btn-2d ms-btn-2d-dark w-full py-2.5 text-xs"
              >
                <MangaIcon name="refresh-cw" className="h-4 w-4" />
                Kiểm tra thanh toán ngay
              </button>

              <button
                type="button"
                onClick={() => {
                  if (pollTimerRef.current !== null) {
                    window.clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                  }
                  const code = momoOrder.order_code;
                  setMomoOrder(null);
                  navigate(`/order-success?orderCode=${encodeURIComponent(code)}`);
                }}
                className="mt-1 text-xs text-slate-400 hover:text-white"
              >
                Xem chi tiết đơn hàng
              </button>
            </div>
          </div>
        </div>
      )}
    </StoreLayout>
  );
}

export default CheckoutPage;

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiClient } from "../lib/api";
import type { CartSummaryResponse } from "../types/api";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";

interface CartWishlistContextValue {
  cartCount: number;
  wishlistIds: number[];
  wishlistCount: number;
  refreshCounts: () => Promise<void>;
  addToCart: (productId: number, quantity?: number) => Promise<boolean>;
  toggleWishlist: (productId: number) => Promise<boolean | null>;
}

const CartWishlistContext = createContext<CartWishlistContextValue | null>(null);

export function CartWishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [cartCount, setCartCount] = useState(0);
  const [wishlistIds, setWishlistIds] = useState<number[]>([]);

  const refreshCounts = useCallback(async () => {
    if (!user) {
      setCartCount(0);
      setWishlistIds([]);
      return;
    }
    try {
      const [cartRes, wishRes] = await Promise.all([
        apiClient.get<CartSummaryResponse>("/api/cart"),
        apiClient.get<{ product_ids: number[] }>("/api/profile/wishlist"),
      ]);
      setCartCount(cartRes.total_items);
      setWishlistIds(wishRes.product_ids ?? []);
    } catch {
      // Ignore transient errors when user is logging out
    }
  }, [user]);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  const addToCart = useCallback(
    async (productId: number, quantity = 1): Promise<boolean> => {
      if (!user) {
        showToast("Vui lòng đăng nhập để thêm truyện vào giỏ hàng.", "warning");
        return false;
      }
      try {
        const res = await apiClient.post<{ ok: boolean; message: string; cart_count: number }>(
          "/api/cart",
          { product_id: productId, quantity }
        );
        setCartCount(res.cart_count);
        showToast(res.message || "Đã thêm vào giỏ hàng!", "success");
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Không thể thêm vào giỏ hàng.", "error");
        return false;
      }
    },
    [user, showToast]
  );

  const toggleWishlist = useCallback(
    async (productId: number): Promise<boolean | null> => {
      if (!user) {
        showToast("Vui lòng đăng nhập để lưu truyện yêu thích.", "warning");
        return null;
      }
      try {
        const res = await apiClient.post<{ added: boolean; count: number; message?: string }>(
          `/api/profile/wishlist/${productId}`
        );
        setWishlistIds((prev) =>
          res.added
            ? Array.from(new Set([...prev, productId]))
            : prev.filter((id) => id !== productId)
        );
        showToast(
          res.added ? "Đã thêm vào danh sách yêu thích" : "Đã bỏ khỏi danh sách yêu thích",
          res.added ? "success" : "info"
        );
        return res.added;
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Không thể cập nhật yêu thích.", "error");
        return null;
      }
    },
    [user, showToast]
  );

  return (
    <CartWishlistContext.Provider
      value={{
        cartCount,
        wishlistIds,
        wishlistCount: wishlistIds.length,
        refreshCounts,
        addToCart,
        toggleWishlist,
      }}
    >
      {children}
    </CartWishlistContext.Provider>
  );
}

export function useCartWishlist(): CartWishlistContextValue {
  const ctx = useContext(CartWishlistContext);
  if (!ctx) throw new Error("useCartWishlist must be used within CartWishlistProvider");
  return ctx;
}

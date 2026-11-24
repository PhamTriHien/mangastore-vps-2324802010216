import { Suspense, lazy, useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

const AboutPage = lazy(() => import("./pages/AboutPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const CartPage = lazy(() => import("./pages/CartPage"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const OrderSuccessPage = lazy(() => import("./pages/OrderSuccessPage"));
const ProductDetailPage = lazy(() => import("./pages/ProductDetailPage"));
const ProductsPage = lazy(() => import("./pages/ProductsPage"));
const ProfileOrdersPage = lazy(() => import("./pages/ProfileOrdersPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ProfileSettingsPage = lazy(() => import("./pages/ProfileSettingsPage"));
const ProfileWishlistPage = lazy(() => import("./pages/ProfileWishlistPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const VerifyCodePage = lazy(() => import("./pages/VerifyCodePage"));

const ReaderDetailPage = lazy(() => import("./pages/reader/ReaderDetailPage"));
const ReaderIndexPage = lazy(() => import("./pages/reader/ReaderIndexPage"));
const ReaderReadPage = lazy(() => import("./pages/reader/ReaderReadPage"));

const AdminCustomerEditPage = lazy(() => import("./pages/admin/AdminCustomerEditPage"));
const AdminCustomersPage = lazy(() => import("./pages/admin/AdminCustomersPage"));
const AdminDashboardPage = lazy(() => import("./pages/admin/AdminDashboardPage"));
const AdminImportHistoryDetailPage = lazy(() => import("./pages/admin/AdminImportHistoryDetailPage"));
const AdminImportHistoryPage = lazy(() => import("./pages/admin/AdminImportHistoryPage"));
const AdminImportPage = lazy(() => import("./pages/admin/AdminImportPage"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminLoginPage = lazy(() => import("./pages/admin/AdminLoginPage"));
const AdminOrdersPage = lazy(() => import("./pages/admin/AdminOrdersPage"));
const AdminProductFormPage = lazy(() => import("./pages/admin/AdminProductFormPage"));
const AdminProductsPage = lazy(() => import("./pages/admin/AdminProductsPage"));
const AdminReviewsPage = lazy(() => import("./pages/admin/AdminReviewsPage"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

function PageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0B0D14] text-[#A3AEC2]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E63946] border-t-transparent" />
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="ms-panel-2d w-full max-w-lg rounded-2xl border border-white/10 p-8 text-center">
        <img
          src="/content/icons/spots/spot-empty-search.svg"
          alt=""
          className="ms-float-3d mx-auto mb-5 h-24 w-24"
        />
        <span className="ms-hanko-badge px-3 py-1 text-xs">LỖI 404</span>
        <h1 className="ms-font-display mt-3 text-2xl font-extrabold text-[#F5F6FA]">
          Không tìm thấy trang bạn yêu cầu
        </h1>
        <p className="mt-2 text-sm text-[#A3AEC2]">
          Đường dẫn có thể đã thay đổi hoặc nội dung không còn khả dụng. Hãy chọn một khu vực bên dưới để tiếp tục.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/"
            className="ms-btn-2d ms-btn-2d-dark rounded-xl border px-4 py-2.5 text-sm font-semibold"
          >
            Trang chủ
          </Link>
          <Link
            to="/products"
            className="ms-btn-2d ms-btn-2d-crimson rounded-xl border px-4 py-2.5 text-sm font-semibold"
          >
            Cửa hàng mua truyện
          </Link>
          <Link
            to="/doc-truyen"
            className="ms-btn-2d ms-btn-2d-cyan rounded-xl border px-4 py-2.5 text-sm font-semibold"
          >
            Đọc truyện Online
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Storefront & Public */}
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/order-success" element={<OrderSuccessPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />

          {/* Auth & Password Recovery */}
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-code" element={<VerifyCodePage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Member Profile */}
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/orders" element={<ProfileOrdersPage />} />
          <Route path="/profile/wishlist" element={<ProfileWishlistPage />} />
          <Route path="/profile/settings" element={<ProfileSettingsPage />} />

          {/* Online Manga Reader */}
          <Route path="/doc-truyen" element={<ReaderIndexPage />} />
          <Route path="/reader" element={<ReaderIndexPage />} />
          <Route path="/doc-truyen/chi-tiet" element={<ReaderDetailPage />} />
          <Route path="/reader/detail" element={<ReaderDetailPage />} />
          <Route path="/doc-truyen/doc" element={<ReaderReadPage />} />
          <Route path="/reader/read" element={<ReaderReadPage />} />

          {/* Admin Panel */}
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="dashboard" element={<Navigate to="/admin" replace />} />
            <Route path="products" element={<AdminProductsPage />} />
            <Route path="products/new" element={<AdminProductFormPage />} />
            <Route path="products/create" element={<AdminProductFormPage />} />
            <Route path="products/:id/edit" element={<AdminProductFormPage />} />
            <Route path="orders" element={<AdminOrdersPage />} />
            <Route path="customers" element={<AdminCustomersPage />} />
            <Route path="customers/:id/edit" element={<AdminCustomerEditPage />} />
            <Route path="reviews" element={<AdminReviewsPage />} />
            <Route path="import" element={<AdminImportPage />} />
            <Route path="import/history" element={<AdminImportHistoryPage />} />
            <Route path="import/history/:batchId" element={<AdminImportHistoryDetailPage />} />
          </Route>

          {/* Fallback 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}

import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-white/10 bg-[#0B0D14]/95 text-slate-300 backdrop-blur-md">
      <div className="ms-halftone-strip h-1.5 w-full border-b border-[#E63946]/25 opacity-75" />
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-5">
          <div>
            <Link to="/" className="mb-4 inline-flex items-center gap-2.5">
              <img
                src="/content/icons/spots/brand-logo.svg"
                alt="MangaStore"
                className="h-10 w-10 rounded-xl shadow-md"
              />
              <span className="font-display text-lg font-bold text-white">
                Manga<span className="text-[#E63946]">Store</span>
              </span>
            </Link>
            <p className="text-sm leading-relaxed text-slate-400">
              Cửa hàng Manga, Light Novel và không gian đọc truyện trực tuyến.
            </p>
          </div>

          <div>
            <h3 className="mb-4 font-semibold text-white">Về chúng tôi</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link to="/about" className="transition-colors hover:text-white">
                  Giới thiệu
                </Link>
              </li>
              <li>
                <Link
                  to="/contact"
                  className="transition-colors hover:text-white"
                >
                  Liên hệ
                </Link>
              </li>
              <li>
                <Link
                  to="/products"
                  className="transition-colors hover:text-white"
                >
                  Bộ sưu tập
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-semibold text-white">Hỗ trợ</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link
                  to="/contact"
                  className="transition-colors hover:text-white"
                >
                  Hỗ trợ trực tuyến
                </Link>
              </li>
              <li>
                <Link
                  to="/profile/orders"
                  className="transition-colors hover:text-white"
                >
                  Theo dõi đơn hàng
                </Link>
              </li>
              <li>
                <Link to="/cart" className="transition-colors hover:text-white">
                  Giỏ hàng &amp; Thanh toán
                </Link>
              </li>
              <li>
                <Link to="/about" className="transition-colors hover:text-white">
                  Chính sách &amp; Vận chuyển
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-semibold text-white">Danh mục</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link
                  to="/products"
                  className="transition-colors hover:text-white"
                >
                  Cửa hàng mua truyện
                </Link>
              </li>
              <li>
                <Link
                  to="/doc-truyen?source=mangadex-vi"
                  className="transition-colors hover:text-white"
                >
                  Đọc truyện Tiếng Việt
                </Link>
              </li>
              <li>
                <Link
                  to="/doc-truyen?source=mangadex-vi&tag=3e2b8dae-350e-4ab8-a8ce-016e844b9f0d"
                  className="transition-colors hover:text-white"
                >
                  Đọc Webtoon cuộn dọc
                </Link>
              </li>
              <li>
                <Link
                  to="/doc-truyen?source=archive-manga"
                  className="transition-colors hover:text-white"
                >
                  Kho lưu trữ Manga mở
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-semibold text-white">Tài khoản</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link to="/auth" className="transition-colors hover:text-white">
                  Đăng nhập
                </Link>
              </li>
              <li>
                <Link
                  to="/profile"
                  className="transition-colors hover:text-white"
                >
                  Hồ sơ cá nhân
                </Link>
              </li>
              <li>
                <Link
                  to="/profile/wishlist"
                  className="transition-colors hover:text-white"
                >
                  Yêu thích
                </Link>
              </li>
              <li>
                <Link
                  to="/profile/settings"
                  className="transition-colors hover:text-white"
                >
                  Cài đặt
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-sm text-slate-400 md:flex-row">
          <p>© 2026 MangaStore — Phạm Trí Hiển</p>
          <div className="flex gap-6">
            <Link to="/about" className="transition-colors hover:text-white">
              Điều khoản
            </Link>
            <Link to="/contact" className="transition-colors hover:text-white">
              Hỗ trợ
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

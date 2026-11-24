import { Link } from "react-router-dom";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaIcon } from "../components/ui/MangaIcon";

export function ContactPage() {
  const handleOpenChatbot = () => {
    window.dispatchEvent(new CustomEvent("ms:open-chatbot"));
  };

  return (
    <StoreLayout>
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0">
          <img
            src="/content/manga/auth-manga-art.png"
            alt="Liên hệ và hỗ trợ MangaStore"
            className="h-full w-full object-cover opacity-40"
            onError={(e) => {
              e.currentTarget.src = "/covers/default-manga.svg";
            }}
          />
          <div className="ms-manga-banner-overlay absolute inset-0" />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="max-w-3xl space-y-5">
            <h1 className="font-display text-3xl font-extrabold text-white md:text-5xl">
              Liên hệ &amp; Hỗ trợ khách hàng
            </h1>
            <p className="text-base leading-relaxed text-slate-300 md:text-lg">
              Sử dụng các kênh hỗ trợ trực tiếp trên hệ thống MangaStore để tra cứu đơn hàng,
              hỏi đáp chính sách giao nhận hoặc khám phá đầu truyện phù hợp.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                to="/products"
                className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-6 py-3 text-sm font-semibold text-white"
              >
                <MangaIcon name="shopping-bag" className="h-4 w-4" />
                <span>Cửa hàng</span>
              </Link>
              <Link
                to="/doc-truyen"
                className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-xl border px-6 py-3 text-sm font-semibold text-white"
              >
                <MangaIcon name="book-open-check" className="h-4 w-4" />
                <span>Đọc truyện</span>
              </Link>
              <Link
                to="/"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-slate-200 transition-all hover:bg-white/10 hover:text-white"
              >
                <MangaIcon name="home" className="h-4 w-4" />
                <span>Trang chủ</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-10 px-6 py-14">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <article className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#131722]/90 p-6 shadow-lg">
            <div>
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#E63946]/35 bg-[#E63946]/15 text-rose-300">
                <MangaIcon name="bot" className="h-5 w-5" />
              </div>
              <h2 className="font-display mb-2 text-lg font-bold text-white">Hỗ trợ trực tuyến</h2>
              <p className="mb-6 text-sm leading-relaxed text-slate-400">
                Hỗ trợ giải đáp nhanh về chính sách giao hàng, thanh toán, đổi trả và gợi ý
                bộ truyện theo thể loại ngay trong cửa sổ chat.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenChatbot}
              className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold text-white"
            >
              <MangaIcon name="message-circle" className="h-4 w-4" />
              <span>Mở hộp thoại hỗ trợ</span>
            </button>
          </article>

          <article className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#131722]/90 p-6 shadow-lg">
            <div>
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/35 bg-cyan-500/15 text-cyan-300">
                <MangaIcon name="package" className="h-5 w-5" />
              </div>
              <h2 className="font-display mb-2 text-lg font-bold text-white">
                Theo dõi Đơn hàng &amp; Hồ sơ
              </h2>
              <p className="mb-6 text-sm leading-relaxed text-slate-400">
                Kiểm tra trạng thái đơn đã đặt, giỏ hàng và danh sách truyện yêu thích trực
                tiếp trong khu vực tài khoản của bạn.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/profile/orders"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#1B2130] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:border-cyan-400/50"
              >
                <MangaIcon name="clipboard-list" className="h-4 w-4 text-cyan-300" />
                <span>Đơn hàng</span>
              </Link>
              <Link
                to="/profile"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:bg-white/10"
              >
                <MangaIcon name="user" className="h-4 w-4" />
                <span>Tài khoản</span>
              </Link>
            </div>
          </article>

          <article className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#131722]/90 p-6 shadow-lg">
            <div>
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/35 bg-amber-500/15 text-amber-300">
                <MangaIcon name="compass" className="h-5 w-5" />
              </div>
              <h2 className="font-display mb-2 text-lg font-bold text-white">Tiện ích nhanh</h2>
              <p className="mb-6 text-sm leading-relaxed text-slate-400">
                Xem thông tin giới thiệu về MangaStore hoặc mở danh sách truyện yêu thích đã
                lưu của bạn.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/about"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#1B2130] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:border-[#E63946]/50"
              >
                <MangaIcon name="info" className="h-4 w-4 text-rose-400" />
                <span>Giới thiệu</span>
              </Link>
              <Link
                to="/profile/wishlist"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:bg-white/10"
              >
                <MangaIcon name="heart" className="h-4 w-4 text-rose-400" />
                <span>Yêu thích</span>
              </Link>
            </div>
          </article>
        </div>
      </section>
    </StoreLayout>
  );
}

export default ContactPage;

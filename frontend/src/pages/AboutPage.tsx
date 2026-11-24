import { Link } from "react-router-dom";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaIcon } from "../components/ui/MangaIcon";

export function AboutPage() {
  return (
    <StoreLayout>
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0">
          <img
            src="/content/banners/hero-light-novel.png"
            alt="Giới thiệu MangaStore"
            className="h-full w-full object-cover opacity-50"
          />
          <div className="ms-manga-banner-overlay absolute inset-0" />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="max-w-3xl space-y-5">
            <h1 className="font-display text-3xl font-extrabold text-white md:text-5xl">
              Không gian mua sắm và đọc truyện tranh trực tuyến
            </h1>
            <p className="text-base leading-relaxed text-slate-300 md:text-lg">
              MangaStore là nơi bạn có thể đặt mua Manga, Light Novel và đọc truyện trực tuyến
              trên cùng một nền tảng thống nhất.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                to="/products"
                className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-6 py-3 text-sm font-semibold text-white"
              >
                <MangaIcon name="shopping-bag" className="h-4 w-4" />
                <span>Khám phá Cửa hàng</span>
              </Link>
              <Link
                to="/doc-truyen"
                className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-xl border px-6 py-3 text-sm font-semibold text-white"
              >
                <MangaIcon name="book-open-check" className="h-4 w-4" />
                <span>Mở Khu Đọc Truyện</span>
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

      <section className="mx-auto max-w-7xl space-y-12 px-6 py-14">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <article className="rounded-2xl border border-white/10 bg-[#131722]/90 p-6 shadow-lg transition-all hover:border-[#E63946]/40">
            <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#E63946]/35 bg-[#E63946]/15 text-rose-300">
              <MangaIcon name="shopping-bag" className="h-5 w-5" />
            </div>
            <h2 className="font-display mb-2 text-lg font-bold text-white">
              Cửa hàng Manga &amp; Light Novel
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              Tìm kiếm theo tên truyện hoặc thể loại, thêm vào giỏ hàng, lưu mục yêu thích và
              theo dõi đơn hàng trực tiếp trong tài khoản.
            </p>
          </article>

          <article className="rounded-2xl border border-white/10 bg-[#131722]/90 p-6 shadow-lg transition-all hover:border-cyan-400/40">
            <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/35 bg-cyan-500/15 text-cyan-300">
              <MangaIcon name="book-open-check" className="h-5 w-5" />
            </div>
            <h2 className="font-display mb-2 text-lg font-bold text-white">
              Khu Đọc Truyện Đa Nguồn
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              Đọc truyện tiếng Việt, webtoon cuộn dọc và truyện từ kho lưu trữ với danh sách
              chương rõ ràng, đồng bộ tiến độ đọc.
            </p>
          </article>

          <article className="rounded-2xl border border-white/10 bg-[#131722]/90 p-6 shadow-lg transition-all hover:border-amber-400/40">
            <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/35 bg-amber-500/15 text-amber-300">
              <MangaIcon name="sparkles" className="h-5 w-5" />
            </div>
            <h2 className="font-display mb-2 text-lg font-bold text-white">Hỗ trợ trực tuyến</h2>
            <p className="text-sm leading-relaxed text-slate-400">
              Giải đáp câu hỏi về giao hàng, thanh toán MoMo/COD, đổi trả và gợi ý tìm truyện
              ngay trên trang.
            </p>
          </article>
        </div>

        <div className="grid grid-cols-1 items-center gap-8 overflow-hidden rounded-3xl border border-white/10 bg-[#131722]/90 p-6 md:grid-cols-2 md:p-10">
          <div className="space-y-4">
            <h2 className="font-display text-2xl font-bold text-white md:text-3xl">
              Từ khám phá đầu truyện đến sở hữu ấn phẩm
            </h2>
            <p className="text-sm leading-relaxed text-slate-300 md:text-base">
              Tìm truyện cần mua hoặc đọc online ngay từ trang chủ, lưu đầu truyện yêu thích
              và quản lý toàn bộ đơn hàng tại một nơi duy nhất.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#1B2130] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:border-[#E63946]/50"
              >
                <MangaIcon name="target" className="h-4 w-4 text-rose-400" />
                <span>Trang Liên hệ</span>
              </Link>
              <Link
                to="/products"
                className="inline-flex items-center gap-2 rounded-xl border border-[#E63946]/40 bg-[#E63946]/15 px-5 py-2.5 text-sm font-semibold text-rose-200 transition-all hover:bg-[#E63946]/25"
              >
                <MangaIcon name="arrow-right" className="h-4 w-4" />
                <span>Xem danh mục truyện</span>
              </Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0B0D14]">
            <img
              src="/content/manga/auth-manga-art.png"
              alt="Minh họa MangaStore"
              className="h-64 w-full object-cover md:h-80"
              onError={(e) => {
                e.currentTarget.src = "/covers/default-manga.svg";
              }}
            />
          </div>
        </div>
      </section>
    </StoreLayout>
  );
}

export default AboutPage;

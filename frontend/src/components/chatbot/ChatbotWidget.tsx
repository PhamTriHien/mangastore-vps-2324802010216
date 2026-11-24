import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Eye,
  Package,
  RefreshCw,
  Send,
  ShoppingBag,
  Star,
  X,
  XCircle,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import type { ChatbotProductCard, ChatbotReply } from "../../types/api";

const DEFAULT_COVER_URL = "/covers/default-manga.svg";
const MAX_HISTORY_ITEMS = 20;

interface ChatMessageItem {
  id: number;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  productCards?: ChatbotProductCard[];
}

interface QuickChip {
  label: string;
  message: string;
}

const DEFAULT_CHIPS: readonly QuickChip[] = [
  {
    label: "Chính sách giao hàng",
    message: "Chính sách giao hàng của bạn là gì?",
  },
  {
    label: "Manga phổ biến",
    message: "Bạn có những bộ truyện manga nào phổ biến?",
  },
  {
    label: "Đổi trả hàng",
    message: "Làm thế nào để đổi trả hàng?",
  },
];

let _nextMessageId = 1;

function renderMessageContent(text: string) {
  const cleaned = text.replace(/^\[.*?\]\s*/, "");
  const lines = cleaned.split("\n");
  const urlPattern = /(https?:\/\/[^\s]+)/g;

  return lines.map((line, lineIdx) => {
    const parts = line.split(urlPattern);
    return (
      <Fragment key={lineIdx}>
        {parts.map((part, partIdx) => {
          if (/^https?:\/\/[^\s]+$/.test(part)) {
            return (
              <a
                key={partIdx}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-300 underline hover:text-cyan-200"
              >
                {part}
              </a>
            );
          }
          return <Fragment key={partIdx}>{part}</Fragment>;
        })}
        {lineIdx < lines.length - 1 ? <br /> : null}
      </Fragment>
    );
  });
}

function SuggestedProductCard({ card }: { card: ChatbotProductCard }) {
  const normalizedSrc = card.image_url?.trim()
    ? card.image_url.trim()
    : DEFAULT_COVER_URL;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const displaySrc =
    failedSrc === normalizedSrc ? DEFAULT_COVER_URL : normalizedSrc;

  const hasDiscount =
    card.original_price !== null && card.original_price > card.price;

  return (
    <Link
      to={`/products/${card.id}`}
      className="group flex w-[132px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1B2130] shadow-md transition-all hover:-translate-y-0.5 hover:border-[#E63946]"
    >
      <div className="relative h-20 w-full overflow-hidden bg-[#0B0D14]">
        <img
          src={displaySrc}
          alt={card.title}
          loading="lazy"
          onError={() => {
            if (displaySrc !== DEFAULT_COVER_URL) {
              setFailedSrc(normalizedSrc);
            }
          }}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {card.category ? (
          <span className="absolute right-1 top-1 max-w-[85%] truncate rounded bg-[#E63946]/90 px-1.5 py-0.5 text-[9px] font-semibold text-white">
            {card.category}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col justify-between gap-1 p-2">
        <div>
          <h4 className="line-clamp-2 text-[11px] font-semibold leading-tight text-[#F5F6FA]">
            {card.title}
          </h4>

          <div className="mt-1 flex flex-wrap items-baseline gap-1">
            {hasDiscount && card.original_price !== null ? (
              <span className="text-[9px] text-slate-400 line-through">
                {formatCurrency(card.original_price)}
              </span>
            ) : null}
            <span className="text-[11px] font-bold text-[#F59E0B]">
              {formatCurrency(card.price)}
            </span>
          </div>

          <div
            className={`mt-1 flex items-center gap-1 text-[10px] font-medium ${
              card.is_available ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {card.is_available ? (
              <>
                <Package className="h-3 w-3 shrink-0" />
                <span>Còn hàng</span>
              </>
            ) : (
              <>
                <XCircle className="h-3 w-3 shrink-0" />
                <span>Hết hàng</span>
              </>
            )}
          </div>

          {card.rating > 0 ? (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-amber-400">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              <span>{card.rating.toFixed(1)}/5</span>
            </div>
          ) : null}
        </div>

        <span className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded-md bg-gradient-to-r from-[#E63946] to-[#BE123C] px-2 py-1 text-[10px] font-semibold text-white">
          <Eye className="h-3 w-3" />
          <span>Xem chi tiết</span>
        </span>
      </div>
    </Link>
  );
}

export function ChatbotWidget() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: _nextMessageId++,
      role: "assistant",
      content:
        "Xin chào! Bạn cần hỗ trợ về đơn hàng, giao nhận hay tìm truyện?",
    },
  ]);
  const [chips, setChips] = useState<readonly QuickChip[]>(DEFAULT_CHIPS);

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openChat = useCallback(() => {
    setIsOpen(true);
    setHasUnread(false);
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) setHasUnread(false);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleOpenEvent = () => {
      openChat();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        toggleChat();
      } else if (event.key === "Escape" && isOpen) {
        closeChat();
      }
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        isOpen &&
        widgetRef.current &&
        !widgetRef.current.contains(event.target as Node)
      ) {
        closeChat();
      }
    };

    window.addEventListener("ms:open-chatbot", handleOpenEvent);
    document.addEventListener("ms:open-chatbot", handleOpenEvent);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("click", handleDocumentClick);

    return () => {
      window.removeEventListener("ms:open-chatbot", handleOpenEvent);
      document.removeEventListener("ms:open-chatbot", handleOpenEvent);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [closeChat, isOpen, openChat, toggleChat]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 160);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, isSending, isOpen]);

  const sendMessage = async (rawText?: string) => {
    const message = (rawText ?? inputValue).trim();
    if (!message || isSending) return;

    if (!rawText) {
      setInputValue("");
    }

    const historyPayload = messages
      .filter((m) => !m.isError)
      .slice(-MAX_HISTORY_ITEMS)
      .map((m) => ({ role: m.role, content: m.content }));

    const userMessage: ChatMessageItem = {
      id: _nextMessageId++,
      role: "user",
      content: message,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsSending(true);

    try {
      const reply = await apiClient.post<ChatbotReply>("/api/chatbot/message", {
        message,
        visitor_name: user?.username ?? null,
        conversation_history: historyPayload,
      });

      const assistantMessage: ChatMessageItem = {
        id: _nextMessageId++,
        role: "assistant",
        content:
          reply.text?.trim() ||
          "Xin lỗi, hiện chưa thể tạo phản hồi. Vui lòng thử lại sau.",
        productCards:
          Array.isArray(reply.product_cards) && reply.product_cards.length > 0
            ? reply.product_cards
            : undefined,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (
        Array.isArray(reply.suggested_questions) &&
        reply.suggested_questions.length > 0
      ) {
        setChips(
          reply.suggested_questions.slice(0, 3).map((q) => ({
            label: q,
            message: q,
          }))
        );
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: _nextMessageId++,
          role: "assistant",
          content: "Xin lỗi, có lỗi xảy ra. Vui lòng thử lại sau.",
          isError: true,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage();
  };

  const chipIcons = [
    <Package key="pkg" className="h-3.5 w-3.5 shrink-0 text-rose-400" />,
    <BookOpen key="book" className="h-3.5 w-3.5 shrink-0 text-rose-400" />,
    <RefreshCw key="ret" className="h-3.5 w-3.5 shrink-0 text-rose-400" />,
  ];

  return (
    <div ref={widgetRef} className="fixed bottom-5 right-5 z-[999]">
      <div
        role="dialog"
        aria-label="Hỗ trợ MangaStore"
        aria-hidden={!isOpen}
        className={`absolute bottom-20 right-0 flex h-[520px] max-h-[calc(100vh-112px)] w-[340px] max-w-[calc(100vw-24px)] origin-bottom-right flex-col overflow-hidden rounded-[20px] border border-white/15 bg-[#131722] text-[#F5F6FA] shadow-[0_24px_60px_rgba(0,0,0,0.65)] transition-all duration-300 ${
          isOpen
            ? "visible translate-y-0 scale-100 opacity-100"
            : "pointer-events-none invisible translate-y-4 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between gap-2.5 border-b border-white/10 bg-gradient-to-br from-[#E63946] to-[#BE123C] px-4 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/25 bg-[#0B0D14]/30">
              <img
                src="/content/icons/spots/spot-assistant.svg"
                alt="Hỗ trợ MangaStore"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold leading-tight text-white">
                Hỗ trợ MangaStore
              </h3>
              <span className="inline-flex items-center gap-1.5 text-xs text-rose-100">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.85)]"
                />
                <span>Trực tuyến</span>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={closeChat}
            tabIndex={isOpen ? 0 : -1}
            aria-label="Đóng cửa sổ hỗ trợ"
            className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={messagesContainerRef}
          className="flex-1 space-y-2.5 overflow-y-auto bg-[#0B0D14] p-3"
        >
          {messages.map((msg) => (
            <div key={msg.id} className="space-y-2">
              <div
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2.5 text-[13px] leading-relaxed shadow-md ${
                    msg.role === "user"
                      ? "rounded-br-md border border-white/15 bg-gradient-to-br from-[#E63946] to-[#BE123C] text-white"
                      : msg.isError
                        ? "rounded-bl-md border border-[#E63946]/45 border-l-4 border-l-[#E63946] bg-[#E63946]/15 text-rose-200"
                        : "rounded-bl-md border border-white/10 bg-[#1B2130] text-[#F5F6FA]"
                  }`}
                >
                  {renderMessageContent(msg.content)}
                </div>
              </div>

              {msg.productCards && msg.productCards.length > 0 ? (
                <div className="rounded-xl border border-white/10 bg-[#131722] p-2.5">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#F5F6FA]">
                    <ShoppingBag className="h-3.5 w-3.5 text-rose-400" />
                    <span>Sản phẩm gợi ý cho bạn</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {msg.productCards.map((card) => (
                      <SuggestedProductCard key={card.id} card={card} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          {isSending ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/10 bg-[#1B2130] px-3.5 py-2.5 text-xs text-[#A3AEC2]">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#E63946]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#E63946] [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#E63946] [animation-delay:300ms]" />
                </span>
                <span>Đang trả lời...</span>
              </div>
            </div>
          ) : null}
        </div>

        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 border-t border-white/10 bg-[#131722] px-3 py-2.5">
            {chips.slice(0, 3).map((chip, idx) => (
              <button
                key={`${chip.message}-${idx}`}
                type="button"
                tabIndex={isOpen ? 0 : -1}
                disabled={isSending}
                onClick={() => void sendMessage(chip.message)}
                className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-[#E63946]/35 bg-[#1B2130] px-2.5 py-1 text-[11px] text-[#F5F6FA] transition-all hover:-translate-y-0.5 hover:border-[#E63946]/70 hover:bg-[#E63946]/20 disabled:opacity-50"
              >
                {chipIcons[idx % chipIcons.length]}
                <span className="truncate">{chip.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="border-t border-white/10 bg-[#131722] px-3 py-2.5"
        >
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              tabIndex={isOpen ? 0 : -1}
              maxLength={500}
              placeholder="Nhập tin nhắn..."
              aria-label="Nhập tin nhắn hỗ trợ"
              className="flex-1 rounded-full border border-white/15 bg-[#1B2130] px-3.5 py-2 text-[13px] text-[#F5F6FA] placeholder-[#A3AEC2] transition-all focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/30"
            />
            <button
              type="submit"
              tabIndex={isOpen ? 0 : -1}
              disabled={isSending || !inputValue.trim()}
              aria-label="Gửi tin nhắn"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E63946] to-[#BE123C] text-white shadow transition-all hover:scale-105 hover:from-[#FF4D5A] hover:to-[#E63946] disabled:pointer-events-none disabled:opacity-45"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>

      <button
        type="button"
        onClick={toggleChat}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Đóng hỗ trợ MangaStore" : "Mở hỗ trợ MangaStore"}
        style={{
          background:
            "radial-gradient(circle at 32% 28%, #2B344B 0%, #161C2C 54%, #0B0D14 100%)",
          boxShadow:
            "inset 0 2px 4px rgba(255,255,255,0.24), inset 0 -8px 14px rgba(0,0,0,0.55), 0 6px 0 rgba(76,5,25,0.85), 0 14px 32px rgba(230,57,70,0.36)",
        }}
        className="chatbot-orb-float relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#E63946]/80 transition-transform duration-200 hover:scale-105 active:translate-y-0.5"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 right-2.5 top-1 h-5 rounded-full bg-gradient-to-b from-white/30 to-transparent"
        />

        {!isOpen ? (
          <span
            aria-hidden="true"
            className="chatbot-radar-ring pointer-events-none absolute -inset-1.5 rounded-full border-2 border-[#E63946]/45"
          />
        ) : null}

        {isOpen ? (
          <X className="relative z-10 h-6 w-6 text-[#F5F6FA]" />
        ) : (
          <img
            src="/content/icons/spots/spot-assistant.svg"
            alt="Hỗ trợ MangaStore"
            className="relative z-10 h-12 w-12 rounded-full object-cover"
          />
        )}

        {!isOpen && hasUnread ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 z-20 h-4 w-4 rounded-full border-2 border-[#0B0D14] bg-[#E63946]"
          />
        ) : null}
      </button>
    </div>
  );
}

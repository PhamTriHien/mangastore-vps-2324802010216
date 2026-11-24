import type { ReactNode } from "react";
import { ChatbotWidget } from "../chatbot/ChatbotWidget";
import { ToastContainer } from "../ui/ToastContainer";
import { Footer } from "./Footer";
import { Header } from "./Header";

export interface StoreLayoutProps {
  children: ReactNode;
}

export function StoreLayout({ children }: StoreLayoutProps) {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="min-h-[calc(100vh-160px)]">{children}</main>
      <Footer />
      <ChatbotWidget />
      <ToastContainer />
    </div>
  );
}

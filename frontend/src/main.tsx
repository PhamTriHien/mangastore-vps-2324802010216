import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { AuthProvider } from "./contexts/AuthContext";
import { CartWishlistProvider } from "./contexts/CartWishlistContext";
import { ToastProvider } from "./contexts/ToastContext";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <CartWishlistProvider>
            <App />
          </CartWishlistProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);

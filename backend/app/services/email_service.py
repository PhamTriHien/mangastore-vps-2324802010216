from email.message import EmailMessage
from html import escape
import logging
import smtplib
from typing import Iterable

from app.config import get_settings

logger = logging.getLogger(__name__)


def _send_html_email(to_email: str, subject: str, html_body: str) -> bool:
    settings = get_settings()
    if not settings.smtp_email or not settings.smtp_password or not to_email:
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"MangaStore <{settings.smtp_email}>"
    msg["To"] = to_email
    msg.set_content("Vui lòng xem email bằng trình đọc hỗ trợ HTML.")
    msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(settings.smtp_email, settings.smtp_password)
            server.send_message(msg)
        return True
    except Exception as exc:
        logger.warning("Failed sending email to %s: %s", to_email, exc)
        return False


def send_verification_code(to_email: str, otp_code: str) -> bool:
    subject = "[MangaStore] Mã xác nhận đặt lại mật khẩu"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0b0d14;color:#f5f6fa;border-radius:12px;">
      <h2 style="color:#e63946;margin:0 0 12px;">MangaStore — Khôi phục mật khẩu</h2>
      <p>Bạn vừa yêu cầu đặt lại mật khẩu tài khoản MangaStore. Mã xác nhận 6 chữ số của bạn là:</p>
      <div style="font-size:28px;font-weight:bold;letter-spacing:6px;text-align:center;padding:16px;background:#131722;border:1px solid #e63946;border-radius:8px;margin:16px 0;color:#ffffff;">
        {escape(otp_code)}
      </div>
      <p style="color:#a3aec2;font-size:13px;">Mã có hiệu lực trong 10 phút. Nếu không phải bạn thực hiện, vui lòng bỏ qua email này.</p>
    </div>
    """
    return _send_html_email(to_email, subject, html)


def send_order_confirmation_email(
    to_email: str,
    customer_name: str,
    order_code: str,
    items: Iterable[dict[str, object]],
    sub_total: float,
    discount: float,
    shipping_fee: float,
    grand_total: float,
    payment_method: str,
) -> bool:
    if not to_email:
        return False
    rows_html = "".join(
        f"<tr><td style='padding:6px 8px;border-bottom:1px solid #262c3d;'>{escape(str(item['product_name']))}</td>"
        f"<td style='padding:6px 8px;border-bottom:1px solid #262c3d;text-align:center;'>{int(str(item['quantity']))}</td>"
        f"<td style='padding:6px 8px;border-bottom:1px solid #262c3d;text-align:right;'>{float(str(item['subtotal'])):,.0f}đ</td></tr>"
        for item in items
    )
    method_label = "Thanh toán khi nhận hàng (COD)" if payment_method == "cod" else "Ví điện tử MoMo"
    subject = f"[MangaStore] Xác nhận đơn hàng #{order_code}"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#0b0d14;color:#f5f6fa;border-radius:12px;">
      <h2 style="color:#e63946;margin:0 0 8px;">Cảm ơn {escape(customer_name)} đã đặt hàng!</h2>
      <p style="margin:0 0 14px;">Mã đơn hàng: <strong>{escape(order_code)}</strong> — Hình thức: <strong>{escape(method_label)}</strong></p>
      <table style="width:100%;border-collapse:collapse;background:#131722;font-size:14px;">
        <thead><tr><th style="text-align:left;padding:8px;">Sản phẩm</th><th style="padding:8px;">SL</th><th style="text-align:right;padding:8px;">Thành tiền</th></tr></thead>
        <tbody>{rows_html}</tbody>
      </table>
      <p style="margin-top:14px;">Tạm tính: {sub_total:,.0f}đ | Giảm giá: -{discount:,.0f}đ | Phí ship: {shipping_fee:,.0f}đ</p>
      <p style="font-size:18px;color:#f59e0b;"><strong>Tổng thanh toán: {grand_total:,.0f}đ</strong></p>
    </div>
    """
    return _send_html_email(to_email, subject, html)


def send_order_status_update_email(
    to_email: str,
    customer_name: str,
    order_code: str,
    new_status_label: str,
) -> bool:
    if not to_email:
        return False
    subject = f"[MangaStore] Cập nhật trạng thái đơn hàng #{order_code}"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0b0d14;color:#f5f6fa;border-radius:12px;">
      <h2 style="color:#22d3ee;margin:0 0 12px;">Cập nhật đơn hàng #{escape(order_code)}</h2>
      <p>Xin chào {escape(customer_name)},</p>
      <p>Đơn hàng <strong>#{escape(order_code)}</strong> của bạn vừa được cập nhật sang trạng thái: <strong>{escape(new_status_label)}</strong>.</p>
    </div>
    """
    return _send_html_email(to_email, subject, html)

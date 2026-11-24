from collections.abc import Mapping
import hashlib
import hmac
import logging
from typing import Any
import uuid

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_MOMO_TIMEOUT_SECONDS = 15.0


def compute_hmac_sha256(raw_signature: str, secret_key: str) -> str:
    return hmac.new(
        secret_key.encode("utf-8"),
        raw_signature.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _missing_config_message(require_query: bool = False) -> str | None:
    settings = get_settings()
    if not settings.momo_partner_code.strip():
        return "MOMO_PARTNER_CODE chưa được cấu hình."
    if not settings.momo_access_key.strip() or not settings.momo_secret_key.strip():
        return "Cổng thanh toán MoMo chưa được cấu hình khóa kết nối (MOMO_ACCESS_KEY / MOMO_SECRET_KEY)."
    endpoint = settings.momo_query_endpoint if require_query else settings.momo_endpoint
    if not endpoint.strip():
        return "Endpoint cổng thanh toán MoMo chưa được cấu hình."
    return None


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def create_payment(
    order_id: str,
    amount: int,
    order_info: str,
    redirect_url: str,
    ipn_url: str,
    extra_data: str = "",
    request_id: str | None = None,
) -> dict[str, Any]:
    clean_order_id = (order_id or "").strip()
    req_id = (request_id or "").strip() or str(uuid.uuid4())
    amount_int = _coerce_int(amount, 0)

    if not clean_order_id:
        return {
            "success": False,
            "result_code": -1,
            "message": "Mã đơn hàng MoMo không hợp lệ.",
            "order_id": "",
            "request_id": req_id,
            "amount": amount_int,
            "pay_url": "",
            "qr_code_url": "",
            "deeplink": "",
        }

    if amount_int <= 0:
        return {
            "success": False,
            "result_code": -1,
            "message": "Số tiền thanh toán MoMo phải lớn hơn 0.",
            "order_id": clean_order_id,
            "request_id": req_id,
            "amount": amount_int,
            "pay_url": "",
            "qr_code_url": "",
            "deeplink": "",
        }

    config_error = _missing_config_message(require_query=False)
    if config_error:
        return {
            "success": False,
            "result_code": -1,
            "message": config_error,
            "order_id": clean_order_id,
            "request_id": req_id,
            "amount": amount_int,
            "pay_url": "",
            "qr_code_url": "",
            "deeplink": "",
        }

    settings = get_settings()
    partner_code = settings.momo_partner_code.strip()
    access_key = settings.momo_access_key.strip()
    secret_key = settings.momo_secret_key.strip()
    endpoint = settings.momo_endpoint.strip()

    clean_info = (order_info or f"Thanh toán đơn hàng #{clean_order_id}").strip()
    clean_redirect = (redirect_url or "").strip()
    clean_ipn = (ipn_url or "").strip()
    clean_extra = extra_data or ""
    request_type = "captureWallet"

    raw_signature = (
        f"accessKey={access_key}"
        f"&amount={amount_int}"
        f"&extraData={clean_extra}"
        f"&ipnUrl={clean_ipn}"
        f"&orderId={clean_order_id}"
        f"&orderInfo={clean_info}"
        f"&partnerCode={partner_code}"
        f"&redirectUrl={clean_redirect}"
        f"&requestId={req_id}"
        f"&requestType={request_type}"
    )
    signature = compute_hmac_sha256(raw_signature, secret_key)

    body = {
        "partnerCode": partner_code,
        "partnerName": "MangaStore",
        "storeId": "MangaStore",
        "requestId": req_id,
        "amount": amount_int,
        "orderId": clean_order_id,
        "orderInfo": clean_info,
        "redirectUrl": clean_redirect,
        "ipnUrl": clean_ipn,
        "lang": "vi",
        "extraData": clean_extra,
        "requestType": request_type,
        "signature": signature,
    }

    try:
        with httpx.Client(timeout=_MOMO_TIMEOUT_SECONDS) as client:
            response = client.post(endpoint, json=body)
    except httpx.HTTPError as exc:
        logger.warning("MoMo create_payment network error for %s: %s", clean_order_id, exc)
        return {
            "success": False,
            "result_code": -1,
            "message": "Không thể kết nối cổng thanh toán MoMo lúc này. Vui lòng thử lại.",
            "order_id": clean_order_id,
            "request_id": req_id,
            "amount": amount_int,
            "pay_url": "",
            "qr_code_url": "",
            "deeplink": "",
        }

    try:
        data = response.json()
    except ValueError:
        logger.warning(
            "MoMo create_payment non-JSON response (%s) for %s",
            response.status_code,
            clean_order_id,
        )
        return {
            "success": False,
            "result_code": -1,
            "message": "Phản hồi từ cổng thanh toán MoMo không hợp lệ.",
            "order_id": clean_order_id,
            "request_id": req_id,
            "amount": amount_int,
            "pay_url": "",
            "qr_code_url": "",
            "deeplink": "",
        }

    if not response.is_success or not isinstance(data, dict):
        gateway_msg = data.get("message") if isinstance(data, dict) else ""
        logger.warning(
            "MoMo create_payment HTTP %s for %s: %s",
            response.status_code,
            clean_order_id,
            gateway_msg or response.text[:300],
        )
        return {
            "success": False,
            "result_code": _coerce_int(data.get("resultCode"), -1) if isinstance(data, dict) else -1,
            "message": str(gateway_msg or "Cổng thanh toán MoMo từ chối yêu cầu."),
            "order_id": clean_order_id,
            "request_id": req_id,
            "amount": amount_int,
            "pay_url": "",
            "qr_code_url": "",
            "deeplink": "",
            "raw": data if isinstance(data, dict) else None,
        }

    result_code = _coerce_int(data.get("resultCode"), -1)
    pay_url = str(data.get("payUrl") or "").strip()
    qr_code_url = str(data.get("qrCodeUrl") or "").strip()
    deeplink = str(data.get("deeplink") or "").strip()
    is_success = result_code == 0 and bool(pay_url)

    return {
        "success": is_success,
        "result_code": result_code,
        "message": str(data.get("message") or ""),
        "partner_code": str(data.get("partnerCode") or partner_code),
        "order_id": str(data.get("orderId") or clean_order_id),
        "request_id": str(data.get("requestId") or req_id),
        "amount": _coerce_int(data.get("amount"), amount_int),
        "response_time": _coerce_int(data.get("responseTime"), 0),
        "pay_url": pay_url,
        "qr_code_url": qr_code_url,
        "deeplink": deeplink,
        "raw": data,
    }


def query_transaction(order_id: str, request_id: str | None = None) -> dict[str, Any]:
    clean_order_id = (order_id or "").strip()
    req_id = (request_id or "").strip() or str(uuid.uuid4())

    if not clean_order_id:
        return {
            "success": False,
            "is_paid": False,
            "is_pending": False,
            "result_code": -1,
            "message": "Mã đơn hàng không hợp lệ.",
            "order_id": "",
            "request_id": req_id,
            "amount": 0,
            "trans_id": 0,
        }

    config_error = _missing_config_message(require_query=True)
    if config_error:
        return {
            "success": False,
            "is_paid": False,
            "is_pending": False,
            "result_code": -1,
            "message": config_error,
            "order_id": clean_order_id,
            "request_id": req_id,
            "amount": 0,
            "trans_id": 0,
        }

    settings = get_settings()
    partner_code = settings.momo_partner_code.strip()
    access_key = settings.momo_access_key.strip()
    secret_key = settings.momo_secret_key.strip()
    endpoint = settings.momo_query_endpoint.strip()

    raw_signature = (
        f"accessKey={access_key}"
        f"&orderId={clean_order_id}"
        f"&partnerCode={partner_code}"
        f"&requestId={req_id}"
    )
    signature = compute_hmac_sha256(raw_signature, secret_key)

    body = {
        "partnerCode": partner_code,
        "requestId": req_id,
        "orderId": clean_order_id,
        "signature": signature,
        "lang": "vi",
    }

    try:
        with httpx.Client(timeout=_MOMO_TIMEOUT_SECONDS) as client:
            response = client.post(endpoint, json=body)
    except httpx.HTTPError as exc:
        logger.warning("MoMo query_transaction network error for %s: %s", clean_order_id, exc)
        return {
            "success": False,
            "is_paid": False,
            "is_pending": False,
            "result_code": -1,
            "message": "Không thể kiểm tra trạng thái giao dịch MoMo lúc này.",
            "order_id": clean_order_id,
            "request_id": req_id,
            "amount": 0,
            "trans_id": 0,
        }

    try:
        data = response.json()
    except ValueError:
        logger.warning(
            "MoMo query_transaction non-JSON response (%s) for %s",
            response.status_code,
            clean_order_id,
        )
        return {
            "success": False,
            "is_paid": False,
            "is_pending": False,
            "result_code": -1,
            "message": "Phản hồi kiểm tra giao dịch MoMo không hợp lệ.",
            "order_id": clean_order_id,
            "request_id": req_id,
            "amount": 0,
            "trans_id": 0,
        }

    if not response.is_success or not isinstance(data, dict):
        gateway_msg = data.get("message") if isinstance(data, dict) else ""
        return {
            "success": False,
            "is_paid": False,
            "is_pending": False,
            "result_code": _coerce_int(data.get("resultCode"), -1) if isinstance(data, dict) else -1,
            "message": str(gateway_msg or "Không thể kiểm tra trạng thái giao dịch MoMo."),
            "order_id": clean_order_id,
            "request_id": req_id,
            "amount": 0,
            "trans_id": 0,
            "raw": data if isinstance(data, dict) else None,
        }

    result_code = _coerce_int(data.get("resultCode"), -1)
    return {
        "success": True,
        "is_paid": result_code == 0,
        "is_pending": result_code == 1000,
        "result_code": result_code,
        "message": str(data.get("message") or ""),
        "partner_code": str(data.get("partnerCode") or partner_code),
        "order_id": str(data.get("orderId") or clean_order_id),
        "request_id": str(data.get("requestId") or req_id),
        "extra_data": str(data.get("extraData") or ""),
        "amount": _coerce_int(data.get("amount"), 0),
        "trans_id": _coerce_int(data.get("transId"), 0),
        "pay_type": str(data.get("payType") or ""),
        "response_time": _coerce_int(data.get("responseTime"), 0),
        "raw": data,
    }


def verify_signature(payload: Mapping[str, Any]) -> bool:
    if not isinstance(payload, Mapping):
        return False

    settings = get_settings()
    access_key = settings.momo_access_key.strip()
    secret_key = settings.momo_secret_key.strip()
    if not access_key or not secret_key:
        return False

    provided_sig = str(payload.get("signature") or "").strip().lower()
    if not provided_sig:
        return False

    raw_signature = (
        f"accessKey={access_key}"
        f"&amount={payload.get('amount', 0)}"
        f"&extraData={payload.get('extraData') or ''}"
        f"&message={payload.get('message') or ''}"
        f"&orderId={payload.get('orderId') or ''}"
        f"&orderInfo={payload.get('orderInfo') or ''}"
        f"&orderType={payload.get('orderType') or ''}"
        f"&partnerCode={payload.get('partnerCode') or ''}"
        f"&payType={payload.get('payType') or ''}"
        f"&requestId={payload.get('requestId') or ''}"
        f"&responseTime={payload.get('responseTime', 0)}"
        f"&resultCode={payload.get('resultCode', -1)}"
        f"&transId={payload.get('transId', 0)}"
    )
    expected_signature = compute_hmac_sha256(raw_signature, secret_key)
    return hmac.compare_digest(expected_signature, provided_sig)

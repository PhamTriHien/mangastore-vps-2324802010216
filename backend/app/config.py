from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any
import json

from pydantic import ValidationInfo, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ROOT_DIR = _BACKEND_DIR.parent


class Settings(BaseSettings):
    app_env: str = "production"
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    database_url: str = ""
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost",
        "http://localhost:5173",
    ]
    upload_dir: str = str(_ROOT_DIR / "uploads")
    app_base_url: str = "http://localhost"

    # Optional external integrations configured via environment variables
    groq_api_key: str = ""
    groq_model: str = "llama-3.1-8b-instant"

    momo_endpoint: str = "https://test-payment.momo.vn/v2/gateway/api/create"
    momo_query_endpoint: str = "https://test-payment.momo.vn/v2/gateway/api/query"
    momo_partner_code: str = "MOMO"
    momo_access_key: str = ""
    momo_secret_key: str = ""

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_email: str = ""
    smtp_password: str = ""

    recaptcha_site_key: str = ""
    recaptcha_secret_key: str = ""

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""

    model_config = SettingsConfigDict(
        env_file=(_ROOT_DIR / ".env", _BACKEND_DIR / ".env", ".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator("database_url", "jwt_secret")
    @classmethod
    def _validate_required_secret(cls, value: str, info: ValidationInfo) -> str:
        cleaned = value.strip()
        if not cleaned:
            field_label = (info.field_name or "setting").upper()
            raise ValueError(f"{field_label} environment variable is required")
        return cleaned

    @field_validator("jwt_expire_minutes")
    @classmethod
    def _validate_jwt_expire_minutes(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("JWT_EXPIRE_MINUTES must be positive")
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                parsed = json.loads(stripped)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            return [origin.strip() for origin in stripped.split(",") if origin.strip()]
        if isinstance(value, (list, tuple)):
            return [str(item).strip() for item in value if str(item).strip()]
        raise ValueError("CORS_ORIGINS must be a comma-separated string or list of origins")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def ensure_upload_dirs() -> Path:
    root = Path(get_settings().upload_dir)
    (root / "avatars").mkdir(parents=True, exist_ok=True)
    (root / "covers").mkdir(parents=True, exist_ok=True)
    return root

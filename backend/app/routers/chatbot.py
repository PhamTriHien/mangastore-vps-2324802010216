from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.security import require_staff
from app.services.chatbot_service import DEFAULT_GROQ_MODEL, generate_chatbot_reply

router = APIRouter(prefix="/api/chatbot", tags=["chatbot"])


class ChatbotMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    visitor_name: str | None = Field(default=None, max_length=120)
    conversation_history: list[dict[str, Any]] | None = None


@router.post("/message")
async def send_chatbot_message(
    payload: ChatbotMessageRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cleaned_message = payload.message.strip()
    if not cleaned_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tin nhắn không hợp lệ.",
        )

    return await generate_chatbot_reply(
        db=db,
        message=cleaned_message,
        visitor_name=payload.visitor_name,
        conversation_history=payload.conversation_history,
    )


@router.get("/status")
def get_chatbot_status(_staff: User = Depends(require_staff)) -> dict[str, Any]:
    settings = get_settings()
    has_api_key = bool(settings.groq_api_key and settings.groq_api_key.strip())
    model = (settings.groq_model or DEFAULT_GROQ_MODEL).strip() or DEFAULT_GROQ_MODEL
    return {
        "provider": "Groq",
        "has_api_key": has_api_key,
        "model": model,
        "is_configured": has_api_key,
        "status": "configured" if has_api_key else "not_configured",
    }

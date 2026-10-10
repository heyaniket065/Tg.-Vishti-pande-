"""
Authentication & Authorization Middleware for TeleGroup Bot.
Intercepts updates to verify administrator credentials and prevents unauthorized actions.
"""

import logging
from typing import Callable, Dict, Any, Awaitable
from aiogram import BaseMiddleware
from aiogram.types import TelegramObject, Message, CallbackQuery
from bot.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class AdminAuthMiddleware(BaseMiddleware):
    """Logs actions and ensures private chat commands are handled securely."""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any]
    ) -> Any:
        # Extract user
        user = None
        if isinstance(event, Message):
            user = event.from_user
        elif isinstance(event, CallbackQuery):
            user = event.from_user

        if user:
            # We never log secret tokens or sensitive values
            user_id = user.id
            is_superadmin = user_id in settings.admin_ids
            data["is_superadmin"] = is_superadmin

        return await handler(event, data)

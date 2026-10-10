"""
Anti-Spam & Safety Engine for TeleGroup Bot.
Detects:
- Message Flooding (sliding time window)
- Duplicate / Repeated Messages
- External Links (http://, https://, t.me)
- Blocked Words & Phrases
Applies configured actions (delete, warn, mute) and exempts administrators.
"""

from collections import defaultdict
from datetime import datetime, timedelta
import re
import time
from typing import Dict, List, Tuple

from aiogram import Router, F, Bot
from aiogram.types import Message
from sqlalchemy import select

from bot.database.database import async_session
from bot.database.models import Group, UserWarning
from bot.handlers.moderation import is_user_admin

router = Router(name="antispam")

# Tracking structures: (chat_id, user_id) -> list of timestamps
_USER_MESSAGE_TIMES: Dict[Tuple[int, int], List[float]] = defaultdict(list)
# Tracking structures: (chat_id, user_id) -> list of recent message texts
_USER_RECENT_TEXTS: Dict[Tuple[int, int], List[str]] = defaultdict(list)

URL_REGEX = re.compile(r"https?://\S+|t\.me/\S+|telegram\.me/\S+", re.IGNORECASE)


@router.message(F.chat.type.in_({"group", "supergroup"}))
async def check_antispam_rules(message: Message, bot: Bot):
    """Message inspection pipeline for group messages."""
    user = message.from_user
    if not user or user.is_bot:
        return

    chat_id = message.chat.id
    user_id = user.id

    # 1. Check if user is administrator (admins are exempt)
    if await is_user_admin(bot, chat_id, user_id):
        return

    text = message.text or message.caption or ""
    now = time.time()
    key = (chat_id, user_id)

    async with async_session() as session:
        group_stmt = select(Group).where(Group.tg_chat_id == chat_id)
        group = (await session.execute(group_stmt)).scalar_one_or_none()
        if not group:
            return

        # --- A. Flood Control Check ---
        # Window: 5 seconds
        timestamps = _USER_MESSAGE_TIMES[key]
        timestamps.append(now)
        # Keep only timestamps in last 5 seconds
        _USER_MESSAGE_TIMES[key] = [t for t in timestamps if now - t <= 5.0]

        if len(_USER_MESSAGE_TIMES[key]) > group.flood_limit:
            try:
                await message.delete()
                warning_notice = await message.answer(
                    f"⚠️ `{user.first_name}`, stop spamming! Flood limit is {group.flood_limit} messages per 5s.",
                    parse_mode="Markdown"
                )
                # Reset counter to give breathing room
                _USER_MESSAGE_TIMES[key] = []
            except Exception:
                pass
            return

        # --- B. Repeated Message Detection ---
        if text:
            recent_texts = _USER_RECENT_TEXTS[key]
            recent_texts.append(text)
            if len(recent_texts) > 5:
                recent_texts.pop(0)

            # Check if current text matches last N texts
            if recent_texts.count(text) >= group.repeat_limit:
                try:
                    await message.delete()
                    await message.answer(
                        f"⚠️ `{user.first_name}`, repeated messages are prohibited in this group.",
                        parse_mode="Markdown"
                    )
                    _USER_RECENT_TEXTS[key] = []
                except Exception:
                    pass
                return

        # --- C. Link Filtering Check ---
        if group.block_links and text:
            if URL_REGEX.search(text):
                try:
                    await message.delete()
                    await message.answer(
                        f"🛡️ External links are disallowed in this group, `{user.first_name}`.",
                        parse_mode="Markdown"
                    )
                except Exception:
                    pass
                return

        # --- D. Blocked Word Filter Check ---
        if group.blocked_words and text:
            words = [w.strip().lower() for w in group.blocked_words.split(",") if w.strip()]
            lowered_text = text.lower()
            for word in words:
                if word in lowered_text:
                    try:
                        await message.delete()
                        await message.answer(
                            f"🚫 Message deleted: containing blocked phrase.",
                            parse_mode="Markdown"
                        )
                    except Exception:
                        pass
                    return

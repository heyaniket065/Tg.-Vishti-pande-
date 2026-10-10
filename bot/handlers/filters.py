"""
Auto-Replies & Keyword Filters for TeleGroup Bot.
Rule-based keyword matchers (exact or substring).
Admins can manage, enable, disable, and remove filters from private chat.
"""

from typing import List
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from sqlalchemy import select, and_

from bot.database.database import async_session
from bot.database.models import Group, FilterRule

router = Router(name="filters")


@router.message(F.chat.type.in_({"group", "supergroup"}))
async def handle_keyword_filters(message: Message):
    """Scan group messages for rule-based filter matches."""
    text = message.text or message.caption
    if not text:
        return

    chat_id = message.chat.id
    lowered = text.lower().strip()

    async with async_session() as session:
        # Fetch group
        g = (await session.execute(select(Group).where(Group.tg_chat_id == chat_id))).scalar_one_or_none()
        if not g:
            return

        # Fetch active filter rules for this group
        rules_stmt = select(FilterRule).where(
            and_(FilterRule.group_id == g.id, FilterRule.is_enabled == True)
        )
        rules = (await session.execute(rules_stmt)).scalars().all()

        for rule in rules:
            keyword = rule.keyword.lower().strip()
            matched = False

            if rule.match_type == "exact":
                matched = (lowered == keyword)
            else:  # contains
                matched = (keyword in lowered)

            if matched:
                try:
                    await message.reply(rule.reply_text, parse_mode="Markdown")
                except Exception:
                    await message.reply(rule.reply_text)
                return  # Fire one rule per message


# Fast group rules command
@router.message(Command("rules"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_rules(message: Message):
    """Display rules configured for this group."""
    async with async_session() as session:
        g = (await session.execute(select(Group).where(Group.tg_chat_id == message.chat.id))).scalar_one_or_none()
        rules_text = g.rules_text if (g and g.rules_text) else "No specific rules set for this group yet."
        title = g.title if g else "Group"

    await message.reply(
        f"📜 **Rules for {title}:**\n\n{rules_text}",
        parse_mode="Markdown"
    )

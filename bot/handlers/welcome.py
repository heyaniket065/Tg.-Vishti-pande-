"""
Welcome and Goodbye System for TeleGroup Bot.
Handles member joins and departures, dynamic text formatting, inline URL buttons,
and automatic message deletion with configurable delays (10s, 30s, 60s, 120s, 300s).
"""

import asyncio
import json
import logging
from typing import Optional, List, Dict, Any

from aiogram import Router, F, Bot
from aiogram.filters import ChatMemberUpdatedFilter, MEMBER, JOIN_TRANSITION, LEAVE_TRANSITION
from aiogram.types import (
    ChatMemberUpdated,
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton
)
from sqlalchemy import select

from bot.database.database import async_session
from bot.database.models import Group, WelcomeConfig, GoodbyeConfig
from bot.keyboards.inline import get_welcome_editor_keyboard, get_delete_timer_selector_keyboard

logger = logging.getLogger(__name__)
router = Router(name="welcome_system")


def render_template(template: str, user, chat) -> str:
    """Format template with user and chat variables safely."""
    first_name = getattr(user, "first_name", "") or "Member"
    last_name = getattr(user, "last_name", "") or ""
    full_name = f"{first_name} {last_name}".strip()
    username = f"@{user.username}" if getattr(user, "username", None) else first_name
    user_id = str(getattr(user, "id", ""))
    group_name = getattr(chat, "title", "our group") or "our group"

    replacements = {
        "{first_name}": first_name,
        "{last_name}": last_name,
        "{full_name}": full_name,
        "{username}": username,
        "{user_id}": user_id,
        "{group_name}": group_name,
    }

    result = template
    for key, val in replacements.items():
        result = result.replace(key, val)
    return result


async def schedule_message_deletion(bot: Bot, chat_id: int, message_id: int, delay_seconds: int):
    """Background task to delete the message after the configured delay."""
    if delay_seconds <= 0:
        return
    try:
        await asyncio.sleep(delay_seconds)
        await bot.delete_message(chat_id=chat_id, message_id=message_id)
        logger.info(f"Auto-deleted welcome message {message_id} in chat {chat_id} after {delay_seconds}s.")
    except Exception as e:
        logger.debug(f"Could not auto-delete message {message_id} in chat {chat_id}: {e}")


@router.chat_member(ChatMemberUpdatedFilter(JOIN_TRANSITION))
async def on_user_join(event: ChatMemberUpdated, bot: Bot):
    """Fired when a new user joins or is added to a group."""
    chat = event.chat
    new_member = event.new_chat_member.user

    # Don't welcome bot itself
    if new_member.id == bot.id:
        return

    async with async_session() as session:
        # Find group record
        g_stmt = select(Group).where(Group.tg_chat_id == chat.id)
        group = (await session.execute(g_stmt)).scalar_one_or_none()
        if not group:
            return

        # Find welcome config
        w_stmt = select(WelcomeConfig).where(WelcomeConfig.group_id == group.id)
        config = (await session.execute(w_stmt)).scalar_one_or_none()

        if not config or not config.is_enabled:
            return

        text = render_template(config.template_text, new_member, chat)
        buttons_markup = None

        if config.buttons_json:
            try:
                btns = json.loads(config.buttons_json)
                if isinstance(btns, list) and btns:
                    kb_rows = []
                    for b in btns:
                        kb_rows.append([InlineKeyboardButton(text=b.get("text", "Link"), url=b.get("url", "https://t.me"))])
                    buttons_markup = InlineKeyboardMarkup(inline_keyboard=kb_rows)
            except Exception:
                pass

        try:
            if config.media_url and (config.media_url.startswith("http://") or config.media_url.startswith("https://")):
                sent_msg = await bot.send_photo(
                    chat_id=chat.id,
                    photo=config.media_url,
                    caption=text,
                    reply_markup=buttons_markup,
                    parse_mode="Markdown"
                )
            else:
                sent_msg = await bot.send_message(
                    chat_id=chat.id,
                    text=text,
                    reply_markup=buttons_markup,
                    parse_mode="Markdown"
                )

            # Schedule auto-deletion if configured
            if config.delete_after_seconds > 0:
                asyncio.create_task(
                    schedule_message_deletion(
                        bot=bot,
                        chat_id=chat.id,
                        message_id=sent_msg.message_id,
                        delay_seconds=config.delete_after_seconds
                    )
                )

        except Exception as e:
            logger.error(f"Error sending welcome message in chat {chat.id}: {e}")


@router.chat_member(ChatMemberUpdatedFilter(LEAVE_TRANSITION))
async def on_user_leave(event: ChatMemberUpdated, bot: Bot):
    """Fired when a user leaves or is kicked from a group."""
    chat = event.chat
    user = event.old_chat_member.user

    async with async_session() as session:
        g = (await session.execute(select(Group).where(Group.tg_chat_id == chat.id))).scalar_one_or_none()
        if not g:
            return

        cfg = (await session.execute(select(GoodbyeConfig).where(GoodbyeConfig.group_id == g.id))).scalar_one_or_none()
        if not cfg or not cfg.is_enabled:
            return

        text = render_template(cfg.template_text, user, chat)
        try:
            sent_msg = await bot.send_message(chat_id=chat.id, text=text, parse_mode="Markdown")
            if cfg.delete_after_seconds > 0:
                asyncio.create_task(
                    schedule_message_deletion(bot=bot, chat_id=chat.id, message_id=sent_msg.message_id, delay_seconds=cfg.delete_after_seconds)
                )
        except Exception as e:
            logger.debug(f"Could not send goodbye message: {e}")


# Private Chat Dashboard Management for Welcome System
@router.callback_query(F.data.startswith("grp_welcome_"))
async def cb_group_welcome_settings(call: CallbackQuery):
    group_id = int(call.data.split("_")[-1])
    async with async_session() as session:
        group = await session.get(Group, group_id)
        if not group:
            await call.answer("Group not found.", show_alert=True)
            return

        cfg = (await session.execute(select(WelcomeConfig).where(WelcomeConfig.group_id == group_id))).scalar_one_or_none()
        if not cfg:
            cfg = WelcomeConfig(group_id=group_id, is_enabled=True, delete_after_seconds=60)
            session.add(cfg)
            await session.commit()

    is_enabled = cfg.is_enabled
    del_delay = cfg.delete_after_seconds
    tpl_preview = cfg.template_text[:120] + ("..." if len(cfg.template_text) > 120 else "")

    text = (
        f"👋 **Welcome System Settings: {group.title}**\n\n"
        f"• **Status:** `{'🟢 Enabled' if is_enabled else '🔴 Disabled'}`\n"
        f"• **Auto-Delete Timer:** `{del_delay} seconds`\n"
        f"• **Template Preview:**\n> {tpl_preview}\n\n"
        "**Available Placeholders:**\n"
        "`{first_name}`, `{last_name}`, `{full_name}`, `{username}`, `{group_name}`"
    )
    await call.message.edit_text(text, reply_markup=get_welcome_editor_keyboard(group_id, is_enabled, del_delay), parse_mode="Markdown")
    await call.answer()


@router.callback_query(F.data.startswith("wlc_toggle_"))
async def cb_toggle_welcome(call: CallbackQuery):
    group_id = int(call.data.split("_")[-1])
    async with async_session() as session:
        cfg = (await session.execute(select(WelcomeConfig).where(WelcomeConfig.group_id == group_id))).scalar_one_or_none()
        if cfg:
            cfg.is_enabled = not cfg.is_enabled
            await session.commit()
    await call.answer("Welcome message status toggled.")
    call.data = f"grp_welcome_{group_id}"
    await cb_group_welcome_settings(call)


@router.callback_query(F.data.startswith("wlc_timer_"))
async def cb_select_timer(call: CallbackQuery):
    group_id = int(call.data.split("_")[-1])
    text = (
        "⏱️ **Configure Welcome Message Auto-Deletion**\n\n"
        "To prevent group chat clutter, the bot automatically deletes welcome messages after the specified time."
    )
    await call.message.edit_text(text, reply_markup=get_delete_timer_selector_keyboard(group_id), parse_mode="Markdown")
    await call.answer()


@router.callback_query(F.data.startswith("wlc_set_timer_"))
async def cb_set_timer_value(call: CallbackQuery):
    parts = call.data.split("_")
    group_id = int(parts[3])
    seconds = int(parts[4])
    async with async_session() as session:
        cfg = (await session.execute(select(WelcomeConfig).where(WelcomeConfig.group_id == group_id))).scalar_one_or_none()
        if cfg:
            cfg.delete_after_seconds = seconds
            await session.commit()
    await call.answer(f"Auto-delete delay set to {seconds}s.")
    call.data = f"grp_welcome_{group_id}"
    await cb_group_welcome_settings(call)

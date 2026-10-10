"""
Moderation System for TeleGroup Bot.
Implements: /warn, /warnings, /resetwarn, /mute, /unmute, /ban, /unban, /kick, /purge, /report.
Includes administrator & owner protection, duration parsing, reasons, and audit logs.
"""

from datetime import datetime, timedelta
import re
from typing import Optional

from aiogram import Router, F, Bot
from aiogram.filters import Command
from aiogram.types import Message, ChatPermissions
from sqlalchemy import select, func, delete, and_

from bot.database.database import async_session
from bot.database.models import Group, GroupAdmin, UserWarning, ModerationLog
from bot.config import get_settings

router = Router(name="moderation")
settings = get_settings()


async def is_user_admin(bot: Bot, chat_id: int, user_id: int) -> bool:
    """Check if the user is a group admin or bot superadmin."""
    if user_id in settings.admin_ids:
        return True
    try:
        member = await bot.get_chat_member(chat_id=chat_id, user_id=user_id)
        return member.status in ("creator", "administrator")
    except Exception:
        return False


def parse_duration(duration_str: str) -> Optional[timedelta]:
    """Parse string like '10m', '2h', '1d', '30s' into timedelta."""
    match = re.match(r"^(\d+)([smhd])$", duration_str.lower().strip())
    if not match:
        return None
    val, unit = int(match.group(1)), match.group(2)
    if unit == "s":
        return timedelta(seconds=val)
    elif unit == "m":
        return timedelta(minutes=val)
    elif unit == "h":
        return timedelta(hours=val)
    elif unit == "d":
        return timedelta(days=val)
    return None


@router.message(Command("warn"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_warn(message: Message, bot: Bot):
    """Warn a member by replying to their message."""
    sender_id = message.from_user.id if message.from_user else 0
    if not await is_user_admin(bot, message.chat.id, sender_id):
        await message.reply("⚠️ Only group administrators can issue warnings.")
        return

    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Please reply to the user's message that you wish to warn.\nExample: Reply to message with `/warn Spamming links`")
        return

    target_user = message.reply_to_message.from_user
    if target_user.id == bot.id:
        await message.reply("🤖 You cannot warn the bot!")
        return

    # Protect administrators
    if await is_user_admin(bot, message.chat.id, target_user.id):
        await message.reply("🛡️ Cannot warn an administrator.")
        return

    reason_parts = message.text.split(maxsplit=1)[1:] if message.text else []
    reason = reason_parts[0] if reason_parts else "Rule violation"

    async with async_session() as session:
        # Get or create group
        g = (await session.execute(select(Group).where(Group.tg_chat_id == message.chat.id))).scalar_one_or_none()
        if not g:
            g = Group(tg_chat_id=message.chat.id, title=message.chat.title or "Group")
            session.add(g)
            await session.flush()

        # Add warning
        warning = UserWarning(
            group_id=g.id,
            tg_user_id=target_user.id,
            warned_by_user_id=sender_id,
            reason=reason
        )
        session.add(warning)

        # Count total warnings for this user
        count_stmt = select(func.count(UserWarning.id)).where(
            and_(UserWarning.group_id == g.id, UserWarning.tg_user_id == target_user.id)
        )
        warn_count = (await session.execute(count_stmt)).scalar() or 1

        # Check threshold
        threshold_reached = warn_count >= g.warn_limit
        action_taken = None

        if threshold_reached:
            action_taken = g.warn_action  # mute, kick, ban
            if action_taken == "ban":
                try:
                    await bot.ban_chat_member(chat_id=message.chat.id, user_id=target_user.id)
                except Exception as e:
                    action_taken = f"ban failed ({e})"
            elif action_taken == "kick":
                try:
                    await bot.ban_chat_member(chat_id=message.chat.id, user_id=target_user.id)
                    await bot.unban_chat_member(chat_id=message.chat.id, user_id=target_user.id)
                except Exception as e:
                    action_taken = f"kick failed ({e})"
            else:  # mute
                try:
                    until_date = datetime.utcnow() + timedelta(minutes=g.mute_duration_minutes)
                    await bot.restrict_chat_member(
                        chat_id=message.chat.id,
                        user_id=target_user.id,
                        permissions=ChatPermissions(can_send_messages=False),
                        until_date=until_date
                    )
                except Exception as e:
                    action_taken = f"mute failed ({e})"

            # Clear warnings after threshold action
            await session.execute(
                delete(UserWarning).where(
                    and_(UserWarning.group_id == g.id, UserWarning.tg_user_id == target_user.id)
                )
            )

        # Log action
        log = ModerationLog(
            group_id=g.id,
            tg_user_id=target_user.id,
            action="WARN_PUNISH" if threshold_reached else "WARN",
            reason=reason,
            executed_by_user_id=sender_id
        )
        session.add(log)
        await session.commit()

    target_name = target_user.first_name
    if threshold_reached:
        reply_msg = (
            f"⚠️ **User Warned ({warn_count}/{g.warn_limit})**\n\n"
            f"• **User:** `{target_name}` (`{target_user.id}`)\n"
            f"• **Reason:** {reason}\n"
            f"• **Threshold Exceeded:** Punished with **{action_taken.upper()}**!"
        )
    else:
        reply_msg = (
            f"⚠️ **User Warned ({warn_count}/{g.warn_limit})**\n\n"
            f"• **User:** `{target_name}` (`{target_user.id}`)\n"
            f"• **Reason:** {reason}\n"
            f"• `{g.warn_limit - warn_count}` more warning(s) until punishment."
        )

    await message.reply(reply_msg, parse_mode="Markdown")


@router.message(Command("warnings"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_warnings(message: Message, bot: Bot):
    """Check warning count for replied user or self."""
    target_user = message.reply_to_message.from_user if message.reply_to_message else message.from_user
    if not target_user:
        return

    async with async_session() as session:
        g = (await session.execute(select(Group).where(Group.tg_chat_id == message.chat.id))).scalar_one_or_none()
        limit = g.warn_limit if g else 3
        group_id = g.id if g else 0

        count_stmt = select(func.count(UserWarning.id)).where(
            and_(UserWarning.group_id == group_id, UserWarning.tg_user_id == target_user.id)
        )
        count = (await session.execute(count_stmt)).scalar() or 0

    await message.reply(
        f"📋 **Warning Status for {target_user.first_name}:**\n"
        f"Warnings: `{count}/{limit}`",
        parse_mode="Markdown"
    )


@router.message(Command("resetwarn"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_resetwarn(message: Message, bot: Bot):
    """Reset warnings for a replied user."""
    sender_id = message.from_user.id if message.from_user else 0
    if not await is_user_admin(bot, message.chat.id, sender_id):
        await message.reply("⚠️ Only group administrators can reset warnings.")
        return

    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Please reply to the user's message to reset their warnings.")
        return

    target_user = message.reply_to_message.from_user
    async with async_session() as session:
        g = (await session.execute(select(Group).where(Group.tg_chat_id == message.chat.id))).scalar_one_or_none()
        if g:
            await session.execute(
                delete(UserWarning).where(
                    and_(UserWarning.group_id == g.id, UserWarning.tg_user_id == target_user.id)
                )
            )
            session.add(ModerationLog(
                group_id=g.id,
                tg_user_id=target_user.id,
                action="RESET_WARNS",
                reason="Admin reset",
                executed_by_user_id=sender_id
            ))
            await session.commit()

    await message.reply(f"✅ Warnings reset for `{target_user.first_name}`.", parse_mode="Markdown")


@router.message(Command("mute"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_mute(message: Message, bot: Bot):
    """Mute a user temporarily or indefinitely. Syntax: /mute [duration] [reason]"""
    sender_id = message.from_user.id if message.from_user else 0
    if not await is_user_admin(bot, message.chat.id, sender_id):
        await message.reply("⚠️ Only group administrators can mute members.")
        return

    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Reply to a user's message to mute them.\nExample: `/mute 30m Spamming`")
        return

    target_user = message.reply_to_message.from_user
    if await is_user_admin(bot, message.chat.id, target_user.id):
        await message.reply("🛡️ Cannot mute an administrator.")
        return

    args = message.text.split()[1:] if message.text else []
    duration = None
    reason = "Violating group rules"

    if args:
        parsed = parse_duration(args[0])
        if parsed:
            duration = parsed
            reason = " ".join(args[1:]) if len(args) > 1 else reason
        else:
            reason = " ".join(args)

    until_date = datetime.utcnow() + (duration if duration else timedelta(minutes=60))

    try:
        await bot.restrict_chat_member(
            chat_id=message.chat.id,
            user_id=target_user.id,
            permissions=ChatPermissions(can_send_messages=False),
            until_date=until_date
        )
        time_str = f"{args[0]}" if (args and duration) else "60 minutes"
        await message.reply(
            f"🤐 **User Muted**\n\n"
            f"• **User:** `{target_user.first_name}`\n"
            f"• **Duration:** `{time_str}`\n"
            f"• **Reason:** {reason}",
            parse_mode="Markdown"
        )
    except Exception as e:
        await message.reply(f"❌ Could not mute user: {e}")


@router.message(Command("unmute"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_unmute(message: Message, bot: Bot):
    """Unmute a replied user."""
    sender_id = message.from_user.id if message.from_user else 0
    if not await is_user_admin(bot, message.chat.id, sender_id):
        return
    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Reply to a user's message to unmute them.")
        return
    target = message.reply_to_message.from_user
    try:
        await bot.restrict_chat_member(
            chat_id=message.chat.id,
            user_id=target.id,
            permissions=ChatPermissions(
                can_send_messages=True,
                can_send_media_messages=True,
                can_send_other_messages=True,
                can_add_web_page_previews=True
            )
        )
        await message.reply(f"🔊 Unmuted `{target.first_name}`.", parse_mode="Markdown")
    except Exception as e:
        await message.reply(f"❌ Unmute error: {e}")


@router.message(Command("ban"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_ban(message: Message, bot: Bot):
    """Ban a user from the group."""
    sender_id = message.from_user.id if message.from_user else 0
    if not await is_user_admin(bot, message.chat.id, sender_id):
        return
    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Reply to a user's message to ban them.")
        return
    target = message.reply_to_message.from_user
    if await is_user_admin(bot, message.chat.id, target.id):
        await message.reply("🛡️ Cannot ban an administrator.")
        return
    try:
        await bot.ban_chat_member(chat_id=message.chat.id, user_id=target.id)
        await message.reply(f"🔨 Banned `{target.first_name}` from the group.", parse_mode="Markdown")
    except Exception as e:
        await message.reply(f"❌ Ban error: {e}")


@router.message(Command("unban"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_unban(message: Message, bot: Bot):
    """Unban a user."""
    sender_id = message.from_user.id if message.from_user else 0
    if not await is_user_admin(bot, message.chat.id, sender_id):
        return
    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Reply to a message or provide user ID to unban.")
        return
    target = message.reply_to_message.from_user
    try:
        await bot.unban_chat_member(chat_id=message.chat.id, user_id=target.id, only_if_banned=True)
        await message.reply(f"✅ Unbanned `{target.first_name}`.", parse_mode="Markdown")
    except Exception as e:
        await message.reply(f"❌ Unban error: {e}")


@router.message(Command("kick"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_kick(message: Message, bot: Bot):
    """Kick a user (ban then immediately unban to let them re-join)."""
    sender_id = message.from_user.id if message.from_user else 0
    if not await is_user_admin(bot, message.chat.id, sender_id):
        return
    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Reply to a user's message to kick them.")
        return
    target = message.reply_to_message.from_user
    if await is_user_admin(bot, message.chat.id, target.id):
        await message.reply("🛡️ Cannot kick an administrator.")
        return
    try:
        await bot.ban_chat_member(chat_id=message.chat.id, user_id=target.id)
        await bot.unban_chat_member(chat_id=message.chat.id, user_id=target.id)
        await message.reply(f"👢 Kicked `{target.first_name}`.", parse_mode="Markdown")
    except Exception as e:
        await message.reply(f"❌ Kick error: {e}")


@router.message(Command("purge"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_purge(message: Message, bot: Bot):
    """Purge messages between replied message and current command."""
    sender_id = message.from_user.id if message.from_user else 0
    if not await is_user_admin(bot, message.chat.id, sender_id):
        return
    if not message.reply_to_message:
        await message.reply("⚠️ Reply to the message from which you want to start purging.")
        return

    start_id = message.reply_to_message.message_id
    end_id = message.message_id
    chat_id = message.chat.id

    # Batch delete (max 100 messages at once)
    count = 0
    for m_id in range(start_id, end_id + 1):
        try:
            await bot.delete_message(chat_id=chat_id, message_id=m_id)
            count += 1
        except Exception:
            pass

    confirm = await message.answer(f"🧹 Purged `{count}` messages.", parse_mode="Markdown")
    await asyncio.sleep(5)
    try:
        await confirm.delete()
    except Exception:
        pass

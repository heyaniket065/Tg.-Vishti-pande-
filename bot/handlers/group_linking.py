"""
Group Connection and Verification Handler for TeleGroup Bot.
Implements /linkgroup in group and channel chats, and /connect in private chat.
Generates single-use expiring alphanumeric codes and verifies admin permissions.
Supports both single group management and 2-group cross-posting connections.
"""

import random
import string
from datetime import datetime, timedelta
from typing import Optional

from aiogram import Router, F, Bot
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from sqlalchemy import select, and_

from bot.database.database import async_session
from bot.database.models import Group, GroupAdmin, LinkCode, CrossPostConnection
from bot.config import get_settings

router = Router(name="group_linking")
settings = get_settings()


def generate_connection_code(length: int = 6) -> str:
    """Generate a clean random single-use code (e.g. A7XK92)."""
    chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
    return "".join(random.choices(chars, k=length))


async def process_linkgroup_request(message: Message, bot: Bot):
    """Core logic to generate code for groups, supergroups, and channels."""
    chat = message.chat
    user = message.from_user

    # In channels, message.from is often None (authored by channel)
    sender_id = user.id if user else chat.id

    # Verify sender admin status if user object exists in group
    if user and chat.type in {"group", "supergroup"}:
        try:
            member = await bot.get_chat_member(chat_id=chat.id, user_id=user.id)
            if member.status not in {"creator", "administrator"}:
                await message.reply("⚠️ Only group administrators can generate connection codes.")
                return
        except Exception as e:
            await message.reply(f"⚠️ Could not verify administrator status: {e}")
            return

    # Verify bot admin rights
    try:
        bot_member = await bot.get_chat_member(chat_id=chat.id, user_id=bot.id)
        if bot_member.status != "administrator":
            await message.reply(
                "⚠️ **Bot Permissions Incomplete**\n\n"
                "Please promote this bot to **Administrator** before linking.",
                parse_mode="Markdown"
            )
            return
    except Exception as e:
        # In some channels or privacy modes get_chat_member might be restricted, continue gracefully
        pass

    code = generate_connection_code(6)
    expires_at = datetime.utcnow() + timedelta(minutes=settings.link_code_expiry_minutes)

    async with async_session() as session:
        # Find or register group
        stmt = select(Group).where(Group.tg_chat_id == chat.id)
        res = await session.execute(stmt)
        group = res.scalar_one_or_none()

        if not group:
            group = Group(
                tg_chat_id=chat.id,
                title=chat.title or f"Chat {chat.id}",
                username=chat.username,
                is_active=True
            )
            session.add(group)
            await session.flush()

        # Update or register admin
        if user:
            admin_stmt = select(GroupAdmin).where(
                and_(GroupAdmin.group_id == group.id, GroupAdmin.tg_user_id == user.id)
            )
            admin_res = await session.execute(admin_stmt)
            group_admin = admin_res.scalar_one_or_none()

            if not group_admin:
                group_admin = GroupAdmin(
                    group_id=group.id,
                    tg_user_id=user.id,
                    role="administrator",
                    can_manage_settings=True,
                    can_crosspost=True,
                    can_moderate=True
                )
                session.add(group_admin)

        # Store single-use link code
        link_code_obj = LinkCode(
            code=code,
            group_id=group.id,
            generated_by_user_id=sender_id,
            expires_at=expires_at,
            is_used=False
        )
        session.add(link_code_obj)
        await session.commit()

    bot_info = await bot.get_me()
    deep_link = f"https://t.me/{bot_info.username}?start=connect_{code}"

    reply_text = (
        "🔐 **Group Connection Code Generated Successfully!**\n\n"
        f"Code: `{code}`\n"
        f"Chat: **{chat.title or 'This Chat'}**\n"
        f"Expires in: `{settings.link_code_expiry_minutes} minutes` (Single-use)\n\n"
        f"👉 **Aap aisa karo (Next Steps):**\n"
        f"1. Bot ke private chat me jaiye: @{bot_info.username}\n"
        f"2. Wahan ye code send karein: `{code}`\n"
        f"*(Ya type karein: `/connect {code}`)*\n"
        f"*(Do groups cross-post karne ke liye: `/connect {code} <CODE_B>`)*"
    )
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Open Bot Private Chat (प्राइवेट चैट खोलो ↗️)", url=deep_link)]
    ])
    await message.reply(reply_text, reply_markup=kb, parse_mode="Markdown")


# Support /linkgroup in group, supergroup, and channel posts
@router.message(Command("linkgroup"), F.chat.type.in_({"group", "supergroup", "channel"}))
async def cmd_linkgroup_message(message: Message, bot: Bot):
    await process_linkgroup_request(message, bot)


@router.channel_post(Command("linkgroup"))
async def cmd_linkgroup_channel(message: Message, bot: Bot):
    await process_linkgroup_request(message, bot)


# If user runs /linkgroup in private chat, give clear guidance
@router.message(Command("linkgroup"), F.chat.type == "private")
async def cmd_linkgroup_private(message: Message, bot: Bot):
    bot_info = await bot.get_me()
    await message.reply(
        "⚠️ **Important Instructions:**\n\n"
        "`/linkgroup` must be sent inside your **Telegram Group or Channel**, not here in private chat!\n\n"
        "**How to link:**\n"
        f"1. Go to your group or channel.\n"
        f"2. Add @{bot_info.username} as an **Administrator**.\n"
        "3. Send `/linkgroup` in that chat.\n"
        "4. Copy the 6-character code generated and send it right here!",
        parse_mode="Markdown"
    )


# Single Code or Two-Code /connect Handler in Private Chat
@router.message(Command("connect"), F.chat.type == "private")
async def cmd_connect_in_private(message: Message, bot: Bot):
    args = message.text.split()[1:] if message.text else []
    if len(args) == 0:
        help_text = (
            "⚠️ **Connection Syntax**\n\n"
            "• **To connect a single group:** `/connect <CODE>`\n"
            "• **To connect two groups for cross-posting:** `/connect <CODE_A> <CODE_B>`\n\n"
            "Example: `/connect A7XK92`"
        )
        await message.reply(help_text, parse_mode="Markdown")
        return

    user_id = message.from_user.id if message.from_user else 0

    # Case A: Single Code Connection (Connects group to this user's dashboard)
    if len(args) == 1:
        code = args[0].strip().upper()
        now = datetime.utcnow()

        async with async_session() as session:
            stmt = select(LinkCode).where(
                and_(LinkCode.code == code, LinkCode.is_used == False, LinkCode.expires_at > now)
            )
            res = await session.execute(stmt)
            record = res.scalar_one_or_none()

            if not record:
                await message.reply(
                    f"❌ **Code '{code}' is invalid, expired, or already used.**\n"
                    "Please run `/linkgroup` in the group/channel again to get a fresh code.",
                    parse_mode="Markdown"
                )
                return

            group = await session.get(Group, record.group_id)
            if not group:
                await message.reply("❌ Error fetching group details. Please re-run `/linkgroup`.")
                return

            # Mark code as used
            record.is_used = True
            record.used_at = now

            # Ensure user is registered as admin for this group
            admin_stmt = select(GroupAdmin).where(
                and_(GroupAdmin.group_id == group.id, GroupAdmin.tg_user_id == user_id)
            )
            admin_res = await session.execute(admin_stmt)
            group_admin = admin_res.scalar_one_or_none()

            if not group_admin:
                group_admin = GroupAdmin(
                    group_id=group.id,
                    tg_user_id=user_id,
                    role="creator",
                    can_manage_settings=True,
                    can_crosspost=True,
                    can_moderate=True
                )
                session.add(group_admin)

            await session.commit()

        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="👥 Open My Groups", callback_data="nav_my_groups")],
            [InlineKeyboardButton(text="🏠 Main Dashboard", callback_data="nav_main_menu")]
        ])

        await message.reply(
            f"✅ **Group Connected Successfully!**\n\n"
            f"• **Title:** **{group.title}**\n"
            f"• **Chat ID:** `{group.tg_chat_id}`\n"
            f"• **Status:** 🟢 Connected & Authorized\n\n"
            f"This group is now accessible under your **My Groups** menu.",
            reply_markup=kb,
            parse_mode="Markdown"
        )
        return

    # Case B: Two-Code Cross-Posting Connection
    code_a, code_b = args[0].strip().upper(), args[1].strip().upper()
    now = datetime.utcnow()

    async with async_session() as session:
        record_a = (await session.execute(
            select(LinkCode).where(and_(LinkCode.code == code_a, LinkCode.is_used == False, LinkCode.expires_at > now))
        )).scalar_one_or_none()

        record_b = (await session.execute(
            select(LinkCode).where(and_(LinkCode.code == code_b, LinkCode.is_used == False, LinkCode.expires_at > now))
        )).scalar_one_or_none()

        if not record_a or not record_b:
            await message.reply(
                "❌ One or both codes are invalid, expired, or already used.\n"
                "Please run `/linkgroup` again in both groups.",
                parse_mode="Markdown"
            )
            return

        if record_a.group_id == record_b.group_id:
            await message.reply("⚠️ Cannot connect a group to itself! Please select two distinct groups.")
            return

        group_a = await session.get(Group, record_a.group_id)
        group_b = await session.get(Group, record_b.group_id)

        record_a.is_used = True
        record_a.used_at = now
        record_b.is_used = True
        record_b.used_at = now

        new_conn = CrossPostConnection(
            name=f"{group_a.title} ⇄ {group_b.title}",
            group_a_id=group_a.id,
            group_b_id=group_b.id,
            direction="A_TO_B",
            mode="COPY",
            is_active=True,
            created_by_user_id=user_id
        )
        session.add(new_conn)
        await session.commit()
        conn_id = new_conn.id

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔄 Configure Cross-Posting", callback_data=f"cp_detail_{conn_id}")],
        [InlineKeyboardButton(text="👥 My Groups", callback_data="nav_my_groups")],
        [InlineKeyboardButton(text="« Back to Dashboard", callback_data="nav_main_menu")]
    ])

    await message.reply(
        "✅ **Groups Connected for Cross-Posting!**\n\n"
        f"• Source (A): `{group_a.title}`\n"
        f"• Destination (B): `{group_b.title}`\n"
        f"• Status: 🟢 Active\n"
        f"• Mode: Clean Copy",
        reply_markup=kb,
        parse_mode="Markdown"
    )


# Handle plain text single code entered in private chat (e.g. user simply sends "A7XK92")
@router.message(F.chat.type == "private", F.text.regexp(r"^[A-Za-z0-9]{5,8}$"))
async def handle_raw_code_in_private(message: Message, bot: Bot):
    code = message.text.strip().upper()
    now = datetime.utcnow()
    user_id = message.from_user.id if message.from_user else 0

    async with async_session() as session:
        stmt = select(LinkCode).where(
            and_(LinkCode.code == code, LinkCode.is_used == False, LinkCode.expires_at > now)
        )
        res = await session.execute(stmt)
        record = res.scalar_one_or_none()

        if record:
            group = await session.get(Group, record.group_id)
            if group:
                record.is_used = True
                record.used_at = now

                admin_stmt = select(GroupAdmin).where(
                    and_(GroupAdmin.group_id == group.id, GroupAdmin.tg_user_id == user_id)
                )
                admin_res = await session.execute(admin_stmt)
                group_admin = admin_res.scalar_one_or_none()

                if not group_admin:
                    group_admin = GroupAdmin(
                        group_id=group.id,
                        tg_user_id=user_id,
                        role="creator",
                        can_manage_settings=True,
                        can_crosspost=True,
                        can_moderate=True
                    )
                    session.add(group_admin)

                await session.commit()

                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="👥 Open My Groups", callback_data="nav_my_groups")],
                    [InlineKeyboardButton(text="🏠 Main Dashboard", callback_data="nav_main_menu")]
                ])

                await message.reply(
                    f"✅ **Group Connected Successfully!**\n\n"
                    f"• **Title:** **{group.title}**\n"
                    f"• **Chat ID:** `{group.tg_chat_id}`\n"
                    f"• **Status:** 🟢 Connected to your dashboard!\n\n"
                    f"You can now manage this group under **My Groups**.",
                    reply_markup=kb,
                    parse_mode="Markdown"
                )
                return

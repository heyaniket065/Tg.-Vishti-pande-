"""
Cross-Posting Engine for TeleGroup Bot.
Mirrors messages (text, photos, videos, documents, voice) between connected groups.
Includes anti-loop protection, bidirectional safety, and deduplication mappings.
"""

import logging
from typing import Optional, List
from aiogram import Router, F, Bot
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from sqlalchemy import select, and_, or_

from bot.database.database import async_session
from bot.database.models import Group, CrossPostConnection, CrossPostMessageMap
from bot.keyboards.inline import get_crosspost_keyboard, get_crosspost_detail_keyboard

logger = logging.getLogger(__name__)
router = Router(name="cross_posting")

# In-memory recent message hash cache for sub-second loop prevention
_RECENT_PROCESSED_MESSAGES = set()


@router.callback_query(F.data == "nav_crosspost")
async def cb_crosspost_menu(call: CallbackQuery):
    """View all cross-posting connections."""
    async with async_session() as session:
        stmt = select(CrossPostConnection)
        res = await session.execute(stmt)
        connections = res.scalars().all()

    conn_data = [
        {"id": c.id, "name": c.name, "direction": c.direction, "is_active": c.is_active}
        for c in connections
    ]
    text = (
        "🔄 **Cross-Posting Management**\n\n"
        "Transfer messages seamlessly between connected groups in real time.\n"
        "Configure directions, copy vs forward mode, and anti-loop guards below:"
    )
    await call.message.edit_text(text, reply_markup=get_crosspost_keyboard(conn_data), parse_mode="Markdown")
    await call.answer()


@router.callback_query(F.data.startswith("cp_detail_"))
async def cb_cp_detail(call: CallbackQuery):
    """Details and settings for a specific cross-posting pipeline."""
    conn_id = int(call.data.split("_")[-1])
    async with async_session() as session:
        conn = await session.get(CrossPostConnection, conn_id)
        if not conn:
            await call.answer("Connection not found.", show_alert=True)
            return
        group_a = await session.get(Group, conn.group_a_id)
        group_b = await session.get(Group, conn.group_b_id)

    title_a = group_a.title if group_a else "Group A"
    title_b = group_b.title if group_b else "Group B"

    dir_label = {
        "A_TO_B": f"{title_a} ➔ {title_b}",
        "B_TO_A": f"{title_b} ➔ {title_a}",
        "BIDIRECTIONAL": f"{title_a} ⇄ {title_b} (Bidirectional)"
    }.get(conn.direction, conn.direction)

    mode_label = "Clean Copy (No forward author)" if conn.mode == "COPY" else "Forward (With attribution)"
    status_label = "🟢 Active" if conn.is_active else "⏸️ Paused"

    text = (
        f"🔄 **Pipeline Details: {conn.name}**\n\n"
        f"• **Status:** {status_label}\n"
        f"• **Direction:** `{dir_label}`\n"
        f"• **Transfer Mode:** `{mode_label}`\n"
        f"• **Allowed Media:** `{conn.allowed_types}`\n"
        f"• **Admin-Only Post:** `{'Yes' if conn.admin_only else 'No (All members)'}`\n\n"
        "Use the buttons below to change settings or pause/resume:"
    )
    await call.message.edit_text(text, reply_markup=get_crosspost_detail_keyboard(conn.id, conn.is_active), parse_mode="Markdown")
    await call.answer()


@router.callback_query(F.data.startswith("cp_pause_"))
async def cb_cp_pause(call: CallbackQuery):
    conn_id = int(call.data.split("_")[-1])
    async with async_session() as session:
        conn = await session.get(CrossPostConnection, conn_id)
        if conn:
            conn.is_active = False
            await session.commit()
    await call.answer("Cross-posting pipeline paused.", show_alert=True)
    # Re-render detail
    call.data = f"cp_detail_{conn_id}"
    await cb_cp_detail(call)


@router.callback_query(F.data.startswith("cp_resume_"))
async def cb_cp_resume(call: CallbackQuery):
    conn_id = int(call.data.split("_")[-1])
    async with async_session() as session:
        conn = await session.get(CrossPostConnection, conn_id)
        if conn:
            conn.is_active = True
            await session.commit()
    await call.answer("Cross-posting pipeline resumed.", show_alert=True)
    call.data = f"cp_detail_{conn_id}"
    await cb_cp_detail(call)


@router.callback_query(F.data.startswith("cp_dir_"))
async def cb_cp_change_dir(call: CallbackQuery):
    conn_id = int(call.data.split("_")[-1])
    async with async_session() as session:
        conn = await session.get(CrossPostConnection, conn_id)
        if conn:
            # Cycle direction: A_TO_B -> B_TO_A -> BIDIRECTIONAL -> A_TO_B
            cycle = {"A_TO_B": "B_TO_A", "B_TO_A": "BIDIRECTIONAL", "BIDIRECTIONAL": "A_TO_B"}
            conn.direction = cycle.get(conn.direction, "A_TO_B")
            await session.commit()
            await call.answer(f"Direction changed to {conn.direction}")
    call.data = f"cp_detail_{conn_id}"
    await cb_cp_detail(call)


@router.callback_query(F.data.startswith("cp_mode_"))
async def cb_cp_change_mode(call: CallbackQuery):
    conn_id = int(call.data.split("_")[-1])
    async with async_session() as session:
        conn = await session.get(CrossPostConnection, conn_id)
        if conn:
            conn.mode = "FORWARD" if conn.mode == "COPY" else "COPY"
            await session.commit()
            await call.answer(f"Mode changed to {conn.mode}")
    call.data = f"cp_detail_{conn_id}"
    await cb_cp_detail(call)


# Cross-posting commands requested in brief:
@router.message(Command("crosspost_status"))
async def cmd_crosspost_status(message: Message):
    """Check status of active pipelines for this group."""
    chat_id = message.chat.id
    async with async_session() as session:
        # Find group
        g = (await session.execute(select(Group).where(Group.tg_chat_id == chat_id))).scalar_one_or_none()
        if not g:
            await message.reply("This group is not registered yet. Use `/linkgroup` to connect.", parse_mode="Markdown")
            return
        conns = (await session.execute(
            select(CrossPostConnection).where(
                or_(CrossPostConnection.group_a_id == g.id, CrossPostConnection.group_b_id == g.id)
            )
        )).scalars().all()

    if not conns:
        await message.reply("No cross-post connections active for this group.")
        return

    lines = ["🔄 **Cross-Posting Pipelines Status:**\n"]
    for c in conns:
        status = "🟢 Active" if c.is_active else "⏸️ Paused"
        lines.append(f"• `{c.name}`: {status} | Direction: `{c.direction}` | Mode: `{c.mode}`")
    await message.reply("\n".join(lines), parse_mode="Markdown")


# Core Message Transfer Listener
@router.message(F.chat.type.in_({"group", "supergroup"}))
async def handle_group_message_crosspost(message: Message, bot: Bot):
    """
    Evaluates incoming messages in groups to mirror across connected pipelines.
    Guarantees:
    - No self-posting loops
    - No duplicate forward cycles
    - Respects directional constraints (A->B, B->A, Bidirectional)
    - Records source-to-dest message map in database
    """
    # 1. Skip messages from the bot itself
    if message.from_user and message.from_user.id == bot.id:
        return

    # 2. Skip commands to prevent command execution propagation
    if message.text and message.text.startswith("/"):
        return

    chat_id = message.chat.id
    msg_id = message.message_id
    dedup_key = f"{chat_id}:{msg_id}"

    # Fast in-memory deduplication check
    if dedup_key in _RECENT_PROCESSED_MESSAGES:
        return

    async with async_session() as session:
        # Find if this chat is a registered group
        group_stmt = select(Group).where(Group.tg_chat_id == chat_id)
        current_group = (await session.execute(group_stmt)).scalar_one_or_none()
        if not current_group or not current_group.is_active:
            return

        # Check if already mirrored as a destination message
        existing_map = (await session.execute(
            select(CrossPostMessageMap).where(
                and_(CrossPostMessageMap.dest_chat_id == chat_id, CrossPostMessageMap.dest_msg_id == msg_id)
            )
        )).scalar_one_or_none()
        if existing_map:
            return  # Message originated from bot's cross-post; ignore to break loop!

        # Find all active connections involving this group
        connections_stmt = select(CrossPostConnection).where(
            and_(
                CrossPostConnection.is_active == True,
                or_(CrossPostConnection.group_a_id == current_group.id, CrossPostConnection.group_b_id == current_group.id)
            )
        )
        connections = (await session.execute(connections_stmt)).scalars().all()

        if not connections:
            return

        for conn in connections:
            target_group_id = None

            # Verify direction
            if conn.group_a_id == current_group.id:
                if conn.direction in ("A_TO_B", "BIDIRECTIONAL"):
                    target_group_id = conn.group_b_id
            elif conn.group_b_id == current_group.id:
                if conn.direction in ("B_TO_A", "BIDIRECTIONAL"):
                    target_group_id = conn.group_a_id

            if not target_group_id:
                continue

            target_group = await session.get(Group, target_group_id)
            if not target_group or not target_group.is_active:
                continue

            # Route message safely
            try:
                dest_chat_id = target_group.tg_chat_id

                if conn.mode == "COPY":
                    # Copy without forward attribution
                    sent_msg = await bot.copy_message(
                        chat_id=dest_chat_id,
                        from_chat_id=chat_id,
                        message_id=msg_id
                    )
                else:
                    # Forward with original attribution
                    sent_msg = await bot.forward_message(
                        chat_id=dest_chat_id,
                        from_chat_id=chat_id,
                        message_id=msg_id
                    )

                # Record mapping for anti-loop and edit capabilities
                new_map = CrossPostMessageMap(
                    connection_id=conn.id,
                    source_chat_id=chat_id,
                    source_msg_id=msg_id,
                    dest_chat_id=dest_chat_id,
                    dest_msg_id=sent_msg.message_id
                )
                session.add(new_map)
                _RECENT_PROCESSED_MESSAGES.add(f"{dest_chat_id}:{sent_msg.message_id}")

            except Exception as e:
                logger.warning(f"Could not cross-post message {msg_id} from {chat_id} to {target_group.tg_chat_id}: {e}")

        await session.commit()

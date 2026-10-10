"""
Promotion & Aesthetic Button Builder for TeleGroup Bot.
Allows administrators to compose promotional broadcasts with custom inline URL buttons,
media banners, multi-row button grids, and preview before publishing to target groups.
"""

import json
from typing import List, Dict, Any, Optional

from aiogram import Router, F, Bot
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton
)
from sqlalchemy import select

from bot.database.database import async_session
from bot.database.models import Group, PromotionTemplate
from bot.keyboards.inline import get_back_button

router = Router(name="promotions")


class PromoWizard(StatesGroup):
    waiting_for_text = State()
    waiting_for_media = State()
    waiting_for_button_label = State()
    waiting_for_button_url = State()
    waiting_for_target_group = State()


def build_promo_keyboard(buttons: List[Dict[str, str]]) -> InlineKeyboardMarkup:
    """Build inline keyboard from list of button specs: [{"text": "...", "url": "..."}]."""
    rows = []
    for btn in buttons:
        rows.append([InlineKeyboardButton(text=btn.get("text", "Link"), url=btn.get("url", "https://t.me"))])
    return InlineKeyboardMarkup(inline_keyboard=rows)


@router.callback_query(F.data == "nav_promotions")
async def cb_promotions_menu(call: CallbackQuery):
    """Entry point for promotions module."""
    text = (
        "📢 **Promotion & Aesthetic Button Builder**\n\n"
        "Design professional promotional broadcasts with interactive inline URL buttons.\n\n"
        "**Features:**\n"
        "• Rich text & Markdown formatting\n"
        "• Optional hero photo or banner\n"
        "• Multi-row custom URL buttons with emojis\n"
        "• Instant realistic preview\n"
        "• Safe broadcast to authorized groups only"
    )
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ Create New Promotion", callback_data="promo_create_new")],
        [InlineKeyboardButton(text="📋 Saved Templates", callback_data="promo_saved_templates")],
        get_back_button(),
    ])
    await call.message.edit_text(text, reply_markup=kb, parse_mode="Markdown")
    await call.answer()


@router.callback_query(F.data == "promo_create_new")
async def cb_create_promo_start(call: CallbackQuery, state: FSMContext):
    """Start step-by-step promotion creation wizard."""
    await state.set_state(PromoWizard.waiting_for_text)
    await state.update_data(buttons=[], media_url=None)

    prompt = (
        "✏️ **Step 1 of 4: Promotion Text**\n\n"
        "Send the message content for your promotion.\n"
        "You can use formatting like **bold**, *italics*, and bullet points.\n\n"
        "Or type `/promote_cancel` to exit."
    )
    await call.message.edit_text(prompt, parse_mode="Markdown")
    await call.answer()


@router.message(Command("promote_cancel"))
async def cmd_cancel_promo(message: Message, state: FSMContext):
    """Cancel wizard."""
    await state.clear()
    await message.reply("❌ Promotion wizard cancelled.")


@router.message(PromoWizard.waiting_for_text)
async def process_promo_text(message: Message, state: FSMContext):
    """Record promo body text."""
    text = message.text or message.caption or "Promotional Announcement"
    await state.update_data(promo_text=text)
    await state.set_state(PromoWizard.waiting_for_media)

    prompt = (
        "🖼️ **Step 2 of 4: Media Banner (Optional)**\n\n"
        "Send a photo URL (e.g. `https://example.com/banner.jpg`), or send `/skip` if you don't want an image."
    )
    await message.reply(prompt, parse_mode="Markdown")


@router.message(PromoWizard.waiting_for_media)
async def process_promo_media(message: Message, state: FSMContext):
    """Record media URL or skip."""
    url = None
    if message.text and not message.text.startswith("/skip"):
        url = message.text.strip()
    await state.update_data(media_url=url)
    await state.set_state(PromoWizard.waiting_for_button_label)

    prompt = (
        "🔘 **Step 3 of 4: Add Inline Button**\n\n"
        "Send the label for your first button (e.g. `🚀 Join Channel` or `💬 Discussion Group`).\n"
        "Or send `/done` to proceed directly to target selection."
    )
    await message.reply(prompt, parse_mode="Markdown")


@router.message(PromoWizard.waiting_for_button_label)
async def process_button_label(message: Message, state: FSMContext):
    if message.text and message.text.startswith("/done"):
        await finish_buttons_and_select_group(message, state)
        return

    label = message.text.strip() if message.text else "Visit Link"
    await state.update_data(current_label=label)
    await state.set_state(PromoWizard.waiting_for_button_url)

    prompt = f"🔗 Now send the destination URL for **'{label}'** (e.g. `https://t.me/yourchannel`):"
    await message.reply(prompt, parse_mode="Markdown")


@router.message(PromoWizard.waiting_for_button_url)
async def process_button_url(message: Message, state: FSMContext):
    url = message.text.strip() if message.text else "https://t.me"
    data = await state.get_data()
    buttons = data.get("buttons", [])
    current_label = data.get("current_label", "Link")

    buttons.append({"text": current_label, "url": url})
    await state.update_data(buttons=buttons)
    await state.set_state(PromoWizard.waiting_for_button_label)

    prompt = (
        f"✅ Added button: **[{current_label}]({url})**\n\n"
        "Send another button label to add more buttons, or send `/done` to finish!"
    )
    await message.reply(prompt, parse_mode="Markdown")


async def finish_buttons_and_select_group(message: Message, state: FSMContext):
    """Show target group selection and preview."""
    data = await state.get_data()
    promo_text = data.get("promo_text", "Promo")
    buttons = data.get("buttons", [])
    media_url = data.get("media_url")

    async with async_session() as session:
        groups = (await session.execute(select(Group).where(Group.is_active == True))).scalars().all()

    if not groups:
        await message.reply("⚠️ No active groups connected to publish to.")
        await state.clear()
        return

    preview_kb = build_promo_keyboard(buttons)
    await message.reply(
        "👁️ **Preview of your Promotional Post:**\n\n" + promo_text,
        reply_markup=preview_kb,
        parse_mode="Markdown"
    )

    group_rows = []
    for g in groups:
        group_rows.append([InlineKeyboardButton(text=f"📢 Publish to {g.title}", callback_data=f"publish_promo_{g.id}")])
    group_rows.append([InlineKeyboardButton(text="❌ Cancel", callback_data="nav_promotions")])

    await message.reply(
        "🚀 **Select the target group to publish:**",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=group_rows),
        parse_mode="Markdown"
    )


@router.callback_query(F.data.startswith("publish_promo_"))
async def cb_publish_promo(call: CallbackQuery, state: FSMContext, bot: Bot):
    group_id = int(call.data.split("_")[-1])
    data = await state.get_data()
    promo_text = data.get("promo_text", "Announcement")
    buttons = data.get("buttons", [])
    media_url = data.get("media_url")

    async with async_session() as session:
        target_group = await session.get(Group, group_id)
        if not target_group:
            await call.answer("Target group not found.", show_alert=True)
            return

        kb = build_promo_keyboard(buttons)
        try:
            if media_url and (media_url.startswith("http://") or media_url.startswith("https://")):
                await bot.send_photo(
                    chat_id=target_group.tg_chat_id,
                    photo=media_url,
                    caption=promo_text,
                    reply_markup=kb,
                    parse_mode="Markdown"
                )
            else:
                await bot.send_message(
                    chat_id=target_group.tg_chat_id,
                    text=promo_text,
                    reply_markup=kb,
                    parse_mode="Markdown"
                )
            await call.message.edit_text(
                f"✅ **Promotion published successfully to {target_group.title}!**",
                parse_mode="Markdown"
            )
        except Exception as e:
            await call.message.edit_text(f"❌ Could not publish promotion: {e}")

    await state.clear()
    await call.answer()

"""
Interactive Help Center for TeleGroup Bot.
Covers 11 comprehensive categories with:
1. What the feature does
2. Required permissions
3. Exact command syntax
4. Realistic example
5. What response to expect
6. Common errors and their solutions
"""

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from bot.keyboards.inline import get_help_center_keyboard

router = Router(name="help_center")


HELP_TOPICS = {
    "help_getting_started": (
        "🚀 **Getting Started with TeleGroup Bot**\n\n"
        "**1. What it does:**\n"
        "TeleGroup Bot lets you manage, protect, and synchronize multiple Telegram groups directly from this private chat without needing to memorize complicated commands.\n\n"
        "**2. Required permissions:**\n"
        "• Bot must be added as Administrator in each group with: Delete Messages, Ban/Restrict Members, Invite via Link, Pin Messages.\n"
        "• You must be an Administrator in the groups you connect.\n\n"
        "**3. Exact command syntax:**\n"
        "• `/start` (in private chat) — Opens main dashboard\n"
        "• `/linkgroup` (in each group) — Generates temporary connection code\n"
        "• `/connect <CODE_A> <CODE_B>` (in private) — Connects both groups\n\n"
        "**4. Realistic example:**\n"
        "Add bot to Group A and Group B. Run `/linkgroup` in both. Then run `/connect A7XK92 B4MPL8` in private chat.\n\n"
        "**5. What response to expect:**\n"
        "✅ `Groups Connected Successfully` with instant controls for cross-posting and welcome flows.\n\n"
        "**6. Common errors and solutions:**\n"
        "• *Error: Bot cannot read messages*: Go to @BotFather -> /setprivacy -> Disabled for full functionality."
    ),
    "help_linking": (
        "🔗 **Group Connection Guide**\n\n"
        "**1. What it does:**\n"
        "Pairs two or more groups securely using single-use, 10-minute expiring alphanumeric codes.\n\n"
        "**2. Required permissions:**\n"
        "• Administrator status in both groups\n"
        "• Bot must have 'Change Group Info' and 'Add Admins' or 'Delete Messages' rights\n\n"
        "**3. Exact command syntax:**\n"
        "`/linkgroup` (in group) -> generates 6-character code\n"
        "`/connect <CODE_1> <CODE_2>` (in private bot chat)\n\n"
        "**4. Realistic example:**\n"
        "`/connect K9P2M4 W7T1X8`\n\n"
        "**5. What response to expect:**\n"
        "Detailed confirmation card displaying Source, Destination, and active pipeline status.\n\n"
        "**6. Common errors and solutions:**\n"
        "• *Code expired*: Run `/linkgroup` again to generate a fresh single-use code."
    ),
    "help_crossposting": (
        "🔄 **Cross-Posting Between Groups Guide**\n\n"
        "**1. What it does:**\n"
        "Automatically mirrors eligible text messages, photos, videos, audio, and documents between linked groups with full anti-loop and deduplication safeguards.\n\n"
        "**2. Required permissions:**\n"
        "• Bot needs 'Send Messages' and 'Send Media' in the destination group\n\n"
        "**3. Exact command syntax:**\n"
        "• `/crosspost_status` — View active pipelines\n"
        "• `/crosspost_pause` — Temporarily halt routing\n"
        "• `/crosspost_resume` — Resume message routing\n\n"
        "**4. Realistic example:**\n"
        "When member posts in Group A: 'Release v2.0 live!', bot replicates it in Group B without forward author tags (or with attribution if configured).\n\n"
        "**5. What response to expect:**\n"
        "Instant delivery (<200ms) with unique destination message ID logged in database.\n\n"
        "**6. Common errors and solutions:**\n"
        "• *Protected content error*: Telegram does not allow copying from channels or groups with 'Restrict saving content' enabled."
    ),
    "help_welcome": (
        "👋 **Welcome & Auto-Delete System Guide**\n\n"
        "**1. What it does:**\n"
        "Greets new arrivals with customizable messages, image banners, and inline URL buttons, then automatically deletes the message to keep the chat tidy.\n\n"
        "**2. Required permissions:**\n"
        "• Bot needs 'Delete Messages' permission in the group.\n\n"
        "**3. Exact command syntax:**\n"
        "Configured from private chat: Dashboard -> My Groups -> [Select Group] -> Welcome Flow.\n\n"
        "**4. Realistic example:**\n"
        "`👋 Welcome {first_name} to {group_name}! Read our rules below.`\n\n"
        "**5. What response to expect:**\n"
        "Welcome message appears when a member joins, displays inline buttons, and disappears after configured countdown (e.g. 60s).\n\n"
        "**6. Common errors and solutions:**\n"
        "• *Welcome message doesn't delete*: Ensure bot has 'Delete Messages' rights."
    ),
    "help_moderation": (
        "🛡️ **Moderation Commands Guide**\n\n"
        "**1. What it does:**\n"
        "Provides commands to warn, mute, ban, unban, kick, and purge rule-breakers.\n\n"
        "**2. Required permissions:**\n"
        "• Admin status with 'Ban Users' and 'Delete Messages' rights.\n\n"
        "**3. Exact command syntax:**\n"
        "• `/warn [reason]` (reply to target)\n"
        "• `/warnings` (check count)\n"
        "• `/resetwarn` (reset count)\n"
        "• `/mute [duration] [reason]` (e.g. `/mute 15m Flood`)\n"
        "• `/unmute` (restore rights)\n"
        "• `/ban [reason]`\n"
        "• `/kick`\n"
        "• `/purge` (reply to start message)\n\n"
        "**4. Realistic example:**\n"
        "Reply to a spammer: `/warn Spamming telegram links`\n\n"
        "**5. What response to expect:**\n"
        "Bot records warning, announces count (e.g. `2/3`), and triggers auto-mute/ban if limit is reached.\n\n"
        "**6. Common errors and solutions:**\n"
        "• *Cannot mute/ban*: Administrators cannot be punished by the bot."
    ),
    "help_antispam": (
        "🚫 **Anti-Spam & Safety Guide**\n\n"
        "**1. What it does:**\n"
        "Protects your group 24/7 against flood attacks, rapid repeated messages, unsolicited external links, and forbidden words.\n\n"
        "**2. Required permissions:**\n"
        "• Bot needs 'Delete Messages' permission.\n\n"
        "**3. Configuration:**\n"
        "Adjust Flood Limit (e.g. 5 msgs / 5s), Repeat Limit (3 msgs), and Link Filtering directly from the private dashboard.\n\n"
        "**4. Realistic example:**\n"
        "A spammer sends 6 rapid messages; the bot deletes them immediately and sends a warning notice.\n\n"
        "**5. What response to expect:**\n"
        "Spam messages vanish within milliseconds.\n\n"
        "**6. Common errors and solutions:**\n"
        "• *Legitimate links blocked*: Administrators and trusted users are automatically exempt."
    ),
    "help_promotions": (
        "📢 **Promotion Builder Guide**\n\n"
        "**1. What it does:**\n"
        "Lets admins craft eye-catching promotional cards with custom inline URL buttons and publish them to selected groups.\n\n"
        "**2. Required permissions:**\n"
        "• Bot admin in destination group with 'Send Messages' permission.\n\n"
        "**3. Workflow:**\n"
        "1. Open Private Chat -> Promotions -> Create Promotion\n"
        "2. Provide promotional text and optional banner image URL\n"
        "3. Add inline buttons with text label + destination URL\n"
        "4. Preview and tap 'Publish to Group'\n\n"
        "**4. Realistic example:**\n"
        "Button: `🚀 Join Channel` -> `https://t.me/mychannel`\n\n"
        "**5. What response to expect:**\n"
        "Formatted post published to the selected group with clickable inline buttons.\n\n"
        "**6. Common errors and solutions:**\n"
        "• *Button URL invalid*: Telegram requires full valid URLs starting with `http://` or `https://`."
    ),
    "help_scheduling": (
        "⏰ **Scheduled Messages Guide**\n\n"
        "**1. What it does:**\n"
        "Schedules recurring announcements (daily reminders, weekly community check-ins) to be sent automatically.\n\n"
        "**2. Required permissions:**\n"
        "• Bot must have 'Send Messages' permission in the target group.\n\n"
        "**3. Configuration:**\n"
        "Available in Group Settings -> Scheduled Messages.\n\n"
        "**4. Realistic example:**\n"
        "Send daily rules reminder every 24 hours at 09:00 UTC.\n\n"
        "**5. Common errors and solutions:**\n"
        "• Ensure server clock is in UTC to calculate run times reliably."
    ),
    "help_settings": (
        "⚙️ **Group Settings Guide**\n\n"
        "**1. What it does:**\n"
        "Centralized configuration for warning thresholds, action punishments, flood limits, and rules text.\n\n"
        "**2. How to access:**\n"
        "Private Chat -> Dashboard -> My Groups -> [Choose Group]\n\n"
        "**3. Options available:**\n"
        "• Warn threshold (1 to 10 warnings)\n"
        "• Warn action (Mute, Kick, Ban)\n"
        "• Welcome template & auto-delete duration\n"
        "• External link filter toggle\n"
        "• Custom rules text"
    ),
    "help_troubleshooting": (
        "🔧 **Troubleshooting Guide**\n\n"
        "**1. Bot not responding in group:**\n"
        "• Verify bot is an administrator in the group.\n"
        "• Check that Privacy Mode in @BotFather is set to 'Disabled' if you want the bot to see all messages for filters and cross-posting.\n\n"
        "**2. Cross-posting is not sending messages:**\n"
        "• Check if the pipeline is active or paused via `/crosspost_status`.\n"
        "• Verify bot has 'Send Messages' and 'Send Media' rights in the target group.\n\n"
        "**3. Welcome messages not auto-deleting:**\n"
        "• Ensure bot has 'Delete Messages' permission.\n\n"
        "**4. Token revoked:**\n"
        "• If bot token was compromised, generate a new one in @BotFather with `/revoke` and update your `.env` file immediately."
    ),
    "help_all_commands": (
        "📋 **All Commands Reference**\n\n"
        "**Private Chat Commands:**\n"
        "• `/start` — Open main interactive dashboard\n"
        "• `/connect <CODE_A> <CODE_B>` — Link two groups\n"
        "• `/help` — Open this interactive Help Center\n\n"
        "**Group Management Commands:**\n"
        "• `/linkgroup` — Generate connection code for this group\n"
        "• `/rules` — Display current group rules\n"
        "• `/id` — Display chat ID and user ID\n"
        "• `/ping` — Check bot response time\n\n"
        "**Moderation Commands:**\n"
        "• `/warn [reason]` — Warn replied user\n"
        "• `/warnings` — Check user warning count\n"
        "• `/resetwarn` — Clear user warnings\n"
        "• `/mute [duration] [reason]` — Mute member\n"
        "• `/unmute` — Remove mute restriction\n"
        "• `/ban [reason]` — Ban member permanently\n"
        "• `/unban` — Unban member\n"
        "• `/kick` — Kick member from group\n"
        "• `/purge` — Batch delete messages from reply\n"
        "• `/report` — Report spam to admins\n\n"
        "**Cross-Posting Commands:**\n"
        "• `/crosspost_status` — Check pipeline status\n"
        "• `/crosspost_pause` — Pause current pipeline\n"
        "• `/crosspost_resume` — Resume pipeline"
    )
}


@router.message(Command("help"), F.chat.type == "private")
async def cmd_help_private(message: Message):
    """Handle /help in private chat."""
    intro = (
        "📚 **TeleGroup Help Center**\n\n"
        "Select a topic below for detailed instructions, syntax examples, and troubleshooting:"
    )
    await message.answer(intro, reply_markup=get_help_center_keyboard(), parse_mode="Markdown")


@router.callback_query(F.data == "nav_help")
async def cb_help_menu(call: CallbackQuery):
    """Callback to open help center."""
    intro = (
        "📚 **TeleGroup Help Center**\n\n"
        "Select a topic below for detailed instructions, syntax examples, and troubleshooting:"
    )
    await call.message.edit_text(intro, reply_markup=get_help_center_keyboard(), parse_mode="Markdown")
    await call.answer()


@router.callback_query(F.data.startswith("help_"))
async def cb_show_topic(call: CallbackQuery):
    """Show detailed topic content."""
    topic_key = call.data
    content = HELP_TOPICS.get(topic_key, "Topic details coming soon.")

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="« Back to Help Topics", callback_data="nav_help")],
        [InlineKeyboardButton(text="🏠 Main Menu", callback_data="nav_main_menu")]
    ])

    await call.message.edit_text(content, reply_markup=kb, parse_mode="Markdown")
    await call.answer()

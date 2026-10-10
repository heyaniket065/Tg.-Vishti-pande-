"""
Telegram Inline Keyboards for TeleGroup Bot.
Structured for private dashboard, group management, cross-posting wizard,
welcome builder, moderation controls, and help center navigation.
"""

from typing import List, Optional, Dict, Any
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton


def get_main_menu_keyboard() -> InlineKeyboardMarkup:
    """Primary 12-button private chat dashboard menu."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🏠 Dashboard", callback_data="nav_dashboard"),
                InlineKeyboardButton(text="👥 My Groups", callback_data="nav_my_groups"),
            ],
            [
                InlineKeyboardButton(text="🔗 Connect Groups", callback_data="nav_connect_groups"),
                InlineKeyboardButton(text="🔄 Cross-Posting", callback_data="nav_crosspost"),
            ],
            [
                InlineKeyboardButton(text="👋 Welcome System", callback_data="nav_welcome"),
                InlineKeyboardButton(text="🛡️ Moderation", callback_data="nav_moderation"),
            ],
            [
                InlineKeyboardButton(text="📢 Promotions", callback_data="nav_promotions"),
                InlineKeyboardButton(text="⚙️ Group Settings", callback_data="nav_settings"),
            ],
            [
                InlineKeyboardButton(text="📊 Statistics", callback_data="nav_stats"),
                InlineKeyboardButton(text="📋 Logs", callback_data="nav_logs"),
            ],
            [
                InlineKeyboardButton(text="🌐 Language / भाषा", callback_data="nav_language"),
                InlineKeyboardButton(text="📚 Help & Commands", callback_data="nav_help"),
            ],
            [
                InlineKeyboardButton(text="🔍 Bot Status", callback_data="nav_status"),
            ],
        ]
    )


def get_language_selection_keyboard() -> InlineKeyboardMarkup:
    """Inline keyboard for switching user language."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🇮🇳 Hinglish (Aap aisa karo)", callback_data="set_lang_hinglish")],
            [InlineKeyboardButton(text="🇬🇧 English", callback_data="set_lang_english")],
            [InlineKeyboardButton(text="🇮🇳 हिन्दी (Hindi)", callback_data="set_lang_hindi")],
            [InlineKeyboardButton(text="🚩 मराठी (Marathi)", callback_data="set_lang_marathi")],
            [InlineKeyboardButton(text="« Back to Main Menu", callback_data="nav_main_menu")],
        ]
    )


def get_back_button(target: str = "nav_main_menu") -> List[InlineKeyboardButton]:
    """Uniform Back to Menu button row."""
    return [InlineKeyboardButton(text="« Back to Main Menu", callback_data=target)]


def get_groups_list_keyboard(groups: List[Dict[str, Any]], page: int = 0, page_size: int = 5) -> InlineKeyboardMarkup:
    """Group selector list with pagination and details action."""
    rows: List[List[InlineKeyboardButton]] = []
    start_idx = page * page_size
    end_idx = start_idx + page_size
    current_page_groups = groups[start_idx:end_idx]

    for g in current_page_groups:
        title = g.get("title", f"Group {g.get('id')}")
        status = "🟢" if g.get("is_active", True) else "🔴"
        rows.append([
            InlineKeyboardButton(
                text=f"{status} {title}",
                callback_data=f"group_detail_{g.get('id')}"
            )
        ])

    # Pagination controls
    nav_row = []
    if page > 0:
        nav_row.append(InlineKeyboardButton(text="◀ Prev", callback_data=f"groups_page_{page-1}"))
    if end_idx < len(groups):
        nav_row.append(InlineKeyboardButton(text="Next ▶", callback_data=f"groups_page_{page+1}"))
    if nav_row:
        rows.append(nav_row)

    rows.append([InlineKeyboardButton(text="➕ Link New Group", callback_data="nav_connect_groups")])
    rows.append(get_back_button())
    return InlineKeyboardMarkup(inline_keyboard=rows)


def get_group_detail_keyboard(group_id: int) -> InlineKeyboardMarkup:
    """Manage an individual selected group."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="👋 Welcome Flow", callback_data=f"grp_welcome_{group_id}"),
                InlineKeyboardButton(text="🛡️ Moderation", callback_data=f"grp_mod_{group_id}"),
            ],
            [
                InlineKeyboardButton(text="🚫 Anti-Spam", callback_data=f"grp_antispam_{group_id}"),
                InlineKeyboardButton(text="🔄 Cross-Posting", callback_data=f"grp_crosspost_{group_id}"),
            ],
            [
                InlineKeyboardButton(text="💬 Auto-Replies", callback_data=f"grp_filters_{group_id}"),
                InlineKeyboardButton(text="📜 Edit Rules", callback_data=f"grp_rules_{group_id}"),
            ],
            [
                InlineKeyboardButton(text="🔑 Generate Link Code", callback_data=f"gen_code_{group_id}"),
                InlineKeyboardButton(text="❌ Unlink Group", callback_data=f"confirm_unlink_{group_id}"),
            ],
            [InlineKeyboardButton(text="« Back to Groups", callback_data="nav_my_groups")],
        ]
    )


def get_crosspost_keyboard(connections: List[Dict[str, Any]]) -> InlineKeyboardMarkup:
    """Cross-posting pipeline management menu."""
    rows: List[List[InlineKeyboardButton]] = []
    for conn in connections:
        status_icon = "🟢" if conn.get("is_active") else "⏸️"
        name = conn.get("name", f"Pipeline #{conn.get('id')}")
        direction = conn.get("direction", "A_TO_B").replace("_", " ")
        rows.append([
            InlineKeyboardButton(
                text=f"{status_icon} {name} ({direction})",
                callback_data=f"cp_detail_{conn.get('id')}"
            )
        ])

    rows.append([
        InlineKeyboardButton(text="➕ Create Cross-Post Pipeline", callback_data="cp_create_wizard")
    ])
    rows.append(get_back_button())
    return InlineKeyboardMarkup(inline_keyboard=rows)


def get_crosspost_detail_keyboard(conn_id: int, is_active: bool) -> InlineKeyboardMarkup:
    """Detailed options for a single cross-posting connection."""
    toggle_text = "⏸️ Pause Pipeline" if is_active else "▶️ Resume Pipeline"
    toggle_cb = f"cp_pause_{conn_id}" if is_active else f"cp_resume_{conn_id}"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=toggle_text, callback_data=toggle_cb)],
            [
                InlineKeyboardButton(text="🔄 Change Direction", callback_data=f"cp_dir_{conn_id}"),
                InlineKeyboardButton(text="⚙️ Change Mode", callback_data=f"cp_mode_{conn_id}"),
            ],
            [
                InlineKeyboardButton(text="🗑️ Delete Connection", callback_data=f"cp_delete_confirm_{conn_id}")
            ],
            [InlineKeyboardButton(text="« Back to Cross-Posting", callback_data="nav_crosspost")],
        ]
    )


def get_welcome_editor_keyboard(group_id: int, is_enabled: bool, delete_delay: int) -> InlineKeyboardMarkup:
    """Welcome message customizer keyboard."""
    status_text = "🟢 Enabled (Turn Off)" if is_enabled else "🔴 Disabled (Turn On)"
    del_str = f"{delete_delay}s" if delete_delay > 0 else "Off"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=status_text, callback_data=f"wlc_toggle_{group_id}")],
            [
                InlineKeyboardButton(text="✏️ Edit Template Text", callback_data=f"wlc_text_{group_id}"),
                InlineKeyboardButton(text=f"⏱️ Auto-Delete: {del_str}", callback_data=f"wlc_timer_{group_id}"),
            ],
            [
                InlineKeyboardButton(text="🔗 Custom URL Buttons", callback_data=f"wlc_buttons_{group_id}"),
                InlineKeyboardButton(text="🖼️ Welcome Media URL", callback_data=f"wlc_media_{group_id}"),
            ],
            [
                InlineKeyboardButton(text="👁️ Test Preview", callback_data=f"wlc_preview_{group_id}"),
            ],
            [InlineKeyboardButton(text="« Back to Group", callback_data=f"group_detail_{group_id}")],
        ]
    )


def get_delete_timer_selector_keyboard(group_id: int) -> InlineKeyboardMarkup:
    """Delay intervals for welcome auto-delete."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="10 seconds", callback_data=f"wlc_set_timer_{group_id}_10"),
                InlineKeyboardButton(text="30 seconds", callback_data=f"wlc_set_timer_{group_id}_30"),
            ],
            [
                InlineKeyboardButton(text="60 seconds (Default)", callback_data=f"wlc_set_timer_{group_id}_60"),
                InlineKeyboardButton(text="120 seconds", callback_data=f"wlc_set_timer_{group_id}_120"),
            ],
            [
                InlineKeyboardButton(text="300 seconds (5 min)", callback_data=f"wlc_set_timer_{group_id}_300"),
                InlineKeyboardButton(text="Keep Forever (0s)", callback_data=f"wlc_set_timer_{group_id}_0"),
            ],
            [InlineKeyboardButton(text="« Back to Welcome Settings", callback_data=f"grp_welcome_{group_id}")],
        ]
    )


def get_moderation_settings_keyboard(group_id: int, warn_limit: int, action: str) -> InlineKeyboardMarkup:
    """Moderation threshold controls."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=f"⚠️ Warning Threshold: {warn_limit}", callback_data=f"mod_warn_thresh_{group_id}"),
                InlineKeyboardButton(text=f"⚡ Action: {action.upper()}", callback_data=f"mod_warn_action_{group_id}"),
            ],
            [
                InlineKeyboardButton(text="⏳ Default Mute Duration", callback_data=f"mod_mute_dur_{group_id}"),
                InlineKeyboardButton(text="📋 View Group Warns", callback_data=f"mod_view_warns_{group_id}"),
            ],
            [InlineKeyboardButton(text="« Back to Group", callback_data=f"group_detail_{group_id}")],
        ]
    )


def get_antispam_keyboard(group_id: int, block_links: bool, flood_limit: int, repeat_limit: int) -> InlineKeyboardMarkup:
    """Anti-spam toggle buttons."""
    link_status = "🟢 Enabled" if block_links else "🔴 Disabled"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=f"🔗 Block External Links: {link_status}", callback_data=f"as_toggle_links_{group_id}")
            ],
            [
                InlineKeyboardButton(text=f"🌊 Flood Limit: {flood_limit} msgs/5s", callback_data=f"as_flood_{group_id}"),
                InlineKeyboardButton(text=f"🔁 Repeat Limit: {repeat_limit} msgs", callback_data=f"as_repeat_{group_id}"),
            ],
            [
                InlineKeyboardButton(text="🚫 Word Blocklist", callback_data=f"as_words_{group_id}")
            ],
            [InlineKeyboardButton(text="« Back to Group", callback_data=f"group_detail_{group_id}")],
        ]
    )


def get_help_center_keyboard() -> InlineKeyboardMarkup:
    """11 help categories requested in specifications."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🚀 Getting Started", callback_data="help_getting_started"),
                InlineKeyboardButton(text="🔗 Group Linking Guide", callback_data="help_linking"),
            ],
            [
                InlineKeyboardButton(text="🔄 Cross-Posting Guide", callback_data="help_crossposting"),
                InlineKeyboardButton(text="👋 Welcome Setup", callback_data="help_welcome"),
            ],
            [
                InlineKeyboardButton(text="🛡️ Moderation Commands", callback_data="help_moderation"),
                InlineKeyboardButton(text="🚫 Anti-Spam & Safety", callback_data="help_antispam"),
            ],
            [
                InlineKeyboardButton(text="📢 Promotion Builder", callback_data="help_promotions"),
                InlineKeyboardButton(text="⏰ Scheduled Messages", callback_data="help_scheduling"),
            ],
            [
                InlineKeyboardButton(text="⚙️ Group Settings", callback_data="help_settings"),
                InlineKeyboardButton(text="🔧 Troubleshooting", callback_data="help_troubleshooting"),
            ],
            [
                InlineKeyboardButton(text="📋 All Commands Reference", callback_data="help_all_commands")
            ],
            get_back_button(),
        ]
    )

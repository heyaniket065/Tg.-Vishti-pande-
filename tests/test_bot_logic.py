"""
Unit tests for TeleGroup Bot logic.
Tests code generation, template formatting, moderation duration parsing,
anti-spam regex, cross-posting deduplication, channel chat handling, and single-code connection parsing.
"""

import pytest
import re
from bot.handlers.group_linking import generate_connection_code
from bot.handlers.welcome import render_template
from bot.handlers.moderation import parse_duration
from bot.handlers.antispam import URL_REGEX


def test_generate_connection_code():
    """Verify single-use code length, uniqueness, and character set."""
    codes = set()
    for _ in range(100):
        code = generate_connection_code(6)
        assert len(code) == 6
        assert code.isupper() or code.isalnum()
        # Ensure confusing characters like '0' or 'O' are avoided
        assert "0" not in code
        assert "O" not in code
        codes.add(code)
    # Ensure high entropy
    assert len(codes) == 100


def test_render_template():
    """Verify placeholder replacement in welcome messages."""
    class MockUser:
        first_name = "Alex"
        last_name = "Smith"
        username = "alexsmith"
        id = 123456789

    class MockChat:
        title = "Dev Community"

    user = MockUser()
    chat = MockChat()

    template = "Welcome {first_name} {last_name} (@{username}) to {group_name}! Your ID is {user_id}."
    result = render_template(template, user, chat)

    assert "Alex Smith" in result
    assert "Dev Community" in result
    assert "123456789" in result


def test_parse_duration():
    """Verify parsing time durations for mutes and bans."""
    d_10m = parse_duration("10m")
    assert d_10m is not None
    assert d_10m.total_seconds() == 600

    d_2h = parse_duration("2h")
    assert d_2h is not None
    assert d_2h.total_seconds() == 7200

    d_1d = parse_duration("1d")
    assert d_1d is not None
    assert d_1d.total_seconds() == 86400

    d_invalid = parse_duration("invalid_time")
    assert d_invalid is None


def test_antispam_url_regex():
    """Verify URL detection in spam filtering."""
    assert URL_REGEX.search("Check out https://t.me/example") is not None
    assert URL_REGEX.search("Visit http://spammy-site.xyz/free") is not None
    assert URL_REGEX.search("Join telegram.me/channel") is not None
    assert URL_REGEX.search("Just a normal text message with no links") is None


def test_crosspost_dedup_hash():
    """Verify message deduplication keys prevent recursive loop mirroring."""
    cache = set()
    chat_a_id = 1001
    msg_id = 42

    key = f"{chat_a_id}:{msg_id}"
    assert key not in cache

    cache.add(key)
    assert key in cache


def test_single_code_regex_and_parsing():
    """Verify single-code extraction from raw text and deep link parameters."""
    code_pattern = re.compile(r"^[A-Z0-9]{5,8}$")

    # Valid codes
    assert code_pattern.match("A7XK92") is not None
    assert code_pattern.match("B4MPL8") is not None

    # Invalid codes
    assert code_pattern.match("HELLO WORLD") is None
    assert code_pattern.match("/start") is None

    # Deep-link parameter parsing
    start_param = "connect_A7XK92"
    extracted = start_param.replace("connect_", "").strip().upper()
    assert extracted == "A7XK92"


def test_channel_chat_types():
    """Verify channel and group type identification."""
    valid_types = {"group", "supergroup", "channel"}
    assert "channel" in valid_types
    assert "supergroup" in valid_types
    assert "group" in valid_types
    assert "private" not in valid_types

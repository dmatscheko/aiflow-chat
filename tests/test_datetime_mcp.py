"""Unit tests for datetime-mcp: get_datetime tool."""

import os
import sys
import datetime
import pytest

_server_dir = os.path.join(os.path.dirname(__file__), "..", "_mcp_servers", "datetime-mcp")
sys.path.insert(0, _server_dir)

# Import directly - this module has no problematic top-level code
import importlib

spec = importlib.util.spec_from_file_location(
    "datetime_mcp",
    os.path.join(_server_dir, "datetime-mcp.py"),
)
_dt_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(_dt_mod)


class TestGetDatetime:
    def test_returns_iso_format_string(self):
        result = _dt_mod.get_datetime()
        assert isinstance(result, str)
        # Should be parseable as ISO format
        parsed = datetime.datetime.fromisoformat(result)
        assert isinstance(parsed, datetime.datetime)

    def test_returns_current_time_approximately(self):
        before = datetime.datetime.now()
        result = _dt_mod.get_datetime()
        after = datetime.datetime.now()
        parsed = datetime.datetime.fromisoformat(result)
        assert before <= parsed <= after

    def test_contains_date_and_time(self):
        result = _dt_mod.get_datetime()
        # ISO format contains 'T' separator between date and time
        assert "T" in result or "-" in result

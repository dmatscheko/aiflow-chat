"""Unit tests for filesystem_write MCP: _apply_simplified_patch."""

import os
import sys
import tempfile
import pytest

_server_dir = os.path.join(os.path.dirname(__file__), "..", "_mcp_servers", "filesystem_write-mcp")


def _import_fsw_module():
    """Import filesystem_write module, patching sys.argv to avoid top-level exit."""
    original_argv = sys.argv
    tmpdir = tempfile.mkdtemp()
    sys.argv = ["test", tmpdir]
    sys.path.insert(0, _server_dir)
    try:
        import importlib

        spec = importlib.util.spec_from_file_location(
            "filesystem_write_mcp",
            os.path.join(_server_dir, "filesystem_write-mcp.py"),
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        sys.argv = original_argv


_fsw_mod = _import_fsw_module()


class TestApplySimplifiedPatch:
    def test_simple_line_replacement(self):
        original = "line 1\nline 2\nline 3"
        diff = "### ###\n-line 2\n+line TWO"
        new_content, report = _fsw_mod._apply_simplified_patch(original, diff)
        assert new_content == "line 1\nline TWO\nline 3"
        assert "successfully" in report

    def test_add_lines(self):
        original = "aaa\nbbb\nccc"
        # Context lines have no prefix in this format (bare lines, not space-prefixed)
        diff = "### ###\nbbb\n+inserted\nccc"
        new_content, report = _fsw_mod._apply_simplified_patch(original, diff)
        assert new_content == "aaa\nbbb\ninserted\nccc"

    def test_remove_lines(self):
        original = "keep\nremove me\nalso keep"
        diff = "### ###\nkeep\n-remove me\nalso keep"
        new_content, report = _fsw_mod._apply_simplified_patch(original, diff)
        assert new_content == "keep\nalso keep"

    def test_multiple_segments(self):
        original = "a\nb\nc\nd\ne"
        diff = "### ###\n-b\n+B\n### ###\n-d\n+D"
        new_content, report = _fsw_mod._apply_simplified_patch(original, diff)
        assert new_content == "a\nB\nc\nD\ne"

    def test_line_hint(self):
        original = "a\nb\nc\nd\ne"
        diff = "### line >= 4 ###\n-d\n+REPLACED"
        new_content, report = _fsw_mod._apply_simplified_patch(original, diff)
        assert new_content == "a\nb\nc\nREPLACED\ne"

    def test_no_segment_header_raises(self):
        original = "hello"
        diff = "-hello\n+world"
        with pytest.raises(_fsw_mod.CustomError, match="no segment separators"):
            _fsw_mod._apply_simplified_patch(original, diff)

    def test_unmatched_from_lines_raises(self):
        original = "aaa\nbbb"
        diff = "### ###\n-zzz\n+yyy"
        with pytest.raises(_fsw_mod.CustomError, match="could not be applied"):
            _fsw_mod._apply_simplified_patch(original, diff)

    def test_insert_only_segment(self):
        original = "first\nsecond"
        diff = "### ###\n+new first line"
        new_content, report = _fsw_mod._apply_simplified_patch(original, diff)
        assert new_content == "new first line\nfirst\nsecond"

    def test_context_lines_matching(self):
        original = "header\nfoo\nbar\nbaz\nfooter"
        # Context lines are bare (no space prefix) in this patch format
        diff = "### ###\nheader\nfoo\n-bar\n+BAR\nbaz"
        new_content, report = _fsw_mod._apply_simplified_patch(original, diff)
        assert new_content == "header\nfoo\nBAR\nbaz\nfooter"

    def test_preserves_trailing_content(self):
        original = "a\nb\nc\nd\ne\nf"
        diff = "### ###\n-c\n+C"
        new_content, _ = _fsw_mod._apply_simplified_patch(original, diff)
        lines = new_content.split("\n")
        assert lines == ["a", "b", "C", "d", "e", "f"]


class TestNormalizeVirtualPathWrite:
    """Test normalize_virtual_path in the write module (same logic as read)."""

    def test_empty(self):
        assert _fsw_mod.normalize_virtual_path("") == "/"

    def test_dot(self):
        assert _fsw_mod.normalize_virtual_path(".") == "/"

    def test_relative(self):
        assert _fsw_mod.normalize_virtual_path("a/b") == "/a/b"

    def test_dot_slash(self):
        assert _fsw_mod.normalize_virtual_path("./x") == "/x"

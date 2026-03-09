"""Unit tests for filesystem MCP path mapping and security."""

import os
import sys
import tempfile
import pytest

# Import from the filesystem_read MCP server.
# The module has top-level code that calls sys.exit, so we need to handle that.
_server_dir = os.path.join(os.path.dirname(__file__), "..", "_mcp_servers", "filesystem_read-mcp")


def _import_fs_module():
    """Import filesystem module, patching sys.argv to avoid top-level exit."""
    original_argv = sys.argv
    tmpdir = tempfile.mkdtemp()
    sys.argv = ["test", tmpdir]
    sys.path.insert(0, _server_dir)
    try:
        # Use importlib to get a clean import
        import importlib

        spec = importlib.util.spec_from_file_location(
            "filesystem_read_mcp",
            os.path.join(_server_dir, "filesystem_read-mcp.py"),
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod, tmpdir
    finally:
        sys.argv = original_argv


_fs_mod, _initial_tmpdir = _import_fs_module()


# --- normalize_virtual_path ---


class TestNormalizeVirtualPath:
    def test_empty_string(self):
        assert _fs_mod.normalize_virtual_path("") == "/"

    def test_dot(self):
        assert _fs_mod.normalize_virtual_path(".") == "/"

    def test_relative_dot_slash(self):
        assert _fs_mod.normalize_virtual_path("./a/b") == "/a/b"

    def test_no_leading_slash(self):
        assert _fs_mod.normalize_virtual_path("a/b") == "/a/b"

    def test_already_normalized(self):
        assert _fs_mod.normalize_virtual_path("/a/file.txt") == "/a/file.txt"


# --- set_allowed_dirs / virtual_to_real_path ---


class TestVirtualToRealPath:
    @pytest.fixture(autouse=True)
    def setup_dirs(self, tmp_path):
        self.dir_a = str(tmp_path / "project_a")
        self.dir_b = str(tmp_path / "project_b")
        os.makedirs(self.dir_a)
        os.makedirs(self.dir_b)
        # Create a test file
        with open(os.path.join(self.dir_a, "test.txt"), "w") as f:
            f.write("hello")
        _fs_mod.set_allowed_dirs([self.dir_a, self.dir_b])

    def test_maps_first_dir_to_a(self):
        real = _fs_mod.virtual_to_real_path("/a/test.txt")
        assert real.endswith("test.txt")
        assert os.path.dirname(real) == os.path.realpath(self.dir_a)

    def test_maps_second_dir_to_b(self):
        real = _fs_mod.virtual_to_real_path("/b")
        assert real == os.path.realpath(self.dir_b)

    def test_root_raises_is_a_directory(self):
        with pytest.raises(IsADirectoryError):
            _fs_mod.virtual_to_real_path("/")

    def test_invalid_virtual_prefix_raises(self):
        with pytest.raises(_fs_mod.CustomError):
            _fs_mod.virtual_to_real_path("/z/something")

    def test_directory_traversal_blocked(self):
        with pytest.raises(PermissionError):
            _fs_mod.virtual_to_real_path("/a/../../etc/passwd")

    def test_symlink_traversal_blocked(self, tmp_path):
        # Create a symlink pointing outside allowed dirs
        outside = str(tmp_path / "outside")
        os.makedirs(outside)
        link_path = os.path.join(self.dir_a, "evil_link")
        os.symlink(outside, link_path)
        with pytest.raises(PermissionError):
            _fs_mod.virtual_to_real_path("/a/evil_link")


# --- get_error_message ---


class TestGetErrorMessage:
    def test_file_not_found(self):
        msg = _fs_mod.get_error_message("Read failed", "/a/missing.txt", FileNotFoundError())
        assert "No such file or directory" in msg
        assert "/a/missing.txt" in msg

    def test_permission_error(self):
        msg = _fs_mod.get_error_message("Access", "/a/secret", PermissionError())
        assert "Permission denied" in msg

    def test_is_a_directory(self):
        msg = _fs_mod.get_error_message("Op", "/a", IsADirectoryError())
        assert "Is a directory" in msg

    def test_custom_error(self):
        msg = _fs_mod.get_error_message("Op", "/x", _fs_mod.CustomError("bad path"))
        assert "bad path" in msg

    def test_none_virtual_path(self):
        msg = _fs_mod.get_error_message("Op", None, ValueError())
        assert "Unknown path" in msg


# --- head_file / tail_file ---


class TestHeadTailFile:
    @pytest.fixture(autouse=True)
    def create_test_file(self, tmp_path):
        self.test_file = str(tmp_path / "lines.txt")
        with open(self.test_file, "w") as f:
            for i in range(1, 11):
                f.write(f"line {i}\n")

    def test_head_3_lines(self):
        result = _fs_mod.head_file(self.test_file, 3)
        assert result == "line 1\nline 2\nline 3\n"

    def test_head_more_than_file(self):
        result = _fs_mod.head_file(self.test_file, 100)
        assert result.count("\n") == 10

    def test_tail_3_lines(self):
        result = _fs_mod.tail_file(self.test_file, 3)
        assert result == "line 8\nline 9\nline 10\n"

    def test_tail_1_line(self):
        result = _fs_mod.tail_file(self.test_file, 1)
        assert result == "line 10\n"

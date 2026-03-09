"""Unit tests for main.py: load_config and validate_servers."""

import json
import os
import tempfile
import pytest

# We need to import from main.py in the project root.
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import load_config, validate_servers


# --- load_config ---


class TestLoadConfig:
    def test_loads_valid_config(self, tmp_path, monkeypatch):
        config = {"dt": {"command": "uvx", "args": ["fastmcp", "run", "script.py"]}}
        config_file = tmp_path / "mcp_config.json"
        config_file.write_text(json.dumps(config))
        monkeypatch.setenv("MCP_CONFIG", str(config_file))
        result = load_config()
        assert result == config

    def test_returns_empty_dict_for_missing_file(self, monkeypatch):
        monkeypatch.setenv("MCP_CONFIG", "/nonexistent/path/config.json")
        result = load_config()
        assert result == {}

    def test_returns_empty_dict_for_invalid_json(self, tmp_path, monkeypatch):
        config_file = tmp_path / "bad.json"
        config_file.write_text("{invalid json!!!")
        monkeypatch.setenv("MCP_CONFIG", str(config_file))
        result = load_config()
        assert result == {}

    def test_returns_empty_dict_for_empty_file(self, tmp_path, monkeypatch):
        config_file = tmp_path / "empty.json"
        config_file.write_text("")
        monkeypatch.setenv("MCP_CONFIG", str(config_file))
        result = load_config()
        assert result == {}

    def test_uses_default_path_env_unset(self, monkeypatch):
        monkeypatch.delenv("MCP_CONFIG", raising=False)
        # Just ensure it doesn't crash; the default file may or may not exist
        result = load_config()
        assert isinstance(result, dict)


# --- validate_servers ---


class TestValidateServers:
    def test_valid_server_with_existing_script(self, tmp_path):
        script = tmp_path / "server.py"
        script.write_text("# server")
        servers = {
            "test": {
                "command": "uvx",
                "args": ["fastmcp", "run", str(script)],
            }
        }
        result = validate_servers(servers)
        assert "test" in result

    def test_skips_server_with_missing_script(self, tmp_path):
        servers = {
            "bad": {
                "command": "uvx",
                "args": ["fastmcp", "run", str(tmp_path / "nonexistent.py")],
            }
        }
        result = validate_servers(servers)
        assert "bad" not in result

    def test_keeps_server_without_run_arg(self):
        servers = {
            "custom": {
                "command": "node",
                "args": ["server.js"],
            }
        }
        result = validate_servers(servers)
        assert "custom" in result

    def test_mixed_valid_and_invalid(self, tmp_path):
        good_script = tmp_path / "good.py"
        good_script.write_text("# ok")
        servers = {
            "good": {
                "command": "uvx",
                "args": ["fastmcp", "run", str(good_script)],
            },
            "bad": {
                "command": "uvx",
                "args": ["fastmcp", "run", str(tmp_path / "missing.py")],
            },
        }
        result = validate_servers(servers)
        assert "good" in result
        assert "bad" not in result

    def test_empty_servers(self):
        assert validate_servers({}) == {}

    def test_server_with_empty_args(self):
        servers = {"empty": {"command": "uvx", "args": []}}
        result = validate_servers(servers)
        assert "empty" in result

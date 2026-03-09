"""Unit tests for stack-mcp: add_to_stack, pop_from_stack, persistence."""

import json
import os
import sys
import pytest

# Import from the MCP server module (filename has hyphen, use importlib)
import importlib.util

_server_dir = os.path.join(os.path.dirname(__file__), "..", "_mcp_servers", "stack-mcp")
_spec = importlib.util.spec_from_file_location(
    "stack_mcp", os.path.join(_server_dir, "stack-mcp.py")
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


@pytest.fixture(autouse=True)
def isolated_stack_file(tmp_path, monkeypatch):
    """Redirect stack persistence to a temp file for each test."""
    stack_file = str(tmp_path / "stack_data.json")
    monkeypatch.setattr(_mod, "_STACK_FILE", stack_file)
    yield stack_file


class TestAddToStack:
    def test_add_single_prompt(self):
        result = _mod.add_to_stack("do task 1")
        assert "stack size: 1" in result

    def test_add_multiple_prompts(self):
        _mod.add_to_stack("task 1")
        result = _mod.add_to_stack("task 2")
        assert "stack size: 2" in result

    def test_add_to_named_stack(self):
        result = _mod.add_to_stack("task A", stack_id="my-stack")
        assert "stack size: 1" in result
        # Default stack should be empty
        popped = _mod.pop_from_stack("default")
        assert popped == ""

    def test_add_to_separate_stacks(self):
        _mod.add_to_stack("a1", stack_id="a")
        _mod.add_to_stack("b1", stack_id="b")
        _mod.add_to_stack("a2", stack_id="a")
        assert _mod.pop_from_stack("a") == "a2"
        assert _mod.pop_from_stack("b") == "b1"


class TestPopFromStack:
    def test_pop_empty_stack(self):
        result = _mod.pop_from_stack()
        assert result == ""

    def test_pop_returns_last_added(self):
        _mod.add_to_stack("first")
        _mod.add_to_stack("second")
        assert _mod.pop_from_stack() == "second"

    def test_pop_until_empty(self):
        _mod.add_to_stack("a")
        _mod.add_to_stack("b")
        assert _mod.pop_from_stack() == "b"
        assert _mod.pop_from_stack() == "a"
        assert _mod.pop_from_stack() == ""

    def test_pop_removes_empty_stack_key(self, isolated_stack_file):
        _mod.add_to_stack("only one", stack_id="temp")
        _mod.pop_from_stack("temp")
        # The stack key should be cleaned up
        with open(isolated_stack_file) as f:
            data = json.load(f)
        assert "temp" not in data


class TestPersistence:
    def test_data_persists_across_load_cycles(self, isolated_stack_file):
        _mod.add_to_stack("persistent prompt")
        # Simulate fresh load
        stacks = _mod._load_all_stacks()
        assert stacks["default"] == ["persistent prompt"]

    def test_handles_corrupted_file(self, isolated_stack_file):
        with open(isolated_stack_file, "w") as f:
            f.write("not json!!!")
        stacks = _mod._load_all_stacks()
        assert stacks == {}

    def test_handles_non_dict_json(self, isolated_stack_file):
        with open(isolated_stack_file, "w") as f:
            json.dump(["a list", "not a dict"], f)
        stacks = _mod._load_all_stacks()
        assert stacks == {}

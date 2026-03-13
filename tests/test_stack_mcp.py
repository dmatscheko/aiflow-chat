"""Unit tests for stack-mcp: add_to_stack, pop_from_stack."""

import os
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
def clear_stacks():
    """Reset in-memory stacks before each test."""
    _mod._stacks.clear()
    yield
    _mod._stacks.clear()


class TestAddToStack:
    def test_add_single_prompt(self):
        result = _mod.add_to_stack("do task 1")
        assert "stack size: 1" in result

    def test_add_multiple_prompts(self):
        _mod.add_to_stack("task 1")
        result = _mod.add_to_stack("task 2")
        assert "stack size: 2" in result

    def test_add_to_named_stack(self):
        result = _mod.add_to_stack("task A", __hidden_stack_id="my-stack")
        assert "stack size: 1" in result
        # Default stack should be empty
        popped = _mod.pop_from_stack("default")
        assert popped == ""

    def test_add_to_separate_stacks(self):
        _mod.add_to_stack("a1", __hidden_stack_id="a")
        _mod.add_to_stack("b1", __hidden_stack_id="b")
        _mod.add_to_stack("a2", __hidden_stack_id="a")
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

    def test_pop_removes_empty_stack_key(self):
        _mod.add_to_stack("only one", __hidden_stack_id="temp")
        _mod.pop_from_stack("temp")
        assert "temp" not in _mod._stacks


class TestInMemoryStorage:
    def test_stacks_share_module_state(self):
        _mod.add_to_stack("prompt 1")
        assert _mod._stacks["default"] == ["prompt 1"]

    def test_stacks_isolated_between_tests(self):
        """Verify the autouse fixture clears stacks."""
        assert _mod._stacks == {}

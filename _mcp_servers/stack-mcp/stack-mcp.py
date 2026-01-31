"""
This is an MCP server that provides a stack of prompts.
"""

from fastmcp import FastMCP
from typing import Annotated

# Create an MCP server instance
mcp = FastMCP("Stack Server")

# Global stack to store prompts
_stack = []


@mcp.tool()
def add_to_stack(prompt: Annotated[str, "The prompt to add to the stack."]) -> str:
    """
    Add a prompt to the stack.
    """
    _stack.append(prompt)
    return f"Prompt added to stack. Current stack size: {len(_stack)}"


@mcp.tool()
def pop_from_stack() -> str:
    """
    Pop the latest prompt from the stack. This tool is primarily used by the 'Pop from Stack' flow step.
    """
    if not _stack:
        return "Error: Stack is empty"
    return _stack.pop()


if __name__ == "__main__":
    # Run the MCP server
    mcp.run()

import json
import os

from fastmcp import FastMCP

# Create an MCP server instance
mcp = FastMCP("Stack Server")

# Persist stacks to a JSON file so they survive process restarts
# (FastMCP proxy may spawn a new subprocess per session/call).
# Data format: { "stack_id": ["prompt1", "prompt2", ...], ... }
_STACK_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stack_data.json")


def _load_all_stacks() -> dict:
    """Load all stacks from disk."""
    try:
        with open(_STACK_FILE, "r") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return {}


def _save_all_stacks(stacks: dict) -> None:
    """Save all stacks to disk."""
    with open(_STACK_FILE, "w") as f:
        json.dump(stacks, f)


@mcp.tool()
def add_to_stack(prompt: str, stack_id: str = "default") -> str:
    """
    Adds a prompt to the stack.

    Use this when the current task might be too large / complex to finish
    without hitting the context limit.

    How to use:
    1. Decide what the very next reasonable sub-task / checkpoint is
       → keep working on THAT in the current response
    2. Put all FUTURE follow-up sub-tasks (as complete, self-contained prompts)
       on the stack using this tool — one call per sub-task
    3. Finish your answer for the current sub-task normally

    The system will later run stacked prompts one-by-one as new calls,
    compressing context if needed. Write them like standalone user messages.
    Do NOT stack your current task.

    The stack_id parameter is set automatically by the system. Do not set it yourself.
    """
    stacks = _load_all_stacks()
    if stack_id not in stacks:
        stacks[stack_id] = []
    stacks[stack_id].append(prompt)
    _save_all_stacks(stacks)
    return f"Prompt added to stack. Current stack size: {len(stacks[stack_id])}"


@mcp.tool()
def pop_from_stack(stack_id: str = "default") -> str:
    """
    Pop the latest prompt from the stack.
    Returns the prompt or an empty string if the stack is empty.

    The stack_id parameter is set automatically by the system. Do not set it yourself.
    """
    stacks = _load_all_stacks()
    stack = stacks.get(stack_id, [])
    if not stack:
        return ""
    prompt = stack.pop()
    if stack:
        stacks[stack_id] = stack
    else:
        stacks.pop(stack_id, None)
    _save_all_stacks(stacks)
    return prompt


if __name__ == "__main__":
    # Run the MCP server
    mcp.run()

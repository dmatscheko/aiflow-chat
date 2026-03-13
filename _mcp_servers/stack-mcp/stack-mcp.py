from fastmcp import FastMCP

# Create an MCP server instance
mcp = FastMCP("Stack Server")

# In-memory stack storage. The MCP server is loaded once by the proxy and
# stays alive for the entire session, so no file persistence is needed.
# Keeping stacks in memory eliminates the race condition that occurred when
# concurrent tool calls performed read-modify-write cycles on a JSON file.
_stacks: dict[str, list[str]] = {}


@mcp.tool()
def add_to_stack(prompt: str, __hidden_stack_id: str = "default") -> str:
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
    """
    stack_id = __hidden_stack_id
    if stack_id not in _stacks:
        _stacks[stack_id] = []
    _stacks[stack_id].append(prompt)
    return f"Prompt added to stack. Current stack size: {len(_stacks[stack_id])}"


@mcp.tool()
def pop_from_stack(__hidden_stack_id: str = "default") -> str:
    """
    Pop the latest prompt from the stack.
    Returns the prompt or an empty string if the stack is empty.
    """
    stack_id = __hidden_stack_id
    stack = _stacks.get(stack_id, [])
    if not stack:
        return ""
    prompt = stack.pop()
    if not stack:
        _stacks.pop(stack_id, None)
    return prompt


if __name__ == "__main__":
    # Run the MCP server
    mcp.run()

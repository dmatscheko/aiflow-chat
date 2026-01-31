from fastmcp import FastMCP

# Create an MCP server instance
mcp = FastMCP("Stack Server")

# Global stack to store prompts
stack = []


@mcp.tool()
def add_to_stack(prompt: str) -> str:
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
    stack.append(prompt)
    return f"Prompt added to stack. Current stack size: {len(stack)}"


@mcp.resource("stack://pop")
def pop_from_stack() -> str:
    """
    Pop the latest prompt from the stack.
    Returns the prompt or an empty string if the stack is empty.
    """
    if not stack:
        return ""
    return stack.pop()


if __name__ == "__main__":
    # Run the MCP server
    mcp.run()

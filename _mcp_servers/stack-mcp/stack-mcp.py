from fastmcp import FastMCP

# Create an MCP server instance
mcp = FastMCP("Stack Server")

# Global stack to store prompts
stack = []

@mcp.tool()
def add_to_stack(prompt: str) -> str:
    """
    Add a prompt to the stack.
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

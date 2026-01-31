from collections import deque
from datetime import datetime
import fnmatch
from fastmcp import FastMCP
import os
from pydantic import ValidationError
import sys
from typing import Annotated


# Custom error class
class CustomError(ValueError):
    """Custom error for filesystem operations."""

    pass


# Global mappings for directory access
_allowed_real_dirs: list[str] = []  # Real file system paths
_virtual_to_real: dict[str, str] = {}  # Virtual path -> Real path
_real_to_virtual: dict[str, str] = {}  # Real path -> Virtual path


def set_allowed_dirs(real_dirs: list[str]) -> None:
    """Configure allowed real directories and map them to virtual paths (e.g., /a)."""
    global _allowed_real_dirs, _virtual_to_real, _real_to_virtual
    _allowed_real_dirs = [os.path.abspath(os.path.expanduser(d)) for d in real_dirs]
    _virtual_to_real = {f"/{chr(97 + i)}": real_dir for i, real_dir in enumerate(_allowed_real_dirs)}
    _real_to_virtual = {real_dir: virtual_dir for virtual_dir, real_dir in _virtual_to_real.items()}


def normalize_virtual_path(virtual_path: str) -> str:
    """Normalize a virtual path for consistent formatting."""
    if not virtual_path or virtual_path == ".":
        virtual_path = "/"
    if virtual_path.startswith("./"):
        virtual_path = virtual_path[1:]
    if not virtual_path.startswith("/"):
        virtual_path = "/" + virtual_path
    return virtual_path


def virtual_to_real_path(virtual_path: str) -> str:
    """Convert a virtual path to a real path, ensuring it’s within allowed directories."""
    virtual_path = normalize_virtual_path(virtual_path)

    if virtual_path == "/":
        raise IsADirectoryError("Root directory (R/O)")

    for virtual_dir, real_dir in _virtual_to_real.items():
        if virtual_path.startswith(virtual_dir + "/") or virtual_path == virtual_dir:
            relative = virtual_path[len(virtual_dir) :].lstrip("/")
            real_path = os.path.join(real_dir, relative) if relative else real_dir
            break
    else:
        raise CustomError(f"Not a valid path (List / for valid paths): {virtual_path}")

    real_path = os.path.normpath(os.path.abspath(real_path))
    try:
        resolved_real_path = os.path.realpath(real_path)
        if any(resolved_real_path.startswith(d + os.sep) or resolved_real_path == d for d in _allowed_real_dirs):
            return resolved_real_path
        raise PermissionError("Access denied")
    except FileNotFoundError:
        real_parent = os.path.realpath(os.path.dirname(real_path))
        if not os.path.exists(real_parent):
            raise FileNotFoundError("Parent directory not found")
        if any(real_parent.startswith(d + os.sep) or real_parent == d for d in _allowed_real_dirs):
            return real_path
        raise PermissionError("Access denied")


def get_error_message(message, virtual_path: str, e: Exception) -> str:
    """Generate a user-friendly error message using the virtual path."""
    virtual_path = virtual_path or "Unknown path"
    if isinstance(e, CustomError):
        return f"{message}: {e}"
    elif isinstance(e, FileNotFoundError):
        return f"{message}: No such file or directory: {virtual_path}"
    elif isinstance(e, PermissionError):
        return f"{message}: Permission denied: {virtual_path}"
    elif isinstance(e, IsADirectoryError):
        return f"{message}: Is a directory: {virtual_path}"
    elif isinstance(e, NotADirectoryError):
        return f"{message}: Not a directory: {virtual_path}"
    elif isinstance(e, FileExistsError):
        return f"{message}: File already exists: {virtual_path}"
    elif isinstance(e, ValidationError):
        errors = e.errors()
        error_details = "; ".join(f"{err['loc'][0]}: {err['msg']}" for err in errors)
        return f"{message}: Input validation error: {error_details}"
    elif isinstance(e, ValueError):
        return f"{message}: Invalid value: {virtual_path}"
    else:
        return f"{message}: {virtual_path}"


# File operation helpers
def head_file(real_path: str, lines: int) -> str:
    """Read first N lines of a file."""
    with open(real_path, "r", encoding="utf-8") as f:
        return "".join(line for i, line in enumerate(f) if i < lines)


def tail_file(real_path: str, lines: int) -> str:
    """Read last N lines of a file."""
    with open(real_path, "r", encoding="utf-8") as f:
        return "".join(deque(f, maxlen=lines))


def list_files_recursive(virtual_path: str, pattern: str = None, exclude_patterns: list[str] = None) -> str:
    """List files and directories recursively, optionally filtering by pattern."""
    virtual_path = normalize_virtual_path(virtual_path)
    if virtual_path == "/":
        matches = []
        for v_dir, r_dir in sorted(_virtual_to_real.items()):
            v_name = v_dir.lstrip("/")
            for root, dirs, files in os.walk(r_dir):
                if exclude_patterns:
                    dirs[:] = [d for d in dirs if not any(fnmatch.fnmatch(d, p) for p in exclude_patterns)]
                    files = [f for f in files if not any(fnmatch.fnmatch(f, p) for p in exclude_patterns)]

                rel_root = os.path.relpath(root, r_dir)
                if rel_root == ".":
                    rel_root = ""

                for name in dirs + files:
                    if pattern is None or fnmatch.fnmatch(name.lower(), pattern.lower()):
                        rel_path = os.path.join(v_name, rel_root, name).replace(os.sep, "/")
                        if os.path.isdir(os.path.join(root, name)):
                            rel_path += "/"
                        matches.append(rel_path)
            # Add the virtual dir itself if it matches pattern
            if pattern is None or fnmatch.fnmatch(v_name.lower(), pattern.lower()):
                matches.append(v_name + "/")
        return "\n".join([f"### Contents of /:"] + sorted(matches))

    real_path = virtual_to_real_path(virtual_path)
    matches = []
    for root, dirs, files in os.walk(real_path):
        if exclude_patterns:
            dirs[:] = [d for d in dirs if not any(fnmatch.fnmatch(d, p) for p in exclude_patterns)]
            files = [f for f in files if not any(fnmatch.fnmatch(f, p) for p in exclude_patterns)]
        rel_root = os.path.relpath(root, real_path) if root != real_path else ""
        for name in dirs + files:
            if pattern is None or fnmatch.fnmatch(name.lower(), pattern.lower()):
                rel_path = os.path.join(rel_root, name).replace(os.sep, "/")
                if os.path.isdir(os.path.join(root, name)):
                    rel_path += "/"
                matches.append(rel_path)
    return "\n".join([f"### Contents of {virtual_path}:"] + sorted(matches))


# Server setup
mcp = FastMCP(
    name="File System Server (Read)",
    instructions="A server that provides tools for interacting with a file system.",
)


@mcp.tool
def read_file(
    path: Annotated[str, "The path of the file to read."],
    head: Annotated[int, "The number of lines to read from the beginning of the file."] = None,
    tail: Annotated[int, "The number of lines to read from the end of the file."] = None,
) -> str:
    """Read file contents from the file system. Allows reading the whole file, or just the head or tail."""
    try:
        real_path = virtual_to_real_path(path)
        if head is not None and tail is not None:
            raise CustomError("Specify either head or tail, not both")
        if head is not None:
            return head_file(real_path, head)
        elif tail is not None:
            return tail_file(real_path, tail)
        else:
            with open(real_path, "r", encoding="utf-8") as f:
                return f.read()
    except Exception as e:
        return get_error_message("Error reading", path, e)


@mcp.tool
def read_files(paths: Annotated[str, "A list of paths of the files to read, one path per line."]) -> str:
    """Read the contents of one or multiple files."""
    try:
        results = []
        seen = set()
        for virtual_path in paths.split("\n"):
            if virtual_path == "":
                continue
            if virtual_path not in seen:
                try:
                    seen.add(virtual_path)
                    real_path = virtual_to_real_path(virtual_path)
                    content = open(real_path, "r", encoding="utf-8").read()
                    results.append(f"### {virtual_path}:\n```\n{content}\n```\n")
                except Exception as e:
                    results.append(f"### {virtual_path}:\n{get_error_message('Error reading', virtual_path, e)}\n")
        return "\n".join(results)
    except Exception as e:
        return get_error_message("Error reading multiple files", None, e)


@mcp.tool
def list_directory(path: Annotated[str, "The path of the directory to list."]) -> str:
    """List the files and directories within a given directory."""
    try:
        path = normalize_virtual_path(path)
        if path == "/":
            listing = [f"[DIR] {k.lstrip('/')}" for k in sorted(_virtual_to_real.keys())]
            return "\n".join(listing)
        real_path = virtual_to_real_path(path)
        entries = os.listdir(real_path)
        listing = [f"[{'DIR' if os.path.isdir(os.path.join(real_path, e)) else 'FILE'}] {e}" for e in entries]
        return "\n".join(listing)
    except Exception as e:
        return get_error_message("Error listing", path, e)


@mcp.tool
def directory_tree(path: Annotated[str, "The path of the root directory for the tree listing."]) -> str:
    """Show a recursive directory listing starting from the given path."""
    try:
        return list_files_recursive(path)
    except Exception as e:
        return get_error_message("Error listing", path, e)


@mcp.tool
def search_files(
    path: Annotated[str, "The path of the directory to start the search from."],
    pattern: Annotated[str, "A glob pattern to filter file and directory names (e.g., '*.py')."] = None,
    excludePatterns: Annotated[list[str], "A list of glob patterns to exclude files or directories."] = None,
) -> str:
    """Search for files and directories by name pattern, with optional exclusions."""
    try:
        return list_files_recursive(path, pattern, excludePatterns)
    except Exception as e:
        return get_error_message("Error searching", path, e)


@mcp.tool
def get_file_info(path: Annotated[str, "The path of the file or directory to get information about."]) -> str:
    """Get metadata for a file or directory, such as size, modification times, and permissions."""
    try:
        if not path or path == "/":
            info = {
                "path": "/",
                "size": 0,
                "created": "N/A",
                "modified": "N/A",
                "accessed": "N/A",
                "isDirectory": True,
                "isFile": False,
                "permissions": "755",
            }
            return "\n".join(f"{k}: {v}" for k, v in info.items())

        def format_time(timestamp):
            return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")

        real_path = virtual_to_real_path(path)
        stats = os.stat(real_path)
        info = {
            "path": path,
            "size": stats.st_size,
            "created": format_time(stats.st_ctime),
            "modified": format_time(stats.st_mtime),
            "accessed": format_time(stats.st_atime),
            "isDirectory": os.path.isdir(real_path),
            "isFile": os.path.isfile(real_path),
            "permissions": oct(stats.st_mode)[-3:],
        }
        return "\n".join(f"{k}: {v}" for k, v in info.items())
    except Exception as e:
        return get_error_message("Error getting info", path, e)


# Run the server with allowed directories from command-line arguments.
if len(sys.argv) < 2:
    print("Usage: filesystem <allowed-directory> [additional-directories...]")
    sys.exit(1)
real_dirs = sys.argv[1:]
for real_dir in real_dirs:
    if not os.path.isdir(real_dir):
        print(f"Error: {real_dir} is not a directory")
        sys.exit(1)
set_allowed_dirs(real_dirs)
virtual_dirs_mapping = "\n".join(f"{v} -> {r}" for v, r in _virtual_to_real.items())
print(f"MCP Filesystem Server running on stdio\nVirtual to real directory mappings:\n{virtual_dirs_mapping}")


if __name__ == "__main__":
    mcp.run()

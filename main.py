"""
This script serves the static files for the chat application and runs an MCP proxy.
"""

import os
import json
import http.server
import socketserver
import threading
import webbrowser
import logging
import argparse
import time
import signal
import sys
import anyio
from functools import partial
from fastmcp import Client
from fastmcp.server import create_proxy
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    """
    Custom HTTP request handler to serve static files and the API configuration.
    """

    proxy_port = 3000  # Default, will be overridden

    def log_message(self, format, *args):
        """Logs an HTTP request."""
        logging.info(f"WEB: {format % args}")

    def do_GET(self):
        """Handles GET requests."""
        if self.path == "/api/config":
            host_header = self.headers.get("Host")
            if host_header:
                client_host = host_header.split(":")[0]
            else:
                client_host = "127.0.0.1"
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            config = {"mcp_endpoint": f"http://{client_host}:{self.proxy_port}/mcp"}
            self.wfile.write(json.dumps(config).encode("utf-8"))
        else:
            super().do_GET()


def run_file_server(file_host, file_port):
    """
    Runs the static file server.
    """

    class ReuseTCPServer(socketserver.TCPServer):
        """
        A TCP server that allows address reuse.
        """

        allow_reuse_address = True

    log_host = "127.0.0.1" if file_host in ["0.0.0.0", ""] else file_host
    with ReuseTCPServer((file_host, file_port), CustomHandler) as server:
        logging.info(f"WEB: Serving static files at http://{log_host}:{file_port}")
        server.serve_forever()


def load_config():
    """
    Loads the MCP configuration from a JSON file.
    """
    path = os.getenv("MCP_CONFIG", "mcp_config.json")
    if not os.path.exists(path):
        logging.warning(f"{path} not found, using empty config")
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logging.error(f"JSON decode error in {path}: {e}")
        return {}
    except Exception as e:
        logging.error(f"Error loading {path}: {e}")
        return {}


def validate_servers(mcp_servers):
    """
    Validates each MCP server config and returns only the ones that can start.
    Servers with missing scripts or directories are skipped with a warning.
    """
    valid = {}
    for name, config in mcp_servers.items():
        args = config.get("args", [])
        # For stdio servers using 'fastmcp run <script> [-- <dir>...]',
        # check that the script exists and any directories after '--' exist or can be created.
        try:
            run_idx = args.index("run") if "run" in args else -1
            if run_idx >= 0 and run_idx + 1 < len(args):
                script = args[run_idx + 1]
                if not os.path.isfile(script):
                    logging.warning(f"MCP: Skipping '{name}': script not found: {script}")
                    continue
        except (ValueError, IndexError):
            pass
        valid[name] = config
    return valid


def get_cors_middleware():
    """
    Returns CORS middleware configuration for the MCP proxy.
    """
    return [
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["MCP-Session-ID", "X-MCP-Session-ID"],
        )
    ]


async def run_proxy(mcp_servers, host, port, middleware):
    """
    Runs the MCP proxy with a pre-connected client.

    Connects the Client ONCE before creating the proxy so that all tool calls
    reuse the same backend sessions instead of spawning fresh subprocesses
    for every single MCP call.
    """
    client = Client({"mcpServers": mcp_servers})
    async with client:
        proxy = create_proxy(client, name="Composite Proxy")
        await proxy.run_async(
            transport="http", host=host, port=port, middleware=middleware
        )


def shutdown(sig, frame):
    """
    Shuts down the application gracefully.
    """
    logging.info("Shutting down gracefully")
    sys.exit(0)


def main():
    """
    Main function to run the application.
    """
    parser = argparse.ArgumentParser(description="Run MCP proxy and web server")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable debug logging")
    parser.add_argument("--proxy-host", default="127.0.0.1", help="Host IP for the MCP proxy (default: 127.0.0.1)")
    parser.add_argument("--proxy-port", type=int, default=3000, help="Port for the MCP proxy (default: 3000)")
    parser.add_argument("--file-host", default="127.0.0.1", help="Host IP for the file server (default: 127.0.0.1)")
    parser.add_argument("--file-port", type=int, default=8000, help="Port for the file server (default: 8000)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a web browser on startup")
    args = parser.parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s - %(levelname)s - %(message)s")

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    mcp_servers = load_config()
    mcp_servers = validate_servers(mcp_servers) if mcp_servers else {}

    CustomHandler.proxy_port = args.proxy_port

    file_log_host = "127.0.0.1" if args.file_host in ["0.0.0.0", ""] else args.file_host
    proxy_log_host = "127.0.0.1" if args.proxy_host in ["0.0.0.0", ""] else args.proxy_host

    threading.Thread(target=run_file_server, args=(args.file_host, args.file_port), daemon=True).start()

    if not args.no_browser:
        webbrowser.open(f"http://{file_log_host}:{args.file_port}")

    if mcp_servers:
        cors = get_cors_middleware()
        logging.info(f"MCP: Starting proxy at http://{proxy_log_host}:{args.proxy_port}/mcp")
        # Connect the MCP client once and keep backend subprocesses alive
        # for the lifetime of the server, then run the HTTP proxy on top.
        anyio.run(
            partial(
                run_proxy, mcp_servers, args.proxy_host, args.proxy_port, cors
            )
        )
    else:
        logging.info("No MCP proxy to run. Serving files only.")
        # Keep the main thread alive so the daemon file server thread can run.
        while True:
            time.sleep(1)


if __name__ == "__main__":
    main()

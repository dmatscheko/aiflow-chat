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
from fastmcp import FastMCP
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


def setup_proxy(mcp_servers):
    """
    Sets up the MCP proxy.
    """
    if not mcp_servers:
        return None
    proxy = FastMCP.as_proxy({"mcpServers": mcp_servers}, name="Composite Proxy")
    cors = [
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["MCP-Session-ID", "X-MCP-Session-ID"],
        )
    ]
    return proxy, cors


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
    parser.add_argument(
        "--load-mcp-server",
        action="append",
        dest="mcp_servers_to_load",
        help="Load only specific MCP servers from the config. Can be used multiple times.",
    )
    args = parser.parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s - %(levelname)s - %(message)s")

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    mcp_servers_config = load_config()
    mcp_servers_to_run = {}

    if args.mcp_servers_to_load:
        for server_name in args.mcp_servers_to_load:
            if server_name in mcp_servers_config:
                mcp_servers_to_run[server_name] = mcp_servers_config[server_name]
            else:
                logging.warning(f"MCP server '{server_name}' not found in config.")
    else:
        mcp_servers_to_run = mcp_servers_config

    proxy_info = setup_proxy(mcp_servers_to_run)

    CustomHandler.proxy_port = args.proxy_port

    file_log_host = "127.0.0.1" if args.file_host in ["0.0.0.0", ""] else args.file_host
    proxy_log_host = "127.0.0.1" if args.proxy_host in ["0.0.0.0", ""] else args.proxy_host

    threading.Thread(target=run_file_server, args=(args.file_host, args.file_port), daemon=True).start()

    webbrowser.open(f"http://{file_log_host}:{args.file_port}")

    if proxy_info:
        proxy, cors = proxy_info
        logging.info(f"MCP: Starting proxy at http://{proxy_log_host}:{args.proxy_port}/mcp")
        # This is a blocking call
        proxy.run(transport="http", host=args.proxy_host, port=args.proxy_port, middleware=cors)
    else:
        logging.info("No MCP proxy to run. Serving files only.")
        # Keep the main thread alive so the daemon file server thread can run.
        while True:
            time.sleep(1)


if __name__ == "__main__":
    main()

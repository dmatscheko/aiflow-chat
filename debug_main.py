"""
This script serves the static files for the chat application and runs an MCP proxy.
This is a temporary, instrumented version for debugging.
"""
print("DEBUG: Script start")

import os
print("DEBUG: os imported")
import json
print("DEBUG: json imported")
import http.server
print("DEBUG: http.server imported")
import socketserver
print("DEBUG: socketserver imported")
import threading
print("DEBUG: threading imported")
import webbrowser
print("DEBUG: webbrowser imported")
import logging
print("DEBUG: logging imported")
import argparse
print("DEBUG: argparse imported")
import time
print("DEBUG: time imported")
import signal
print("DEBUG: signal imported")
import sys
print("DEBUG: sys imported")

try:
    from fastmcp import FastMCP
    print("DEBUG: FastMCP imported")
    from starlette.middleware import Middleware
    print("DEBUG: Middleware imported")
    from starlette.middleware.cors import CORSMiddleware
    print("DEBUG: CORSMiddleware imported")
except ImportError as e:
    print(f"DEBUG: FAILED to import a required library: {e}")
    sys.exit(1)


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    """
    Custom HTTP request handler to serve static files and the API configuration.
    """
    print("DEBUG: CustomHandler class defined")
    proxy_port = 3000

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
    print("DEBUG: run_file_server function called")
    class ReuseTCPServer(socketserver.TCPServer):
        """
        A TCP server that allows address reuse.
        """
        allow_reuse_address = True
        print("DEBUG: ReuseTCPServer class defined")

    log_host = "127.0.0.1" if file_host in ["0.0.0.0", ""] else file_host
    with ReuseTCPServer((file_host, file_port), CustomHandler) as server:
        print(f"DEBUG: Static file server starting at http://{log_host}:{file_port}")
        server.serve_forever()


def load_config():
    """
    Loads the MCP configuration from a JSON file.
    """
    print("DEBUG: load_config function called")
    path = os.getenv("MCP_CONFIG", "mcp_config.json")
    if not os.path.exists(path):
        print(f"DEBUG: {path} not found, using empty config")
        return {}
    try:
        with open(path) as f:
            print(f"DEBUG: Reading config from {path}")
            data = json.load(f)
            print("DEBUG: Config loaded successfully")
            return data
    except json.JSONDecodeError as e:
        print(f"DEBUG: JSON decode error in {path}: {e}")
        return {}
    except Exception as e:
        print(f"DEBUG: Error loading {path}: {e}")
        return {}


def setup_proxy(mcp_servers):
    """
    Sets up the MCP proxy.
    """
    print("DEBUG: setup_proxy function called")
    if not mcp_servers:
        print("DEBUG: No MCP servers configured, skipping proxy setup.")
        return None

    print("DEBUG: Calling FastMCP.as_proxy...")
    try:
        proxy = FastMCP.as_proxy({"mcpServers": mcp_servers}, name="Composite Proxy")
        print("DEBUG: FastMCP.as_proxy call successful")
    except Exception as e:
        print(f"DEBUG: FastMCP.as_proxy call FAILED: {e}")
        return None

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
    print("DEBUG: CORS middleware configured")
    return proxy, cors


def shutdown(sig, frame):
    """
    Shuts down the application gracefully.
    """
    print("DEBUG: Shutdown function called")
    sys.exit(0)


def main():
    """
    Main function to run the application.
    """
    print("DEBUG: main function started")
    parser = argparse.ArgumentParser(description="Run MCP proxy and web server")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable debug logging")
    parser.add_argument("--proxy-host", default="127.0.0.1", help="Host IP for the MCP proxy (default: 127.0.0.1)")
    parser.add_argument("--proxy-port", type=int, default=3000, help="Port for the MCP proxy (default: 3000)")
    parser.add_argument("--file-host", default="127.0.0.1", help="Host IP for the file server (default: 127.0.0.1)")
    parser.add_argument("--file-port", type=int, default=8000, help="Port for the file server (default: 8000)")
    args = parser.parse_args()
    print(f"DEBUG: Parsed arguments: {args}")

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s - %(levelname)s - %(message)s")
    print("DEBUG: Logging configured")

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    print("DEBUG: Signal handlers set up")

    mcp_servers = load_config()
    print(f"DEBUG: Loaded {len(mcp_servers)} MCP server configs")
    proxy_info = setup_proxy(mcp_servers)
    print(f"DEBUG: Proxy setup complete. Proxy info is {'not None' if proxy_info else 'None'}")

    CustomHandler.proxy_port = args.proxy_port
    print(f"DEBUG: CustomHandler.proxy_port set to {args.proxy_port}")

    file_log_host = "127.0.0.1" if args.file_host in ["0.0.0.0", ""] else args.file_host
    proxy_log_host = "127.0.0.1" if args.proxy_host in ["0.0.0.0", ""] else args.proxy_host

    print("DEBUG: Starting file server thread")
    threading.Thread(target=run_file_server, args=(args.file_host, args.file_port), daemon=True).start()

    # Commented out to avoid issues in headless environments
    # print("DEBUG: Skipping webbrowser.open")
    # webbrowser.open(f"http://{file_log_host}:{args.file_port}")

    if proxy_info:
        proxy, cors = proxy_info
        print(f"DEBUG: MCP proxy starting at http://{proxy_log_host}:{args.proxy_port}/mcp")
        # This is a blocking call
        proxy.run(transport="http", host=args.proxy_host, port=args.proxy_port, middleware=cors)
        print("DEBUG: MCP proxy run finished (this should not happen unless it's stopped)")
    else:
        print("DEBUG: No MCP proxy to run. Serving files only.")
        while True:
            time.sleep(1)


if __name__ == "__main__":
    print("DEBUG: Script is being run directly")
    main()
    print("DEBUG: main() function has exited")
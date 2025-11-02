import http.server
import json
import argparse
from http.server import BaseHTTPRequestHandler

class MockAIServer(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        print(f"--- Mock AI Server received GET request for path: '{self.path}' ---")
        # Use startswith to ignore potential query parameters
        if self.path.startswith('/v1/models'):
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            response = {
                "object": "list",
                "data": [
                    {"id": "mock-model", "object": "model", "created": 123, "owned_by": "mock"}
                ]
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
            print("--- Mock AI Server responded 200 for /v1/models ---")
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()
            print(f"--- Mock AI Server responded 404 for {self.path} ---")

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        request_body = json.loads(post_data)

        print(f"--- Mock AI Server received POST request with body: ---")
        print(json.dumps(request_body, indent=2))
        print("----------------------------------------------------")

        # Check if the last user message contains "datetime" to trigger a tool call
        user_message = ""
        if request_body.get("messages"):
            for message in reversed(request_body["messages"]):
                if message.get("role") == "user":
                    user_message = message.get("content", "").lower()
                    break

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self._send_cors_headers()
        self.end_headers()

        if "datetime" in user_message:
            # Respond with a tool call
            response_payload = {
                "id": "chatcmpl-mock-123",
                "object": "chat.completion",
                "created": 1677652288,
                "model": "mock-model",
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "id": "call_mocktool_123",
                            "type": "function",
                            "function": {
                                "name": "dt_get_current_datetime",
                                "arguments": "{}"
                            }
                        }]
                    },
                    "finish_reason": "tool_calls"
                }]
            }
            print("--- Mock AI Server responding with a tool call ---")
        else:
            # Generic response
            full_request_str = json.dumps(request_body)
            response_content = f"AI response to request: {full_request_str}"

            response_payload = {
                "id": "chatcmpl-mock-456",
                "object": "chat.completion",
                "created": 1677652288,
                "model": "mock-model",
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": response_content
                    },
                    "finish_reason": "stop"
                }]
            }
            print("--- Mock AI Server responding with a generic text message ---")

        self.wfile.write(json.dumps(response_payload).encode('utf-8'))

def run(server_class=http.server.HTTPServer, handler_class=MockAIServer, port=8080):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f"Starting mock AI server on port {port}...")
    httpd.serve_forever()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mock AI Server")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on")
    args = parser.parse_args()
    run(port=args.port)

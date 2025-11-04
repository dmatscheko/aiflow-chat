import http.server
import socketserver
import json
import argparse
import time


class MockAIHandler(http.server.SimpleHTTPRequestHandler):
    max_len = None

    def _set_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_headers()
        self.end_headers()

    def do_POST(self):
        if self.path == "/v1/chat/completions":
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            request_body = json.loads(post_data.decode("utf-8"))
            print(f"Request body: {request_body}", flush=True)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._set_headers()
            self.end_headers()

            # Default response
            response_text = f"AI response to request: {json.dumps(request_body)}"

            # Handle the conversation flow
            last_message = request_body["messages"][-1]
            last_message_role = last_message.get("role", "")
            last_message_content = last_message.get("content", "")

            # Logic for testing
            if last_message_role == "user" and "What's the current date and time?" in last_message_content:
                # If the user asks for the current date and time, call the datetime tool.
                response_text = '<dma:tool_call name="get_datetime"/>'
            elif last_message_role == "user" and "Trigger a tool error." in last_message_content:
                # If the user asks to trigger an error, call a non-existent tool.
                response_text = '<dma:tool_call name="non_existent_tool"/>'
            elif last_message_role == "tool" and '<dma:tool_response name="get_datetime"' in last_message_content and '"text": "' in last_message_content:
                # If the last message is a successful get_datetime tool response, give the final answer.
                response_text = "The current date and time has been provided by the tool."
            elif last_message_role == "tool" and "</content>\n</dma:tool_response>" in last_message_content:
                # If the last message is a successful tool response, say so.
                response_text = "The last tool response was successful."
            elif last_message_role == "tool" and "</error>\n</dma:tool_response>" in last_message_content:
                # If the last message is a tool response error, say so.
                response_text = "The last tool response was an error."
            else:
                # Fallback for any other message types
                response_text = f"AI response to request: {json.dumps(request_body)}"

            if self.max_len is not None and len(response_text) > self.max_len:
                response_text = response_text[: self.max_len] + "..."

            delta = {"choices": [{"delta": {"content": response_text}}]}
            time.sleep(0.1)
            self.wfile.write(f"data: {json.dumps(delta)}\n\n".encode("utf-8"))
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/v1/models":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._set_headers()
            self.end_headers()
            models = {"data": [{"id": "mock-model-1"}, {"id": "qwen/qwen3-30b-a3b-2507"}, {"id": "mock-model-3"}]}
            self.wfile.write(json.dumps(models).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()


def main():
    parser = argparse.ArgumentParser(description="Mock AI Backend")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on")
    parser.add_argument("--max-len", type=int, default=None, help="Max length of the response")
    args = parser.parse_args()

    MockAIHandler.max_len = args.max_len

    # This allows reusing the address, preventing an "Address already in use" error
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", args.port), MockAIHandler) as httpd:
        print(f"Serving at port {args.port}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()

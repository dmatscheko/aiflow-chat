
import http.server
import socketserver
import json
import argparse
import time

class MockAIHandler(http.server.SimpleHTTPRequestHandler):
    max_len = None

    def do_POST(self):
        if self.path == '/v1/chat/completions':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            request_body = json.loads(post_data.decode('utf-8'))

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()

            response_text = f"AI response to request: {json.dumps(request_body)}"
            if self.max_len is not None and len(response_text) > self.max_len:
                response_text = response_text[:self.max_len] + "..."

            # Stream the response
            for char in response_text:
                delta = {
                    "choices": [
                        {
                            "delta": {
                                "content": char
                            }
                        }
                    ]
                }
                self.wfile.write(f"data: {json.dumps(delta)}\n\n".encode('utf-8'))
                self.wfile.flush()
                time.sleep(0.01) # Simulate streaming delay

            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        elif self.path == '/v1/models':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            models = {
                "data": [
                    {"id": "mock-model-1"},
                    {"id": "qwen/qwen3-30b-a3b-2507"},
                    {"id": "mock-model-3"}
                ]
            }
            self.wfile.write(json.dumps(models).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def main():
    parser = argparse.ArgumentParser(description="Mock AI Backend")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on")
    parser.add_argument("--max-len", type=int, default=None, help="Max length of the response")
    args = parser.parse_args()

    MockAIHandler.max_len = args.max_len

    with socketserver.TCPServer(("", args.port), MockAIHandler) as httpd:
        print(f"Serving at port {args.port}")
        httpd.serve_forever()

if __name__ == "__main__":
    main()

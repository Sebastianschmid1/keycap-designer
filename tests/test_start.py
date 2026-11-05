import threading
import urllib.request

import start


def test_serves_modules_with_js_mime():
    srv = start.make_server(0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        for path, mime in (("/app.js", "text/javascript"), ("/data/index.json", "application/json"),
                           ("/data/meshes.bin", "application/octet-stream"), ("/", "text/html")):
            with urllib.request.urlopen(base + path) as r:
                assert r.headers.get_content_type() == mime, path
    finally:
        srv.shutdown()
        srv.server_close()

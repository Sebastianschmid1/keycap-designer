"""Startet das Keycap-Frontend lokal: liefert web/ auf 127.0.0.1 aus und öffnet den Browser.

    python3 start.py [--port 8765] [--no-browser]

Nur Standardbibliothek. Strg+C beendet.
"""
import argparse
import functools
import http.server
import os
import sys
import webbrowser

BASE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(BASE, "web")


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows liest die MIME-Typen aus der Registry: .js kann dort als text/plain kommen -> Module werden
    # verweigert. Deshalb explizit.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
        ".bin": "application/octet-stream", ".gz": "application/gzip", ".css": "text/css",
        ".html": "text/html",
    }

    def log_message(self, *args):
        pass


def make_server(port=8765, directory=WEB):
    """Server auf 127.0.0.1:port; ist der Port belegt, auf einem freien Port (0)."""
    handler = functools.partial(Handler, directory=directory)
    try:
        return http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    except OSError:
        return http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args(argv)
    if not os.path.isfile(os.path.join(WEB, "data", "index.json")):
        sys.exit("web/data fehlt - erzeugen mit: python -m keycaps.webdata")
    srv = make_server(a.port)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print(f"Keycap-Designer läuft auf {url}  (Strg+C beendet)", flush=True)
    if not a.no_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()

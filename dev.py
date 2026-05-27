"""
BioWallet dev szerver — python dev.py
Megnyitó: http://localhost:8080/app/

Szolgál: BioWallet/src/ mappát
  /app/  → src/app/
  /core/ → src/core/

Chrome localhost-on HTTPS nélkül is engedélyezi a getUserMedia-t.
"""

import http.server, os, sys

PORT    = 3333
SERVE   = os.path.join(os.path.dirname(__file__), 'src')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SERVE, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Csak a nem-200 kérések és a POST-ok látszanak
        code = args[1] if len(args) > 1 else '?'
        if code not in ('200', '304'):
            super().log_message(fmt, *args)

if __name__ == '__main__':
    os.chdir(SERVE)
    print(f'BioWallet dev szerver: http://localhost:{PORT}/app/index.html')
    print('Leállítás: Ctrl+C\n')
    try:
        http.server.HTTPServer(('', PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print('\nLeállítva.')
        sys.exit(0)

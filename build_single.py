#!/usr/bin/env python3
"""
BioWallet 9.2a — Single-file air-gap builder
Eredmény: biowallet.html (~12 MB, minden asset beágyazva, internet nélkül megy)
Használat: python build_single.py
"""

import base64, json, os, re, shutil, subprocess, sys, tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR    = os.path.join(SCRIPT_DIR, 'src')
OUT_FILE   = os.path.join(SCRIPT_DIR, 'biowallet.html')


def main():
    print('BioWallet 9.2a — Single-file build\n')

    tmp = tempfile.mkdtemp(prefix='bw_build_')
    print(f'[1] Temp dir: {tmp}')
    try:
        _copy_stripped(SRC_DIR, tmp)
        _build(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        print('    Temp dir törölve.')


# ── Fájlmásolás ?v=N strip-pel ───────────────────────────────────────────────

def _copy_stripped(src_dir, dst_dir):
    for root, dirs, files in os.walk(src_dir):
        rel      = os.path.relpath(root, src_dir)
        dst_root = os.path.join(dst_dir, rel)
        os.makedirs(dst_root, exist_ok=True)
        is_vendor = os.path.join('vendor') in root
        for fname in files:
            src_path = os.path.join(root, fname)
            dst_path = os.path.join(dst_root, fname)
            if fname.endswith('.js') and not is_vendor:
                with open(src_path, encoding='utf-8') as f:
                    txt = f.read()
                txt = re.sub(r'\?v=\d+', '', txt)
                with open(dst_path, 'w', encoding='utf-8') as f:
                    f.write(txt)
            else:
                shutil.copy2(src_path, dst_path)


# ── esbuild helper ────────────────────────────────────────────────────────────

def _esbuild(entry, outfile):
    cmd = f'npx --yes esbuild "{entry}" --bundle --format=iife --minify --outfile="{outfile}"'
    r = subprocess.run(
        cmd, capture_output=True, text=True, cwd=SCRIPT_DIR, shell=True,
    )
    if r.returncode != 0:
        print('STDERR:', r.stderr[:3000])
        raise RuntimeError(f'esbuild failed: {os.path.basename(entry)}')
    return outfile


# ── Build fő lépések ──────────────────────────────────────────────────────────

def _build(tmp):

    # 2. Worker bundle (IIFE, teljesen önálló)
    print('[2] vault_worker.js bundle...')
    worker_out = os.path.join(tmp, '_w.js')
    _esbuild(os.path.join(tmp, 'app', 'vault_worker.js'), worker_out)
    print(f'    {os.path.getsize(worker_out):,} bytes')

    # 3. App bundle (IIFE)
    print('[3] app.js bundle...')
    app_out = os.path.join(tmp, '_a.js')
    _esbuild(os.path.join(tmp, 'app', 'app.js'), app_out)
    print(f'    {os.path.getsize(app_out):,} bytes')

    # 4. Worker beágyazása Blob-ként az app-ba
    print('[4] Worker blob injection...')
    with open(worker_out, encoding='utf-8') as f:
        worker_code = f.read()
    with open(app_out, encoding='utf-8') as f:
        app_code = f.read()

    blob_expr = (
        'new Worker(URL.createObjectURL('
        'new Blob([' + json.dumps(worker_code) + '],'
        '{type:"application/javascript"})))'
    )

    m = re.search(r'new Worker\(["\']\.\/vault_worker\.js[^)]*\)', app_code)
    if m:
        app_code = app_code[:m.start()] + blob_expr + app_code[m.end():]
        print(f'    Replaced: {m.group()}')
    else:
        print('    ⚠ Worker pattern nem található — bundle manuális ellenőrzés szükséges')
        idx = app_code.find('vault_worker')
        if idx >= 0:
            print(f'    Context: ...{app_code[max(0,idx-20):idx+60]}...')

    # 5. Model fájlok base64 beágyazása
    print('[5] Model encoding...')
    models_dir = os.path.join(SRC_DIR, 'models')
    model_entries = {}
    for fname in sorted(os.listdir(models_dir)):
        fpath = os.path.join(models_dir, fname)
        key   = f'/models/{fname}'
        if fname.endswith('.json'):
            with open(fpath, encoding='utf-8') as f:
                model_entries[key] = ('json', f.read())
            print(f'    J {key} ({os.path.getsize(fpath):,})')
        else:
            with open(fpath, 'rb') as f:
                raw = f.read()
            b64 = base64.b64encode(raw).decode('ascii')
            model_entries[key] = ('bin', b64)
            print(f'    B {key} ({os.path.getsize(fpath):,} -> {len(b64):,} b64)')

    # 6. Vendor fájlok
    print('[6] Vendor files...')
    vendor_dir = os.path.join(SRC_DIR, 'vendor')
    def vread(name):
        with open(os.path.join(vendor_dir, name), encoding='utf-8') as f:
            return f.read()
    wc2_js    = vread('wc2.min.js')
    qrcode_js = vread('qrcode.min.js')
    fa_js     = vread('face-api.min.js')
    ethers_js = vread('ethers.umd.min.js')
    print(f'    wc2:{len(wc2_js):,} qrcode:{len(qrcode_js):,} faceapi:{len(fa_js):,} ethers:{len(ethers_js):,}')

    # 7. HTML összerakás
    print('[7] HTML assembly...')
    with open(os.path.join(SRC_DIR, 'app', 'index.html'), encoding='utf-8') as f:
        html_src = f.read()

    css_m = re.search(r'<style>(.*?)</style>', html_src, re.DOTALL)
    css   = css_m.group(1) if css_m else ''

    # Body: mindent kiveszünk a <script src=...> sorok kivételével
    b_start  = html_src.index('<body>') + 6
    b_end    = html_src.index('</body>')
    body_raw = html_src[b_start:b_end]
    body_html = re.sub(r'\s*<script\b[^>]*(?:src|type\s*=\s*"module")[^>]*>[^<]*</script>', '', body_raw).strip()

    interceptor = _make_interceptor(model_entries)

    # Összerakás:
    #   HEAD: interceptor + vendor globálok (DOM-hozzáférés nem kell)
    #   BODY vége: app_code — az esbuild IIFE nem defer-el, ezért a DOM
    #   elemeknek (getElementById) már létezniük kell futáskor.
    #   (ES module-ok automatikusan deferáltak, IIFE-k nem.)
    out_lines = [
        '<!DOCTYPE html>',
        '<html lang="hu">',
        '<head>',
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '<title>BioWallet — Air-Gap</title>',
        '<style>' + css + '</style>',
        '<script>' + interceptor + '</script>',
        '<script>' + wc2_js + '</script>',
        '<script>' + qrcode_js + '</script>',
        '<script>' + fa_js + '</script>',
        '<script>' + ethers_js + '</script>',
        '</head>',
        '<body>',
        body_html,
        '<script>' + app_code + '</script>',
        '</body>',
        '</html>',
    ]

    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out_lines))

    size_mb = os.path.getsize(OUT_FILE) / 1_048_576
    print(f'\nOK  {OUT_FILE}')
    print(f'   Méret: {size_mb:.1f} MB')


# ── Fetch interceptor generálása (modell fájlok beágyazásához) ────────────────

def _make_interceptor(model_entries):
    parts = []
    for key in sorted(model_entries):
        typ, data = model_entries[key]
        k = json.dumps(key)
        if typ == 'json':
            parts.append(f'{k}:' + json.dumps({'t': 'j', 'd': data}))
        else:
            # base64 az alapkarakterkészletben van (A-Za-z0-9+/=), nincs escaping szükséges
            parts.append(f'{k}:{{"t":"b","d":"{data}"}}')

    entries_js = ','.join(parts)

    return (
        '(function(){'
          'var M={' + entries_js + '};'
          'var F=window.fetch.bind(window);'
          'window.fetch=function(u,o){'
            'var p;'
            'try{'
              'p=new URL(typeof u==="string"?u:u instanceof URL?u.href:String(u),'
              'location.href).pathname;'
            '}catch(e){return F(u,o);}'
            'var m=M[p];'
            'if(!m)return F(u,o);'
            'if(m.t==="j")return Promise.resolve('
              'new Response(m.d,{status:200,headers:{"Content-Type":"application/json"}}));'
            'var b=Uint8Array.from(atob(m.d),function(c){return c.charCodeAt(0);});'
            'return Promise.resolve('
              'new Response(b.buffer,{status:200,headers:{"Content-Type":"application/octet-stream"}}));'
          '};'
        '})()'
    )


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Check the deployed static routes, TLS and cache rules from outside the server."""
import re
import sys
import urllib.error
import urllib.request

origin = sys.argv[1] if len(sys.argv) > 1 else 'https://shaulavo.dev'


def fetch(path):
    try:
        return urllib.request.urlopen(origin.rstrip('/') + path, timeout=30)
    except urllib.error.HTTPError as error:
        return error


for path in ('/fregat', '/singapore', '/ghostty-webgpu'):
    with fetch(path) as response:
        assert response.status == 200, (path, response.status)
        assert response.url == origin.rstrip('/') + path + '/', (path, response.url)
        print(path, 'redirects to', response.url)


for path in ('/', '/fregat/', '/singapore/', '/ghostty-webgpu/'):
    with fetch(path) as response:
        assert response.status == 200, (path, response.status)
        cache = response.headers.get('Cache-Control')
        assert cache == 'public, max-age=60, must-revalidate', (path, cache)
        for header, expected in {
            'Strict-Transport-Security': 'max-age=31536000',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "frame-ancestors 'self'",
            'X-Frame-Options': 'SAMEORIGIN',
        }.items():
            assert response.headers.get(header) == expected, (path, header, response.headers.get(header))
        html = response.read().decode()
        print(path, response.status, cache)
    candidates = re.findall(r'(?:src|href)="([^"]+)"', html)
    asset = next((value for value in candidates if re.search(r'/(?:_astro|assets)/.*[.-][A-Za-z0-9_-]{8,}\.(?:js|css)$', value)), None)
    if path != '/':
        assert asset is not None, ('Missing hashed asset', path)
        with fetch(asset) as response:
            assert response.status == 200, (asset, response.status)
            assert response.headers.get('Cache-Control') == 'public, max-age=31536000, immutable'
            print(asset, response.status, response.headers.get('Cache-Control'))
    for missing in (path + 'missing-page', path + 'assets/missing-12345678.js', path + '.complete', path + '.git/config'):
        with fetch(missing) as response:
            assert response.status == 404, (missing, response.status)
            print(missing, response.status)

with fetch('/ghostty-webgpu/bridge.wasm') as response:
    assert response.status == 200
    assert response.headers.get('Cache-Control') == 'public, max-age=0, must-revalidate'
    print('/ghostty-webgpu/bridge.wasm', response.status, response.headers.get('Cache-Control'))

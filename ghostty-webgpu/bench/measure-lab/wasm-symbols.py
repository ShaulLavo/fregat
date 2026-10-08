"""Recover function identities from the original executable's export table.

Unexported indices remain unnamed. This does not infer source names from a
similar debug build or change acquisition binaries.
"""
import argparse
import hashlib
import json
import pathlib


def leb(data, offset):
    value = 0
    shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if not byte & 128:
            return value, offset
        shift += 7


parser = argparse.ArgumentParser()
parser.add_argument('wasm', type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
data = args.wasm.read_bytes()
assert data[:8] == b'\x00asm\x01\x00\x00\x00'
offset = 8
functions = {}
code_hash = None
while offset < len(data):
    kind = data[offset]
    size, offset = leb(data, offset + 1)
    payload = data[offset:offset + size]
    offset += size
    if kind == 10:
        code_hash = hashlib.sha256(payload).hexdigest()
    if kind != 7:
        continue
    count, pointer = leb(payload, 0)
    for _ in range(count):
        length, pointer = leb(payload, pointer)
        name = payload[pointer:pointer + length].decode('utf8')
        pointer += length
        export_kind = payload[pointer]
        index, pointer = leb(payload, pointer + 1)
        if export_kind == 0:
            functions.setdefault(f'wasm-function[{index}]', []).append(name)
output = {'wasm': str(args.wasm), 'sha256': hashlib.sha256(data).hexdigest(), 'codeSectionSha256': code_hash, 'exportedFunctionIdentities': functions, 'limit': 'Only original exported function names; unexported internal indices have no trustworthy source names.'}
args.output.write_text(json.dumps(output, indent=2) + '\n')
print(json.dumps({'exports': len(functions), 'codeSectionSha256': code_hash}))

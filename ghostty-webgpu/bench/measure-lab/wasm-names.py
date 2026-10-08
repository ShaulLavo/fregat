"""Copy only a verified name section into a profiling-only WASM copy.

Executable sections must match byte for byte. Never assigns names across changed
code, and never replaces an acquisition arm's original WASM file.
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


def sections(data):
    assert data[:8] == b'\x00asm\x01\x00\x00\x00', 'WASM version'
    offset = 8
    output = []
    while offset < len(data):
        start = offset
        kind = data[offset]
        size, offset = leb(data, offset + 1)
        payload = data[offset:offset + size]
        offset += size
        name = None
        if kind == 0:
            length, beginning = leb(payload, 0)
            name = payload[beginning:beginning + length].decode('utf8')
        output.append((kind, name, payload, data[start:offset]))
    return output


parser = argparse.ArgumentParser()
parser.add_argument('--original', required=True, type=pathlib.Path)
parser.add_argument('--named-reference', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
original = args.original.read_bytes()
reference = args.named_reference.read_bytes()
a = sections(original)
b = sections(reference)
assert [(kind, payload) for kind, _, payload, _ in a if kind] == [(kind, payload) for kind, _, payload, _ in b if kind], 'All executable sections must match before using reference names'
name = next(raw for kind, label, _, raw in b if kind == 0 and label == 'name')
assert not any(kind == 0 and label == 'name' for kind, label, _, _ in a), 'Original already named'
with args.output.open('xb') as file:
    file.write(original + name)
print(json.dumps({'original': str(args.original), 'reference': str(args.named_reference), 'output': str(args.output), 'executableSectionsEqual': True, 'originalSha256': hashlib.sha256(original).hexdigest(), 'namedSha256': hashlib.sha256(original + name).hexdigest(), 'nameSectionBytes': len(name)}))

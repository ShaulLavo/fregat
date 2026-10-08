"""Conservative instruction-IP attribution using original V8 code identities.

Accepts perf-ips.py JSONL output. Names are used only for address ranges that
have one identity throughout the entire dump.
"""
import argparse
import bisect
import collections
import hashlib
import json
import pathlib
import struct

parser = argparse.ArgumentParser()
parser.add_argument('--jit', type=pathlib.Path, required=True)
parser.add_argument('--events', type=pathlib.Path, required=True)
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
data = args.jit.read_bytes()
magic, version, header_size, machine, _, pid, timestamp, flags = struct.unpack_from('<IIIIIIQQ', data)
assert (magic, version, machine, flags) == (0x4A695444, 1, 62, 0), 'supported x86 jitdump header'
position = header_size
loads = []
by_index = {}
record_counts = collections.Counter()
length_mismatches = []
while position < len(data):
    kind, size, time = struct.unpack_from('<IIQ', data, position)
    assert kind in range(5) and size >= 16 and position + size <= len(data), f'invalid record at offset {position}'
    end = position + size
    if kind == 2:
        _, entries = struct.unpack_from('<QQ', data, position + 16)
        assert entries < 1000000, 'bounded debug entry count'
        actual_end = position + 32
        for _ in range(entries):
            actual_end = data.index(b'\0', actual_end + 16) + 1
        if actual_end > end:
            candidates = []
            for padding in range(8):
                candidate = actual_end + padding
                if candidate + 16 > len(data) or any(data[actual_end:candidate]):
                    continue
                next_kind, next_size, next_time = struct.unpack_from('<IIQ', data, candidate)
                if next_kind in range(5) and next_size >= 16 and candidate + next_size <= len(data) and next_time >= time:
                    candidates.append(candidate)
            assert len(candidates) == 1, 'debug structural end must have one validated successor'
            end = candidates[0]
            length_mismatches.append({'offset': position, 'declaredSize': size, 'structuralSize': end - position, 'entries': entries})
    if kind == 0:
        load_pid, tid, _, address, code_size, index = struct.unpack_from('<IIQQQQ', data, position + 16)
        name_start = position + 56
        name_end = data.index(b'\0', name_start)
        assert name_end + 1 + code_size == end and load_pid == pid, 'complete code-load identity'
        name = data[name_start:name_end].decode('utf8')
        loads.append((address, address + code_size, name))
        by_index[index] = name
    if kind == 1:
        move_pid, _, _, old_address, new_address, code_size, index = struct.unpack_from('<IIQQQQQ', data, position + 16)
        assert move_pid == pid and index in by_index, 'owned known code move'
        if old_address != new_address:
            loads.append((old_address, old_address + code_size, '<moved-address-unresolved>'))
            loads.append((new_address, new_address + code_size, by_index[index]))
    record_counts[kind] += 1
    position = end
assert position == len(data), 'complete original JIT record traversal'
# Static lookup avoids synthetic --predictable timestamps. Conflicting identities
# at any address are excluded, even when their actual lifetimes might differ.
boundaries = collections.defaultdict(list)
for start, end, name in loads:
    boundaries[start].append((name, 1))
    boundaries[end].append((name, -1))
active = collections.Counter()
starts = []
names = []
for address, changes in sorted(boundaries.items()):
    for name, change in changes:
        active[name] += change
        if active[name] == 0:
            del active[name]
    starts.append(address)
    names.append(next(iter(active)) if len(active) == 1 else None)
counts = collections.Counter()
periods = collections.Counter()
unknown = 0
samples = 0
for line in args.events.read_text().splitlines():
    sample = json.loads(line)
    tid, ip, period = sample['tid'], sample['ip'], sample['period']
    assert tid == pid and period > 0, 'owned main TID and positive sample period'
    samples += 1
    index = bisect.bisect_right(starts, ip) - 1
    name = names[index] if index >= 0 else None
    if name is None or name == '<moved-address-unresolved>':
        unknown += 1
        continue
    counts[name] += 1
    periods[name] += period
assert samples > 0, 'positive parsed IP samples'
categories = collections.Counter()
for name, count in counts.items():
    category = 'wasm-index' if 'wasm-function[' in name else 'v8-builtin' if name.startswith('Builtin:') else 'javascript'
    categories[category] += count
result = {'status': 'COMPLETE', 'jitSha256': hashlib.sha256(data).hexdigest(), 'eventsSha256': hashlib.sha256(args.events.read_bytes()).hexdigest(), 'pid': pid, 'jitRecords': dict(record_counts), 'codeLoads': len(loads), 'debugLengthMismatches': length_mismatches, 'samples': samples, 'uniquelyAttributedSamples': samples - unknown, 'unknownOrConflictingSamples': unknown, 'categories': dict(categories), 'functions': [{'name': name, 'samples': count, 'samplePercent': 100 * count / samples, 'sampledPeriods': periods[name]} for name, count in counts.most_common()], 'limits': ['Sampling envelope includes loop, proof and cleanup; no exact function work partition or energy claim', 'Static address identity only; conflicting identities across time are left unknown', 'Native non-JIT addresses and unexported WASM function meanings remain unknown', 'WASM indices can repeat across modules; no automatic export or source-name assignment', 'Debug lengths traversed structurally; original dump and raw acquisition are unchanged', 'No simulated instruction values or transplanted WASM names']}
with args.output.open('x') as target:
    target.write(json.dumps(result, indent=2) + '\n')
print(json.dumps({key: value for key, value in result.items() if key != 'functions'}, indent=2))

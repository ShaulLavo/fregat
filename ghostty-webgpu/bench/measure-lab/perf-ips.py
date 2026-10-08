"""Read native perf sample IPs without symbolization or call-chain traversal.

Supports little-endian attributes identified by PERF_SAMPLE_IDENTIFIER and the
standard sample prefix through PERIOD. The original recording stays unchanged.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import struct

parser = argparse.ArgumentParser()
parser.add_argument('recording', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path, required=True)
parser.add_argument('--receipt', type=pathlib.Path, required=True)
args = parser.parse_args()
data = args.recording.read_bytes()
assert data[:8] == b'PERFILE2', 'little-endian perf file magic'
_, header_size, attr_size, attrs_offset, attrs_size, data_offset, data_size = struct.unpack_from('<7Q', data)
assert header_size >= 72 and attrs_size % attr_size == 0, 'complete acquisition attributes'
attributes = []
by_id = {}
for offset in range(attrs_offset, attrs_offset + attrs_size, attr_size):
    event_type, size, config, period, sample_type, _, flags = struct.unpack_from('<IIQQQQQ', data, offset)
    assert sample_type & (1 | 2 | 65536) == (1 | 2 | 65536), 'IP, TID and identifier required'
    assert not flags & (1 << 10), 'fixed-period acquisition, frequency mode unsupported'
    ids_offset, ids_size = struct.unpack_from('<QQ', data, offset + attr_size - 16)
    ids = list(struct.unpack_from(f'<{ids_size // 8}Q', data, ids_offset))
    attribute = {'type': event_type, 'config': config, 'period': period, 'sampleType': sample_type, 'ids': ids}
    attributes.append(attribute)
    for identifier in ids:
        by_id[identifier] = attribute
end = data_offset + data_size
assert end <= len(data), 'complete acquisition data section'
position = data_offset
records = collections.Counter()
samples = []
lost = 0
while position < end:
    kind, misc, size = struct.unpack_from('<IHH', data, position)
    assert size >= 8 and position + size <= end, 'bounded complete perf record'
    records[kind] += 1
    if kind == 2:
        lost += struct.unpack_from('<Q', data, position + 16)[0]
    if kind == 13:
        lost += struct.unpack_from('<Q', data, position + 8)[0]
    if kind == 9:
        cursor = position + 8
        identifier = struct.unpack_from('<Q', data, cursor)[0]
        attribute = by_id[identifier]
        sample_type = attribute['sampleType']
        sample = {'misc': misc, 'period': attribute['period']}
        for bit, field in [(65536, 'identifier'), (1, 'ip'), (2, 'pidTid'), (4, 'time'), (8, 'address'), (64, 'id'), (512, 'streamId'), (128, 'cpuReserved'), (256, 'period')]:
            if not sample_type & bit:
                continue
            assert cursor + 8 <= position + size, 'sample prefix bounds'
            value = struct.unpack_from('<Q', data, cursor)[0]
            cursor += 8
            if field == 'pidTid':
                sample['pid'], sample['tid'] = value & 0xffffffff, value >> 32
                continue
            if field == 'cpuReserved':
                sample['cpu'] = value & 0xffffffff
                continue
            sample[field] = value
        assert sample['period'] > 0, 'positive sample period'
        samples.append(sample)
    position += size
assert position == end and samples, 'complete traversal with positive samples'
with args.output.open('x') as target:
    target.writelines(json.dumps(sample) + '\n' for sample in samples)
receipt = {'status': 'COMPLETE', 'recordingSha256': hashlib.sha256(data).hexdigest(), 'attributes': attributes, 'recordCounts': dict(records), 'samples': len(samples), 'lostSamples': lost, 'throttleRecords': records[5], 'unthrottleRecords': records[6], 'tids': sorted(set(sample['tid'] for sample in samples)), 'cpus': sorted(set(sample.get('cpu') for sample in samples)), 'timeRange': [min(sample.get('time', 0) for sample in samples), max(sample.get('time', 0) for sample in samples)], 'limits': 'Little-endian identified attributes, fixed period and sample prefix only. IPs are sampling observations, not exact per-function counts.'}
with args.receipt.open('x') as target:
    target.write(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))

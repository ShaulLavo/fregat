"""Portable generated-fixture checks; no live PMU, Chrome or remote host."""
import json
import pathlib
import struct
import subprocess
import sys
import tempfile
import unittest

LAB = pathlib.Path(__file__).resolve().parent


class Tools(unittest.TestCase):
    def test_perf_prefix_and_structural_jit_debug_length(self):
        with tempfile.TemporaryDirectory(prefix='measure-lab-') as directory:
            root = pathlib.Path(directory)
            pid = 123
            address = 0x1000
            identifier = 77
            period = 500000
            sample_type = 65536 | 1 | 2 | 4 | 32
            ids_offset = 104 + 320
            data_offset = ids_offset + 16
            body = struct.pack('<QQIIQQ', identifier, address + 1, pid, pid, 100, 0)
            sample = struct.pack('<IHH', 9, 2, 8 + len(body)) + body
            lost = struct.pack('<IHHQQ', 2, 2, 24, identifier, 2)
            lost_samples = struct.pack('<IHHQ', 13, 2, 16, 3)
            records = sample + lost + lost_samples
            header = b'PERFILE2' + struct.pack('<6Q', 104, 160, 104, 320, data_offset, len(records)) + bytes(48)
            attribute = bytearray(160)
            struct.pack_into('<IIQQQQQ', attribute, 0, 4, 144, 192, period, sample_type, 0, 0)
            struct.pack_into('<QQ', attribute, 144, ids_offset, 8)
            tracking = bytearray(attribute)
            struct.pack_into('<IIQQ', tracking, 0, 1, 144, 9, 0)
            struct.pack_into('<QQ', tracking, 144, ids_offset + 8, 8)
            perf = root / 'raw.data'
            perf.write_bytes(header + attribute + tracking + struct.pack('<QQ', identifier, identifier + 1) + records)
            ips, receipt = root / 'ips.jsonl', root / 'receipt.json'
            subprocess.run([sys.executable, str(LAB / 'perf-ips.py'), str(perf), '--output', str(ips), '--receipt', str(receipt)], check=True, capture_output=True)
            self.assertEqual(json.loads(ips.read_text())['ip'], address + 1)
            self.assertEqual(json.loads(receipt.read_text())['samples'], 1)
            self.assertEqual(json.loads(receipt.read_text())['lostSamples'], 5)
            # A short declared debug length has a structurally validated next header.
            debug_body = struct.pack('<QQQII', address, 1, address, 1, 0) + b'a.py\0'
            debug = struct.pack('<IIQ', 2, len(debug_body) + 15, 99) + debug_body
            name = b'JS:example\0'
            load_body = struct.pack('<IIQQQQ', pid, pid, address, address, 4, 1) + name + b'1234'
            load = struct.pack('<IIQ', 0, 16 + len(load_body), 100) + load_body
            jit = root / 'jit.dump'
            jit.write_bytes(struct.pack('<IIIIIIQQ', 0x4A695444, 1, 40, 62, 0, pid, 100, 0) + debug + load)
            output = root / 'attribution.json'
            subprocess.run([sys.executable, str(LAB / 'jit-attribution.py'), '--jit', str(jit), '--events', str(ips), '--output', str(output)], check=True, capture_output=True)
            result = json.loads(output.read_text())
            self.assertEqual(result['functions'][0]['name'], 'JS:example')
            self.assertEqual(result['functions'][0]['samples'], 1)
            self.assertEqual(len(result['debugLengthMismatches']), 1)
            move_body = struct.pack('<IIQQQQQ', pid, pid, address, address, 0x2000, 4, 1)
            move = struct.pack('<IIQ', 1, 16 + len(move_body), 101) + move_body
            jit.write_bytes(jit.read_bytes() + move)
            events = [json.loads(ips.read_text())]
            events.append({**events[0], 'ip': 0x2001})
            ips.write_text(''.join(json.dumps(event) + '\n' for event in events))
            moved = root / 'moved.json'
            subprocess.run([sys.executable, str(LAB / 'jit-attribution.py'), '--jit', str(jit), '--events', str(ips), '--output', str(moved)], check=True, capture_output=True)
            result = json.loads(moved.read_text())
            self.assertEqual(result['uniquelyAttributedSamples'], 1)
            self.assertEqual(result['unknownOrConflictingSamples'], 1)

    def test_analysis_rejects_incomplete_requested_blocks(self):
        with tempfile.TemporaryDirectory(prefix='measure-lab-') as directory:
            root = pathlib.Path(directory)
            rows = [{'kind': 'configuration', 'arms': ['A', 'B'], 'repetitions': 3}, {'kind': 'calibration', 'increment': 3000000, 'expectedInstructionIncrement': 3000000}]
            for block in range(2):
                for position, arm in enumerate(['A', 'B', 'B', 'A']):
                    rows.append({'kind': 'sample', 'block': block, 'position': position, 'arm': arm, 'sample': {'instructions': 1000000, 'enabledNs': 100, 'runningNs': 100}, 'elapsedMs': 1, 'work': {'ticks': 1, 'bytes': 1, 'gl': {}, 'canvas': {}}, 'proof': [{'history': 0, 'textDigest': 'a', 'retainedDigest': 'b', 'frameDigest': 'c'}]})
            samples, summary = root / 'samples.jsonl', root / 'summary.json'
            samples.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            subprocess.run([sys.executable, str(LAB / 'analyze.py'), str(samples), '--output', str(summary)], check=True, capture_output=True)
            self.assertFalse(json.loads(summary.read_text())['gatesPassed'])
            self.assertFalse(json.loads(summary.read_text())['requestedRepetitionsComplete'])
            rows[0]['repetitions'] = 2
            samples.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            subprocess.run([sys.executable, str(LAB / 'analyze.py'), str(samples), '--output', str(summary)], check=True, capture_output=True)
            self.assertTrue(json.loads(summary.read_text())['gatesPassed'])
            rows[-1]['sample']['runningNs'] = 50
            samples.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            subprocess.run([sys.executable, str(LAB / 'analyze.py'), str(samples), '--output', str(summary)], check=True, capture_output=True)
            self.assertFalse(json.loads(summary.read_text())['coveragePassed'])
            self.assertFalse(json.loads(summary.read_text())['gatesPassed'])


if __name__ == '__main__':
    unittest.main()

"""Summarize capability controls, preserving CPU-time/instruction distinction."""
import argparse
import json
import pathlib

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
record = json.loads((args.directory / 'result.json').read_text())
events = json.loads((args.directory / 'trace.json').read_text())['traceEvents']
interesting = ['RunTask', 'Document::UpdateStyleAndLayout', 'Blink.ForcedStyleAndLayout.UpdateTime', 'Blink.Paint.UpdateTime', 'RasterTask', 'CanvasRenderingContext2D::FinalizeFrame', 'GPUTask', 'ProfileChunk', 'V8.DeoptimizeCode']
profiles = {}
for event in events:
    if event.get('name') != 'ProfileChunk':
        continue
    key = (event.get('pid'), event.get('tid'), event.get('id'))
    nodes, counts = profiles.setdefault(key, ({}, {}))
    profile = event.get('args', {}).get('data', {}).get('cpuProfile', {})
    for node in profile.get('nodes', []):
        nodes[node['id']] = node
    for node in profile.get('samples', []):
        counts[node] = counts.get(node, 0) + 1
function_counts = {}
for nodes, counts in profiles.values():
    for node, count in counts.items():
        name = nodes.get(node, {}).get('callFrame', {}).get('functionName', '(unnamed)')
        function_counts[name] = function_counts.get(name, 0) + count
native = {}
for label in ['counterBefore', 'counterAfter']:
    snapshot = record.get(label, {})
    native[label] = snapshot
summary = {
    'source': str(args.directory),
    'version': record['version'],
    'headless': record['headless'],
    'status': record['status'],
    'controls': {'observedFlag': record['observedFlag'], 'ownedChromeStopped': record['chromeStopped'], 'knownRows': sorted(set(value['rows'] for value in record['results'])), 'traceEvents': record['events'], 'threadCpuFields': record['threadCpuFields'], 'instructionFields': record['instructionFields']},
    'sliceControls': {name: {'count': sum(event.get('name') == name for event in events), 'threadCpuMicrosecondsIncludingNested': sum(event.get('tdur', 0) for event in events if event.get('name') == name)} for name in interesting},
    'v8CpuSampleCountsByFunction': function_counts,
    'native': native,
    'limits': ['Slice thread CPU time is not instructions.', 'Nested slice totals overlap and cannot be summed as exclusive attribution.', 'External PMU samples cover processes, not individual trace slices.', 'Synthetic control proves capability, not terminal efficiency.'],
}
args.output.write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key != 'native'}, indent=2))

import csv
import hashlib
import json
import pathlib
import sys

BEFORE = pathlib.Path(sys.argv[1]).resolve()
NOW = pathlib.Path(sys.argv[2]).resolve()
OUTPUT = pathlib.Path(sys.argv[3]).resolve()
METRICS = ['instructions', 'cycles', 'energyJ', 'cpuSeconds']
CHANNELS = ['renderer', 'GPU', 'rendererPlusGPU', 'allChrome', 'otherChrome']
PARTS = [
    'ghosttyParse',
    'ghosttyFrameInclusive',
    'ghosttyGPUDispatchInclusive',
    'ghosttyCopiedPublicationInclusive',
    'ghosttyFull',
    'xtermParse',
    'xtermCombinedRenderResidual',
    'xtermFull',
    'comparableParserExcess',
    'comparableCombinedRenderingExcess',
    'comparableFullExcess',
]
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
before = json.loads(BEFORE.read_text())
now = json.loads(NOW.read_text())
assert before['complete'] and now['complete']
result = {
    'diagnosticOnly': True,
    'before': {'path': str(BEFORE), 'sha256': sha(BEFORE), 'runtimeCommit': before['runtimeCommit']},
    'now': {'path': str(NOW), 'sha256': sha(NOW), 'runtimeCommit': now['runtimeCommit']},
    'comparability': 'Same six-arm definitions, order, ticks, warmup, terminal count, R07 byte fixtures and R07-u11 oracle. Different sessions and runtime pins. Descriptive current budget, not a causal isolation of any individual merged change.',
    'publicationDefinition': 'GFULL minus GSKIP is the inclusive cost of enabling copied-text publication in the diagnostic. It includes interaction and GC changes. Fraction of excess divides by GFULL minus XFULL; fraction of ghostty full divides by GFULL. Suppressing public output is diagnostic and cannot ship.',
    'xtermPartition': 'Only parse and combined rendering are comparable. Native frame, dispatch and copied publication have no separate xterm arm, so no per-subpart xterm allocation is inferred.',
    'workloads': {},
}
rows = []
for workload, current in now['workloads'].items():
    previous = before['workloads'].get(workload)
    if previous:
        for key in ['inputSha256', 'contentSha256', 'cellLayoutSha256']:
            assert {p[key] for p in previous['proof']} == {p[key] for p in current['proof']}, (workload, key)
    entry = {'parts': {}, 'publication': {}, 'rendererGrossInstructionRanking': []}
    for part in PARTS:
        entry['parts'][part] = {}
        for channel in CHANNELS:
            entry['parts'][part][channel] = {}
            for metric in METRICS:
                old = previous['budget'][part][channel][metric] if previous else None
                new = current['budget'][part][channel][metric]
                entry['parts'][part][channel][metric] = {'before': old, 'now': new}
                if channel == 'renderer':
                    rows.append([workload, part, metric, old['mean'] if old else '', new['mean'], new['min'], new['max']])
    for channel in CHANNELS:
        entry['publication'][channel] = {}
        for metric in METRICS:
            item = {}
            for period, data in [('before', previous), ('now', current)]:
                if not data:
                    item[period] = None
                    continue
                publication = data['budget']['ghosttyCopiedPublicationInclusive'][channel][metric]
                full = data['budget']['ghosttyFull'][channel][metric]['mean']
                excess = data['budget']['comparableFullExcess'][channel][metric]['mean']
                skip = data['armMeans']['GSKIP'][channel][metric]
                xterm = data['armMeans']['XFULL'][channel][metric]
                item[period] = {
                    'inclusiveCost': publication,
                    'fractionOfGhosttyFull': publication['mean'] / full if full else None,
                    'fractionOfFullExcess': publication['mean'] / excess if excess else None,
                    'skipOverXterm': skip / xterm if xterm else None,
                    'remainingSkipExcess': skip - xterm,
                }
            entry['publication'][channel][metric] = item
    ranked = ['ghosttyFrameInclusive', 'ghosttyGPUDispatchInclusive', 'ghosttyCopiedPublicationInclusive']
    ranked.sort(key=lambda part: current['budget'][part]['renderer']['instructions']['mean'], reverse=True)
    nonparse = current['budget']['ghosttyFull']['renderer']['instructions']['mean'] - current['budget']['ghosttyParse']['renderer']['instructions']['mean']
    for rank, part in enumerate(ranked, 1):
        instructions = current['budget'][part]['renderer']['instructions']['mean']
        entry['rendererGrossInstructionRanking'].append({'rank': rank, 'part': part, 'instructions': instructions, 'fractionOfNativeNonParserInstructions': instructions / nonparse})
    result['workloads'][workload] = entry
OUTPUT.mkdir(exist_ok=True)
(OUTPUT / 'before-now.json').write_text(json.dumps(result, indent=2) + '\n')
with (OUTPUT / 'before-now-renderer.csv').open('w', newline='') as stream:
    writer = csv.writer(stream)
    writer.writerow(['workload', 'component', 'metric', 'beforeMean', 'nowMean', 'nowBalancedMin', 'nowBalancedMax'])
    writer.writerows(rows)
print(json.dumps({'output': str(OUTPUT / 'before-now.json'), 'workloads': list(result['workloads'])}))

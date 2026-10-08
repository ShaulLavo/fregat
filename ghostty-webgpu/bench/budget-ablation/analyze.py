import hashlib
import json
import pathlib
import statistics
import sys

LANE = pathlib.Path(sys.argv[1]).resolve()
CHANNELS = ['renderer', 'GPU', 'rendererPlusGPU', 'allChrome', 'otherChrome']
METRICS = ['instructions', 'cycles', 'energyJ', 'cpuSeconds', 'effectiveClockGHz', 'pCoreTimeShare']
COMPONENTS = {
    'ghosttyParse': [('GPARSE', 1)],
    'ghosttyFrameInclusive': [('GFRAME', 1), ('GPARSE', -1)],
    'ghosttyGPUDispatchInclusive': [('GSKIP', 1), ('GFRAME', -1)],
    'ghosttyCopiedPublicationInclusive': [('GFULL', 1), ('GSKIP', -1)],
    'ghosttyFull': [('GFULL', 1)],
    'xtermParse': [('XPARSE', 1)],
    'xtermCombinedRenderResidual': [('XFULL', 1), ('XPARSE', -1)],
    'xtermFull': [('XFULL', 1)],
    'comparableParserExcess': [('GPARSE', 1), ('XPARSE', -1)],
    'comparableCombinedRenderingExcess': [('GFULL', 1), ('GPARSE', -1), ('XFULL', -1), ('XPARSE', 1)],
    'comparableFullExcess': [('GFULL', 1), ('XFULL', -1)],
}
result = {
    'task': 'r4-budget',
    'diagnosticOnly': True,
    'reviewStatus': 'Descriptive, independent headline review not acquired',
    'runtimeCommit': 'b4e526490217841d304a83b22b4fe987afd44a98',
    'publicationPR1009Included': True,
    'unitScope': '17 terminals, 900 measured R07 byte ticks and reset per window',
    'method': 'Means of two same-session windows per arm. Signed inclusive counter differences and early/late balanced difference range. No old acquisitions rescored; no negative difference clamping.',
    'limitations': [
        'Parser values include common page/RAF/control work and library session bookkeeping; no idle baseline subtraction.',
        'Frame residual includes native building, glyph/raster/atlas bookkeeping, scheduling/metadata and upload planning.',
        'GPU dispatch residual includes WebGL JS/API work and mutation-observer overhead; GPU process is host CPU, physical GPU energy is outside scope.',
        'xterm has no public equivalent of native frame building without GPU, so its rendering residual cannot be partitioned comparably.',
        'Counter differences can include interaction and GC changes. Two windows per arm establish descriptive budgets, not significance.',
        'Energy is the kernel CPU estimate. Readback and screenshot settlement are outside logical counter endpoints.',
        'At lower clocks memory stalls consume fewer cycles, slightly favouring the lower-clocked arm. Cycles improvement with instruction loss needs stall analysis.',
    ],
    'workloads': {},
}
for protocol_path in sorted(LANE.glob('mac-*/protocol.json')):
    protocol = json.loads(protocol_path.read_text())
    raw_path = protocol_path.parent / 'native' / protocol['id'] / 'index.json'
    if not raw_path.exists():
        continue
    raw_bytes = raw_path.read_bytes()
    raw = json.loads(raw_bytes)
    custody_path = protocol_path.parent / 'native/custody.json'
    custody = json.loads(custody_path.read_text())
    if not raw.get('complete') or not custody.get('clean'):
        result.setdefault('excluded', []).append({'id': protocol['id'], 'failure': raw.get('failure'), 'raw': str(raw_path)})
        continue
    assert raw['runtimeCommit'] == result['runtimeCommit']
    assert len(raw['runs']) == len(protocol['order']) == 12
    workload = protocol['workloads'][0]
    groups = {actor: [row for row in raw['runs'] if row['actor'] == actor] for actor in set(protocol['order'])}
    assert all(len(rows) == 2 and all(row['status'] == 'complete' for row in rows) for rows in groups.values())
    assert len({row['inputSha256'] for row in raw['runs']}) == 1
    assert len({row['contentSha256'] for row in raw['runs']}) == 1
    assert len({row['cellLayoutSha256'] for row in raw['runs']}) == 1
    assert all(row['native']['commonValidation']['status'] == 'measured' for row in raw['runs'])
    means = {actor: {channel: {metric: statistics.mean(row['native']['channels'][channel][metric] for row in rows) for metric in METRICS} for channel in CHANNELS} for actor, rows in groups.items()}
    budget = {}
    for name, terms in COMPONENTS.items():
        budget[name] = {}
        for channel in CHANNELS:
            values = {}
            for metric in ['instructions', 'cycles', 'energyJ', 'cpuSeconds']:
                paired = [sum(sign * groups[actor][window]['native']['channels'][channel][metric] for actor, sign in terms) for window in range(2)]
                mean = sum(sign * means[actor][channel][metric] for actor, sign in terms)
                assert abs(mean - statistics.mean(paired)) <= max(1e-9, abs(mean) * 1e-12)
                values[metric] = {'mean': mean, 'balancedDifferences': paired, 'min': min(paired), 'max': max(paired)}
            budget[name][channel] = values
    for channel in CHANNELS:
        for metric in ['instructions', 'cycles', 'energyJ', 'cpuSeconds']:
            components = ['ghosttyParse', 'ghosttyFrameInclusive', 'ghosttyGPUDispatchInclusive', 'ghosttyCopiedPublicationInclusive']
            total = sum(budget[name][channel][metric]['mean'] for name in components)
            assert abs(total - means['GFULL'][channel][metric]) < max(1e-8, abs(total) * 1e-12)
    ratios = {channel: {metric: means['GFULL'][channel][metric] / means['XFULL'][channel][metric] for metric in METRICS if means['XFULL'][channel][metric]} for channel in CHANNELS}
    work_proof = [{
        'actor': row['actor'], 'index': row['index'],
        'inputSha256': row['inputSha256'], 'contentSha256': row['contentSha256'], 'cellLayoutSha256': row['cellLayoutSha256'],
        'publicWritesPerTarget': row['targetWork'][0]['counters']['publicWrites'],
        'inputBytesPerTarget': row['targetWork'][0]['counters']['inputBytes'],
        'parserCallsTotal': sum(target['counters'].get('actualCoreWrites', target['counters'].get('actualParserCalls', 0)) for target in row['targetWork']),
        'nativeFrames': row['measured']['budgetAfter']['nativeFrames'] - row['measured']['budgetBefore']['nativeFrames'],
        'copiedRowCaptures': sum(target['counters'].get('copiedRowCaptures', 0) for target in row['targetWork']),
        'copiedTextReads': sum(target['counters'].get('copiedTextReads', 0) for target in row['targetWork']),
        'gl': {key: value - row['measured']['budgetBefore']['gl'].get(key, 0) for key, value in row['measured']['budgetAfter']['gl'].items()},
    } for row in raw['runs']]
    result['workloads'][workload] = {'id': protocol['id'], 'raw': str(raw_path), 'rawSha256': hashlib.sha256(raw_bytes).hexdigest(), 'armMeans': means, 'budget': budget, 'fullGhosttyOverXterm': ratios, 'proof': work_proof}
result['complete'] = set(result['workloads']) == {'line-scroll', 'unicode-emoji'}
output = LANE / 'budget-results.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'complete': result['complete'], 'output': str(output), 'workloads': list(result['workloads'])}))

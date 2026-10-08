import argparse
import json
import math
import pathlib
import statistics

parser = argparse.ArgumentParser()
parser.add_argument('samples', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path)
args = parser.parse_args()
rows = [json.loads(line) for line in args.samples.read_text().splitlines()]
config = next(row for row in rows if row['kind'] == 'configuration')
samples = [row for row in rows if row['kind'] == 'sample']
calibration = [row for row in rows if row['kind'] == 'calibration']
summary = {'source': str(args.samples), 'configuration': config, 'validSamples': len(samples), 'calibration': {'increments': [row['increment'] for row in calibration], 'maximumRelativeError': max(abs(row['increment'] / row['expectedInstructionIncrement'] - 1) for row in calibration)}}
by_arm = {}
for sample in samples:
    by_arm.setdefault(sample['arm'], []).append(sample)
summary['arms'] = {}
for arm, values in by_arm.items():
    instructions = [row['sample']['instructions'] for row in values]
    cv = statistics.stdev(instructions) / statistics.mean(instructions) if len(values) > 1 else None
    summary['arms'][arm] = {'n': len(values), 'instructionMean': statistics.mean(instructions), 'instructionMedian': statistics.median(instructions), 'instructionCvPercent': None if cv is None else cv * 100, 'instructionRange': [min(instructions), max(instructions)], 'elapsedMedianMs': statistics.median(row['elapsedMs'] for row in values), 'minimumPmuCoverage': min(row['sample']['runningNs'] / row['sample']['enabledNs'] for row in values), 'historyCounts': sorted(set(proof['history'] for row in values for proof in row['proof'])), 'outputDigests': sorted(set(proof['textDigest'] for row in values for proof in row['proof'])), 'frameDigests': sorted(set(proof['frameDigest'] for row in values for proof in row['proof'])), 'workExamples': [values[0]['work']]}
blocks = {}
for row in samples:
    blocks.setdefault(row['block'], []).append(row)
ratios = []
block_logs = []
for block in blocks.values():
    if len(block) != 4:
        continue
    a0, b1, b2, a3 = block
    pair1 = b1['sample']['instructions'] / a0['sample']['instructions']
    pair2 = b2['sample']['instructions'] / a3['sample']['instructions']
    ratios.extend([pair1, pair2])
    block_logs.append((math.log(pair1) + math.log(pair2)) / 2)
if ratios:
    n = len(block_logs)
    mean = statistics.mean(block_logs)
    sd = statistics.stdev(block_logs) if n > 1 else None
    critical = {2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 9: 2.306, 10: 2.262, 11: 2.228, 12: 2.201, 13: 2.179, 14: 2.16, 15: 2.145, 16: 2.131}.get(n, 1.96)
    half = critical * sd / math.sqrt(n) if sd is not None else None
    interval = [math.exp(mean - half), math.exp(mean + half)] if half is not None else None
    method = 'Student t' if n <= 16 else 'Normal approximation'
    summary['comparison'] = {'pairRatios': ratios, 'medianPairRatio': statistics.median(ratios), 'blockGeometricRatio': math.exp(mean), 'blockN': n, 'blockLogSd': sd, 'ci95': interval, 'ciMethod': f'{method} over mean log ratio of each whole ABBA block; no independence assumed for pairs within block', 'estimatedBlocksFor80PercentPowerAt1Percent': None if sd is None else math.ceil(((1.96 + .8416) * sd / abs(math.log(.99))) ** 2)}
proofs = [proof for row in samples for proof in row['proof']]
summary['equalWorkAndOutput'] = {'ticks': len(set(row['work']['ticks'] for row in samples)) <= 1, 'bytes': len(set(row['work']['bytes'] for row in samples)) <= 1, 'glCommands': len(set(json.dumps(row['work']['gl'], sort_keys=True) for row in samples)) <= 1, 'canvasCommands': len(set(json.dumps(row['work'].get('canvas'), sort_keys=True) for row in samples)) <= 1, 'text': len(set(proof['textDigest'] for proof in proofs)) <= 1, 'retainedText': len(set(proof.get('retainedDigest') for proof in proofs)) <= 1, 'instances': len(set(proof['frameDigest'] for proof in proofs)) <= 1, 'history': len(set(proof['history'] for proof in proofs)) <= 1}
boundaries = [sample['instructions'] for row in rows if row['kind'] == 'boundary-calibration' for sample in row['samples']]
summary['boundaryInstructions'] = None if not boundaries else {'n': len(boundaries), 'median': statistics.median(boundaries), 'range': [min(boundaries), max(boundaries)]}
summary['precisionTargetMet'] = bool(samples) and all(value['instructionCvPercent'] is not None and value['instructionCvPercent'] <= .3 for value in summary['arms'].values())
summary['calibrationPassed'] = summary['calibration']['maximumRelativeError'] <= .001
expected_order = config['arms'] if len(config['arms']) == 1 else [config['arms'][0], config['arms'][1], config['arms'][1], config['arms'][0]]
summary['allBlocksComplete'] = bool(blocks) and all([sample['arm'] for sample in block] == expected_order and [sample['position'] for sample in block] == list(range(len(expected_order))) for block in blocks.values())
summary['requestedRepetitionsComplete'] = set(blocks) == set(range(config.get('repetitions', len(blocks))))
summary['allBlocksComplete'] = summary['allBlocksComplete'] and summary['requestedRepetitionsComplete']
summary['coveragePassed'] = bool(samples) and all(value['minimumPmuCoverage'] > .999 for value in summary['arms'].values())
summary['gatesPassed'] = summary['calibrationPassed'] and summary['allBlocksComplete'] and summary['coveragePassed'] and all(summary['equalWorkAndOutput'].values())
text = json.dumps(summary, indent=2) + '\n'
if args.output:
    args.output.write_text(text)
print(json.dumps({key: value for key, value in summary.items() if key != 'configuration'}, indent=2))

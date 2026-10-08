"""Exploratory power estimates from preserved valid Mac ABBA summary files.

No acquisition, no pooling across workloads, and no short-segment precision claim.
"""
import argparse
import json
import math
import pathlib
import statistics

parser = argparse.ArgumentParser()
parser.add_argument('summaries', nargs='+', type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
results = []
for path in args.summaries:
    summary = json.loads(path.read_text())
    result = {'source': str(path), 'status': summary['status'], 'workload': summary['workload'], 'channels': {}}
    for channel in ['renderer', 'allChrome']:
        pairs = summary['channels'][channel]['pairs']
        values = {}
        for metric, effect in [('instructions', .01), ('energyJ', .02)]:
            logs = [math.log(pair['ratios'][metric]) for pair in pairs]
            by_block = {}
            for pair, value in zip(pairs, logs):
                # Four successive windows form one ABBA/BAAB cluster.
                block = min(pair['indexes']) // 4
                by_block.setdefault(block, []).append(value)
            blocks = [statistics.mean(group) for group in by_block.values()]
            pair_sd = statistics.stdev(logs) if len(logs) > 1 else None
            block_sd = statistics.stdev(blocks) if len(blocks) > 1 else None
            effect_log = abs(math.log(1 - effect))
            power = lambda sd: None if sd is None else max(1, math.ceil(((1.96 + .8416) * sd / effect_log) ** 2))
            half = None if block_sd is None else 12.706 * block_sd / math.sqrt(2) if len(blocks) == 2 else 1.96 * block_sd / math.sqrt(len(blocks))
            values[metric] = {
                'pairRatios': [math.exp(value) for value in logs],
                'geometricRatio': math.exp(statistics.mean(logs)),
                'pairLogSdPercent': None if pair_sd is None else pair_sd * 100,
                'blockLogSdPercent': None if block_sd is None else block_sd * 100,
                'blocks': len(blocks),
                'clusteredCi95': None if half is None else [math.exp(statistics.mean(blocks) - half), math.exp(statistics.mean(blocks) + half)],
                'targetEffectPercent': effect * 100,
                'optimisticIndependentPairs80Power': power(pair_sd),
                'clusteredBlocks80Power': power(block_sd),
                'clusteredSegments80Power': None if power(block_sd) is None else power(block_sd) * 4,
            }
        result['channels'][channel] = values
    results.append(result)
output = {
    'status': 'EXPLORATORY_DESIGN_INPUT',
    'method': 'Two-sided alpha .05, power .80 normal planning approximation; log B/A paired effects, whole four-window blocks as clusters. Two pilot blocks cannot establish stable variance. Estimates are from long windows and do not predict short-window variance.',
    'shortSegmentPlan': {'seconds': 3, 'ticksAt60Hz': 180, 'minimumPilotBlocks': 6, 'maximumBlocksPerBoundedTurn': 12, 'maximumMeasuredSecondsPerTurn': 144, 'minimumSegments': 24, 'clockAndPower': 'Instructions and estimated process CPU energy primary; CPU seconds context. Cycles need stall analysis because lower clock shortens stall counts.'},
    'results': results,
}
args.output.write_text(json.dumps(output, indent=2) + '\n')
print(json.dumps([{'workload': row['workload'], 'allChrome': row['channels']['allChrome']} for row in results], indent=2))

import argparse
import json
import math
import pathlib
import statistics

T95 = [None, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042]


def critical(df):
    if df < len(T95):
        return T95[df]
    return 1.959964 + 2.372271 / df + 2.8225 / df ** 2


def interval(logs):
    n = len(logs)
    mean = statistics.mean(logs)
    sd = statistics.stdev(logs) if n > 1 else None
    margin = critical(n - 1) * sd / math.sqrt(n) if sd is not None else None
    return {'ratio': math.exp(mean), 'n': n, 'blockLogSdPercent': sd * 100 if sd is not None else None, 'ci95': [math.exp(mean - margin), math.exp(mean + margin)] if margin is not None else None}


def required_blocks(sd, fraction):
    target = math.log1p(fraction)
    for n in range(2, 10000):
        if (critical(n - 1) + 0.841621) * sd / math.sqrt(n) <= target:
            return n
    return None


def lag_one(values):
    if len(values) < 3:
        return None
    mean = statistics.mean(values)
    denom = sum((v - mean) ** 2 for v in values)
    return sum((values[i] - mean) * (values[i - 1] - mean) for i in range(1, len(values))) / denom if denom else None


def summarize(data):
    assert data['complete'], data.get('failure')
    rows = data['runs']
    assert len(rows) == data['protocol']['blocks'] * 4
    assert all(row['complete'] and row['idleWorkUnchanged'] for row in rows)
    if 'contentSha256' in rows[0]:
        assert len({row['contentSha256'] for row in rows}) == 1
    else:
        assert data['arms']['A']['contentSha256'] == data['arms']['B']['contentSha256']
        assert data['arms']['A']['rgbaHashes'] == data['arms']['B']['rgbaHashes']
    assert len({row['measured']['stock']['inputBytesPerTerminal'] for row in rows}) == 1
    assert len({row['measured']['stock']['completedTicks'] for row in rows}) == 1
    assert len({(r['label'], r['activePid'], r['idlePid']) for r in rows}) == 2
    for row in rows:
        assert all(target['counters']['publicWrites'] == data['protocol']['ticks'] + 1 for target in row['targetWork'])
    output = {'id': data['id'], 'protocol': data['protocol'], 'blocks': data['protocol']['blocks'], 'segments': len(rows), 'nominalMeasuredSeconds': len(rows) * data['protocol']['ticks'] / 60, 'actualMeasuredSeconds': sum(row['wallSeconds'] for row in rows), 'channels': {}, 'idle': {}, 'supportEstablishedEverySegment': True}
    channels = ['renderer', 'GPU', 'rendererPlusGPU', 'allChrome', 'otherChrome']
    for channel in channels:
        output['channels'][channel] = {}
        for metric, target in [('instructions', .01), ('energyJ', .02), ('cycles', .01), ('cpuSeconds', .01), ('effectiveClockGHz', .01), ('pCoreTimeShare', .01)]:
            values = {label: [r['native']['channels'][channel][metric] for r in rows if r['label'] == label] for label in ['A', 'B']}
            if any(v is None or v <= 0 for arm in values.values() for v in arm):
                continue
            logs = []
            for block in range(output['blocks']):
                cohort = [r for r in rows if r['block'] == block]
                pair = {label: [r['native']['channels'][channel][metric] for r in cohort if r['label'] == label] for label in ['A', 'B']}
                logs.append(statistics.mean(map(math.log, pair['B'])) - statistics.mean(map(math.log, pair['A'])))
            result = interval(logs)
            result['blockLogRatios'] = logs
            result['segmentCvPercent'] = {label: 100 * statistics.stdev(v) / statistics.mean(v) for label, v in values.items()}
            result['armMeans'] = {label: statistics.mean(v) for label, v in values.items()}
            result['armMedians'] = {label: statistics.median(v) for label, v in values.items()}
            sd = statistics.stdev(logs)
            result['blocksFor80PercentPowerAtTarget'] = required_blocks(sd, target)
            result['targetFraction'] = target
            result['segmentsFor80PercentPowerAtTarget'] = result['blocksFor80PercentPowerAtTarget'] * 4 if result['blocksFor80PercentPowerAtTarget'] else None
            result['nominalSecondsFor80PercentPowerAtTarget'] = result['segmentsFor80PercentPowerAtTarget'] * data['protocol']['ticks'] / 60 if result['segmentsFor80PercentPowerAtTarget'] else None
            result['lagOneBlockCorrelation'] = lag_one(logs)
            result['byOrder'] = {'ABBA': interval(logs[::2]), 'BAAB': interval(logs[1::2])}
            clusters = [statistics.mean(logs[i:i + 2]) for i in range(0, len(logs), 2) if len(logs[i:i + 2]) == 2]
            if len(clusters) > 1:
                result['twoBlockClusterSensitivity'] = interval(clusters)
            result['firstHalfRatio'] = math.exp(statistics.mean(logs[:len(logs) // 2]))
            result['secondHalfRatio'] = math.exp(statistics.mean(logs[len(logs) // 2:]))
            output['channels'][channel][metric] = result
    for field, metric in [('ri_instructions', 'instructions'), ('ri_energy_nj', 'energyJ'), ('ri_cycles', 'cycles')]:
        fractions = [r['idleRenderer'][field] / r['native']['channels']['allChrome'][field] for r in rows]
        output['idle'][metric] = {'medianPercentOfAllChrome': 100 * statistics.median(fractions), 'maxPercentOfAllChrome': 100 * max(fractions), 'allBelowRegisteredPointTwoPercent': max(fractions) < .002}
    output['idleControls'] = [{k: r[k] for k in ['kind', 'label', 'milliseconds']} | {'channels': r['native']['channels']} for r in data['idle']]
    endpoints = [s for r in rows for s in r['snapshots'].values()]
    envelopes = [float(int(s['nativeCompletedNs']) - int(s['nativeRequestedNs'])) / 1e6 for s in endpoints]
    output['nativeReadEnvelopeMs'] = {'median': statistics.median(envelopes), 'max': max(envelopes)}
    output['coverage'] = 'Stable endpoint PID/type/start identities; sequential non-atomic reads; entirely inter-endpoint short-lived processes can be missed.'
    output['ciMethod'] = 'Student t on whole ABBA/BAAB mean log ratios. Two-block cluster sensitivity and order splits retained. Power estimates are planning only, conditional on stationary independent blocks.'
    if data.get('injectionCalibration'):
        calibration = data['injectionCalibration']
        zero = statistics.mean(r['native']['channels']['allChrome']['instructions'] for r in calibration if r['iterations'] == 0)
        pulse = statistics.mean(r['native']['channels']['allChrome']['instructions'] for r in calibration if r['iterations'] == 1000000)
        extra = (pulse - zero) * data['protocol']['injectionIterations'] / 1000000
        baseline = output['channels']['allChrome']['instructions']['armMeans']['A']
        output['injection'] = {'iterations': data['protocol']['injectionIterations'], 'instructionsPerIteration': (pulse - zero) / 1000000, 'expectedFractionOfBaseline': extra / baseline, 'observedRatio': output['channels']['allChrome']['instructions']['ratio']}
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    output = summarize(json.loads(args.input.read_text()))
    args.output.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({k: output[k] for k in ['id', 'segments', 'nominalMeasuredSeconds', 'actualMeasuredSeconds', 'idle']}))
    print(json.dumps({m: output['channels']['allChrome'][m] for m in ['instructions', 'energyJ', 'cycles']}, indent=2))

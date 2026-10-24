#!/usr/bin/env python3
"""Report V8 heap ownership and baseline deltas using only Python's standard library."""
import argparse
import collections
import gzip
import json


def load(path):
    reader = gzip.open if str(path).endswith('.gz') else open
    with reader(path, 'rt', encoding='utf-8') as source:
        return json.load(source)


class Heap:
    def __init__(self, data):
        meta = data['snapshot']['meta']
        self.nodes = data['nodes']
        self.edges = data['edges']
        self.strings = data['strings']
        self.node_fields = meta['node_fields']
        self.edge_fields = meta['edge_fields']
        self.width = len(self.node_fields)
        self.edge_width = len(self.edge_fields)
        self.types = meta['node_types'][0]
        self.edge_types = meta['edge_types'][0]
        self.count = len(self.nodes) // self.width
        self.names = [self.strings[self.value(v, 'name')] for v in range(self.count)]
        self.kinds = [self.types[self.value(v, 'type')] for v in range(self.count)]
        self.sizes = [self.value(v, 'self_size') for v in range(self.count)]
        self.ids = [self.value(v, 'id') for v in range(self.count)]
        self.successors = [[] for _ in range(self.count)]
        self.predecessors = [[] for _ in range(self.count)]
        self.edge_names = {}
        self.properties = [[] for _ in range(self.count)]
        self.graph()

    def value(self, vertex, field):
        return self.nodes[vertex * self.width + self.node_fields.index(field)]

    def targets(self, start, count):
        for offset in range(start, start + count * self.edge_width, self.edge_width):
            kind = self.edge_types[self.edges[offset]]
            if kind == 'weak':
                continue
            target = self.edges[offset + self.edge_fields.index('to_node')] // self.width
            raw_name = self.edges[offset + self.edge_fields.index('name_or_index')]
            name = str(raw_name) if kind in ('element', 'hidden') else self.strings[raw_name]
            yield target, name

    def graph(self):
        start = 0
        for vertex in range(self.count):
            count = self.value(vertex, 'edge_count')
            for target, name in self.targets(start, count):
                self.successors[vertex].append(target)
                self.predecessors[target].append(vertex)
                self.edge_names[(vertex, target)] = name
                self.properties[vertex].append((name, target))
            start += count * self.edge_width

    def describe(self, vertex):
        return {'node': vertex, 'id': self.ids[vertex], 'type': self.kinds[vertex],
                'name': self.names[vertex][:120], 'selfBytes': self.sizes[vertex]}


def postorder(graph):
    visited = [False] * len(graph)
    result = []
    stack = [(0, False)]
    while stack:
        vertex, expanded = stack.pop()
        if expanded:
            result.append(vertex)
            continue
        if visited[vertex]:
            continue
        visited[vertex] = True
        stack.append((vertex, True))
        for child in graph[vertex]:
            stack.append((child, False))
    return result


def intersect(left, right, ranks, parents):
    while left != right:
        while ranks[left] > ranks[right]:
            left = parents[left]
        while ranks[right] > ranks[left]:
            right = parents[right]
    return left


def parent_for(vertex, heap, ranks, parents):
    candidates = [pred for pred in heap.predecessors[vertex] if parents[pred] != -1]
    if not candidates:
        return -1
    parent = candidates[0]
    for candidate in candidates[1:]:
        parent = intersect(parent, candidate, ranks, parents)
    return parent


def dominators(heap):
    order = list(reversed(postorder(heap.successors)))
    ranks = {vertex: rank for rank, vertex in enumerate(order)}
    parents = [-1] * heap.count
    parents[0] = 0
    changed = True
    passes = 0
    while changed:
        changed = False
        passes += 1
        for vertex in order[1:]:
            parent = parent_for(vertex, heap, ranks, parents)
            changed |= parents[vertex] != parent
            parents[vertex] = parent
    return order, parents, passes


def shortest_paths(heap):
    parents = [-1] * heap.count
    parents[0] = 0
    queue = collections.deque([0])
    while queue:
        parent = queue.popleft()
        children = [child for child in heap.successors[parent] if parents[child] == -1]
        for child in children:
            parents[child] = parent
            queue.append(child)
    return parents


def path_to(heap, target, parents):
    path = []
    vertex = target
    while vertex != 0 and parents[vertex] >= 0:
        parent = parents[vertex]
        path.append({**heap.describe(vertex), 'edge': heap.edge_names[(parent, vertex)]})
        vertex = parent
    return list(reversed(path))


def totals(heap):
    groups = collections.defaultdict(lambda: {'count': 0, 'selfBytes': 0})
    for vertex in range(heap.count):
        key = heap.kinds[vertex] + ': ' + heap.names[vertex][:100]
        groups[key]['count'] += 1
        groups[key]['selfBytes'] += heap.sizes[vertex]
    return groups


def owned_fields(heap, retained, paths):
    names = {'history', 'editChain', 'measurements', 'root', 'reverseIndex', 'lineIndexes', 'chunks'}
    fields = collections.defaultdict(set)
    for (parent, target), name in heap.edge_names.items():
        if name in names:
            fields[name].add(target)
    result = {}
    for name, targets in fields.items():
        ranked = sorted(targets, key=lambda vertex: retained[vertex], reverse=True)[:8]
        result[name] = [{**heap.describe(v), 'retainedBytes': retained[v],
                         'path': path_to(heap, v, paths)} for v in ranked]
    return result


def object_shapes(heap):
    shapes = collections.defaultdict(lambda: {'count': 0, 'selfBytes': 0, 'example': None})
    for vertex in range(heap.count):
        if heap.kinds[vertex] != 'object' or heap.names[vertex] != 'Object':
            continue
        keys = tuple(sorted(name for name, _ in heap.properties[vertex]))
        shapes[keys]['count'] += 1
        shapes[keys]['selfBytes'] += heap.sizes[vertex]
        shapes[keys]['example'] = vertex
    rows = [{'fields': list(fields), **facts} for fields, facts in shapes.items()]
    return sorted(rows, key=lambda row: row['selfBytes'], reverse=True)[:20]


def category(heap, vertex):
    kind = heap.kinds[vertex]
    if kind != 'object':
        return kind
    keys = {name for name, _ in heap.properties[vertex]}
    if {'piece', 'subtreeVisibleLength'} <= keys:
        return 'piece-tree node'
    if {'buffer', 'start', 'length', 'visible'} <= keys:
        return 'piece'
    if {'start', 'order', 'height', 'left', 'right'} <= keys:
        return 'reverse-index split node'
    if {'count', 'shift', 'root', 'tail'} <= keys:
        return 'reverse-index header'
    if {'offsets', 'count', 'scannedLength', 'text'} <= keys:
        return 'line index'
    if {'snapshotBefore', 'snapshotAfter', 'inverseEdits'} <= keys:
        return 'transaction'
    return kind


def category_totals(heap):
    result = collections.defaultdict(lambda: {'count': 0, 'selfBytes': 0})
    for vertex in range(heap.count):
        row = result[category(heap, vertex)]
        row['count'] += 1
        row['selfBytes'] += heap.sizes[vertex]
    return result


def inverse_strings(heap):
    arrays = {target for entries in heap.properties for name, target in entries if name == 'inverseEdits'}
    edits = {target for owner in arrays for name, target in heap.properties[owner] if name.isdigit()}
    payloads = {target for owner in edits for name, target in heap.properties[owner] if name == 'text'}
    string_kinds = {'string', 'concatenated string', 'sliced string'}
    owned = set()
    queue = list(payloads)
    while queue:
        vertex = queue.pop()
        if vertex in owned or heap.kinds[vertex] not in string_kinds:
            continue
        owned.add(vertex)
        queue.extend(child for child in heap.successors[vertex] if heap.kinds[child] in string_kinds)
    parents = {child for vertex in owned if heap.kinds[vertex] == 'sliced string'
               for name, child in heap.properties[vertex] if name == 'parent'}
    return {'inverseEditArrays': len(arrays), 'distinctTextReferences': len(payloads),
            'stringGraphNodes': len(owned), 'stringGraphBytes': sum(heap.sizes[v] for v in owned),
            'distinctSliceParents': len(parents), 'sliceParentBytes': sum(heap.sizes[v] for v in parents),
            'note': 'Unique string nodes reachable from inverse edit text, including sliced/cons parents. Other owners can share these bytes; this is not exclusive retained size.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot')
    parser.add_argument('--baseline')
    parser.add_argument('--top', type=int, default=30)
    args = parser.parse_args()
    heap = Heap(load(args.snapshot))
    baseline = Heap(load(args.baseline)) if args.baseline else None
    baseline_ids = set(baseline.ids) if baseline else set()
    baseline_groups = totals(baseline) if baseline else {}
    order, parents, passes = dominators(heap)
    paths = shortest_paths(heap)
    retained = heap.sizes.copy()
    added = [size if heap.ids[v] not in baseline_ids else 0 for v, size in enumerate(heap.sizes)]
    native = [size if heap.kinds[v] == 'native' else 0 for v, size in enumerate(heap.sizes)]
    for vertex in reversed(order[1:]):
        retained[parents[vertex]] += retained[vertex]
        added[parents[vertex]] += added[vertex]
        native[parents[vertex]] += native[vertex]
    ranked = sorted(order[1:], key=lambda vertex: retained[vertex], reverse=True)
    dominant = []
    for vertex in ranked[:args.top]:
        dominant.append({**heap.describe(vertex), 'retainedBytes': retained[vertex],
                         'retainedNewBytes': added[vertex], 'retainedNativeBytes': native[vertex],
                         'path': path_to(heap, vertex, paths)})
    groups = []
    for name, current in totals(heap).items():
        before = baseline_groups.get(name, {'count': 0, 'selfBytes': 0})
        groups.append({'name': name, **current, 'countDelta': current['count'] - before['count'],
                       'bytesDelta': current['selfBytes'] - before['selfBytes']})
    report = {'nodes': heap.count, 'reachableNodes': len(order), 'dominatorPasses': passes,
              'snapshotSelfBytes': sum(heap.sizes),
              'baselineSelfBytes': sum(baseline.sizes) if baseline else None,
              'note': 'Retained sizes use dominators of the snapshot graph with weak edges excluded; this is not the DevTools ephemeron-aware retention model. Categories are disjoint shallow sums. Dominator rows can contain other rows and overlap categories; do not add these views. Native DOM/external allocations do not equal Runtime.getHeapUsage. New bytes mean object IDs absent from the baseline, not net growth.',
              'dominant': dominant,
              'ownedFields': owned_fields(heap, retained, paths),
              'objectShapes': object_shapes(heap),
              'categories': category_totals(heap),
              'baselineCategories': category_totals(baseline) if baseline else None,
              'inverseEditStrings': inverse_strings(heap),
              'largestGroups': sorted(groups, key=lambda row: row['selfBytes'], reverse=True)[:args.top],
              'largestGrowthGroups': sorted(groups, key=lambda row: row['bytesDelta'], reverse=True)[:args.top]}
    ranked_strings = sorted((v for v in order if heap.kinds[v] in ('string', 'concatenated string', 'sliced string')), key=lambda v: heap.sizes[v], reverse=True)
    report['largestStrings'] = [{**heap.describe(v), 'retainedBytes': retained[v], 'path': path_to(heap, v, paths)} for v in ranked_strings[:args.top]]
    report['snapshotNativeBytes'] = sum(size for v, size in enumerate(heap.sizes) if heap.kinds[v] == 'native')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

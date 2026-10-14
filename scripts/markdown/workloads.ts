export type BenchmarkFamily =
  | 'cold-mount'
  | 'warm-completed'
  | 'streaming-replay'
  | 'pathological-scaling'
  | 'reference-invalidation'
  | 'highlighting-extensions'
  | 'timeline-input'
  | 'resources'
  | 'payload'

export const BENCHMARK_FAMILIES: readonly BenchmarkFamily[] = [
  'cold-mount',
  'warm-completed',
  'streaming-replay',
  'pathological-scaling',
  'reference-invalidation',
  'highlighting-extensions',
  'timeline-input',
  'resources',
  'payload',
]

export type BenchmarkMode = 'quick' | 'promotion'
export type Workload = {
  readonly id: string
  readonly source: string
  readonly shape: string
  readonly sourceBytes: number
}

export const BENCHMARK_PROFILES = {
  quick: {
    trials: 3,
    warmups: 1,
    completedBytes: [256, 2048, 8192],
    streamBytes: [256, 2048],
    pathologicalBytes: [1024, 8192],
    cycleCounts: [20],
    timelineCounts: [1, 20],
  },
  promotion: {
    trials: 20,
    warmups: 3,
    completedBytes: [256, 2048, 8192, 32768, 131072],
    streamBytes: [256, 2048, 8192, 32768, 131072],
    pathologicalBytes: [1024, 16384, 262144, 1048576],
    cycleCounts: [20, 100, 500],
    timelineCounts: [1, 20, 100, 500],
  },
} satisfies Record<
  BenchmarkMode,
  {
    trials: number
    warmups: number
    completedBytes: readonly number[]
    streamBytes: readonly number[]
    pathologicalBytes: readonly number[]
    cycleCounts: readonly number[]
    timelineCounts: readonly number[]
  }
>

export const STREAM_UNITS: readonly number[] = [1, 8, 24, 64, 256]
const MIXED =
  '# Heading\n\nA **bold** answer and [a link](https://example.test/docs).\n\n' +
  '- First item\n- Second item with `inline code`\n\n' +
  '| Name | Value |\n| --- | ---: |\n| alpha | 12 |\n\n' +
  '```typescript\nconst count = 42\n```\n\n> Quoted answer.\n\n'

export function workload(id: string, source: string, shape: string): Workload {
  return { id, source, shape, sourceBytes: new TextEncoder().encode(source).byteLength }
}

export function mixedWorkload(bytes: number): Workload {
  return workload(`mixed-${bytes}`, repeatAscii(MIXED, bytes), 'mixed')
}

export function pathologicalWorkloads(bytes: number): readonly Workload[] {
  return [
    workload(`paragraph-${bytes}`, repeatAscii('one enormous paragraph ', bytes), 'one-paragraph'),
    workload(`fence-${bytes}`, fillFence(bytes), 'one-fence'),
    workload(`references-${bytes}`, repeatReferences(bytes), 'many-references'),
    workload(`deep-list-${bytes}`, repeatAscii(deepList(), bytes), 'deep-list'),
    workload(`wide-table-${bytes}`, repeatAscii(wideTable(), bytes), '32-column-table'),
    mixedWorkload(bytes),
  ]
}

export function referenceRevisions(): readonly { readonly id: string; readonly source: string }[] {
  const uses = Array.from(
    { length: 64 },
    (_, index) => `Paragraph ${index}: [early][target].`,
  ).join('\n\n')
  return [
    { id: 'unresolved', source: uses },
    { id: 'late-definition', source: `${uses}\n\n[target]: https://example.test/first` },
    { id: 'edited-definition', source: `${uses}\n\n[target]: https://example.test/second` },
    { id: 'removed-definition', source: uses },
    { id: 'early-definition', source: `[target]: https://example.test/third\n\n${uses}` },
  ]
}

export function timelineWorkloads(count: number, source: string): readonly Workload[] {
  return Array.from({ length: count }, (_, index) =>
    workload(`timeline-${count}-${index}`, source, 'timeline'),
  )
}

/** The generator owns no growing-prefix array; source slicing happens before an update timer. */
export function* fixedChunks(
  source: string,
  units: number,
): Iterable<{ offset: number; text: string }> {
  for (let offset = units; offset < source.length; offset += units) {
    yield { offset, text: source.slice(0, offset) }
  }
  yield { offset: source.length, text: source }
}

function repeatAscii(pattern: string, bytes: number): string {
  return pattern.repeat(Math.ceil(bytes / pattern.length)).slice(0, bytes)
}

function fillFence(bytes: number): string {
  const opener = '```typescript\n'
  const closer = '\n```'
  return (
    opener +
    repeatAscii('const value = 42;\n', Math.max(0, bytes - opener.length - closer.length)) +
    closer
  )
}

function deepList(): string {
  return (
    Array.from({ length: 32 }, (_, depth) => `${'  '.repeat(depth)}- level ${depth}`).join('\n') +
    '\n\n'
  )
}

function wideTable(): string {
  const row = (prefix: string) =>
    `| ${Array.from({ length: 32 }, (_, index) => `${prefix}${index}`).join(' | ')} |\n`
  return (
    row('column') +
    `| ${Array.from({ length: 32 }, () => '---').join(' | ')} |\n` +
    row('value') +
    '\n'
  )
}

function repeatReferences(bytes: number): string {
  const pair = (index: number) =>
    `[use ${index}][ref${index}]\n\n[ref${index}]: https://example.test/${index}\n\n`
  const parts: string[] = []
  let length = 0
  for (let index = 0; length < bytes; index += 1) {
    const part = pair(index)
    parts.push(part)
    length += part.length
  }
  return parts.join('').slice(0, bytes)
}

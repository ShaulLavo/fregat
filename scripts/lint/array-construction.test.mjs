import { expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript-api'
import {
  firstPartyFiles,
  allocationCopyCandidates,
  arrayCandidates,
  checkArrayCandidates,
  inspectAllocationCopies,
  inspectFiles,
  inspectMutationCopies,
  inspectMutationSnapshots,
  inspectImmutableOrdering,
} from './array-construction.mjs'

const source = `
declare const items: number[];
declare const readonlyItems: readonly number[];
declare const other: number[];
declare const bytes: Uint8Array;
declare const set: Set<number>;
declare const unknown: any;
declare const custom: { map(fn: (value: number) => number): Set<number> };
const cases = {
  multipleArrays: [...items, ...other],
  multipleIterables: [...set, ...bytes],
  freshMap: [...items.map(value => value + 1)],
  freshFilter: [...readonlyItems.filter(Boolean)],
  freshFlatMap: [...items.flatMap(value => [value])],
  freshSlice: [...items.slice()],
  freshConcat: [...items.concat(other)],
  freshFrom: [...Array.from(set)],
  freshSorted: [...items.toSorted()],
  freshLiteral: [...[1, 2]],
  copiedMap: [...items].map(value => value + 1),
  copiedFilter: [...readonlyItems].filter(Boolean),
  copiedFlatMap: ([...items]).flatMap(value => [value]),
  wrappedCopiedMap: ([...items] as number[]).map(value => value),
  typedMap: [...bytes.map(value => value + 1)],
  typedSlice: [...bytes.slice()],
  typedFilter: [...bytes.filter(Boolean)],
  customMap: [...custom.map(value => value)],
  unknownMap: [...unknown.map(value => value)],
  iterator: [...set.values()],
  typedConversion: [...bytes],
  borrowedClone: [...items],
  mutableSort: [...items].sort(),
  mutableReverse: [...items].reverse(),
  append: [...items, 42],
  prepend: [42, ...items],
  explicitDensification: Array.from(items.map(value => value)),
  explicitCopiedDensification: Array.from(items).map(value => value),
  copiedDenseFilter: Array.from(items.filter(Boolean)),
  copiedDenseFlatMap: Array.from(items.flatMap(value => [value])),
  mappedFrom: Array.from(items.filter(Boolean), value => value + 1),
  nestedFrom: Array.from(Array.from(set)),
  copiedSliceMap: items.slice().map(value => value),
  copiedConcatFilter: readonlyItems.concat().filter(Boolean),
  rangedSliceMap: items.slice(1).map(value => value),
  typedSliceMap: bytes.slice().map(value => value),
  convertedTypedMap: Array.from(bytes.map(value => value)),
  ownedFromSort: Array.from(set).toSorted(),
  ownedFilterReverse: items.filter(Boolean).toReversed(),
  ownedFlatSort: items.flat().toSorted(),
  ownedLiteralSort: [1, 2].toSorted(),
  sparseMapSort: items.map(value => value).toSorted(),
  sparseSliceReverse: items.slice().toReversed(),
  sparseLiteralSort: [1, , 2].toSorted(),
  ownedToSpliced: items.filter(Boolean).toSpliced(1, 1),
  ownedWith: items.filter(Boolean).with(1, 2),
  borrowedToSorted: items.toSorted(),
  readonlyLiteralSort: ([1, 2] as const).toSorted(),
  readonlyLiteralReverse: ([1, 2] as readonly number[]).toReversed(),
  typedToSorted: bytes.toSorted(),
  fromSort: Array.from(items).sort((a, b) => b - a),
  fromReverse: Array.from(readonlyItems).reverse(),
  fromMappedSort: Array.from(items, value => value + 1).sort(),
  setCopiedSort: [...set].sort(),
  typedCopiedReverse: [...bytes].reverse(),
  iteratorCopiedSort: Array.from(set.values()).sort(),
  typedFromSort: Array.from(bytes).sort(),
  ownedCopiedSort: [...items.filter(Boolean)].sort(),
  snapshotSorted: [...items.sort()],
  snapshotReversed: Array.from(items.reverse()),
};
function shadowed(Array: { from(input: number[]): Set<number> }) {
  return [...Array.from(items)];
}
`
const filename = path.resolve('array-construction-fixture.ts')
const options = { target: ts.ScriptTarget.ESNext, strict: true, noEmit: true }
const host = ts.createCompilerHost(options)
const getSourceFile = host.getSourceFile.bind(host)
host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
  file === filename
    ? ts.createSourceFile(file, source, languageVersion, true)
    : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
const program = ts.createProgram([filename], options, host)
const file = program.getSourceFile(filename)
const findings = checkArrayCandidates(file, program.getTypeChecker())
const rules = new Map(
  findings.map((finding) => [
    source.split('\n')[finding.line - 1].trim().split(':')[0],
    finding.rule,
  ]),
)

test('rejects multiple array and iterable spreads', () => {
  expect(rules.get('multipleArrays')).toBe('array-concat')
  expect(rules.get('multipleIterables')).toBe('array-concat')
})

test.each([
  'freshMap',
  'freshFilter',
  'freshFlatMap',
  'freshSlice',
  'freshConcat',
  'freshFrom',
  'freshSorted',
  'freshLiteral',
])('rejects an unnecessary fresh-array copy: %s', (name) => {
  expect(rules.get(name)).toBe('redundant-array-copy')
})

test.each(['copiedMap', 'copiedFilter', 'copiedFlatMap', 'wrappedCopiedMap'])(
  'rejects a copy before an allocating method: %s',
  (name) => {
    expect(rules.get(name)).toBe('copy-before-allocation')
  },
)

test.each([
  'typedMap',
  'typedSlice',
  'typedFilter',
  'customMap',
  'unknownMap',
  'iterator',
  'typedConversion',
  'borrowedClone',
  'mutableSort',
  'mutableReverse',
  'append',
  'prepend',
  'explicitDensification',
  'explicitCopiedDensification',
])('retains semantic conversions and ownership copies: %s', (name) => {
  expect(rules.has(name)).toBe(false)
})

test('does not treat a shadowed Array.from as the built-in allocator', () => {
  expect(findings.some(({ line }) => source.split('\n')[line - 1].includes('return'))).toBe(false)
})

test('inventory sees multiline spreads without matching prose or other spread forms', () => {
  const parsed = ts.createSourceFile(
    'fixture.ts',
    `
    const prose = '[...items.map(fn)]';
    const object = { ...input };
    call(...items);
    const list = [
      ...items,
      ...other,
    ];
  `,
    ts.ScriptTarget.Latest,
    true,
  )
  expect(arrayCandidates(parsed).map(({ spreads }) => spreads.length)).toEqual([2])
})

const adjacent = inspectAllocationCopies(file, program.getTypeChecker())
const adjacentRules = new Map(
  adjacent.map((finding) => [
    source.split('\n')[finding.line - 1].trim().split(':')[0],
    finding.redundant,
  ]),
)

test.each([
  'copiedDenseFilter',
  'copiedDenseFlatMap',
  'nestedFrom',
  'copiedSliceMap',
  'copiedConcatFilter',
])('rejects adjacent copies of proven allocating arrays: %s', (name) => {
  expect(adjacentRules.get(name)).toBe(true)
})

test.each(['explicitDensification', 'explicitCopiedDensification', 'mappedFrom'])(
  'inventories potential densification or transformation for review: %s',
  (name) => {
    expect(adjacentRules.get(name)).toBe(false)
  },
)

test.each(['rangedSliceMap', 'typedSliceMap', 'convertedTypedMap'])(
  'retains slicing and typed array operations: %s',
  (name) => {
    expect(adjacentRules.has(name)).toBe(false)
  },
)

test('scans all first-party roots and excludes generated and dependency trees', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'array-construction-'))
  try {
    execFileSync('git', ['init', '--quiet', directory])
    const files = [
      'apps/a.ts',
      'editor/packages/a.tsx',
      'ghostty-webgpu/src/a.js',
      'hotkeys/a.mjs',
      'scripts/a.cjs',
      'packages/a.cts',
      'editor/references/a.ts',
      'vendor/a.js',
      'node_modules/a.js',
      'generated/a.ts',
      'dist/a.ts',
      'packages/a.d.ts',
    ]
    for (const filename of files) {
      const absolute = path.join(directory, filename)
      mkdirSync(path.dirname(absolute), { recursive: true })
      writeFileSync(absolute, '')
    }
    expect(firstPartyFiles(directory).sort()).toEqual(files.slice(0, 6).sort())
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('handles argumentless custom methods without assuming an Array.from call', () => {
  const parsed = ts.createSourceFile(
    'fixture.ts',
    'custom.from(); custom.slice().map(fn);',
    ts.ScriptTarget.Latest,
    true,
  )
  expect(allocationCopyCandidates(parsed)).toHaveLength(1)
})

test.each(['ownedFromSort', 'ownedFilterReverse', 'ownedFlatSort', 'ownedLiteralSort'])(
  'rejects extra immutable sorting or reversing of fresh dense arrays: %s',
  (name) => {
    expect(adjacentRules.get(name)).toBe(true)
  },
)

test.each([
  'sparseMapSort',
  'sparseSliceReverse',
  'sparseLiteralSort',
  'ownedToSpliced',
  'ownedWith',
  'readonlyLiteralSort',
  'readonlyLiteralReverse',
])('inventories sparse or complex copying methods for review: %s', (name) => {
  expect(adjacentRules.get(name)).toBe(false)
})

test.each(['borrowedToSorted', 'typedToSorted'])(
  'retains immutable operations on borrowed arrays and typed arrays: %s',
  (name) => {
    expect(adjacentRules.has(name)).toBe(false)
  },
)

test('fast mode leaves unresolved imported types alone while full mode follows them', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'array-construction-types-'))
  try {
    writeFileSync(
      path.join(directory, 'tsconfig.json'),
      JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }],
      }),
    )
    writeFileSync(
      path.join(directory, 'tsconfig.app.json'),
      JSON.stringify({
        include: ['*.ts'],
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          types: [],
        },
      }),
    )
    writeFileSync(path.join(directory, 'producer.ts'), 'export const items: number[] = [];')
    writeFileSync(
      path.join(directory, 'consumer.ts'),
      `import { items } from './producer'; const copy = [...items.map(value => value)];`,
    )
    expect(inspectFiles(['consumer.ts'], directory).findings).toEqual([])
    expect(inspectFiles(['consumer.ts'], directory, { fullTypes: true }).findings).toEqual([
      expect.objectContaining({ rule: 'redundant-array-copy' }),
    ])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('explicit densification preserves sparse spread semantics and direct mapping does not', () => {
  const result = runInNewContext(`
    const sparse = [1, , 3];
    const identity = value => value;
    const name = value => String(value);
    ({
      spreadAfter: [...sparse.map(identity)],
      directAfter: sparse.map(identity),
      explicitAfter: Array.from(sparse.map(identity)),
      spreadBefore: [...sparse].map(name),
      directBefore: sparse.map(name),
      explicitBefore: Array.from(sparse).map(name),
    });
  `)
  expect(result.explicitAfter).toStrictEqual(result.spreadAfter)
  expect(Object.hasOwn(result.spreadAfter, 1)).toBe(true)
  expect(Object.hasOwn(result.directAfter, 1)).toBe(false)
  expect(result.explicitBefore).toStrictEqual(result.spreadBefore)
  expect(result.spreadBefore[1]).toBe('undefined')
  expect(Object.hasOwn(result.directBefore, 1)).toBe(false)
})

const orderingCopies = inspectMutationCopies(file, program.getTypeChecker())
const orderingRows = new Map(
  orderingCopies.map((finding) => [
    source.split('\n')[finding.line - 1].trim().split(':')[0],
    finding,
  ]),
)

test.each(['mutableSort', 'mutableReverse', 'fromSort', 'fromReverse'])(
  'requires ownership review for cloned ordinary-array ordering: %s',
  (name) => {
    const row = orderingRows.get(name)
    expect(row.requiresChange).toBe(true)
    expect(row.ownershipReview).toBe(true)
    expect(row.replacement).toBeNull()
    expect(source.slice(row.start, row.end)).toBe(row.original)
    if (row.canMutate) expect(row.inPlaceReplacement).toMatch(/\.(sort|reverse)\(/)
    if (!row.canMutate) expect(row.inPlaceReplacement).toBeNull()
    expect(row.preserveInputReplacement).toMatch(/\.(toSorted|toReversed)\(/)
  },
)

test.each([
  'fromMappedSort',
  'setCopiedSort',
  'typedCopiedReverse',
  'iteratorCopiedSort',
  'typedFromSort',
])('retains conversion and mapping before ordering: %s', (name) => {
  const row = orderingRows.get(name)
  expect(row.requiresChange).toBe(false)
  expect(row.retainedConversion).toBe(true)
  expect(row.replacement).toBeNull()
})

test('uses in-place ordering when the source is a proven fresh dense array', () => {
  const row = orderingRows.get('ownedCopiedSort')
  expect(row.ownershipReview).toBe(false)
  expect(row.replacement).toBe('(items.filter(Boolean)).sort()')
})

test('inventories snapshots after mutation without changing original mutation ownership', () => {
  const snapshots = inspectMutationSnapshots(file, program.getTypeChecker())
  expect(snapshots.map((row) => row.original)).toEqual([
    '[...items.sort()]',
    'Array.from(items.reverse())',
  ])
  expect(snapshots.every((row) => row.replacement === null)).toBe(true)
})

test('inventories immutable ordering on borrowed, owned, readonly and typed arrays', () => {
  const rows = inspectImmutableOrdering(file, program.getTypeChecker())
  const borrowed = rows.find((row) => row.original === 'items.toSorted()')
  expect(borrowed.ownershipReview).toBe(true)
  expect(borrowed.replacement).toBeNull()
  expect(borrowed.inPlaceReplacement).toBe('(items).sort()')
  expect(rows.find((row) => row.original === 'bytes.toSorted()').ordinaryArray).toBe(false)
  expect(
    rows.find((row) => row.original === '([1, 2] as const).toSorted()').inPlaceReplacement,
  ).toBeNull()
})

test('copied immutable ordering preserves sparse spread and Array.from ordering semantics', () => {
  const result = runInNewContext(`
    const sparse = [3, , 1];
    const compare = (a, b) => a - b;
    ({
      spreadSort: [...sparse].sort(compare), immutableSort: sparse.toSorted(compare),
      fromSort: Array.from(sparse).sort(compare),
      spreadReverse: [...sparse].reverse(), immutableReverse: sparse.toReversed(),
      fromReverse: Array.from(sparse).reverse(), source: sparse,
    });
  `)
  expect(result.spreadSort).toStrictEqual(result.immutableSort)
  expect(result.fromSort).toStrictEqual(result.immutableSort)
  expect(result.spreadReverse).toStrictEqual(result.immutableReverse)
  expect(result.fromReverse).toStrictEqual(result.immutableReverse)
  expect(Object.hasOwn(result.source, 1)).toBe(false)
  expect(result.source[0]).toBe(3)
  expect(Object.hasOwn(result.immutableReverse, 1)).toBe(true)
})

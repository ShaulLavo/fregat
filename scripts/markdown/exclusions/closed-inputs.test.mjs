import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'vitest'
import { closedInputReader, inputSha256 } from './closed-inputs.mjs'

const require = createRequire(import.meta.url)
const ts = require(process.env.EXCLUSION_TYPESCRIPT ?? 'typescript-api')

function inputs(text) {
  const reader = closedInputReader(ts, new Map([['fixture.ts', text]]))
  const found = []
  function visit(node) {
    if (ts.isCallExpression(node) && reader.nameOf(node.expression) === 'update')
      found.push(reader.resolve(node.arguments[0]))
    ts.forEachChild(node, visit)
  }
  visit(reader.files.get('fixture.ts'))
  return found
}

test('resolves actual caller arguments and preserves paired loop bindings', () => {
  const rows = inputs(`
    function replay(source: string) { owner.update(source) }
    const cases = [{ prefix: 'A', suffix: 'a' }, { prefix: 'B', suffix: 'b' }]
    for (const { prefix, suffix } of cases) replay(prefix + suffix)
  `)
  assert.deepEqual(rows[0].failures, [])
  assert.deepEqual(rows[0].values, ['Aa', 'Bb'])
})

test('collects test.each arguments and numeric prefix loops without normalizing', () => {
  const rows = inputs(`
    test.each(['A\\r\\n', '😀'])('prefix', (source) => {
      for (let offset = 0; offset <= source.length; offset += 1) owner.update(source.slice(0, offset))
    })
  `)
  assert.deepEqual(rows[0].failures, [])
  assert.deepEqual(rows[0].values, ['', 'A', 'A\r', 'A\r\n', '', '\ud83d', '😀'])
  assert.equal(inputSha256('\ud83d'), inputSha256('\ufffd'))
  assert.notEqual(inputSha256('A\r\n'), inputSha256('A\n'))
})

test('keeps expectations separate and reports external inputs as unresolved', () => {
  const rows = inputs(`
    owner.update('authored')
    expect('expectation').toBe('different')
    owner.update(await fetch('/private').then(r => r.text()))
  `)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].values, ['authored'])
  assert.equal(rows[1].values.length, 0)
  assert.ok(rows[1].failures.length > 0)
})

test('resolves local data helpers without invoking unrelated side effects', () => {
  const rows = inputs(`
    function fixture() { const result = { source: 'exact' }; return result }
    owner.update(fixture().source + ' suffix')
  `)
  assert.deepEqual(rows[0].values, ['exact suffix'])
})

test('rejects executable constructors and unsupported function loops', () => {
  const rows = inputs(`
    owner.update(''.constructor.constructor('return process.env')())
    function random() { while (true) {} return 'unreachable' }
    owner.update(random())
  `)
  assert.ok(rows.every((row) => row.failures.length > 0))
  assert.ok(rows.every((row) => row.values.length === 0))
})

test('fails closed on helper mutation and continues past a false conditional', () => {
  const rows = inputs(`
    function changed() { let value = 'old'; value += 'new'; return value }
    owner.update(changed())
    function choose() { if (false) { return 'wrong' }; return 'right' }
    owner.update(choose())
  `)
  assert.ok(rows[0].failures.length > 0)
  assert.deepEqual(rows[1].values, ['right'])
})

test('fails closed on reassignment, aliases, reached throws and unknown conditions', () => {
  const rows = inputs(`
    let value = 'before'; value = 'after'; owner.update(value)
    const object = { source: 'before' }; const alias = object; alias.source = 'after'; owner.update(object.source)
    function stopped() { throw 'stop'; return 'unreachable' }; owner.update(stopped())
    import { unknown } from './external'; owner.update(unknown ? 'yes' : 'no')
    owner.update(unknown || 'fallback')
  `)
  assert.ok(rows.every((row) => row.failures.length > 0))
  assert.ok(rows.every((row) => row.values.length === 0))
})

test('literal inputs ignore unrelated callback parameters but globals respect shadowing', () => {
  const rows = inputs(`
    test('literal', ({ server }) => owner.update('exact'))
    function choose(Math) { return Math.floor(1.5) }; owner.update(choose({ floor: 'unknown' }))
  `)
  assert.deepEqual(rows[0].values, ['exact'])
  assert.ok(rows[1].failures.length > 0)
})

test('keeps nested shorthand callback bindings and unrelated loop identities separate', () => {
  const rows = inputs(`
    const rows = [false, true].flatMap(native => [false, true].map(heal => ({ native, heal })))
    test.each(rows)('case', ({ native, heal }) => owner.update('mode ' + native + heal))
    function replay(source) { owner.update(source) }
    for (const engine of [unknownFactory(), otherFactory()]) replay('actual')
  `)
  assert.deepEqual(rows[0].failures, [])
  assert.deepEqual(rows[0].values, [
    'mode falsefalse',
    'mode falsetrue',
    'mode truefalse',
    'mode truetrue',
  ])
  assert.deepEqual(rows[1].values, ['actual', 'actual'])
})

test('uninitialized loop bindings require their actual finite contexts', () => {
  const results = inputs(
    `const sources = ['a', 'b']; for (const source of sources) { update(source); update(source + ' tail') }`,
  )
  assert.deepEqual(
    results.map((result) => result.values),
    [
      ['a', 'b'],
      ['a tail', 'b tail'],
    ],
  )
  assert(results.every((result) => result.failures.length === 0))
})

test('rejects replacement callbacks and assertion-named side effects', () => {
  const rows = inputs(`
    owner.update('old'.replace(/old/g, () => 'new'))
    function fake() { assert(sideEffect()); return 'after side effect' }
    owner.update(fake())
  `)
  assert.ok(rows.every((row) => row.failures.length > 0))
  assert.ok(rows.every((row) => row.values.length === 0))
})

test.each([
  ['unsupported import', "import { source } from './external'; owner.update(source)"],
  [
    'unknown filter',
    "import { choice } from './external'; owner.update(['a','b'].filter(() => choice).join(''))",
  ],
  [
    'unknown find',
    "import { choice } from './external'; owner.update(['a','b'].find(() => choice) ?? 'fallback')",
  ],
  [
    'loop binding write',
    "for (const row of [{source:'before'}]) { row.source='after'; owner.update(row.source) }",
  ],
  [
    'delete write',
    "const row={source:'before'}; delete row.source; owner.update(row.source ?? 'after')",
  ],
  [
    'nested alias write',
    "const row={source:'before'}; const alias={row}; alias.row.source='after'; owner.update(row.source)",
  ],
  [
    'Object.assign write',
    "const row={source:'before'}; Object.assign(row,{source:'after'}); owner.update(row.source)",
  ],
])('keeps %s explicitly unresolved', (_name, source) => {
  const [row] = inputs(source)
  assert.ok(row.failures.length > 0)
  assert.deepEqual(row.values, [])
})

test.each([
  ['quoted key', "const {'source': text}={source:'actual'}; owner.update(text)", 'actual'],
  [
    'parameter default',
    "function replay(source='fallback') { owner.update(source) }; replay(undefined)",
    'fallback',
  ],
  [
    'destructuring default',
    "function replay({source='fallback'}) { owner.update(source) }; replay({})",
    'fallback',
  ],
  [
    'test.each default',
    "test.each([undefined])('row',(source='fallback')=>owner.update(source))",
    'fallback',
  ],
])('resolves %s with exact binding semantics', (_name, source, expected) => {
  const [row] = inputs(source)
  assert.deepEqual(row.failures, [])
  assert.deepEqual(row.values, [expected])
})

test.each([
  "import { source } from './external'; owner.update([source])",
  "import { source } from './external'; owner.update({source})",
  "import { choice } from './external'; owner.update(['a'].some(() => choice))",
  "import { choice } from './external'; owner.update(['a'].every(() => choice))",
  "import { choice } from './external'; owner.update('a'.slice(choice))",
  "for (let i=0;i<1;i++) { i=2; owner.update('row ' + i) }",
  "test.each([{source:'before'}])('row', row => { row.source='after'; owner.update(row.source) })",
  "function replay(row) { delete row.source; owner.update(row.source) }; replay({source:'before'})",
  "const row={source:'before'}; const box=[{row}]; const alias=box; alias[0].row.source='after'; owner.update(row.source)",
  "const row={source:'before'}; const box={row}; const {row:alias}=box; Object.assign(alias,{source:'after'}); owner.update(row.source)",
])('rejects dependent unknown or mutated values in %s', (source) => {
  const [row] = inputs(source)
  assert.ok(row.failures.length > 0)
  assert.deepEqual(row.values, [])
})

test.each([
  ["const {'source': text='fallback'}={}; owner.update(text)", ['fallback']],
  ["const {nested:{'source':text='fallback'}}={nested:{}}; owner.update(text)", ['fallback']],
  ["const [,text='fallback']=['ignore']; owner.update(text)", ['fallback']],
  [
    "function replay(first='fall', source=first+'back') { owner.update(source) }; replay(undefined,undefined)",
    ['fallback'],
  ],
  [
    "function replay({source}={source:'fallback'}) { owner.update(source) }; replay()",
    ['fallback'],
  ],
  [
    "test.each([undefined,null,''])('row',(source='fallback')=>owner.update(source))",
    ['fallback', null, ''],
  ],
  [
    "function replay({source='fallback'}) { return source }; owner.update(replay({}))",
    ['fallback'],
  ],
  [
    "import { metadata } from './external'; const row={source:'actual',metadata}; owner.update(row.source)",
    ['actual'],
  ],
  ["for (let i=0;i<2;i++) owner.update('row '+i)", ['row 0', 'row 1']],
  ["owner.update(['a','b'].filter(value=>value==='b').join(''))", ['b']],
  ["owner.update(['a','b'].find(value=>value==='b'))", ['b']],
])('preserves exact supported bindings and independent values in %s', (source, expected) => {
  const [row] = inputs(source)
  assert.deepEqual(row.failures, [])
  assert.deepEqual(row.values, expected)
})

test('keeps opaque concatenated engine identities independent of source rows and globals', () => {
  const rows = inputs(`
    import { externalEngine } from './external'
    const engines = [['local', () => {}]].concat([['external', externalEngine]])
    test.each(engines)('engine', (_name, engine) => {
      for (const row of [{text:'actual'}]) owner.update(row.text)
    })
    const object = {source: 'old'}; object.source = 'new'
    owner.update(undefined)
    owner.update(() => 'callback')
  `)
  assert.deepEqual(rows[0].failures, [])
  assert.deepEqual(rows[0].values, ['actual', 'actual'])
  assert.deepEqual(rows[1].failures, [])
  assert.deepEqual(rows[1].values, [undefined])
  assert.deepEqual(rows[2].values, [])
  assert.match(rows[2].failures[0], /unevaluated function/)
})

test('does not propagate container writes to immutable globals', () => {
  const rows = inputs(`
    const row = {source: undefined}; row.source = 'after'
    const shorthand = {undefined}; delete shorthand.undefined
    owner.update(undefined)
  `)
  assert.deepEqual(rows[0].failures, [])
  assert.deepEqual(rows[0].values, [undefined])
})

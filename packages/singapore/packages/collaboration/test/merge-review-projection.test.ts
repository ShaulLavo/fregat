import { expect, test } from 'vitest'
import { history, syntaxFixture } from './merge-review-fixture'

const corpus = [
  [
    'javascript',
    'function first() { return 1; }\nfunction second() { return 2; }\nfunction third() { return 3; }',
  ],
  [
    'typescript',
    'interface First { value: 1; }\nconst second = 2;\nfunction third() { return 3; }',
  ],
  [
    'tsx',
    'const first = <Panel value={1} />;\nconst second = <Panel value={2} />;\nconst third = <Panel value={3} />;',
  ],
  ['css', '.first { opacity: 1; }\n.second { opacity: 2; }\n.third { opacity: 3; }'],
  ['json', '{"first":1,"second":2,"third":3}'],
  ['markdown', '# First\n\nValue 1\n\n# Second\n\nValue 2\n\n# Third\n\nValue 3\n'],
  [
    'python',
    'def first():\n    return 1\n\ndef second():\n    return 2\n\ndef third():\n    return 3\n',
  ],
  ['rust', 'fn first() -> i32 { 1 }\nfn second() -> i32 { 2 }\nfn third() -> i32 { 3 }'],
  [
    'go',
    'package main\nfunc first() int { return 1 }\nfunc second() int { return 2 }\nfunc third() int { return 3 }',
  ],
] as const

test.each(corpus)(
  'projected and full parses agree across the %s corpus',
  async (language, text) => {
    const fixture = await syntaxFixture(language, true, 'differential')
    try {
      for (let seed = 1; seed <= 32; seed++) {
        const target = 1 + (seed % 3)
        const offset = text.indexOf(String(target))
        const value = String(4 + ((Math.imul(seed, 1103515245) >>> 0) % 5))
        const input = history(text, [
          { offset, deleteCount: 1, text: value },
          { offset, deleteCount: 1, text: seed % 2 ? '9' : ' ' },
        ])
        const snapshot = input.base.snapshot()
        const result = await fixture.detector.detect(input.window, snapshot)
        expect(result.status, `${language}, seed ${seed}`).toBe('complete')
        expect(await fixture.detector.detect(input.window, snapshot)).toEqual(result)
        fixture.clear()
      }
      expect(fixture.metrics.parses).toBeGreaterThan(0)
    } finally {
      fixture.dispose()
    }
  },
)

test('a repaired adjacent recovery node stays inside bounded parent context', async () => {
  const fixture = await syntaxFixture('typescript', true, 'differential')
  const text = 'const first = 1;\nexport const value = "left";\nconst last = 3;'
  const offset = text.indexOf('"left"') + '"left"'.length
  const input = history(text, [{ offset, deleteCount: 0, text: '"right"' }])
  const current = input.base.snapshot().buffer
  try {
    await fixture.syntax(current, [])
    await fixture.syntax(
      input.snapshot.buffer,
      [{ startIndex: offset - 1, endIndex: offset }],
      true,
      'enclosing',
      current,
    )
    expect(fixture.metrics.boundedParses).toBe(1)
  } finally {
    fixture.dispose()
  }
})

test('a cached projection expands safely when a later candidate reads another unit', async () => {
  const fixture = await syntaxFixture('typescript', true, 'differential')
  const text = Array.from({ length: 20 }, (_, index) => `const value${index} = ${index};`).join(
    '\n',
  )
  const input = history(text, [{ offset: text.indexOf('= 10') + 2, deleteCount: 2, text: '99' }])
  const current = input.base.snapshot().buffer
  const before = input.snapshot.buffer
  try {
    await fixture.syntax(current, [])
    const target = text.indexOf('= 10') + 2
    await fixture.syntax(
      before,
      [{ startIndex: target, endIndex: target + 2 }],
      false,
      'enclosing',
      current,
    )
    expect(fixture.metrics.boundedParses).toBe(1)
    await fixture.syntax(before, [{ startIndex: 0, endIndex: 5 }], false, 'enclosing', current)
    expect(fixture.metrics.boundedParses).toBe(1)
  } finally {
    fixture.dispose()
  }
})

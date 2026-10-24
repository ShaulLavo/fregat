import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import remend, { type RemendHandler } from 'remend'
import { describe, expect, it } from 'vitest'
import {
  beginRepair,
  copy,
  insert,
  rewrite,
  toAuthoredOffset,
  type TrackedText,
} from '../repair-origin'
import { inspectRemendOrigins, remendWithOrigins } from '../remend-origin'

function authored(text: string): TrackedText {
  return beginRepair({ text, start: toAuthoredOffset(0), point: { line: 1, column: 1, offset: 0 } })
}
const controls = [
  ['singleTilde', 0],
  ['comparisonOperators', 5],
  ['htmlTags', 10],
  ['setextHeadings', 15],
  ['links', 20],
  ['boldItalic', 30],
  ['bold', 35],
  ['italicDoubleUnderscore', 40],
  ['italicSingleAsterisk', 41],
  ['italicSingleUnderscore', 42],
  ['inlineCode', 50],
  ['strikethrough', 60],
  ['katex', 70],
] as const
function referenceSteps(text: string) {
  const steps: { handler: string; text: string }[] = []
  const handlers: RemendHandler[] = controls.map(([name, priority]) => ({
    name: `witness-${name}`,
    priority: priority + 0.25,
    handle: (value) => {
      steps.push({ handler: name, text: value })
      return value
    },
  }))
  const result = remend(text, { handlers })
  return { steps, result }
}
function codeUnits(text: string): number[] {
  return Array.from({ length: text.length }, (_, index) => text.charCodeAt(index))
}
function reconstruct(input: TrackedText): string {
  return input.runs
    .map((run) =>
      run.kind === 'copy'
        ? input.window.text.slice(
            run.source.start - input.window.start,
            run.source.start - input.window.start + run.source.length,
          )
        : run.text,
    )
    .join('')
}

function constructionSites(trace: ReturnType<typeof inspectRemendOrigins>): string[] {
  return trace.result.receipts.map((receipt) => receipt.site)
}

const focused = [
  '',
  ' ',
  '  ',
  'x ',
  'x  ',
  '\ufeffx\r\n',
  '\ud800~a',
  'a~\udc00',
  'a~b a~b',
  '`a~b` a~b',
  '```\na~b\n```\na~b',
  '\\`a~b',
  '- > 25',
  '- >= $25\n1. >8\n1) >= 9',
  '`- > 25`\n- > 25',
  'a\n\n- >2',
  'text <custom',
  'text \t\n<custom',
  '<custom',
  '`<custom',
  'text <a><b',
  'heading\n-',
  'heading\n--',
  'heading\n=',
  'heading\n==',
  'heading\n- ',
  'heading\n-  ',
  '\n-',
  'a\n\n--',
  '[text',
  '[text](url',
  '[x](ok) [x](url',
  '[x](ok) ![x](url',
  '![alt',
  'x ![alt](url',
  '[outer [inner]',
  '[outer [inner',
  '`[x](url`',
  '[**x',
  '[x](streamdown:incomplete-link)',
  '***bold italic',
  '***x***',
  '****',
  '*****x',
  '**bold',
  '**bold*',
  '**x** **y',
  '**\n',
  '- **\n',
  '**`x`',
  '__bold',
  '__bold_',
  '__x__ __y',
  '__\n',
  '*italic',
  '*x*',
  'word*word',
  'a *x',
  '*x\n',
  '*x _y',
  '_italic',
  '_x\n\n',
  '_x\r\n',
  '**bold _italic',
  '**bold _italic**',
  '**b _i\n\n',
  'a_b_c',
  '<tag_x',
  '[x](url_x)',
  '`code',
  '```js``',
  '```js```',
  '```\ncode',
  '\\`code',
  '`x` `y',
  '~~strike',
  '~~strike~',
  '~~x~~ ~~y',
  '`~~x`',
  '~~~',
  '$$x',
  '$$x$',
  '$$x\ny',
  '$$x\n',
  '$$x\ny\n$$',
  '`$$x`',
  '$x',
  '\\$x',
  '\ud800**x\udc00',
  '**\ud800\n\udc00',
  '_👩‍💻é\r\n',
  'a\r- >2\r\n<x',
  '𐐀~𐐀 𐐀~𐐀',
  '`𐐀~𐐀` 𐐀~𐐀',
  'a\\`~b a~b',
  '```\na~b\n```\n- >3',
  '``a~b`` a~b',
  '`a~b\\`c~d` e~f',
  '[a [b]](url',
  '[a [b](url',
  '[x](a)b [x](url',
  '[x](a\nurl',
  '![a [b]',
  '![[a]',
  '[x](',
  '![x](',
  '[x](url) [y',
  '[x](url) ![y',
  '* ',
  '** ',
  '*** ',
  '__ ',
  '_ ',
  '~~ ',
  '` ',
  '- **\na',
  '- __\na',
  '***a\n***',
  '*a*b*c',
  'word*word*word',
  '$$a*bc',
  '\\[a*b',
  '\\(a_b',
  '<x a_b>',
  '[x](a_b)',
  '__a__ __b_',
  '`__a_`',
  '~~a~~ ~~b~',
  '`~~a~`',
  '**b _i**',
  '**b _i**\n',
  '_x\n\n\n\n',
  '_x\r',
  '$$a\nb$',
  '$$a\n\n',
  '`$$a` $$b',
  '\\$$x',
  'a~b ![x](url',
  'a~b <x',
  'a~b **x',
  '- >2 **x',
  '**x\ud800',
  '**x\udc00',
  '\ud800_\udc00\n',
  'x\u0000~y',
]

describe('pinned default remend writer', () => {
  it('uses the exact unchanged installed reference', () => {
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(import.meta.resolve('remend'))))
        .digest('hex'),
    ).toBe('3ab122d383b14e9b8974ea75ea392075ce412cd3f1868494c2dc8009e02d5b81')
  })

  it.each(focused.map((text) => [JSON.stringify(text), text]))(
    'matches every reachable default handler on %s',
    (_, text) => {
      const { result, steps } = inspectRemendOrigins(authored(text))
      const reference = referenceSteps(text)
      // A links early return precedes the after-handler hook in the reference.
      const expectedSteps = steps.filter(
        (step) =>
          !(step.handler === 'links' && step.output.text.endsWith('](streamdown:incomplete-link)')),
      )
      expect(
        expectedSteps.map((step) => ({ handler: step.handler, text: codeUnits(step.output.text) })),
      ).toEqual(
        reference.steps.map((step) => ({ handler: step.handler, text: codeUnits(step.text) })),
      )
      expect(codeUnits(result.text)).toEqual(codeUnits(reference.result))
      expect(codeUnits(result.text)).toEqual(codeUnits(remend(text)))
      expect(reconstruct(result)).toBe(result.text)
      expect(reconstruct(steps.at(-1)?.input ?? result)).toBe(
        steps.at(-1)?.input.text ?? result.text,
      )
    },
  )

  it('covers each reachable construction site with a direct focused witness', () => {
    const traces = focused.map((text) => inspectRemendOrigins(authored(text)))
    const sites = new Set(traces.flatMap(constructionSites))
    console.info(
      JSON.stringify({
        focusedCases: focused.length,
        handlerSteps: traces.reduce((count, trace) => count + trace.steps.length, 0),
        sites: sites.size,
      }),
    )
    expect(sites).toEqual(
      new Set([
        'trim.singleSpace',
        'singleTilde.escape',
        'comparisonOperators.escape',
        'htmlTags.trimSuffix',
        'setextHeadings.hyphen',
        'setextHeadings.equals',
        'links.imageUrl',
        'links.url',
        'links.imageLabel',
        'links.label',
        'links.nestedLabel',
        'links.nestedImageLabel',
        'boldItalic.close',
        'bold.closePartial',
        'bold.close',
        'italicDoubleUnderscore.closePartial',
        'italicDoubleUnderscore.close',
        'italicSingleAsterisk.close',
        'italicSingleUnderscore.beforeBold',
        'italicSingleUnderscore.beforeNewlines',
        'italicSingleUnderscore.close',
        'inlineCode.fence',
        'inlineCode.close',
        'strikethrough.close',
        'strikethrough.closePartial',
        'katex.closePartial',
        'katex.closeMultiline',
        'katex.close',
      ]),
    )
  })

  it('records the second equal tilde capture without touching its code-occluded twin', () => {
    const result = remendWithOrigins(authored('`a~b` a~b a~b'))
    expect(result.runs).toEqual([
      { kind: 'copy', source: { start: 0, length: 7 } },
      { kind: 'insert', text: '\\', owner: 'remend', gap: { left: 7, right: 7 } },
      { kind: 'copy', source: { start: 7, length: 4 } },
      { kind: 'insert', text: '\\', owner: 'remend', gap: { left: 11, right: 11 } },
      { kind: 'copy', source: { start: 11, length: 2 } },
    ])
  })

  it('retains the exact comparison punctuation and repeated digit captures', () => {
    const result = remendWithOrigins(authored('- > 25\n- > 25'))
    expect(result.runs).toEqual([
      { kind: 'copy', source: { start: 0, length: 2 } },
      { kind: 'insert', text: '\\', owner: 'remend', gap: { left: 2, right: 2 } },
      { kind: 'copy', source: { start: 2, length: 7 } },
      { kind: 'insert', text: '\\', owner: 'remend', gap: { left: 9, right: 9 } },
      { kind: 'copy', source: { start: 9, length: 4 } },
    ])
  })

  it('retains repeated link brackets, opening parenthesis and labels while replacing the destination', () => {
    const text = '[x](ok) [x](url'
    const result = remendWithOrigins(authored(text))
    expect(result.runs).toEqual([
      { kind: 'copy', source: { start: 0, length: 12 } },
      {
        kind: 'insert',
        text: 'streamdown:incomplete-link)',
        owner: 'remend',
        gap: { left: 12, right: text.length },
      },
    ])
    expect(result.receipts.at(-1)?.deletions).toEqual([{ start: 12, length: text.length - 12 }])
    expect(result.receipts.at(-1)?.insertions[0].cause).toEqual({
      start: 12,
      length: text.length - 12,
    })
  })

  it('keeps an empty link destination opening parenthesis authored at the EOF seam', () => {
    const result = remendWithOrigins(authored('[x]('))
    expect(result.runs).toEqual([
      { kind: 'copy', source: { start: 0, length: 4 } },
      {
        kind: 'insert',
        text: 'streamdown:incomplete-link)',
        owner: 'remend',
        gap: { left: 4, right: 4 },
      },
    ])
    expect(result.receipts.at(-1)?.deletions).toEqual([])
  })

  it('composes initial trim, interior escape, and HTML suffix deletion', () => {
    const result = remendWithOrigins(authored('a~b \n<tag '))
    expect(result.text).toBe('a\\~b')
    expect(result.runs).toEqual([
      { kind: 'copy', source: { start: 0, length: 1 } },
      { kind: 'insert', text: '\\', owner: 'remend', gap: { left: 1, right: 1 } },
      { kind: 'copy', source: { start: 1, length: 2 } },
    ])
    expect(result.receipts.map((receipt) => receipt.site)).toEqual([
      'trim.singleSpace',
      'singleTilde.escape',
      'htmlTags.trimSuffix',
    ])
    expect(result.boundary(result.text.length)).toEqual({ left: 3, right: 3 })
  })

  it('inserts before retained LFs and copies the prior synthetic bold closer', () => {
    const whitespace = remendWithOrigins(authored('_x\n\n'))
    expect(whitespace.runs).toEqual([
      { kind: 'copy', source: { start: 0, length: 2 } },
      { kind: 'insert', text: '_', owner: 'remend', gap: { left: 2, right: 2 } },
      { kind: 'copy', source: { start: 2, length: 2 } },
    ])
    const { result: bold, steps } = inspectRemendOrigins(authored('**bold _italic'))
    expect(bold.text).toBe('**bold _italic_**')
    expect(steps.find((step) => step.handler === 'bold')?.output.runs.at(-1)).toMatchObject({
      kind: 'insert',
      text: '**',
    })
    expect(bold.runs.at(-1)).toMatchObject({
      kind: 'insert',
      text: '_**',
      gap: { left: 14, right: 14 },
    })
  })

  it('preserves rejected input and scopes scratch lookup to independent invocations', () => {
    const input = authored('`a~b` a~b')
    const before = input.runs
    const result = remendWithOrigins(input)
    expect(remendWithOrigins(authored('~~other')).text).toBe(remend('~~other'))
    expect(remendWithOrigins(input).runs).toEqual(result.runs)
    expect(input.text).toBe('`a~b` a~b')
    expect(input.runs).toBe(before)
    expect(input.receipts).toEqual([])
    expect(result.text).toBe(remend(input.text))
    expect(remendWithOrigins(authored('plain'))).toMatchObject({ text: 'plain', receipts: [] })
  })

  it('keeps inherited synthetic ownership through later remend copies', () => {
    const original = authored('x')
    const prepared = rewrite({
      input: original,
      owner: 'nestedStrongRepair',
      site: 'composition',
      parts: [insert(original, '**', 0), copy(original)],
      expected: '**x',
    })
    const repaired = remendWithOrigins(prepared)
    const runs = [
      { kind: 'insert', text: '**', owner: 'nestedStrongRepair', gap: { left: 0, right: 0 } },
      { kind: 'copy', source: { start: 0, length: 1 } },
      { kind: 'insert', text: '**', owner: 'remend', gap: { left: 1, right: 1 } },
    ]
    expect(repaired.runs).toEqual(runs)
  })
})

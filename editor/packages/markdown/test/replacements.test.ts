import { beforeAll, describe, expect, it } from 'vitest'
import { init, MarkdownDocument } from 'tree-sitter-md'
import { createInlineMap, inlineRowForBufferRow } from '@singapore-editor/core/rendering'
import { createPieceTableSnapshot, createStringTextSnapshot } from '@singapore-editor/core/document'
import { markdownInlineReplacements } from '../src/replacements'
import { renderMarkdownLinks, type MarkdownLink } from '../src/linkRender'
import type { InlineReplacementSpec } from '@singapore-editor/core/rendering'

beforeAll(() => init())

function parseMarkdown(text: string): Uint32Array {
  const doc = new MarkdownDocument({ frontmatter: true })
  try {
    doc.setText(text)
    return doc.decorations(0, text.length)
  } finally {
    doc.dispose()
  }
}

const preview = (text: string): string => {
  const specs = markdownInlineReplacements(createStringTextSnapshot(text), parseMarkdown(text))
  const map = createInlineMap(createPieceTableSnapshot(text), specs)
  return inlineRowForBufferRow(map, 0, text).text
}

describe('markdown inline replacements', () => {
  it('hides emphasis and strong fences', () => {
    expect(preview('a **bold** b')).toBe('a bold b')
    expect(preview('an _em_ word')).toBe('an em word')
    expect(preview('***both***')).toBe('both')
  })

  it('hides inline code fences', () => {
    expect(preview('use `code` here')).toBe('use code here')
  })

  it('hides heading markers and the space after them', () => {
    expect(preview('# Title')).toBe('Title')
    expect(preview('### Deep heading')).toBe('Deep heading')
  })

  it('collapses links and images to their label', () => {
    expect(preview('see [docs](https://x.dev) now')).toBe('see docs now')
    expect(preview('![alt](img.png)')).toBe('alt')
    expect(preview('a [ref] b')).toBe('a [ref] b')
  })

  it('substitutes bullets width-for-width', () => {
    expect(preview('- item')).toBe('• item')
    expect(preview('* star item')).toBe('• star item')
  })

  it('substitutes block-quote markers with a quote bar, width-for-width', () => {
    expect(preview('> quoted')).toBe('│ quoted')
    expect(preview('> > nested')).toBe('│ │ nested')
  })

  it('leaves ordered lists alone', () => {
    expect(preview('1. ordered')).toBe('1. ordered')
  })

  it('carries the heading level in the marker kind', () => {
    const specs = markdownInlineReplacements(
      createStringTextSnapshot('## Two'),
      parseMarkdown('## Two'),
    )

    expect(specs.map((spec) => spec.kind)).toEqual(['heading-marker-2'])
  })

  it('leaves escapes and stray punctuation alone', () => {
    expect(preview('escaped \\*not em\\*')).toBe('escaped \\*not em\\*')
    expect(preview('text with * lone star')).toBe('text with * lone star')
  })

  it('hides fence marks while keeping code content', () => {
    const text = '```js\nconst a = 1\n```'
    const specs = markdownInlineReplacements(createStringTextSnapshot(text), parseMarkdown(text))

    expect(specs.every((spec) => spec.endIndex <= 5 || spec.startIndex >= 18)).toBe(true)
    expect(specs.map((spec) => text.slice(spec.startIndex, spec.endIndex))).toEqual([
      '```',
      'js',
      '```',
    ])
  })

  it('groups both fences of one construct so they reveal together', () => {
    const text = 'a **bold** b'
    const specs = markdownInlineReplacements(createStringTextSnapshot(text), parseMarkdown(text))
    const groups = new Set(specs.map((spec) => spec.groupId))

    expect(specs.length).toBeGreaterThan(1)
    expect(groups.size).toBe(1)
  })

  it('gives each construct on a line its own group', () => {
    const text = '**a** and _b_'
    const specs = markdownInlineReplacements(createStringTextSnapshot(text), parseMarkdown(text))

    expect(new Set(specs.map((spec) => spec.groupId)).size).toBe(2)
    expect(preview(text)).toBe('a and b')
  })

  it('emits nonempty marker spans', () => {
    const text = '- item\n- other'
    const specs = markdownInlineReplacements(createStringTextSnapshot(text), parseMarkdown(text))

    for (const spec of specs) expect(spec.endIndex).toBeGreaterThan(spec.startIndex)
  })
})

describe('record coverage', () => {
  const rows = (text: string): readonly string[] => {
    const map = createInlineMap(
      createPieceTableSnapshot(text),
      markdownInlineReplacements(createStringTextSnapshot(text), parseMarkdown(text)),
    )
    return text.split('\n').map((line, row) => inlineRowForBufferRow(map, row, line).text)
  }

  it('handles delimiters across lines and Unicode offsets', () => {
    expect(rows('😀 **עברית\nacross** tail')).toEqual(['😀 עברית', 'across tail'])
    expect(rows('~~across\nlines~~')).toEqual(['across', 'lines'])
    expect(rows('``code\nacross``')).toEqual(['code', 'across'])
  })

  it('resolves references defined after the viewport', () => {
    expect(rows('[ref]\n\n[ref]: /target')[0]).toBe('ref')
    expect(rows('[missing]\n')[0]).toBe('[missing]')
  })

  it('uses link labels with nested formatting and nested images', () => {
    expect(preview('[**bold**](url)')).toBe('bold')
    expect(preview('[![alt](image)](target)')).toBe('alt')
    expect(preview('https://example.com')).toBe('https://example.com')
  })

  it('decorates tables and task markers', () => {
    expect(rows('| head | other |\n| --- | --- |\n| **bold** | `code` |')[2]).toBe(
      '|   bold   |  code  |',
    )
    expect(preview('- [x] done')).toBe('• ☑ done')
    expect(preview('- [ ] todo')).toBe('• ☐ todo')
  })

  it('has no paragraph injection cap', () => {
    const lines = rows(Array.from({ length: 320 }, (_, i) => `**paragraph ${i}**`).join('\n\n'))
    expect(lines[638]).toBe('paragraph 319')
  })
})

it('keeps each table pipe at its source column when links and formatting collapse', () => {
  const source = [
    '| Work                                   | Detail          |',
    '| -------------------------------------- | --------------- |',
    '| [plan](plans/one.md)                    | **bold** `code` |',
    '| [longer label](plans/longer-name.md)     | plain           |',
  ].join('\n')
  const specs = markdownInlineReplacements(createStringTextSnapshot(source), parseMarkdown(source))
  const map = createInlineMap(createPieceTableSnapshot(source), specs)
  const pipes = (line: string) => Array.from(line.matchAll(/\|/g), (match) => match.index)
  for (const [row, line] of source.split('\n').entries()) {
    const rendered = inlineRowForBufferRow(map, row, line).text
    expect(pipes(rendered)).toEqual(pipes(line))
    expect(rendered).not.toContain('](')
  }
})

it('hides multiline link targets while preserving source lines and whole-link reveal', () => {
  const source = '[label](\n/destination\n"title")'
  const specs = markdownInlineReplacements(createStringTextSnapshot(source), parseMarkdown(source))
  const map = createInlineMap(createPieceTableSnapshot(source), specs)
  expect(source.split('\n').map((line, row) => inlineRowForBufferRow(map, row, line).text)).toEqual(
    ['label', '', ''],
  )
  expect(
    specs.every((spec) => spec.revealRange?.start === 0 && spec.revealRange.end === source.length),
  ).toBe(true)
})

it('visits link and marker ranges a bounded number of times as the document grows', () => {
  for (const count of [128, 1024]) {
    const unit = '[label](url)\n'
    let visits = 0
    const specs: InlineReplacementSpec[] = []
    const links: MarkdownLink[] = []
    for (let index = 0; index < count; index++) {
      const start = index * unit.length
      specs.push({
        id: `marker:${index}`,
        get startIndex() {
          visits++
          return start
        },
        endIndex: start + 1,
        text: '',
      })
      links.push({
        get span() {
          visits++
          return { start, end: start + unit.length - 1 }
        },
        label: { start: start + 1, end: start + 6 },
        href: 'url',
      })
    }
    specs.reverse()
    links.reverse()
    renderMarkdownLinks(specs, createStringTextSnapshot(unit.repeat(count)), links, {})
    expect(visits).toBeLessThan(count * 40)
    expect(specs.slice(0, count).map((spec) => spec.id)).toEqual(
      Array.from({ length: count }, (_, index) => `marker:${count - index - 1}`),
    )
    expect(specs.slice(count).map((spec) => spec.startIndex)).toEqual(
      links.map((link) => link.label.start),
    )
    expect(specs.length).toBe(count * 2)
    expect(
      specs.filter((spec) => spec.kind === 'link').every((spec) => spec.text === 'label'),
    ).toBe(true)
  }
})

it('keeps marker order and link fragment boundaries with formatted multiline labels', () => {
  const text = 'before **plain** [**bold** and\n`code` ![alt](image)](target) after [second](url)'
  const specs = markdownInlineReplacements(createStringTextSnapshot(text), parseMarkdown(text))
  expect(
    specs.map(({ kind, startIndex, endIndex, text, wrap, revealRange }) => ({
      kind,
      startIndex,
      endIndex,
      text,
      wrap,
      revealRange,
    })),
  ).toMatchInlineSnapshot(`
    [
      {
        "endIndex": 9,
        "kind": "marker",
        "revealRange": undefined,
        "startIndex": 7,
        "text": "",
        "wrap": undefined,
      },
      {
        "endIndex": 16,
        "kind": "marker",
        "revealRange": undefined,
        "startIndex": 14,
        "text": "",
        "wrap": undefined,
      },
      {
        "endIndex": 18,
        "kind": "link-marker",
        "revealRange": {
          "end": 60,
          "kind": 16,
          "start": 17,
        },
        "startIndex": 17,
        "text": "",
        "wrap": undefined,
      },
      {
        "endIndex": 60,
        "kind": "link-target",
        "revealRange": {
          "end": 60,
          "kind": 16,
          "start": 17,
        },
        "startIndex": 51,
        "text": "",
        "wrap": undefined,
      },
      {
        "endIndex": 68,
        "kind": "link-marker",
        "revealRange": {
          "end": 80,
          "kind": 16,
          "start": 67,
        },
        "startIndex": 67,
        "text": "",
        "wrap": undefined,
      },
      {
        "endIndex": 80,
        "kind": "link-target",
        "revealRange": {
          "end": 80,
          "kind": 16,
          "start": 67,
        },
        "startIndex": 74,
        "text": "",
        "wrap": undefined,
      },
      {
        "endIndex": 30,
        "kind": "link",
        "revealRange": {
          "end": 60,
          "kind": 16,
          "start": 17,
        },
        "startIndex": 18,
        "text": "bold and",
        "wrap": "text",
      },
      {
        "endIndex": 51,
        "kind": "link",
        "revealRange": {
          "end": 60,
          "kind": 16,
          "start": 17,
        },
        "startIndex": 31,
        "text": "code alt",
        "wrap": "text",
      },
      {
        "endIndex": 74,
        "kind": "link",
        "revealRange": {
          "end": 80,
          "kind": 16,
          "start": 67,
        },
        "startIndex": 68,
        "text": "second",
        "wrap": "text",
      },
    ]
  `)
})

it('orders nested formatting markers beyond the first 16 bits of source offsets', () => {
  const prefix = `${'a'.repeat(70_000)} `
  expect(preview(`${prefix}[***both*** and **bold**](url)`)).toBe(`${prefix}both and bold`)
})

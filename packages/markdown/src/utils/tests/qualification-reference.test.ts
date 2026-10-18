import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

import commonmark from '../../../test/reference/commonmark.json'
import gfm from '../../../test/reference/gfm.json'
import differences from '../../../test/reference/gfm-differences.json'
import manifest from '../../../test/reference/manifest.json'
import { expectedOutput, referenceOutput } from '../../../test/reference/oracle'
import { createRemarkReplay, renderRemark } from '../../../test/qualification'
import { seededChunks } from '../../../test/schedules'

describe('independent specification output', () => {
  test.each(commonmark)('$id matches decoded content, nesting and attributes', (example) => {
    expect(referenceOutput(example.source, 'commonmark')).toEqual(expectedOutput(example.html))
  })

  test.each(gfm)(
    '$id preserves the pinned GFM reference or its explicit disagreement',
    (example) => {
      const actual = referenceOutput(example.source, 'gfm')
      const expected = expectedOutput(example.html)
      const difference = differences.find((entry) => entry.id === example.id)
      if (!difference) {
        expect(actual).toEqual(expected)
        return
      }
      expect(actual).not.toEqual(expected)
      expect(hashJson(actual)).toBe(difference.actualSha256)
      expect(hashJson(expected)).toBe(difference.expectedSha256)
      expect(difference.reason.length).toBeGreaterThan(20)
    },
  )

  test('the denominators and documented differences remain explicit', () => {
    expect(commonmark).toHaveLength(652)
    expect(gfm).toHaveLength(672)
    expect(differences).toHaveLength(18)
    expect(new Set(differences.map((entry) => entry.id)).size).toBe(differences.length)
  })

  test('formatting normalization preserves code, cell and inline whitespace', () => {
    expect(expectedOutput('<p>a b</p>')).not.toEqual(expectedOutput('<p>a  b</p>'))
    expect(expectedOutput('<pre><code> a\n</code></pre>')).not.toEqual(
      expectedOutput('<pre><code>a\n</code></pre>'),
    )
    expect(expectedOutput('<table><tr><td> a </td></tr></table>')).not.toEqual(
      expectedOutput('<table><tr><td>a</td></tr></table>'),
    )
  })

  test('changed destinations, numbering, nesting and table widths fail the independent oracle', () => {
    expect(expectedOutput('<a href="/a">text</a>')).not.toEqual(
      expectedOutput('<a href="/b">text</a>'),
    )
    expect(expectedOutput('<ol start="3"><li>item</li></ol>')).not.toEqual(
      expectedOutput('<ol><li>item</li></ol>'),
    )
    expect(expectedOutput('<strong><em>text</em></strong>')).not.toEqual(
      expectedOutput('<strong>text</strong>'),
    )
    expect(expectedOutput('<table><tr><td>a</td><td>b</td></tr></table>')).not.toEqual(
      expectedOutput('<table><tr><td>a</td></tr></table>'),
    )
  })
})

describe('published regression corpus', () => {
  test.each(manifest.assets)('$file keeps its exact pinned bytes', (asset) => {
    const bytes = readFileSync(new URL(`../../../test/reference/${asset.file}`, import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
  })

  test('all published assistant messages settle to fresh completed output over seeded schedules', () => {
    const messages: string[] = JSON.parse(
      readFileSync(new URL('../../../test/reference/chat.json', import.meta.url), 'utf8'),
    )
    expect(messages).toHaveLength(183)
    for (const source of messages) checkCorpusStream(source)
  }, 30_000)

  const documents: { name: string; text: string }[] = JSON.parse(
    gunzipSync(
      readFileSync(new URL('../../../test/reference/repositories.json.gz', import.meta.url)),
    ).toString('utf8'),
  )

  test('repository corpus keeps all repository documents', () => {
    expect(documents).toHaveLength(497)
  })

  test.each(documents)(
    '$name settles after chunked streaming without losing complete-source content',
    ({ text }) => {
      checkCorpusStream(text, Math.max(2048, Math.ceil(text.length / 4)))
    },
    60_000,
  )
})

function checkCorpusStream(source: string, maxUnits = 24) {
  const replay = createRemarkReplay()
  for (const revision of seededChunks(source, { seed: 176, maxUnits })) {
    replay.update(revision.text, true)
  }
  const completed = replay.update(source, false)
  expect(hashJson(completed)).toBe(hashJson(renderRemark(source, false)))
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

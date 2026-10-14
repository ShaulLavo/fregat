import { describe, vi } from 'vitest'
import { loadMarkdownExtension } from '@workspace/markdown/state/extensions'
import { page } from 'vitest/browser'

import { expect, test } from '../../../../test/fixtures'
import {
  checkChatExpectations,
  createMarkdownBrowser,
  observeMarkdownDom,
  observeMarkdownSemantics,
  readyForScreenshot,
  recordMarkdownFrames,
  requiredElement,
} from '../../../../test/factories/markdown-browser'
import {
  BASELINE_DEFECTS,
  MARKDOWN_CASES,
  type Checkpoint,
} from '../../../../../../packages/markdown/test/fixtures/cases'

const STREAM_CASE_IDS: readonly string[] = [
  'plain-paragraph',
  'two-paragraphs',
  'soft-line-break',
  'hard-space-break',
  'hard-backslash-break',
  'atx-heading',
  'setext-heading',
  'setext-second-level',
  'strong-emphasis',
  'italic-emphasis',
  'nested-emphasis',
  'escaped-markers',
  'decoded-entities',
  'inline-code',
  'inline-code-backticks',
  'direct-link',
  'link-title',
  'link-emphasis',
  'link-parentheses',
  'reference-late',
  'unordered-list',
  'ordered-start',
  'nested-list',
  'task-list',
  'quoted-paragraph',
  'nested-quote',
  'fenced-typescript',
  'fence-metadata',
  'fenced-whitespace',
  'fence-literal-markdown',
  'simple-table',
  'hebrew-rtl',
]
const streamCases = MARKDOWN_CASES.filter((fixture) => STREAM_CASE_IDS.includes(fixture.id))

describe('real chat prefix projection', () => {
  test('retains the full small streaming fixture denominator', () => {
    expect(streamCases).toHaveLength(32)
    expect(streamCases.every((fixture) => fixture.checkpoints.length > 0)).toBe(true)
  })

  test.each(streamCases)(
    '$id paints every named prefix and settles to the completed result',
    async (fixture) => {
      const proof = await createMarkdownBrowser()
      let priorRevision = 0
      for (const checkpoint of fixture.checkpoints) {
        if (
          BASELINE_DEFECTS.some(
            (defect) => defect.fixtureId === fixture.id && defect.checkpointId === checkpoint.name,
          )
        )
          continue
        const receipt = await proof.update(
          fixture.source.slice(0, checkpoint.offset),
          checkpoint.live,
        )
        expect(receipt.revision).toBeGreaterThan(priorRevision)
        expect(receipt.committed).toBeGreaterThanOrEqual(receipt.received)
        expect(receipt.painted).toBeGreaterThanOrEqual(receipt.committed)
        await vi.waitFor(() => assertCheckpoint(proof.message(), checkpoint))
        priorRevision = receipt.revision
      }
      await proof.update(fixture.source, false)
      await vi.waitFor(() =>
        expect(checkChatExpectations(proof.message(), fixture.expected)).toEqual([]),
      )
      await readyForScreenshot(proof.message())
      const streamed = observeMarkdownSemantics(proof.message())
      const fresh = await createMarkdownBrowser()
      await fresh.update(fixture.source, false)
      await vi.waitFor(() =>
        expect(checkChatExpectations(fresh.message(), fixture.expected)).toEqual([]),
      )
      await readyForScreenshot(fresh.message())
      expect(observeMarkdownSemantics(fresh.message())).toEqual(streamed)
    },
    30_000,
  )

  test('equal displayed text still detects changed destinations and nesting', async () => {
    const proof = await createMarkdownBrowser()
    await proof.update('[same label](https://example.com/first)')
    const first = observeMarkdownSemantics(proof.message())
    await proof.update('[same label](https://example.com/second)')
    const second = observeMarkdownSemantics(proof.message())
    expect(second.text).toBe(first.text)
    expect(second).not.toEqual(first)
    await proof.update('**same label**')
    const strong = observeMarkdownSemantics(proof.message())
    await proof.update('*same label*')
    const emphasis = observeMarkdownSemantics(proof.message())
    expect(emphasis.text).toBe(strong.text)
    expect(emphasis).not.toEqual(strong)
  })

  test('both observations retain source images and sanitized user ids while excluding host favicons', async () => {
    const proof = await createMarkdownBrowser()
    await loadMarkdownExtension('raw')
    const imageUrl = new URL('/icons/fregat.svg', location.href).href
    const source = `<div id="base-ui-_r_123_">User namespace</div>\n\n<span id="_r_abc_">User identity</span>\n\n![source image](${imageUrl})\n\n[link](https://example.com/docs)`
    await proof.update(source)
    await vi.waitFor(() =>
      expect(proof.host.querySelector('[data-chat-link-favicon]')).not.toBeNull(),
    )
    const dom = observeMarkdownDom(proof.message())
    const semantics = observeMarkdownSemantics(proof.message())
    for (const observation of [dom, semantics]) {
      const images = observation.elements.filter((element) => element.tag === 'img')
      expect(images).toHaveLength(1)
      expect(images[0]?.attributes).toMatchObject({ src: imageUrl, alt: 'source image' })
      const ids = observation.elements.map((element) => element.attributes.id).filter(Boolean)
      expect(ids).toContain('user-content-base-ui-_r_123_')
      expect(ids).toContain('user-content-_r_abc_')
    }
    await proof.update(source.replace('id="_r_abc_"', 'id="_r_xyz_"'))
    const changed = observeMarkdownSemantics(proof.message())
    expect(changed.elements.map((element) => element.attributes.id)).toContain(
      'user-content-_r_xyz_',
    )
    expect(changed).not.toEqual(semantics)
  })

  test.each(BASELINE_DEFECTS)(
    '$fixtureId/$checkpointId records the exact unmet baseline expectation',
    async (defect) => {
      const fixture = MARKDOWN_CASES.find((entry) => entry.id === defect.fixtureId)
      const checkpoint = fixture?.checkpoints.find((entry) => entry.name === defect.checkpointId)
      expect(fixture).toBeDefined()
      expect(checkpoint).toBeDefined()
      if (!fixture || !checkpoint) return
      const proof = await createMarkdownBrowser()
      await proof.update(fixture.source.slice(0, checkpoint.offset), checkpoint.live)
      const findings = checkChatExpectations(proof.message(), defect.expected)
      expect(findings).toEqual([
        'strong: expected 1 elements, received 0',
        'strong[0] text: expected "outside inside", received undefined',
      ])
      expect(observeMarkdownDom(proof.message()).text).toBe('**outside inside')
      console.info(
        'MARKDOWN_BROWSER_BASELINE_DEFECT ' +
          JSON.stringify({
            fixture: fixture.id,
            checkpoint: checkpoint.name,
            expected: defect.expected,
            findings,
            qualificationPassed: false,
          }),
      )
    },
  )

  test('acknowledges processing and paint while heading syntax remains held', async () => {
    const proof = await createMarkdownBrowser()
    await proof.update('Intro\n\n##', true)
    const paragraph = requiredElement(proof.host, 'p')
    const first = observeMarkdownDom(proof.message())
    const receipt = await proof.update('Intro\n\n## ', true)
    expect(receipt.observation.text).toBe(first.text)
    expect(receipt.revision).toBe(2)
    expect(receipt.committed).toBeGreaterThanOrEqual(receipt.received)
    expect(proof.host.querySelector('h2')).toBeNull()
    await proof.update('Intro\n\n## Title', true)
    expect(requiredElement(proof.host, 'h2').textContent).toBe('Title')
    expect(proof.host.querySelector('p')).toBe(paragraph)
    await proof.update('Intro\n\n## Title', false)
    expect(requiredElement(proof.host, 'h2').textContent).toBe('Title')
  })

  test('holds a table header then releases all columns and cells after the separator', async () => {
    const proof = await createMarkdownBrowser({ width: 390 })
    const header = 'Lead\n\n| a | b | c |'
    await proof.update(header, true)
    expect(proof.host.querySelector('table')).toBeNull()
    expect(observeMarkdownDom(proof.message()).text).toBe('Lead')
    await proof.update(header + '\n|---|---|---|\n| 1 | 2 | 3 |', true)
    expect(Array.from(proof.host.querySelectorAll('th'), (cell) => cell.textContent)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(Array.from(proof.host.querySelectorAll('td'), (cell) => cell.textContent)).toEqual([
      '1',
      '2',
      '3',
    ])
    await proof.update(header + '\n|---|---|---|\n| 1 | 2 | 3 |', false)
    expect(proof.host.querySelectorAll('td')).toHaveLength(3)
  })

  test('heals a partial link while keeping it inactive until its destination completes', async () => {
    const proof = await createMarkdownBrowser()
    await proof.update('Read [the docs](https://exa', true)
    const incomplete = requiredElement(proof.host, 'a')
    expect(incomplete.textContent).toBe('the docs')
    expect(incomplete.getAttribute('href') ?? '').toBe('')
    expect(incomplete.dataset.incomplete).toBe('true')
    await proof.update('Read [the docs](https://example.com/guide)', true)
    const link = requiredElement(proof.host, 'a')
    expect(link.getAttribute('href')).toBe('https://example.com/guide')
    expect(link.dataset.incomplete).toBeUndefined()
    expect(link.getAttribute('target')).toBe('_blank')
  })

  test('updates earlier reference uses through late definitions, edits, duplicate definitions and removal', async () => {
    const proof = await createMarkdownBrowser()
    const prefix = '[guide]\n\nTail\n\n'
    await proof.update(prefix, true)
    expect(proof.host.querySelector('a')).toBeNull()
    await proof.update(prefix + '[guide]: https://example.com/first', true)
    expect(requiredElement(proof.host, 'a').getAttribute('href')).toBe('https://example.com/first')
    await proof.update(prefix + '[guide]: https://example.com/second', true)
    expect(requiredElement(proof.host, 'a').getAttribute('href')).toBe('https://example.com/second')
    await proof.update(
      prefix + '[guide]: https://example.com/second\n[guide]: https://example.com/third',
      true,
    )
    expect(requiredElement(proof.host, 'a').getAttribute('href')).toBe('https://example.com/second')
    await proof.update(prefix, false)
    expect(proof.host.querySelector('a')).toBeNull()
    expect(observeMarkdownDom(proof.message()).text).toContain('[guide]')
  })

  test('allows setext reclassification and preserves an unrelated settled paragraph', async () => {
    const proof = await createMarkdownBrowser()
    await proof.update('Stable\n\nTitle', true)
    const stable = requiredElement(proof.host, 'p')
    await proof.update('Stable\n\nTitle\n---\n', true)
    expect(requiredElement(proof.host, 'h2').textContent).toBe('Title')
    expect(proof.host.querySelector('p')).toBe(stable)
    await proof.update('Stable\n\nTitle\n---\n', false)
    expect(requiredElement(proof.host, 'h2').textContent).toBe('Title')
  })

  test('retains settled code state and every painted token color through append and completion', async () => {
    const proof = await createMarkdownBrowser()
    const source = '# Stable\n\n```ts\nconst answer: number = 42\n```\n\nTail'
    await proof.update(source, true)
    await vi.waitFor(() => expect(codeColors(proof.host).length).toBeGreaterThan(1), {
      timeout: 10_000,
    })
    await page.getByRole('button', { name: 'Wrap lines' }).click()
    const fence = requiredElement(proof.host, '[data-markdown="code-block"]')
    const before = codeColors(proof.host)
    const recording = recordMarkdownFrames(proof.host)
    await proof.update(source + ' grows', true)
    await proof.update(source + ' grows', false)
    const frames = recording.stop()
    expect(proof.host.querySelector('[data-markdown="code-block"]')).toBe(fence)
    expect(fence.dataset.wrap).toBe('true')
    expect(codeColors(proof.host)).toEqual(before)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every((frame) => frame.code === 'const answer: number = 42')).toBe(true)
    expect(frames.every((frame) => samePalette(frame.tokenColors, before))).toBe(true)
  }, 20_000)

  test('the frame palette check rejects a changed color with the same token count', async () => {
    const proof = await createMarkdownBrowser()
    await proof.update('```ts\nconst answer: number = 42\n```')
    await vi.waitFor(() => expect(codeColors(proof.host).length).toBeGreaterThan(1), {
      timeout: 10_000,
    })
    const before = codeColors(proof.host)
    const token = requiredElement(proof.host, '[data-markdown="code-block-body"] span[style]')
    token.style.color = 'rgb(1, 2, 3)'
    const recording = recordMarkdownFrames(proof.host)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const frames = recording.stop()
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every((frame) => frame.tokenColors.length === before.length)).toBe(true)
    expect(frames.every((frame) => samePalette(frame.tokenColors, before))).toBe(false)
  }, 20_000)

  test('never paints held heading markers or removes settled prose during release', async () => {
    const proof = await createMarkdownBrowser()
    await proof.update('Stable\n\n##', true)
    const recording = recordMarkdownFrames(proof.host)
    await proof.update('Stable\n\n## ', true)
    await proof.update('Stable\n\n## Ready', true)
    await proof.update('Stable\n\n## Ready', false)
    const frames = recording.stop()
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every((frame) => frame.text.includes('Stable'))).toBe(true)
    expect(frames.every((frame) => !frame.text.includes('##'))).toBe(true)
  })
})

function codeColors(host: HTMLElement) {
  return Array.from(
    host.querySelectorAll<HTMLElement>('[data-markdown="code-block-body"] span[style]'),
    (span) => getComputedStyle(span).color,
  )
}

function samePalette(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((color, index) => color === expected[index])
  )
}

function assertCheckpoint(host: HTMLElement, checkpoint: Checkpoint) {
  const observation = observeMarkdownDom(host)
  expect(checkChatExpectations(host, checkpoint.expected), checkpoint.name).toEqual([])
  for (const text of checkpoint.textIncludes ?? [])
    expect(observation.text, checkpoint.name).toContain(text)
  for (const text of checkpoint.textExcludes ?? [])
    expect(observation.text, checkpoint.name).not.toContain(text)
}

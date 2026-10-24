import { beforeAll, inject, onTestFinished, vi } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { loadMarkdownExtension } from '@workspace/markdown/state/extensions'
import { createMarkdownSession } from '@workspace/markdown/utils/session'

import { expect, test } from '../../../../test/fixtures'
import {
  checkChatExpectations,
  createMarkdownBrowser,
  paintedFrame,
  readyForScreenshot,
  requiredElement,
} from '../../../../test/factories/markdown-browser'
import { observeMarkdownSemantics } from '../../../../test/factories/markdown-observation'
import type { ImageHttpMock } from '../../../../test/factories/qualification-image-command'
import {
  MARKDOWN_CASES,
  type MarkdownCase,
} from '../../../../../../packages/markdown/test/fixtures/cases'
import {
  checkExpectations,
  observeHast,
  renderRemark,
} from '../../../../../../packages/markdown/test/qualification'

declare module 'vitest/browser' {
  interface BrowserCommands {
    mockQualificationImages: (input: ImageHttpMock) => Promise<void>
  }
}

type HostImage = {
  readonly id: string
  readonly src: string
  readonly alt: string
  readonly name: string
  readonly title: string | null
}
const HOST_IMAGES: readonly HostImage[] = [
  {
    id: 'image-alt-title',
    src: 'https://example.com/plot.png',
    alt: 'a small plot',
    name: 'a small plot',
    title: 'Result',
  },
  {
    id: 'image-empty-alt',
    src: 'https://example.com/image.png',
    alt: '',
    name: 'Image',
    title: null,
  },
  { id: 'html-name', src: 'x.png', alt: 'x', name: 'x', title: null },
  { id: 'html-event-handler', src: 'x.png', alt: 'safe', name: 'safe', title: null },
]
const imageCases = MARKDOWN_CASES.filter((fixture) =>
  HOST_IMAGES.some((image) => image.id === fixture.id),
)
type MarkdownProof = Awaited<ReturnType<typeof createMarkdownBrowser>>

beforeAll(async () => {
  await Promise.all([loadMarkdownExtension('raw'), loadMarkdownExtension('math')])
})

test('completed chat semantics retain all 102 original source and native expectation cases', () => {
  expect(MARKDOWN_CASES).toHaveLength(102)
  expect(new Set(MARKDOWN_CASES.map((fixture) => fixture.id)).size).toBe(102)
  expect(imageCases).toHaveLength(4)
})

test.each(MARKDOWN_CASES)(
  '$id preserves native meaning, host behavior and ordered DOM against real remark',
  async (fixture) => {
    expect(
      checkExpectations(observeHast(renderRemark(fixture.source, false)), fixture.expected),
    ).toEqual([])
    const image = HOST_IMAGES.find((entry) => entry.id === fixture.id)
    if (image) await installImageHttp(image, 'image')
    const getSelection = window.getSelection
    const baseline = await createMarkdownBrowser({ sessionFactory: createMarkdownSession })
    await baseline.update(fixture.source, false)
    await assertHostMessage(baseline, fixture, image)
    const expected = observeMarkdownSemantics(baseline.message())
    baseline.dispose()
    const target = await createMarkdownBrowser()
    await target.update(fixture.source, false)
    await assertHostMessage(target, fixture, image)
    expect(observeMarkdownSemantics(target.message())).toEqual(expected)
    expect(window.getSelection).toBe(getSelection)
    console.info(
      'MARKDOWN_BROWSER_COMPLETED ' +
        JSON.stringify({
          fixture: fixture.id,
          sha256: fixture.sha256,
          engine: inject('markdownEngine') ?? 'remark',
          nativeMatches: true,
          hostMatches: true,
          orderedDomMatchesRemark: true,
        }),
    )
  },
  30_000,
)

test.each(imageCases)(
  '$id renders accessible image failure identically to real remark',
  async (fixture) => {
    const image = HOST_IMAGES.find((entry) => entry.id === fixture.id)
    expect(image).toBeDefined()
    if (!image) return
    await installImageHttp(image, 'missing')
    const baseline = await createMarkdownBrowser({ sessionFactory: createMarkdownSession })
    await baseline.update(fixture.source)
    await assertImageFailure(baseline, image)
    const expected = observeMarkdownSemantics(baseline.message())
    baseline.dispose()
    const target = await createMarkdownBrowser()
    await target.update(fixture.source)
    await assertImageFailure(target, image)
    expect(observeMarkdownSemantics(target.message())).toEqual(expected)
  },
  30_000,
)

async function installImageHttp(image: HostImage, response: 'image' | 'missing'): Promise<void> {
  onTestFinished(async () => {
    await commands.mockQualificationImages({ action: 'remove' })
  })
  await commands.mockQualificationImages({
    action: 'install',
    urls: [new URL(image.src, document.baseURI).href],
    response,
  })
}

async function assertHostMessage(
  proof: MarkdownProof,
  fixture: MarkdownCase,
  image: HostImage | undefined,
): Promise<void> {
  if (image) {
    await assertLoadedImage(proof, image)
    return
  }
  if (fixture.id === 'html-fragment') {
    assertFragment(proof.message())
    await readyForScreenshot(proof.message())
    return
  }
  if (fixture.id === 'math-inline-fallback' || fixture.id === 'math-display-fallback') {
    await assertLoadedMath(proof.message(), fixture.id === 'math-display-fallback')
    await readyForScreenshot(proof.message())
    return
  }
  await vi.waitFor(() =>
    expect(checkChatExpectations(proof.message(), fixture.expected)).toEqual([]),
  )
  if ((proof.message().textContent ?? '').trim()) await readyForScreenshot(proof.message())
  await document.fonts.ready
  await paintedFrame()
}

async function assertLoadedImage(proof: MarkdownProof, expected: HostImage): Promise<void> {
  const image = proof.message().querySelector('img')
  expect(image).toBeInstanceOf(HTMLImageElement)
  if (!(image instanceof HTMLImageElement)) return
  expect(image.getAttribute('src')).toBe(expected.src)
  expect(image.getAttribute('alt')).toBe(expected.alt)
  expect(image.getAttribute('title')).toBeNull()
  expect(image.getAttribute('name')).toBeNull()
  expect(image.getAttribute('onerror')).toBeNull()
  expect(proof.message().querySelector('script')).toBeNull()
  expect(proof.message().querySelector('[name="getSelection"]')).toBeNull()
  const button = requiredElement(proof.message(), '[data-markdown-image]')
  expect(button.getAttribute('aria-label')).toBe(`Open ${expected.name}`)
  await page.elementLocator(button).hover()
  await vi.waitFor(() => {
    expect(image.complete).toBe(true)
    expect(image.naturalWidth).toBeGreaterThan(0)
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(
      expected.title ? `Open ${expected.name} · ${expected.title}` : `Open ${expected.name}`,
    )
  })
  await expect
    .element(page.elementLocator(requiredElement(document.body, '[data-slot="tooltip-content"]')))
    .toBeVisible()
  await userEvent.unhover(button)
  await vi.waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull())
  await document.fonts.ready
  await paintedFrame()
}

async function assertImageFailure(proof: MarkdownProof, expected: HostImage): Promise<void> {
  await vi.waitFor(() => {
    const fallback = proof.message().querySelector('[role="img"]')
    expect(fallback?.getAttribute('aria-label')).toBe(expected.name)
    expect(fallback?.textContent).toBe(`${expected.name} · Image unavailable`)
    expect(proof.message().querySelector('img')).toBeNull()
    expect(proof.message().querySelector('[data-markdown-image]')).toBeNull()
    expect(proof.message().querySelector('script')).toBeNull()
    expect(proof.message().querySelector('[onerror], [name="getSelection"]')).toBeNull()
  })
  await document.fonts.ready
  await paintedFrame()
}

function assertFragment(message: HTMLElement): void {
  const target = requiredElement(message, '#user-content-answer')
  expect(target.tagName).toBe('DIV')
  expect(target.textContent).toBe('Result')
  expect(message.querySelectorAll('#user-content-answer')).toHaveLength(1)
  expect(message.querySelector('#answer')).toBeNull()
  const link = requiredElement(message, 'a')
  expect(link.getAttribute('href')).toBe('#user-content-answer')
  expect(link.textContent).toBe('Jump')
}

async function assertLoadedMath(message: HTMLElement, display: boolean): Promise<void> {
  await vi.waitFor(() => expect(message.querySelectorAll('math')).toHaveLength(1))
  const math = message.querySelector('math')
  expect(math?.getAttribute('display')).toBe(display ? 'block' : null)
  expect(message.querySelector('code, pre')).toBeNull()
  expect(Array.from(message.querySelectorAll('math mi'), (node) => node.textContent)).toEqual([
    'x',
    'y',
  ])
  expect(Array.from(message.querySelectorAll('math mo'), (node) => node.textContent)).toEqual(['+'])
  expect(Array.from(message.querySelectorAll('math mn'), (node) => node.textContent)).toEqual(
    display ? ['2', '2'] : [],
  )
  expect(message.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(
    display ? 'x^2 + y^2' : 'x + y',
  )
  if (display) {
    expect(message.querySelectorAll('math msup')).toHaveLength(2)
    return
  }
  const paragraph = requiredElement(message, 'p')
  expect(paragraph.firstChild?.textContent).toBe('Inline ')
  expect(paragraph.lastChild?.textContent).toBe(' result.')
}

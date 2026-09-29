import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const coreEntry = `/@fs/${fileURLToPath(
  new URL('../../../packages/editor/src/editor.ts', import.meta.url),
)}`

type TestWindow = Window & {
  __editor?: {
    focus(): void
    materializeFullText(): string
  }
  __editorInputEvents?: string[]
}

async function installInputEventProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const input = document.querySelector('.editor-virtualized-input')
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Missing editor input')

    ;(window as TestWindow).__editorInputEvents = []
    input.addEventListener(
      'beforeinput',
      (event) => {
        const inputEvent = event as InputEvent
        ;(window as TestWindow).__editorInputEvents?.push(
          `beforeinput:${inputEvent.inputType}:${inputEvent.data ?? ''}`,
        )
      },
      { capture: true },
    )
  })
}

async function clickEditorTextOffset(page: Page, offset: number): Promise<void> {
  const point = await page.evaluate((targetOffset) => {
    const row = document.querySelector('.editor-virtualized-row')
    if (!(row instanceof HTMLDivElement)) throw new Error('Missing editor row')

    const textNode = Array.from(row.childNodes).find(
      (node): node is Text => node.nodeType === Node.TEXT_NODE,
    )
    if (!textNode) throw new Error('Missing editor row text')

    const range = document.createRange()
    const length = textNode.data.length
    const target = Math.max(0, Math.min(targetOffset, length))

    if (length === 0) {
      const rect = row.getBoundingClientRect()
      return {
        x: rect.left + 1,
        y: rect.top + rect.height / 2,
      }
    }

    if (target < length) {
      range.setStart(textNode, target)
      range.setEnd(textNode, target + 1)
      const rect = range.getBoundingClientRect()
      return {
        x: rect.left + 1,
        y: rect.top + rect.height / 2,
      }
    }

    range.setStart(textNode, length - 1)
    range.setEnd(textNode, length)
    const rect = range.getBoundingClientRect()
    return {
      x: rect.right + 1,
      y: rect.top + rect.height / 2,
    }
  }, offset)

  await page.mouse.click(point.x, point.y)
}

test('routes real keyboard typing after clicking the editor surface', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async (entry) => {
    const { Editor } = await import(entry)
    const app = document.querySelector('#app')
    if (!app) throw new Error('Missing app root')

    app.innerHTML = '<div id="host" style="display:flex;height:300px;width:700px"></div>'
    const host = document.querySelector('#host')
    if (!(host instanceof HTMLElement)) throw new Error('Missing editor host')

    const editor = new Editor(host)
    editor.openDocument({ documentId: 'note.txt', text: 'abc' })
    ;(window as TestWindow).__editor = editor
  }, coreEntry)
  await installInputEventProbe(page)

  await page.locator('.editor-virtualized').click({ position: { x: 80, y: 10 } })
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()

  await page.keyboard.type('XYZ')

  await expect
    .poll(() => {
      return page.evaluate(() => (window as TestWindow).__editor?.materializeFullText())
    })
    .toBe('abcXYZ')
  await expect
    .poll(() => {
      return page.evaluate(() => (window as TestWindow).__editorInputEvents ?? [])
    })
    .toContain('beforeinput:insertText:X')
})

test('keeps Space from scrolling the focused editor', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async (entry) => {
    const { Editor } = await import(entry)
    const app = document.querySelector('#app')
    if (!app) throw new Error('Missing app root')

    app.innerHTML = '<div id="host" style="display:flex;height:160px;width:700px"></div>'
    const host = document.querySelector('#host')
    if (!(host instanceof HTMLElement)) throw new Error('Missing editor host')

    const editor = new Editor(host)
    const text = Array.from({ length: 200 }, (_value, index) => `line ${index}`).join('\n')
    editor.openDocument({ documentId: 'note.txt', text })
    ;(window as TestWindow).__editor = editor
  }, coreEntry)

  await clickEditorTextOffset(page, 'line '.length)
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()

  await page.keyboard.press('Space')

  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__editor?.materializeFullText()))
    .toContain('line  0')
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.editor-virtualized')?.scrollTop))
    .toBe(0)
})

test('inserts repeated typing at a placed caret', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async (entry) => {
    const { Editor } = await import(entry)
    const app = document.querySelector('#app')
    if (!app) throw new Error('Missing app root')

    app.innerHTML = '<div id="host" style="display:flex;height:300px;width:700px"></div>'
    const host = document.querySelector('#host')
    if (!(host instanceof HTMLElement)) throw new Error('Missing editor host')

    const editor = new Editor(host)
    editor.openDocument({ documentId: 'note.txt', text: 'abcdef' })
    ;(window as TestWindow).__editor = editor
  }, coreEntry)
  await installInputEventProbe(page)

  await clickEditorTextOffset(page, 3)
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()

  await page.keyboard.type('XYZ')

  await expect
    .poll(() => {
      return page.evaluate(() => (window as TestWindow).__editor?.materializeFullText())
    })
    .toBe('abcXYZdef')
  await expect
    .poll(() => {
      return page.evaluate(() => (window as TestWindow).__editorInputEvents ?? [])
    })
    .toContain('beforeinput:insertText:X')
})

test('routes native line break input at a placed caret', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async (entry) => {
    const { Editor } = await import(entry)
    const app = document.querySelector('#app')
    if (!app) throw new Error('Missing app root')

    app.innerHTML = '<div id="host" style="display:flex;height:300px;width:700px"></div>'
    const host = document.querySelector('#host')
    if (!(host instanceof HTMLElement)) throw new Error('Missing editor host')

    const editor = new Editor(host)
    editor.openDocument({ documentId: 'note.txt', text: 'abcdef' })
    ;(window as TestWindow).__editor = editor
  }, coreEntry)
  await installInputEventProbe(page)

  await clickEditorTextOffset(page, 3)
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()

  await page.keyboard.press('Enter')

  await expect
    .poll(() => {
      return page.evaluate(() => (window as TestWindow).__editor?.materializeFullText())
    })
    .toBe('abc\ndef')
  await expect
    .poll(() => {
      return page.evaluate(() => (window as TestWindow).__editorInputEvents ?? [])
    })
    .toContain('beforeinput:insertLineBreak:')
})

test('keeps focus and inserts a tab when Tab is pressed', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async (entry) => {
    const { Editor } = await import(entry)
    const app = document.querySelector('#app')
    if (!app) throw new Error('Missing app root')

    app.innerHTML = [
      '<button id="before">Before</button>',
      '<div id="host" style="display:flex;height:300px;width:700px"></div>',
      '<button id="after">After</button>',
    ].join('')
    const host = document.querySelector('#host')
    if (!(host instanceof HTMLElement)) throw new Error('Missing editor host')

    const editor = new Editor(host)
    editor.openDocument({ documentId: 'note.txt', text: 'abc' })
    ;(window as TestWindow).__editor = editor
  }, coreEntry)

  await page.locator('.editor-virtualized').click({ position: { x: 80, y: 10 } })
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()

  await page.keyboard.press('Tab')

  await expect(page.locator('.editor-virtualized-input')).toBeFocused()
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__editor?.materializeFullText()))
    .toBe('abc\t')
})

test('focuses the editor for typing after loading a GitHub source file', async ({ page }) => {
  await mockGitHubSource(page, 'README.md', 'abc')
  await page.goto('/')

  await expect(page.locator('.entry.file')).toContainText('README.md')
  await page.locator('.entry.file').click()
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()

  await page.keyboard.type('XYZ')

  await expect(page.locator('.editor-virtualized')).toContainText('abcXYZ')
})

test('shows current file changes in editable live stacked diff mode', async ({ page }) => {
  await mockGitHubSource(page, 'README.md', 'abc')
  await page.goto('/')

  await page.locator('.entry.file').click()
  await page.keyboard.type('XYZ')
  await page.getByRole('button', { name: 'Diff' }).click()

  await expect(page.locator('#editor-host')).toBeVisible()
  await expect(page.locator('.editor-diff-gutter').first()).toBeVisible()
  await expect.poll(() => firstVisibleGutterContribution(page)).toBe('editor-diff-gutter-stacked')
  await expect(page.locator('[data-editor-gutter-contribution="line-gutter"]')).toHaveCount(0)
  await expect(page.locator('.editor-diff-row-addition')).toContainText('abcXYZ')
  await expect(page.locator('.editor-diff-row-deletion')).toContainText('abc')
  await expect
    .poll(() => rowBackgroundColor(page, '.editor-diff-row-addition'))
    .not.toBe('rgba(0, 0, 0, 0)')
  await expect
    .poll(() => rowBackgroundColor(page, '.editor-diff-row-deletion'))
    .not.toBe('rgba(0, 0, 0, 0)')
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()

  await page.keyboard.press('Enter')

  await expect(page.locator('.editor-diff-row-deletion').first()).toBeVisible()
  await expect(page.locator('.editor-diff-row-deletion')).toContainText('abc')
  await expect(page.locator('.editor-diff-row-addition').first()).toContainText('abcXYZ')
  await expect(page.locator('.editor-diff-row-addition')).toHaveCount(2)
  await expect(page.locator('.editor-diff-row-addition').last()).toBeVisible()
  await page.keyboard.type('!')

  await expect(page.locator('.editor-diff-row-deletion').first()).toBeVisible()
  await expect(page.locator('.editor-diff-row-deletion')).toContainText('abc')
  await expect(page.locator('.editor-diff-row-addition').last()).toContainText('!')

  await page.getByRole('button', { name: 'Edit' }).click()

  await expect(page.locator('.editor-diff-gutter:not([hidden])')).toHaveCount(0)
  await expect(
    page.locator('[data-editor-gutter-contribution="line-gutter"]').first(),
  ).toBeVisible()
})

test('keeps the first live diff deletion visible after inserting a newline', async ({ page }) => {
  await mockGitHubSource(page, 'README.md', 'abc')
  await page.goto('/')

  await page.locator('.entry.file').click()
  await page.getByRole('button', { name: 'Diff' }).click()
  await page.keyboard.press('Enter')

  await expect(page.locator('.editor-diff-row-deletion').first()).toBeVisible()
  await expect(page.locator('.editor-diff-row-deletion')).toContainText('abc')
  await expect(page.locator('.editor-diff-row-addition').first()).toContainText('abc')
  await expect(page.locator('.editor-diff-row-addition')).toHaveCount(2)
  await expect(page.locator('.editor-diff-row-addition').last()).toBeVisible()
  await page.keyboard.type('!')

  await expect(page.locator('.editor-diff-row-deletion').first()).toBeVisible()
  await expect(page.locator('.editor-diff-row-deletion')).toContainText('abc')
  await expect(page.locator('.editor-diff-row-addition').last()).toContainText('!')
})

test('keeps syntax highlights in live diff editor rows', async ({ page }) => {
  await mockGitHubSource(page, 'src/index.ts', 'const answer: number = 42;\n')
  await page.goto('/')

  await page.locator('.entry.file').click()
  await page.locator('.editor-virtualized').click({ position: { x: 150, y: 10 } })
  await page.keyboard.type('XYZ')
  await page.getByRole('button', { name: 'Diff' }).click()

  await expect(page.locator('#editor-host')).toBeVisible()
  await expect.poll(() => editorSyntaxHighlightCount(page), { timeout: 15000 }).toBeGreaterThan(0)
})

async function mockGitHubSource(page: Page, path: string, text: string): Promise<void> {
  await page.route('https://api.github.com/repos/ShaulLavo/singapore/commits/main', (route) =>
    route.fulfill({
      json: {
        sha: 'mock-commit-sha',
        commit: { tree: { sha: 'tree-sha' } },
      },
    }),
  )
  await page.route(
    'https://api.github.com/repos/ShaulLavo/singapore/git/trees/tree-sha?recursive=1',
    (route) =>
      route.fulfill({
        json: {
          sha: 'tree-sha',
          truncated: false,
          tree: [{ path, type: 'blob', sha: 'file-sha', size: text.length }],
        },
      }),
  )
  await page.route(
    `https://raw.githubusercontent.com/ShaulLavo/singapore/mock-commit-sha/${path}`,
    (route) =>
      route.fulfill({
        body: text,
        contentType: 'text/plain',
      }),
  )
}

async function editorSyntaxHighlightCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const registry = (
      globalThis.CSS as { highlights?: Iterable<[string, { readonly size: number }]> } | undefined
    )?.highlights
    if (!registry) return 0

    let count = 0
    for (const [name, highlight] of registry) {
      if (!name.includes('-token-')) continue
      count += highlight.size
    }

    return count
  })
}

async function firstVisibleGutterContribution(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const row = [
      ...document.querySelectorAll<HTMLElement>('[data-editor-virtual-gutter-row]'),
    ].find((element) => element.offsetParent !== null)
    return (
      row?.querySelector<HTMLElement>('[data-editor-gutter-contribution]')?.dataset
        .editorGutterContribution ?? null
    )
  })
}

async function rowBackgroundColor(page: Page, selector: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      return getComputedStyle(element).backgroundColor
    })
}

test('preserves scroll when refocusing a scrolled editor', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async (entry) => {
    const { Editor } = await import(entry)
    const app = document.querySelector('#app')
    if (!app) throw new Error('Missing app root')

    app.innerHTML = [
      '<button id="outside">Outside</button>',
      '<div id="host" style="display:flex;height:160px;width:700px"></div>',
    ].join('')
    const host = document.querySelector('#host')
    if (!(host instanceof HTMLElement)) throw new Error('Missing editor host')

    const editor = new Editor(host)
    const text = Array.from({ length: 200 }, (_value, index) => `line ${index}`).join('\n')
    editor.openDocument({ documentId: 'note.txt', text })
    ;(window as TestWindow).__editor = editor

    const root = document.querySelector('.editor-virtualized')
    if (!(root instanceof HTMLElement)) throw new Error('Missing editor root')
    root.scrollTop = 900
  }, coreEntry)

  await page.locator('#outside').focus()
  await page.evaluate(() => {
    ;(window as TestWindow).__editor?.focus()
  })
  await page.waitForTimeout(50)

  await expect
    .poll(() => page.evaluate(() => document.querySelector('.editor-virtualized')?.scrollTop))
    .toBe(900)
})

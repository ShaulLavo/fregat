import { expect, test } from '@playwright/test'
import { mockGitHubSourceFiles } from './github-source.ts'

test('shows the tree before source text and reserves downloads for the selected file', async ({
  page,
}, testInfo) => {
  const files = [{ path: 'README.md', text: '# Ready' }].concat(
    Array.from({ length: 20 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      text: `export const value${index} = ${index};`,
    })),
  )
  await mockGitHubSourceFiles(page, files)
  const requests: string[] = []
  let release: () => void = () => undefined
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    requests.push(route.request().url())
    await blocked
    await route.fallback()
  })
  await page.addInitScript(() => localStorage.clear())

  try {
    await page.goto('/')
    await expect(page.locator('#tree .entry')).toHaveCount(2)
    await expect(page.locator('[data-source-path="README.md"]')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain('/README.md')
    await testInfo.attach('tree-before-content', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await testInfo.attach('downloads-before-first-file.json', {
      body: JSON.stringify({ fileCount: files.length, requests }),
      contentType: 'application/json',
    })
    release()
    await expect(page.locator('.editor-virtualized')).toContainText('# Ready')
    await expect.poll(() => requests.length).toBe(files.length)
    await page.locator('[data-source-path="src/"]').click()
    await expect(page.locator('#tree .entry.file')).toHaveCount(files.length)
  } finally {
    release()
  }
})

test('deduplicates hover and click, holds the open file, and ignores late selections', async ({
  page,
}) => {
  const files = [
    { path: 'README.md', text: '# Original' },
    { path: 'a.md', text: '# Background A' },
    { path: 'b.md', text: '# Background B' },
    { path: 'y.md', text: '# Latest selection' },
    { path: 'z.md', text: '# Slow selection' },
  ]
  await mockGitHubSourceFiles(page, files)
  const requests = new Map<string, number>()
  let release: () => void = () => undefined
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    const path = route.request().url().split('/').at(-1) ?? ''
    requests.set(path, (requests.get(path) ?? 0) + 1)
    if (['a.md', 'b.md', 'z.md'].includes(path)) await blocked
    await route.fallback()
  })
  await page.addInitScript(() => localStorage.clear())

  try {
    await page.goto('/')
    await expect(page.locator('.editor-virtualized')).toContainText('# Original')
    await expect.poll(() => requests.get('b.md')).toBe(1)
    expect(requests.has('y.md')).toBe(false)
    const slow = page.locator('[data-source-path="z.md"]')
    await slow.hover()
    await expect.poll(() => requests.get('z.md')).toBe(1)
    await slow.click()
    await expect(slow).toHaveAttribute('aria-busy', 'true')
    await expect(page.locator('#status-file')).toHaveText('README.md')
    await expect(page.locator('.editor-virtualized')).toContainText('# Original')
    expect(requests.get('z.md')).toBe(1)
    await page.locator('[data-source-path="y.md"]').click()
    await expect(page.locator('.editor-virtualized')).toContainText('# Latest selection')
    release()
    await expect(slow).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('.editor-virtualized')).toContainText('# Latest selection')
    await expect(page.locator('#status-file')).toHaveText('y.md')
    await expect(page.locator('[data-source-path="y.md"]')).toHaveClass(/active/)
    expect(requests.get('z.md')).toBe(1)
  } finally {
    release()
  }
})

test('opens cached source while other cached objects are still missing', async ({ page }) => {
  await mockGitHubSourceFiles(page, [
    { path: 'README.md', text: '# Cached source' },
    { path: 'src/missing.ts', text: 'export const missing = true;' },
  ])
  let rawReads = 0
  let selectedReads = 0
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    rawReads += 1
    if (route.request().url().endsWith('/README.md')) selectedReads += 1
    if (route.request().url().endsWith('/missing.ts')) {
      await route.fulfill({ status: 404 })
      return
    }
    await route.fallback()
  })
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('.editor-virtualized')).toContainText('# Cached source')
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const cache = await root.getDirectoryHandle('editor-github-source-cache')
        const objects = await cache.getDirectoryHandle('objects')
        try {
          return (await (await objects.getFileHandle('file-sha-0')).getFile()).text()
        } catch {
          return null
        }
      }),
    )
    .toBe('# Cached source')
  rawReads = 0
  selectedReads = 0
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 503 }))
  await page.reload()
  await expect(page.locator('.editor-virtualized')).toContainText('# Cached source')
  await expect(page.locator('#tree .entry')).toHaveCount(2)
  // Only the missing background object needs a network read after reloading.
  await expect.poll(() => rawReads).toBeGreaterThan(0)
  expect(selectedReads).toBe(0)
  await page.locator('[data-source-path="README.md"]').click()
  await expect(page.locator('#status-file')).toHaveText('README.md')
})

test('mounts the editor pane in the real app shell', async ({ page }) => {
  await page.goto('/')

  const editorPane = page.locator('#editor-container')
  await expect(editorPane).toBeVisible()
  await expect(editorPane).toHaveCSS('display', 'flex')
})

for (const extension of ['ts', 'tsx']) {
  test(`loads Tree-sitter token highlights for a .${extension} source file`, async ({ page }) => {
    const file = {
      path: `src/index.${extension}`,
      text:
        extension === 'tsx'
          ? 'const answer = <div title="Answer">{42}</div>;\n'
          : 'const answer: number = 42;\n',
    }
    await mockGitHubSource(page, file.path, file.text)
    await page.addInitScript((path) => {
      localStorage.clear()
      localStorage.setItem('editor-selected-file', path)
    }, file.path)

    await page.goto('/')

    await expect(page.locator('.editor-virtualized')).toContainText('const answer')
    const language = extension === 'tsx' ? 'tsx' : 'typescript'
    await expect(page.locator('#status-syntax')).toHaveText(`${language} ready`, {
      timeout: 15000,
    })
    await expect.poll(() => tokenHighlightRangeCount(page), { timeout: 15000 }).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Diff', exact: true }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.locator('#status-syntax')).toHaveText(`${language} ready`)
    await expect.poll(() => tokenHighlightRangeCount(page)).toBeGreaterThan(0)
  })
}

test('loads Tree-sitter Markdown highlights for a Markdown file', async ({ page }) => {
  const file = {
    path: 'README.md',
    text: ['# Editor', '', 'A **fast** editor.', '', '```ts', 'const answer = 42;', '```', ''].join(
      '\n',
    ),
  }
  await mockGitHubSource(page, file.path, file.text)
  await page.addInitScript((path) => {
    localStorage.clear()
    localStorage.setItem('editor-selected-file', path)
  }, file.path)

  await page.goto('/')

  await expect(page.locator('.editor-virtualized')).toContainText('const answer')
  await expect(page.locator('#status-syntax')).toContainText('markdown ready', {
    timeout: 15000,
  })
  await expect.poll(() => tokenHighlightRangeCount(page), { timeout: 15000 }).toBeGreaterThan(0)
})

test('shows TypeScript LSP diagnostics for a source file', async ({ page }) => {
  const file = {
    path: 'src/index.ts',
    text: 'const value: string = 1;\n',
  }
  await mockGitHubSource(page, file.path, file.text)
  await page.addInitScript((path) => {
    localStorage.clear()
    localStorage.setItem('editor-selected-file', path)
  }, file.path)

  await page.goto('/')

  await expect(page.locator('.editor-virtualized')).toContainText('const value')
  await expect
    .poll(() => diagnosticHighlightRangeCount(page), { timeout: 15000 })
    .toBeGreaterThan(0)
  await expect(page.locator('#status-typescript')).toContainText(/TS .*error/)

  const hoverRect = await textRectFor(page, 'value', 0)
  await page.mouse.move(hoverRect.x + 2, hoverRect.y + hoverRect.height / 2)
  await expect(page.getByRole('dialog', { name: 'Editor hover' })).toContainText('value', {
    timeout: 15000,
  })
  const tooltipRect = await page.getByRole('dialog', { name: 'Editor hover' }).boundingBox()
  expect(tooltipRect?.y ?? 0).toBeGreaterThan(hoverRect.y)
})

test('shows TypeScript hover hints and jumps to definitions', async ({ page }) => {
  const files = [
    {
      path: 'src/index.ts',
      text: [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'import { answer } from "./other";',
        'const value: string = answer;',
        '',
      ].join('\n'),
    },
    {
      path: 'src/other.ts',
      text: 'export const answer = 42;\n',
    },
  ]
  await mockGitHubSourceFiles(page, files)
  await page.addInitScript((path) => {
    localStorage.clear()
    localStorage.setItem('editor-selected-file', path)
  }, 'src/index.ts')

  await page.goto('/')
  await expect(page.locator('.editor-virtualized')).toContainText('const value')
  await expect
    .poll(() => diagnosticHighlightRangeCount(page), { timeout: 15000 })
    .toBeGreaterThan(0)

  const hoverRect = await textRectFor(page, 'value', 0)
  await page.mouse.move(hoverRect.x + 2, hoverRect.y + hoverRect.height / 2)
  await expect(page.getByRole('dialog', { name: 'Editor hover' })).toContainText('value', {
    timeout: 15000,
  })
  await expect(page.getByRole('dialog', { name: 'Editor hover' })).toContainText(
    /Type 'number' is not assignable to type 'string'|number/,
  )

  // The hover opens above its word and stays while the pointer is inside it, and above `value` is
  // the import line: leave first, or the move to `answer` lands inside the old hover.
  await page.mouse.move(0, 0)
  await expect(page.getByRole('dialog', { name: 'Editor hover' })).toBeHidden()
  const definitionRect = await textRectFor(page, 'answer', 0)
  await page.mouse.move(definitionRect.x + 2, definitionRect.y + definitionRect.height / 2)
  await expect(page.getByRole('dialog', { name: 'Editor hover' })).toContainText('answer', {
    timeout: 15000,
  })
  const tooltipRect = await page.getByRole('dialog', { name: 'Editor hover' }).boundingBox()
  expect(tooltipRect?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(definitionRect.y)

  await page.keyboard.down('Control')
  await page.mouse.move(definitionRect.x + 2, definitionRect.y + definitionRect.height / 2)
  await expect
    .poll(() => definitionLinkHighlightRangeCount(page), { timeout: 15000 })
    .toBeGreaterThan(0)
  await page.mouse.click(definitionRect.x + 2, definitionRect.y + definitionRect.height / 2)
  await page.keyboard.up('Control')

  await expect(page.locator('.editor-virtualized')).toContainText('export const answer', {
    timeout: 15000,
  })
  await expect(page.locator('.entry.active')).toContainText('other.ts')
})

test('fixes, formats, renames across files and outlines with no language server', async ({
  page,
}) => {
  const files = [
    {
      path: 'src/index.ts',
      text: [
        "import { Circle, area } from './shapes'",
        '',
        'const circle = new Circle(2)',
        'const   total   =   area(circl)',
        'console.log(total)',
        '',
      ].join('\n'),
    },
    {
      path: 'src/shapes.ts',
      text: [
        'export class Circle {',
        '  constructor(readonly radius: number) {}',
        '}',
        '',
        'export function area(circle: Circle): number {',
        '  return Math.PI * circle.radius ** 2',
        '}',
        '',
      ].join('\n'),
    },
  ]
  await page.route('https://playgroundcdn.typescriptlang.org/**', (route) => route.abort())
  await mockGitHubSourceFiles(page, files)
  await page.addInitScript((path) => {
    localStorage.clear()
    localStorage.setItem('editor-selected-file', path)
  }, 'src/index.ts')
  const editor = page.locator('.editor-virtualized')

  await page.goto('/')
  await expect(editor).toContainText('area(circl)')
  await expect
    .poll(() => diagnosticHighlightRangeCount(page), { timeout: 20000 })
    .toBeGreaterThan(0)

  // Quick fix: the preferred fix for the misspelling, applied from the caret.
  const misspelled = await textRectFor(page, 'circl)', 0)
  await page.mouse.click(misspelled.x + 4, misspelled.y + misspelled.height / 2)
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Alt+Shift+Period')
        return editor.textContent()
      },
      { timeout: 15000, intervals: [300] },
    )
    .toContain('area(circle)')

  // Format Document with the editor's indentation.
  await page.keyboard.press('Alt+Shift+F')
  await expect(editor).toContainText('const total = area(circle)', { timeout: 15000 })

  // Rename from the declaration, which reaches the file that imports it.
  await page.locator('.entry.file', { hasText: 'shapes.ts' }).click()
  await expect(editor).toContainText('export class Circle')
  const declaration = await textRectFor(page, 'Circle', 0)
  await page.mouse.click(declaration.x + 4, declaration.y + declaration.height / 2)
  await page.keyboard.press('F2')
  const renameInput = page.getByRole('textbox', { name: 'New name' })
  await expect(renameInput).toHaveValue('Circle', { timeout: 15000 })
  await renameInput.fill('Round')
  await renameInput.press('Enter')
  await expect(editor).toContainText('export class Round')
  await expect(editor).toContainText('area(circle: Round)')

  // The outline lists the file's symbols and jumps to one.
  await page.getByRole('button', { name: 'Outline' }).click()
  const outline = page.getByRole('tree', { name: 'Outline' })
  await expect(outline).toContainText('Round', { timeout: 15000 })
  await expect(outline).toContainText('radius')
  await outline.getByRole('treeitem').filter({ hasText: 'area' }).click()
  await expect(page.locator('#status-cursor')).toContainText('Ln 5')

  // The importing file took the rename, and kept the fix and the formatting.
  await page.locator('.entry.file', { hasText: 'index.ts' }).click()
  await expect(editor).toContainText("import { Round, area } from './shapes'")
  await expect(editor).toContainText('const circle = new Round(2)')
  await expect(editor).toContainText('const total = area(circle)')
  await expect.poll(() => diagnosticHighlightRangeCount(page), { timeout: 15000 }).toBe(0)
})

async function tokenHighlightRangeCount(page: import('@playwright/test').Page): Promise<number> {
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

async function diagnosticHighlightRangeCount(
  page: import('@playwright/test').Page,
): Promise<number> {
  return page.evaluate(() => {
    const registry = (
      globalThis.CSS as { highlights?: Iterable<[string, { readonly size: number }]> } | undefined
    )?.highlights
    if (!registry) return 0

    let count = 0
    for (const [name, highlight] of registry) {
      if (!name.includes('typescript-lsp-error')) continue
      count += highlight.size
    }

    return count
  })
}

async function definitionLinkHighlightRangeCount(
  page: import('@playwright/test').Page,
): Promise<number> {
  return page.evaluate(() => {
    const registry = (
      globalThis.CSS as { highlights?: Iterable<[string, { readonly size: number }]> } | undefined
    )?.highlights
    if (!registry) return 0

    let count = 0
    for (const [name, highlight] of registry) {
      if (!name.includes('typescript-lsp-definition-link')) continue
      count += highlight.size
    }

    return count
  })
}

async function textRectFor(
  page: import('@playwright/test').Page,
  query: string,
  occurrence: number,
): Promise<{
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}> {
  const rect = await page.evaluate(
    ({ query, occurrence }) => {
      const walker = document.createTreeWalker(
        document.querySelector('.editor-virtualized')!,
        NodeFilter.SHOW_TEXT,
      )
      let seen = 0

      for (;;) {
        const node = walker.nextNode()
        if (!node) break

        const text = node.textContent ?? ''
        const index = text.indexOf(query)
        if (index === -1) continue
        if (seen !== occurrence) {
          seen += 1
          continue
        }

        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + query.length)
        const item = range.getBoundingClientRect()
        return {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        }
      }

      return null
    },
    { query, occurrence },
  )
  if (!rect) throw new Error(`Unable to find text rect for ${query}`)
  return rect
}

async function mockGitHubSource(
  page: import('@playwright/test').Page,
  path: string,
  text: string,
): Promise<void> {
  await mockGitHubSourceFiles(page, [{ path, text }])
}

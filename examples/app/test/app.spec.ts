import { expect, test } from '@playwright/test'

test('mounts the editor pane in the real app shell', async ({ page }) => {
  await page.goto('/')

  const editorPane = page.locator('#editor-container')
  await expect(editorPane).toBeVisible()
  await expect(editorPane).toHaveCSS('display', 'flex')
})

test('loads Shiki token highlights for a source file', async ({ page }) => {
  const file = {
    path: 'src/index.ts',
    text: 'const answer: number = 42;\n',
  }
  await mockGitHubSource(page, file.path, file.text)
  await page.addInitScript((path) => {
    localStorage.clear()
    localStorage.setItem('editor-selected-file', path)
  }, file.path)

  await page.goto('/')

  await expect(page.locator('.editor-virtualized')).toContainText('const answer')
  await expect.poll(() => tokenHighlightRangeCount(page)).toBeGreaterThan(0)
})

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

async function mockGitHubSourceFiles(
  page: import('@playwright/test').Page,
  files: readonly { readonly path: string; readonly text: string }[],
): Promise<void> {
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
          tree: files.map((file, index) => ({
            path: file.path,
            type: 'blob',
            sha: `file-sha-${index}`,
            size: file.text.length,
          })),
        },
      }),
  )
  for (const file of files) {
    await page.route(
      `https://raw.githubusercontent.com/ShaulLavo/singapore/mock-commit-sha/${file.path}`,
      (route) =>
        route.fulfill({
          body: file.text,
          contentType: 'text/plain',
        }),
    )
  }
}

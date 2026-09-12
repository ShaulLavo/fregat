import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { testTabContent } from '../../../../../test/factories/document-targets'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  chatMarkdownClipboardPayload,
  serializeRenderedMarkdownFragment,
} from '@/features/chat/utils/markdown-clipboard'
import { markdownHighlightCache } from '@/features/chat/state/markdown-highlight-cache'
import { expect, test } from '../../../../../test/fixtures'
import { createMarkdownWorkspace, renderMarkdown } from '../../../../../test/factories/markdown'

test.each(['Result', ''])(
  'selected Markdown images keep their source in plain and rich copy: %s',
  (alt) => {
    const text = `Before ![${alt}](https://example.com/result.png) after.`
    const { container } = renderMarkdown(text)
    const paragraph = container.querySelector('p')!
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    try {
      const payload = chatMarkdownClipboardPayload(selection)
      expect(payload?.text).toBe(text)
      const rich = document.createElement('div')
      rich.innerHTML = payload?.html ?? ''
      expect(rich.querySelector('img')?.getAttribute('src')).toBe('https://example.com/result.png')
      expect(rich.querySelector('img')?.getAttribute('alt')).toBe(alt)
      expect(rich.querySelector('button')).toBeNull()
      expect(rich.textContent).toBe('Before  after.')
    } finally {
      selection.removeAllRanges()
    }
  },
)

test('an inline file reference opens the referenced file at its line', async ({
  client,
  server,
}) => {
  const user = userEvent.setup()
  const { application, editor } = await createMarkdownWorkspace(client, server)
  const { getByRole } = renderMarkdown('See `src/foo.ts:42` for the fix.', { application })

  await user.click(getByRole('link', { name: /src\/foo\.ts:42/u }))

  await waitFor(() =>
    expect(editor.workspaceStore.getState().selectedTabContent).toEqual(
      testTabContent('repo/src/foo.ts'),
    ),
  )
  expect(editor.uiStore.getState().definitionTarget).toMatchObject({
    path: 'repo/src/foo.ts',
    uri: 'file:///repo/src/foo.ts',
    range: { start: { character: 0, line: 41 } },
  })
})

test('a markdown link to a workspace file opens that file', async ({ client, server }) => {
  const user = userEvent.setup()
  const { application, editor } = await createMarkdownWorkspace(client, server)
  const { getByRole } = renderMarkdown('Look at [the module](src/deep/mod.ts).', { application })

  await user.click(getByRole('link', { name: /src\/deep\/mod\.ts/u }))

  await waitFor(() =>
    expect(editor.workspaceStore.getState().selectedTabContent).toEqual(
      testTabContent('repo/src/deep/mod.ts'),
    ),
  )
  expect(editor.uiStore.getState().definitionTarget).toBeNull()
})

test('a web link is left to the markdown renderer, not turned into a file chip', () => {
  const { container } = renderMarkdown('Read [the docs](https://example.com/guide).')

  expect(container.querySelector('[data-chat-file-link]')).toBeNull()
  expect(container.textContent).toContain('the docs')
})

test('a Codex output citation uses the existing file link action', async ({ client, server }) => {
  const { application, editor } = await createMarkdownWorkspace(client, server)
  const view = renderMarkdown(':codex-file-citation{path="src/foo.ts" purpose="output"}', {
    application,
  })
  await userEvent.click(view.getByRole('link', { name: /src\/foo\.ts/u }))
  await waitFor(() =>
    expect(editor.workspaceStore.getState().selectedTabContent).toEqual(
      testTabContent('repo/src/foo.ts'),
    ),
  )
})

test('a managed chat resolves citations and images in its worktree while the editor remains at the base', async ({
  client,
  server,
}) => {
  const { application, editor } = await createMarkdownWorkspace(client, server)
  const worktreePath = 'repo/.worktrees/chat-fix'
  const worktreeRoot = path.join(server.root, worktreePath)
  await mkdir(path.join(worktreeRoot, 'src'), { recursive: true })
  await mkdir(path.join(worktreeRoot, 'assets'), { recursive: true })
  await writeFile(
    path.join(worktreeRoot, 'assets/result.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
      'base64',
    ),
  )
  await writeFile(path.join(worktreeRoot, 'src/foo.ts'), 'export const managed = true\n')
  const view = renderMarkdown(
    ':codex-file-citation{path="src/foo.ts" line_range_start="2"}\n\n![Result](assets/result.png)',
    { application, workspaceRoot: { canonicalPath: worktreeRoot, path: worktreePath } },
  )
  const file = view.getByRole('link', { name: /src\/foo\.ts/u })
  expect(file).toHaveAttribute('data-chat-file-link', `${worktreeRoot}/src/foo.ts`)
  expect(file).toHaveAttribute('title', `${worktreeRoot}/src/foo.ts:2`)
  const imageUrl = new URL(view.getByAltText('Result').getAttribute('src')!)
  expect(imageUrl.searchParams.get('path')).toBe(`${worktreePath}/assets/result.png`)
  expect(
    (await client.fs.blob.get({ query: { path: imageUrl.searchParams.get('path')! } })).status,
  ).toBe(200)
  expect(editor.workspaceStore.getState().rootFolder?.path).toBe('repo')
  await userEvent.click(file)
  await waitFor(() =>
    expect(editor.uiStore.getState().definitionTarget).toMatchObject({
      path: `${worktreePath}/src/foo.ts`,
      range: { start: { line: 1, character: 0 } },
    }),
  )
})

test('workspace markdown images use the filesystem route and have an explicit failure state', async ({
  client,
  server,
}) => {
  const { application } = await createMarkdownWorkspace(client, server)
  const view = renderMarkdown('![Result](assets/result.png)', { application })
  const image = view.getByAltText('Result')
  expect(image.getAttribute('src')).toContain('/fs/blob?path=repo%2Fassets%2Fresult.png')
  image.dispatchEvent(new Event('error'))
  await waitFor(() => expect(view.getByText('Result · Image unavailable')).toBeVisible())
})

test('an over-indented list item renders as a list, not a code block', () => {
  const { container } = renderMarkdown('-       aligned bullet\n-       second bullet\n')

  expect(container.querySelector('ul')).not.toBeNull()
  expect(container.querySelector('[data-streamdown="code-block"]')).toBeNull()
  expect(container.textContent).toContain('aligned bullet')
})

test('a streaming code block is highlighted but never cached', async () => {
  markdownHighlightCache.clear()
  const { container } = renderMarkdown('```ts\nconst answer = 42\nconst other =', {
    streaming: true,
  })

  await waitFor(
    () => {
      expect(highlightTokens(container).length).toBeGreaterThan(1)
    },
    { timeout: 5_000 },
  )
  expect(markdownHighlightCache.size).toBe(0)
  expect(container.textContent).toContain('const other =')
})

test('a completed code block is highlighted and cached', async () => {
  markdownHighlightCache.clear()
  const { container } = renderMarkdown('```ts\nconst answer = 42\n```')

  await waitFor(
    () => {
      expect(highlightTokens(container).length).toBeGreaterThan(1)
    },
    { timeout: 5_000 },
  )
  expect(markdownHighlightCache.size).toBe(1)
  expect(markdownHighlightCache.totalBytes).toBeGreaterThan(0)
})

test('a fenced block names its language and toggles wrapping on demand', async () => {
  const user = userEvent.setup()
  const { container, getByRole } = renderMarkdown('```ts\nconst answer = 42\n```')
  const block = container.querySelector('[data-streamdown="code-block"]')

  expect(header(container)?.textContent).toContain('ts')
  expect(block).toHaveAttribute('data-wrap', 'false')

  await user.click(getByRole('button', { name: 'Wrap lines' }))

  expect(block).toHaveAttribute('data-wrap', 'true')
  expect(getByRole('button', { name: 'Stop wrapping lines' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('a titled fence names the file instead of the language', () => {
  const { container } = renderMarkdown('```ts title="src/foo.ts"\nconst answer = 42\n```')

  expect(header(container)?.textContent).toContain('src/foo.ts')
})

test('gfm survives our own remark plugins', () => {
  const { container } = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n~~gone~~\n')

  expect(container.querySelector('table')).not.toBeNull()
  expect(container.querySelector('del')).not.toBeNull()
})

test('an external link carries its host chrome and its own context menu', async () => {
  const user = userEvent.setup()
  const { getByRole } = renderMarkdown('Read [the docs](https://example.com/guide).')
  const link = getByRole('link', { name: /the docs/u })

  expect(link).toHaveAttribute('href', 'https://example.com/guide')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link.querySelector('[data-chat-link-favicon="example.com"]')).not.toBeNull()

  await user.hover(link)
  expect(await screen.findByText('https://example.com/guide')).toBeInTheDocument()

  await user.pointer({ keys: '[MouseRight]', target: link })
  expect(await screen.findByRole('menuitem', { name: 'Copy Link' })).toBeInTheDocument()
})

test('a fragment link scrolls to the heading it names', async () => {
  const user = userEvent.setup()
  const { getByRole } = renderMarkdown('## Rollback Plan\n\nSee [the plan](#rollback-plan).')
  const scrolled = recordScrollIntoView()

  try {
    await user.click(getByRole('link', { name: /the plan/u }))
  } finally {
    scrolled.restore()
  }

  expect(scrolled.targets.map((element) => element.textContent)).toEqual(['Rollback Plan'])
})

test('copying a rendered selection yields markdown, not flattened text', () => {
  const { container } = renderMarkdown(
    'Read [the docs](https://example.com/guide) for **detail**.\n\n- first\n- second\n',
  )

  const markdown = serializeRenderedMarkdownFragment(
    container.querySelector('[data-chat-markdown]') as HTMLElement,
  )

  expect(markdown).toContain('[the docs](https://example.com/guide)')
  expect(markdown).toContain('**detail**')
  expect(markdown).toContain('- first\n- second')
})

function header(container: HTMLElement) {
  return container.querySelector('[data-streamdown="code-block-header"]')
}

/**
 * `scrollIntoView` is the only observable a scroll leaves behind in happy-dom,
 * so the DOM primitive is swapped for a recorder and put back afterwards.
 */
function recordScrollIntoView() {
  const targets: Element[] = []
  const original = Element.prototype.scrollIntoView

  Element.prototype.scrollIntoView = function scrollIntoViewSpy(this: Element) {
    targets.push(this)
  }

  return { restore: () => void (Element.prototype.scrollIntoView = original), targets }
}

function highlightTokens(container: HTMLElement) {
  return container.querySelectorAll('[data-streamdown="code-block-body"] code span span')
}

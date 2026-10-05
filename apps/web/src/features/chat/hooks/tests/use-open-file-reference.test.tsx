import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { vi } from 'vitest'

import { filesystemPath } from '@/lib/documents/utils/identity'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { expect, test } from '../../../../../test/fixtures'
import { testTabContent } from '../../../../../test/factories/document-targets'
import {
  createMarkdownWorkspace,
  renderMarkdown,
  renderChatWorkspaceContent,
} from '../../../../../test/factories/markdown'
import { createObservedInProcessClient } from '../../../../../test/client'
import { StackFrameLink } from '@/features/chat/components/stack-frame-link'

test('an absolute path outside the chat workspace opens relative to the server root', async ({
  client,
  server,
}) => {
  const { application, editor } = await createMarkdownWorkspace(client, server)
  await mkdir(path.join(server.root, 'tmp'), { recursive: true })
  await writeFile(path.join(server.root, 'tmp/deploy.log'), 'shutdown\n')
  const view = renderMarkdown(`See [the log](${path.join(server.root, 'tmp/deploy.log')}).`, {
    application,
    workspaceRoot: { canonicalPath: path.join(server.root, 'repo'), path: 'repo' },
  })

  await userEvent.click(view.getByRole('link', { name: /deploy\.log/u }))

  await waitFor(() =>
    expect(editor.workspaceStore.getState().selectedTabContent).toEqual(
      testTabContent('tmp/deploy.log'),
    ),
  )
  expect((await client.fs.stat.get({ query: { path: 'tmp/deploy.log' } })).data?.type).toBe('file')
})

test('a path outside the server root opens nothing and says why', async ({ client, server }) => {
  const warning = vi.spyOn(toast, 'warning')
  try {
    const { application, editor } = await createMarkdownWorkspace(client, server)
    const outside = path.join(path.dirname(server.root), 'elsewhere/notes.md')
    const view = renderMarkdown(`See [notes](${outside}).`, {
      application,
      workspaceRoot: { canonicalPath: path.join(server.root, 'repo'), path: 'repo' },
    })

    await userEvent.click(view.getByRole('link', { name: /notes\.md/u }))

    expect(warning).toHaveBeenCalledWith('That file is outside the workspace', {
      description: outside,
    })
    expect(editor.workspaceStore.getState().selectedTabContent).toBeNull()
  } finally {
    warning.mockRestore()
  }
})

test('hovering a link in the chat workspace prepares its file for the press', async ({
  client,
  server,
}) => {
  const { application, editor } = await createMarkdownWorkspace(client, server)
  const view = renderMarkdown('See [foo](src/foo.ts).', {
    application,
    workspaceRoot: { canonicalPath: path.join(server.root, 'repo'), path: 'repo' },
  })

  await userEvent.hover(view.getByRole('link', { name: /foo\.ts/u }))

  const { queryKey } = fileSnapshotQueryOptions(filesystemPath('repo/src/foo.ts'))
  await waitFor(() => expect(editor.queryClient.getQueryData(queryKey)).toBeDefined())
})

test.for(['markdown', 'stack'] as const)(
  'removing a %s element while a shared read waits prevents optional admission and preserves the query',
  async (kind, { server }) => {
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    let reads = 0
    let aborts = 0
    const client = createObservedInProcessClient(server, async (request) => {
      if (new URL(request.url).pathname !== '/fs/read') return
      reads += 1
      request.signal.addEventListener('abort', () => {
        aborts += 1
      })
      started.resolve()
      await gate.promise
    })
    const { application, editor } = await createMarkdownWorkspace(client, server)
    const workspaceRoot = { canonicalPath: path.join(server.root, 'repo'), path: 'repo' }
    const view =
      kind === 'markdown'
        ? renderMarkdown('See [foo](src/foo.ts).', { application, workspaceRoot })
        : renderChatWorkspaceContent(
            <StackFrameLink
              frame={{ path: 'src/foo.ts', line: 1, column: 1, start: 0, end: 12, external: false }}
              text='foo.ts:1:1'
            />,
            { application, workspaceRoot },
          )
    try {
      await userEvent.hover(view.getByRole('link', { name: /foo\.ts/u }))
      await started.promise
      view.rerenderContent(null)
      gate.resolve()
      const options = fileSnapshotQueryOptions(filesystemPath('repo/src/foo.ts'))
      const snapshot = await editor.queryClient.query(options)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(
        editor.fileOpenIntentOwner.service.claimReadyClean(filesystemPath('repo/src/foo.ts')),
      ).toBeNull()
      expect(editor.queryClient.getQueryData(options.queryKey)).toBe(snapshot)
      expect(reads).toBe(1)
      expect(aborts).toBe(0)
    } finally {
      gate.resolve()
      view.unmount()
    }
  },
)

test('two rendered links keep independent interests when one departs and the other stays focused', async ({
  server,
}) => {
  const started = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  let reads = 0
  const client = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/fs/read') return
    reads += 1
    started.resolve()
    await gate.promise
  })
  const { application, editor } = await createMarkdownWorkspace(client, server)
  const view = renderMarkdown('See [first](src/foo.ts) and [second](src/foo.ts).', {
    application,
    workspaceRoot: { canonicalPath: path.join(server.root, 'repo'), path: 'repo' },
  })
  try {
    const links = view.getAllByRole('link', { name: /foo\.ts/u })
    await userEvent.hover(links[0]!)
    await started.promise
    act(() => links[0]!.focus())
    await userEvent.hover(links[1]!)
    await userEvent.unhover(links[1]!)
    gate.resolve()
    const filePath = filesystemPath('repo/src/foo.ts')
    const snapshot = await editor.queryClient.query(fileSnapshotQueryOptions(filePath))
    const result: { claim: ReturnType<typeof editor.fileOpenIntentOwner.service.claimReadyClean> } =
      { claim: null }
    await waitFor(() => {
      result.claim = editor.fileOpenIntentOwner.service.claimReadyClean(filePath)
      expect(result.claim).not.toBeNull()
    })
    expect(reads).toBe(1)
    expect(editor.queryClient.getQueryData(fileSnapshotQueryOptions(filePath).queryKey)).toBe(
      snapshot,
    )
    result.claim?.preparedDocument.dispose()
  } finally {
    gate.resolve()
    view.unmount()
  }
})

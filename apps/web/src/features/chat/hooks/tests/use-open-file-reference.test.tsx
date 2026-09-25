import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { vi } from 'vitest'

import { expect, test } from '../../../../../test/fixtures'
import { testTabContent } from '../../../../../test/factories/document-targets'
import { createMarkdownWorkspace, renderMarkdown } from '../../../../../test/factories/markdown'

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

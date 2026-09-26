import { act, screen, waitFor, within } from '@testing-library/react'
import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { FilePreviewPanel } from '@/features/command-palette/components/file-preview-panel'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchTree } from '@/lib/file-server'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { createObservedInProcessClient } from '../../../../test/client'
import { installTestClient } from '../../../../test/factories/client-binding'

for (const kind of ['text', 'binary', 'missing']) {
  test(`quick open holds the filename and body until the selected head read is ready (${kind})`, async ({
    server,
  }) => {
    await writeFile(path.join(server.root, 'first.txt'), 'first_file_body\n')
    await writeFile(
      path.join(server.root, 'second.txt'),
      kind === 'binary' ? new Uint8Array([0, 1, 2]) : 'second_file_body\n',
    )
    const gate = Promise.withResolvers<void>()
    let requested = 0
    const client = createObservedInProcessClient(server, async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/fs/head' || url.searchParams.get('path') !== 'second.txt') return
      requested += 1
      await gate.promise
    })
    const restore = installTestClient(client)
    try {
      const tree = await fetchTree(filesystemPath(''), new AbortController().signal, client)
      const first = tree.entries.find((entry) => entry.name === 'first.txt')!
      const second = tree.entries.find((entry) => entry.name === 'second.txt')!
      if (kind === 'missing') await unlink(path.join(server.root, 'second.txt'))
      const view = renderWithProviders(
        <FilePreviewPanel item={{ entry: first, pathLabel: first.name }} />,
        {
          queryClient: createTestQueryClient(),
        },
      )
      await screen.findByText('first_file_body')
      const preview = screen.getByRole('region', { name: 'File preview' })
      view.rerender(<FilePreviewPanel item={{ entry: second, pathLabel: second.name }} />)
      await waitFor(() => expect(requested).toBe(1))
      expect(within(preview).getByText('first.txt')).toBeInTheDocument()
      expect(within(preview).getByText('first_file_body')).toBeInTheDocument()
      expect(within(preview).queryByText('second.txt')).not.toBeInTheDocument()
      expect(within(preview).getByRole('status', { name: 'Loading preview' })).toBeInTheDocument()
      await act(async () => {
        gate.resolve()
      })
      await within(preview).findByText(kind === 'text' ? 'second_file_body' : 'Preview unavailable')
      expect(within(preview).getByText('second.txt')).toBeInTheDocument()
      expect(within(preview).queryByText('first_file_body')).not.toBeInTheDocument()
      await waitFor(() =>
        expect(
          within(preview).queryByRole('status', { name: 'Loading preview' }),
        ).not.toBeInTheDocument(),
      )
      expect(requested).toBe(1)
      expect(
        within(preview).queryByRole('status', { name: 'Loading second.txt' }),
      ).not.toBeInTheDocument()
    } finally {
      gate.resolve()
      restore()
    }
  })
}

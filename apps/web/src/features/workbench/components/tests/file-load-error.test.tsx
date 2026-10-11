import { fireEvent, waitFor } from '@testing-library/react'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { FileLoadError } from '@/features/workbench/components/file-load-error'
import { createTestApplicationRuntime } from '../../../../../test/factories/application-runtime'
import { TestEditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { renderWithProviders } from '../../../../../test/render'
import { expect, test } from '../../../../../test/fixtures'

test.for([false, true])(
  'missing-file recovery preserves retained text, retained=%s',
  async (retained, { client, server }) => {
    void client
    const path = filesystemPath('recover.txt')
    await writeFile(join(server.root, path), 'retained text\n')
    const application = createTestApplicationRuntime()
    const { editor, queryClient } = application.getSnapshot()
    application.start()
    const query = fileSnapshotQueryOptions(path)
    if (retained) {
      const file = await queryClient.query(query)
      editor.documentStore.getState().ensureLiveEditorDocument(file)
    }
    await unlink(join(server.root, path))
    await expect(queryClient.query({ ...query, retry: false, staleTime: 0 })).rejects.toBeDefined()
    if (retained) {
      // Remounting cached presentation data cannot prove the file exists again.
      queryClient.setQueryData(query.queryKey, queryClient.getQueryData(query.queryKey))
      expect(queryClient.getQueryState(query.queryKey)?.status).toBe('success')
    }
    const rendered = renderWithProviders(
      <TestEditorStateProvider>
        <FileLoadError
          path={path}
          message='File read failed'
          hasContent={retained}
          retained={retained}
          onOpenReadOnly={() => undefined}
        />
      </TestEditorStateProvider>,
      { application, queryClient },
    )
    expect(rendered.getByRole('button', { name: 'Retry' })).toBeEnabled()
    if (retained) {
      expect(
        rendered.getByText('File missing on disk. Save to recreate it with the retained text.'),
      ).toBeInTheDocument()
      expect(
        editor.documentStore.getState().getLiveEditorDocument(fileDocumentKey(path))?.sync,
      ).toMatchObject({ orphaned: true })
      fireEvent.click(rendered.getByRole('button', { name: 'Save file' }))
    } else {
      expect(rendered.getByText('File missing on disk')).toBeInTheDocument()
      expect(
        rendered.getByText(
          'Create an empty file, restore it on disk and retry, or close this tab.',
        ),
      ).toBeInTheDocument()
      fireEvent.click(rendered.getByRole('button', { name: 'Create File' }))
    }
    await waitFor(async () =>
      expect(await readFile(join(server.root, path), 'utf8')).toBe(
        retained ? 'retained text\n' : '',
      ),
    )
    if (retained) {
      await waitFor(() =>
        expect(
          editor.documentStore.getState().getLiveEditorDocument(fileDocumentKey(path))?.sync,
        ).toMatchObject({ orphaned: false }),
      )
    }
  },
)

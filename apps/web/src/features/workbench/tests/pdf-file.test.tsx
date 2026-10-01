import { truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { waitFor } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { renderHookWithProviders } from '../../../../test/render'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { makePdf } from '../../../../test/factories/pdf'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fileSystemKeys } from '@/lib/query-keys'
import { useSelectedFile } from '@/features/workspace/hooks/use-selected-file'
import { usePdfFileSource } from '@/hooks/use-pdf-file-source'

for (const oversized of [false, true]) {
  test(`PDF selection bypasses decoded text and its size gate (oversized: ${oversized})`, async ({
    server,
    client,
  }) => {
    const path = filesystemPath('pages.PDF')
    const ascii = Uint8Array.from(makePdf(), (byte) => (byte > 127 ? 32 : byte))
    await writeFile(join(server.root, path), ascii)
    if (oversized) await truncate(join(server.root, path), 200 * 1024 * 1024 + 1)
    const { application, editor } = await createAddressTestRuntime(client)
    const queryClient = application.getSnapshot().queryClient
    const selected = renderHookWithProviders(
      () => ({
        selected: useSelectedFile(path),
        pdf: usePdfFileSource(path),
      }),
      { application, queryClient },
    )
    await waitFor(() => expect(selected.result.current.pdf.source?.kind).toBe('file'))
    expect(selected.result.current.pdf.error).toBeNull()
    expect(queryClient.getQueryState(fileSystemKeys.fileSnapshot(path))?.fetchStatus).toBe('idle')
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toBeUndefined()
    expect(editor.documentStore.getState().liveDocumentsByKey).toEqual({})
    expect(editor.documentStore.getState().dirtyDocumentKeys.size).toBe(0)
    selected.unmount()
  })
}

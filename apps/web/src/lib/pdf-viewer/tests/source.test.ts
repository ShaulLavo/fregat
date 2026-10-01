import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { QueryClient } from '@tanstack/react-query'
import { test, expect } from '../../../../test/fixtures'
import { TEST_ORIGIN } from '../../../../test/server'
import { makePdf } from '../../../../test/factories/pdf'
import { pdfBytesOptions, pdfSourceUrl } from '@/lib/pdf-viewer/source'

test('PDF bytes use the owning origin and revision, remain binary and report missing files', async ({
  server,
}) => {
  const path = join(server.root, 'sample.pdf')
  const bytes = makePdf()
  await writeFile(path, bytes)
  const source = {
    kind: 'file',
    origin: server.origin,
    path: 'sample.pdf',
    version: 'revision-a',
  } as const
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) =>
    server.app.handle(new Request(String(input), { ...init, headers: { Origin: TEST_ORIGIN } }))
  const client = new QueryClient()
  try {
    const result = await client.query(pdfBytesOptions(source, fetcher))
    expect(result.bytes).toEqual(bytes)
    expect(result.revision).not.toBe('revision-a')
    expect(
      pdfBytesOptions({ ...source, origin: 'https://remote.example/platform' }).queryKey,
    ).not.toEqual(pdfBytesOptions(source).queryKey)
    expect(pdfBytesOptions({ ...source, version: 'revision-b' }).queryKey).not.toEqual(
      pdfBytesOptions(source).queryKey,
    )
    await expect(
      client.query(pdfBytesOptions({ ...source, path: `${source.path}.missing` }, fetcher)),
    ).rejects.toMatchObject({ data: { code: 'pdf.LOAD_FAILED' } })
  } finally {
    client.clear()
  }
})

test('attachment transport derives an encoded server-owned path', () => {
  const source = {
    kind: 'attachment',
    origin: 'https://remote.example/platform/',
    attachment: {
      type: 'file',
      id: 'id/unsafe',
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 20,
    },
  } as const
  expect(pdfSourceUrl(source)).toContain('/platform/')
  expect(pdfSourceUrl(source)).toContain('id%2Funsafe.bin')
})

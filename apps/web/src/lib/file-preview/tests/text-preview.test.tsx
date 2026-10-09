import { screen } from '@testing-library/react'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { TextPreview } from '@/lib/file-preview/components/text-preview'
import { lineNumbers } from '@/lib/file-preview/utils/preview'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'

const BUDGET = 64 * 1024

test('a new preview never displays the previous file body under its name', async ({
  server,
  client: _client,
}) => {
  await writeFile(path.join(server.root, 'first.ts'), 'first_file_body')
  const queryClient = createTestQueryClient()
  const first = await queryClient.query(previewQueryOptions('first.ts', BUDGET))
  if (first.kind !== 'text') throw new RangeError('Actual text head required')
  const view = renderWithProviders(
    <TextPreview name='first.ts' read={first.read} fallback={<span>File preview</span>} />,
    { queryClient },
  )
  expect(screen.getByText('first_file_body')).toBeInTheDocument()

  view.rerender(
    <TextPreview
      name='second.json'
      read={{ kind: 'pending' }}
      fallback={<span>File preview</span>}
    />,
  )

  expect(screen.queryByText('first_file_body')).not.toBeInTheDocument()
  expect(screen.getByRole('status', { name: 'Loading second.json' })).toBeInTheDocument()
})

test('a file longer than the budget says how much of it the preview shows', async ({
  server,
  client: _client,
}) => {
  await writeFile(path.join(server.root, 'big.log'), 'a\nb\n'.repeat(314_573))
  const queryClient = createTestQueryClient()
  const big = await queryClient.query(previewQueryOptions('big.log', BUDGET))
  if (big.kind !== 'text') throw new RangeError('Actual text head required')
  renderWithProviders(<TextPreview name='big.log' read={big.read} fallback={null} />, {
    queryClient,
  })

  expect(screen.getByRole('note')).toHaveTextContent('First 64 KB of 1.2 MB')
})

test('the gutter numbers every line and no trailing empty one', () => {
  expect(lineNumbers('a\nb\n')).toBe('1\n2')
  expect(lineNumbers('a\nb')).toBe('1\n2')
  expect(lineNumbers('')).toBe('1')
})

test('the preview key changes with the budget', () => {
  expect(previewQueryOptions('a.ts', 4096).queryKey).not.toEqual(
    previewQueryOptions('a.ts', BUDGET).queryKey,
  )
})

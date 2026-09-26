import { screen } from '@testing-library/react'
import { TextPreview } from '@/lib/file-preview/components/text-preview'
import { lineNumbers, type PreviewContent } from '@/lib/file-preview/utils/preview'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'

const BUDGET = 64 * 1024

test('a new preview never displays the previous file body under its name', () => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    previewQueryOptions('first.ts', BUDGET).queryKey,
    (): PreviewContent => ({ kind: 'text', text: 'first_file_body', size: 15, truncated: false }),
  )
  const view = renderWithProviders(
    <TextPreview name='first.ts' path='first.ts' fallback={<span>File preview</span>} />,
    { queryClient },
  )
  expect(screen.getByText('first_file_body')).toBeInTheDocument()

  view.rerender(
    <TextPreview name='second.json' path='second.json' fallback={<span>File preview</span>} />,
  )

  expect(screen.queryByText('first_file_body')).not.toBeInTheDocument()
  expect(screen.getByText('File preview')).toBeInTheDocument()
})

test('a file longer than the budget says how much of it the preview shows', () => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(previewQueryOptions('big.log', BUDGET).queryKey, (): PreviewContent => ({
    kind: 'text',
    text: 'a\nb\n',
    size: 1_258_291,
    truncated: true,
  }))
  renderWithProviders(<TextPreview name='big.log' path='big.log' fallback={null} />, {
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

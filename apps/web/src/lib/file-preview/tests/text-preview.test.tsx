import { screen } from '@testing-library/react'
import { TextPreview } from '@/lib/file-preview/components/text-preview'
import type { PreviewContent } from '@/lib/file-preview/utils/preview'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'

test('a new preview never displays the previous file body under its name', () => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(previewQueryOptions('first.ts').queryKey, (): PreviewContent => ({
    kind: 'text',
    text: 'first_file_body',
  }))
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

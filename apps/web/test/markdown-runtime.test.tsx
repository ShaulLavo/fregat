import { screen } from '@testing-library/react'

import { AssistantMarkdown } from '@/features/chat/components/assistant-markdown'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { chatMarkdownQueryOptions } from '@/features/chat/state/markdown-session'
import { expect, test } from './fixtures'
import { TestEditorStateProvider } from './factories/editor-state-provider'
import { renderWithProviders } from './render'

test('the DOM environment loads the real chat parser and settles its loading view', async () => {
  resourceQueryClient.removeQueries({ queryKey: chatMarkdownQueryOptions().queryKey, exact: true })
  renderWithProviders(
    <TestEditorStateProvider>
      <AssistantMarkdown text={'# Parsed heading\n\nA **formatted** answer.'} />
    </TestEditorStateProvider>,
  )

  expect(screen.getByLabelText('Loading message renderer')).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Parsed heading' })).toBeInTheDocument()
  expect(screen.getByText('formatted', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Loading message renderer')).not.toBeInTheDocument()
  expect(screen.queryByText('Unable to load message renderer')).not.toBeInTheDocument()
})

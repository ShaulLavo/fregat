import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ChatInputAttachmentList } from '@/features/chat/components/chat-input-attachment-list'
import type { ChatInputAttachment } from '@/features/chat/state/chat-input-draft-store'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

function stagedImage(id: string, name: string): ChatInputAttachment {
  return {
    dataUrl: PNG_DATA_URL,
    id,
    mimeType: 'image/png',
    name,
    previewUrl: PNG_DATA_URL,
    sizeBytes: 2_048,
    type: 'image',
  }
}

test('a staged image opens full size before it is ever sent', async () => {
  const user = userEvent.setup()
  renderWithProviders(
    <ChatInputAttachmentList
      attachments={[stagedImage('image-1', 'shot.png'), stagedImage('image-2', 'diagram.png')]}
      disabled={false}
      onRemove={() => undefined}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Open shot.png' }))

  expect(await screen.findByAltText('shot.png')).toHaveAttribute('src', PNG_DATA_URL)

  await user.click(screen.getByRole('button', { name: 'Next image' }))

  expect(await screen.findByAltText('diagram.png')).toBeInTheDocument()
})

test('removing an attachment is still reachable beside the preview', async () => {
  const removed: string[] = []
  const user = userEvent.setup()
  renderWithProviders(
    <ChatInputAttachmentList
      attachments={[stagedImage('image-1', 'shot.png')]}
      disabled={false}
      onRemove={(id) => removed.push(id)}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Remove shot.png' }))

  expect(removed).toEqual(['image-1'])
})

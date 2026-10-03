import { EditorHost, useEditor } from '@singapore-editor/react'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { useEditorFocusTarget } from '@/lib/focus/hooks/use-editor-target'
import { FocusService } from '@/lib/focus/state/service'

const id = { key: 'preparing.md', kind: 'editor', surface: 'document' } as const

test('holds queued editor focus until its visible host is ready', async () => {
  const service = new FocusService()
  const view = renderWithProviders(<PreparedEditor ready={false} />, {
    command: false,
    focusService: service,
  })
  const ticket = service.request({
    kind: 'match',
    matches: (target) => target.id.kind === 'editor' && target.id.key === id.key,
  })
  expect(service.getSnapshot().requested?.attemptedTarget).toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Editor input')
  view.rerender(<PreparedEditor ready />)
  await expect(ticket.completion).resolves.toEqual({ status: 'acknowledged', targetId: id })
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Editor input')
})

function PreparedEditor({ ready }: { readonly ready: boolean }) {
  const controller = useEditor({ document: { text: '# Preparing', documentId: id.key } })
  const { ref: targetRef } = useEditorFocusTarget({
    controller,
    enabled: ready,
    id,
    writable: true,
  })
  return (
    <div ref={targetRef}>
      <EditorHost controller={controller} />
    </div>
  )
}

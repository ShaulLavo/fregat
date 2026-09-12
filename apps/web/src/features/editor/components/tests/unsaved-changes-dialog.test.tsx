import { testTabContent } from '../../../../../test/factories/document-targets'
import { renderWithProviders } from '../../../../../test/render'
import { screen } from '@testing-library/react'
import { vi } from 'vitest'

import { UnsavedChangesDialog } from '@/features/editor/components/unsaved-changes-dialog'
import type { UnsavedDialogTarget } from '@/features/editor/hooks/use-dirty-tab-close'
import { FocusService, focusTargetById } from '@/lib/focus/state/service'

import { expect, test } from '../../../../../test/fixtures'

test('acknowledges the exact pending close target after the popup receives focus', async () => {
  const service = new FocusService()
  const dialogTarget = {} as UnsavedDialogTarget
  const targetId = { dialogTarget, kind: 'unsaved-dialog' } as const
  const ticket = service.request(focusTargetById(targetId))

  renderWithProviders(
    <UnsavedChangesDialog
      canSave
      error={null}
      open
      content={testTabContent('/repo/src/dirty.ts')}
      saving={false}
      target={dialogTarget}
      onCancel={vi.fn()}
      onDiscard={vi.fn()}
      onOpenChange={vi.fn()}
      onSave={vi.fn()}
    />,
    { focusService: service },
  )

  await expect(ticket.completion).resolves.toEqual({
    status: 'acknowledged',
    targetId,
  })
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
})

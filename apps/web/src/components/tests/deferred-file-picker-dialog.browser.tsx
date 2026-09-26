import '@workspace/ui/globals.css'
import { cleanup } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'

import { DeferredFilePickerDialog } from '@/components/deferred-file-picker-dialog'
import { filePickerDialogQueryOptions } from '@/features/file-picker/utils/dialog-query'
import { holdDeferredDialog, loadDeferredDialogs, renderWithProviders } from '../../../test/render'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofKeyPress: (input: { readonly key: string }) => Promise<void>
  }
}

afterEach(cleanup)

test('a picker opened before its module loads hands focus on and returns it to the opener', async () => {
  await loadDeferredDialogs()
  const release = holdDeferredDialog(
    filePickerDialogQueryOptions.queryKey,
    () => import('@/components/file-picker-dialog'),
  )
  renderWithProviders(<PickerOpener />)
  const opener = document.querySelector<HTMLButtonElement>('[data-picker-opener]')!

  opener.focus()
  opener.click()
  const shell = await dialog()
  await expect.poll(() => shell.contains(document.activeElement)).toBe(true)
  await commands.proofKeyPress({ key: 'Escape' })

  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
  await expect.poll(() => document.activeElement).toBe(opener)

  opener.click()
  await dialog()
  release()

  await expect.poll(() => document.activeElement?.getAttribute('placeholder')).toBe('Search files')
  await commands.proofKeyPress({ key: 'Escape' })

  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
  await expect.poll(() => document.activeElement).toBe(opener)
})

function PickerOpener() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button data-picker-opener onClick={() => setOpen(true)} type='button'>
        Open
      </button>
      <DeferredFilePickerDialog
        mode='file'
        onOpenChange={setOpen}
        onPick={() => {}}
        open={open}
        value={null}
      />
    </>
  )
}

async function dialog() {
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeTruthy()
  return document.querySelector<HTMLElement>('[role="dialog"]')!
}

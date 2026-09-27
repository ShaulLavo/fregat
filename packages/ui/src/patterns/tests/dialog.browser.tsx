import '@workspace/ui/globals.css'
import { afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@workspace/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { TooltipLayer } from '@workspace/ui/patterns/tooltip-layer'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function Example({ defaultOpen = false, action = false }) {
  return (
    <>
      <TooltipLayer />
      <Dialog defaultOpen={defaultOpen}>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Details</DialogTitle>
          {action && <Button data-tooltip='Apply changes'>Apply</Button>}
        </DialogContent>
      </Dialog>
    </>
  )
}

it('closes on the first Escape after initial focus lands on the close button', async () => {
  cleanups.push(mount(<Example />).unmount)
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: 'Close', exact: true })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Open dialog' })).toHaveFocus()
})

it('closes an initially open dialog with one Escape', async () => {
  cleanups.push(mount(<Example defaultOpen />).unmount)
  await expect.element(page.getByRole('button', { name: 'Close', exact: true })).toHaveFocus()
  await expect.element(page.getByText('Close', { exact: true })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
})

it('keeps the close tooltip on hover and the close button clickable', async () => {
  cleanups.push(mount(<Example />).unmount)
  await page.getByRole('button', { name: 'Open dialog' }).click()
  const close = page.getByRole('button', { name: 'Close', exact: true })
  await close.hover()
  await expect.element(page.getByText('Close', { exact: true })).toBeVisible()
  await close.click()
  await expect.element(page.getByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
})

it('gives Escape to a nested menu before the dialog', async () => {
  cleanups.push(
    mount(
      <>
        <TooltipLayer />
        <Dialog defaultOpen>
          <DialogTrigger>Open dialog</DialogTrigger>
          <DialogContent>
            <DialogTitle>Details</DialogTitle>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button />}>Options</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Sample action</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </DialogContent>
        </Dialog>
      </>,
    ).unmount,
  )
  await page.getByRole('button', { name: 'Options' }).click()
  await expect.element(page.getByRole('menuitem', { name: 'Sample action' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('menuitem', { name: 'Sample action' }))
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('dialog', { name: 'Details' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
})

it('keeps tooltips when tabbing within the dialog, including delegated controls', async () => {
  cleanups.push(mount(<Example action />).unmount)
  await page.getByRole('button', { name: 'Open dialog' }).hover()
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('button', { name: 'Apply', exact: true })).toHaveFocus()
  await userEvent.tab()
  await expect.element(page.getByText('Close', { exact: true })).toBeVisible()
  await userEvent.tab({ shift: true })
  await expect.element(page.getByText('Apply changes', { exact: true })).toBeVisible()
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: 'Close', exact: true })).toHaveFocus()
  await expect.element(page.getByText('Close', { exact: true })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByText('Close', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('dialog', { name: 'Details' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
})

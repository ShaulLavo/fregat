import { FolderIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Kbd } from '@workspace/ui/components/kbd'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@workspace/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@workspace/ui/components/context-menu'

/** Mixed icon and text rows expose the shared overlay columns at either density. */
export function OverlaysTab() {
  return (
    <div
      className='mx-auto flex max-w-xl flex-col gap-(--density-section-gap) p-(--density-section-padding)'
      data-overlay-gallery
    >
      <h1 className='text-sm font-semibold'>Overlay alignment</h1>
      <p className='text-muted-foreground text-xs'>
        Compare menu labels, shortcut chips, and dialog edges.
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button />}>Alignment menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem inset={false}>
            <FolderIcon />
            <span>Icon action</span>
            <Kbd className='ml-auto'>⌘O</Kbd>
          </DropdownMenuItem>
          <DropdownMenuItem inset>
            <span>Text action</span>
            <Kbd className='ml-auto'>⌘P</Kbd>
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem checked inset>
            <span>Checked action</span>
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ContextMenu>
        <ContextMenuTrigger render={<Button />}>Alignment context menu</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem inset={false}>
            <FolderIcon />
            <span>Icon action</span>
            <Kbd className='ml-auto'>⌘O</Kbd>
          </ContextMenuItem>
          <ContextMenuItem inset>
            <span>Text action</span>
            <Kbd className='ml-auto'>⌘P</Kbd>
          </ContextMenuItem>
          <ContextMenuCheckboxItem checked inset>
            <span>Checked action</span>
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog>
        <DialogTrigger render={<Button />}>Alignment dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aligned dialog</DialogTitle>
            <DialogDescription>Header and body share the same start edge.</DialogDescription>
          </DialogHeader>
          <p>Footer controls meet the body’s end edge.</p>
          <DialogFooter>
            <Button>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

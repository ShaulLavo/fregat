import { parsePalette, type Palette } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { Textarea } from '@workspace/ui/components/textarea'
import { useState } from 'react'
import * as v from 'valibot'

/** Paste a palette document. Hex is fine; the server writes it back as oklch. */
export function PaletteImportDialog({
  onCancel,
  onImport,
  open,
  pending,
  taken,
}: {
  readonly onCancel: () => void
  readonly onImport: (palette: Palette) => void
  readonly open: boolean
  readonly pending: boolean
  readonly taken: readonly string[]
}) {
  const [text, setText] = useState('')
  const parsed = parseDocument(text, taken)

  return (
    <Dialog onOpenChange={(next) => next || onCancel()} open={open}>
      <DialogContent className='w-[34rem] max-w-[calc(100vw-2rem)]'>
        <DialogHeader>
          <DialogTitle>Import palette</DialogTitle>
          <DialogDescription>
            Paste a palette JSON document. Colors may be hex, rgb(), hsl() or oklch().
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-invalid={text.trim() !== '' && parsed.kind === 'invalid' ? true : undefined}
          aria-label='Palette JSON'
          className='h-56 font-mono text-xs'
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          value={text}
        />
        {parsed.kind === 'invalid' && text.trim() !== '' ? (
          <p className='text-destructive text-xs' role='alert'>
            {parsed.reason}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={onCancel} type='button' variant='outline'>
            Cancel
          </Button>
          <Button
            disabled={pending || parsed.kind !== 'ready'}
            onClick={() => {
              if (parsed.kind === 'ready') onImport(parsed.palette)
            }}
            type='button'
          >
            {pending ? <OrbitLoader /> : null}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ParsedDocument =
  | { readonly kind: 'ready'; readonly palette: Palette }
  | { readonly kind: 'invalid'; readonly reason: string }

function parseDocument(text: string, taken: readonly string[]): ParsedDocument {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { kind: 'invalid', reason: 'Not valid JSON.' }
  }

  const result = parsePalette(json, 'user')
  if (!result.success) return { kind: 'invalid', reason: v.summarize(result.issues) }
  if (taken.includes(result.palette.id)) {
    return { kind: 'invalid', reason: `A palette named ${result.palette.id} already exists.` }
  }

  return { kind: 'ready', palette: result.palette }
}

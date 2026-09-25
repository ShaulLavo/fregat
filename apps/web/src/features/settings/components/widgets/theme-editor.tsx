import { useContext, useEffect, useState } from 'react'
import type { ColorMode, ThemeDocument } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { ThemeVariantEditor } from '@/features/settings/components/widgets/theme-variant-editor'
import { BundleContext } from '@/lib/appearance/providers/bundle-context'
import { previewBundle } from '@/features/settings/utils/bundle-editing'
import { InlineError } from '@/components/inline-error'

export function ThemeEditor({
  initial,
  onClose,
  onSave,
  pending,
  error,
}: {
  initial: ThemeDocument
  onClose: () => void
  onSave: (document: ThemeDocument) => void
  pending: boolean
  error: string | null
}) {
  const [document, setDocument] = useState(initial)
  const [mode, setMode] = useState<ColorMode>('light')
  const preview = useContext(BundleContext)
  const clear = preview?.clear
  useEffect(() => () => clear?.(), [clear])
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Create a theme bundle</DialogTitle>
          <DialogDescription>
            Choose each version independently. Your colors, code and wallpaper switch together.
          </DialogDescription>
        </DialogHeader>
        <label className='text-xs font-medium' htmlFor='theme-bundle-name'>
          Name
        </label>
        <Input
          id='theme-bundle-name'
          autoFocus
          value={document.name}
          maxLength={80}
          onChange={(event) => setDocument({ ...document, name: event.target.value })}
        />
        <div className='flex gap-2' aria-label='Edit theme variant'>
          {(['light', 'dark'] as const).map((variant) => (
            <Button
              key={variant}
              variant='outline'
              aria-pressed={mode === variant}
              className='aria-pressed:bg-accent'
              onClick={() => setMode(variant)}
            >
              {variant === 'light' ? 'Light version' : 'Dark version'}
            </Button>
          ))}
        </div>
        <ThemeVariantEditor
          mode={mode}
          value={document.variants[mode]}
          disabled={pending}
          onChange={(variant) =>
            setDocument({ ...document, variants: { ...document.variants, [mode]: variant } })
          }
        />
        {error ? <InlineError message={error} title='Theme editor' /> : null}
        <DialogFooter>
          <Button variant='outline' onClick={() => preview?.preview(previewBundle(document), mode)}>
            Preview
          </Button>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || !document.name.trim()} onClick={() => onSave(document)}>
            {pending ? <OrbitLoader /> : null}Save and apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

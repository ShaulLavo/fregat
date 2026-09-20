import { useSettingValue } from '@/hooks/use-setting-value'
import { useTheme } from '@/features/settings/hooks/use-theme'
import { PlusIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { paletteSupportsMode, type Palette } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { useState } from 'react'
import { toast } from 'sonner'

import { PaletteCard } from '@/features/settings/components/widgets/palette-card'
import { PaletteCardMenu } from '@/features/settings/components/widgets/palette-card-menu'
import {
  PaletteEditor,
  type PaletteEditorTarget,
} from '@/features/settings/components/widgets/palette-editor'
import { PaletteImportDialog } from '@/features/settings/components/widgets/palette-import-dialog'
import { PaletteNameDialog } from '@/features/settings/components/widgets/palette-name-dialog'
import { usePaletteActions } from '@/features/settings/hooks/use-palette-actions'
import { duplicatePalette, paletteIdFromName } from '@/features/settings/utils/palette-editing'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { errorMessage } from '@/lib/error-message'

/**
 * The gallery: every palette as a card, the current one marked. Keyboard
 * focus previews; click applies through the settings pipeline.
 */
export function PaletteWidget({
  disabled,
  value,
}: {
  readonly disabled: boolean
  readonly id: string
  readonly value: string
}) {
  const { catalog, clearPalettePreview, previewPalette, selectPalette } = usePalette()
  const { create, remove } = usePaletteActions()
  const [editor, setEditor] = useState<PaletteEditorTarget | null>(null)
  const [copySource, setCopySource] = useState<Palette | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const bundle = useSettingValue('workbench.theme')
  const { resolvedTheme } = useTheme()
  const choices = bundle
    ? catalog.filter((palette) => paletteSupportsMode(palette, resolvedTheme))
    : catalog
  const taken = catalog.map((palette) => palette.id)
  const current = catalog.find((palette) => palette.id === value)

  const startCopy = (name: string) => {
    if (!copySource) return
    const copy = duplicatePalette(copySource, paletteIdFromName(name, taken), name)
    setCopySource(null)
    setEditor({ kind: 'create', palette: copy })
  }

  const deletePalette = (palette: Palette) => {
    remove.mutate(palette.id, {
      onError: (error) =>
        toast.error(`Could not delete ${palette.name}`, {
          description: errorMessage(error, 'The palette library did not accept it.'),
        }),
    })
  }

  const importPalette = (palette: Palette) => {
    create.mutate(palette, {
      onError: (error) =>
        toast.error(`Could not import ${palette.name}`, {
          description: errorMessage(error, 'The palette library did not accept it.'),
        }),
      onSuccess: () => setImportOpen(false),
    })
  }

  return (
    <div className='flex w-full min-w-0 flex-col gap-(--density-control-gap)'>
      <div
        aria-label='App colors'
        className='grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2'
        role='radiogroup'
      >
        {choices.map((palette) => (
          <PaletteCard
            disabled={disabled}
            key={palette.id}
            menu={
              <PaletteCardMenu
                disabled={disabled}
                onCopy={() => setCopySource(palette)}
                onDelete={() => deletePalette(palette)}
                onEdit={() => setEditor({ kind: 'update', palette })}
                palette={palette}
              />
            }
            onPreview={() => previewPalette(palette)}
            onPreviewEnd={clearPalettePreview}
            onSelect={() => selectPalette(palette.id, 'settings.palette-gallery')}
            palette={palette}
            selected={palette.id === value}
          />
        ))}
      </div>
      <div className='flex flex-wrap gap-(--density-control-gap)'>
        <Button
          disabled={disabled || !current}
          onClick={() => setCopySource(current ?? null)}
          size='sm'
          type='button'
          variant='outline'
        >
          <PlusIcon data-icon='inline-start' />
          New from current
        </Button>
        <Button
          disabled={disabled}
          onClick={() => setImportOpen(true)}
          size='sm'
          type='button'
          variant='outline'
        >
          <UploadSimpleIcon data-icon='inline-start' />
          Import JSON
        </Button>
      </div>
      <PaletteNameDialog
        initialName={copySource ? `${copySource.name} copy` : ''}
        onCancel={() => setCopySource(null)}
        onSubmit={startCopy}
        open={copySource !== null}
        sourceName={copySource?.name ?? ''}
      />
      <PaletteEditor onClose={() => setEditor(null)} target={editor} />
      <PaletteImportDialog
        onCancel={() => setImportOpen(false)}
        onImport={importPalette}
        open={importOpen}
        pending={create.isPending}
        taken={taken}
      />
    </div>
  )
}

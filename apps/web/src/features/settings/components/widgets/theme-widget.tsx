import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { useContext, useEffect, useRef, useState } from 'react'
import { jsonEqual, themeVariants, type ThemeDocument } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { Spinner } from '@workspace/ui/components/spinner'
import { toast } from 'sonner'
import { ThemeCard } from '@/features/settings/components/widgets/theme-card'
import { ThemeEditor } from '@/features/settings/components/widgets/theme-editor'
import { useBundleLibrary } from '@/features/settings/hooks/use-bundle-library'
import { useBundleActions } from '@/features/settings/hooks/use-bundle-actions'
import { useBundleExport } from '@/features/settings/hooks/use-bundle-export'
import { usePaletteCatalog } from '@/features/settings/hooks/use-palette-catalog'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { BundlePreviewContext } from '@/features/settings/providers/appearance-preview-context'
import { newThemeDocument } from '@/features/settings/utils/bundle-editing'
import { errorMessage } from '@/lib/error-message'

export function ThemeWidget({ disabled }: { disabled: boolean }) {
  const library = useBundleLibrary()
  const palettes = usePaletteCatalog()
  const actions = useBundleActions()
  const exportBundle = useBundleExport()
  const { selectBundle, resetBundle } = useSettingsActions()
  const projection = useSettingsProjection()
  const preview = useContext(BundlePreviewContext)
  const clear = preview?.clear
  const [editing, setEditing] = useState<ThemeDocument | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => clear?.(), [clear])
  const values = projection?.values
  const selected = values?.['workbench.theme']
  const customizations = values?.['workbench.theme.customizations'] ?? {}
  const fail = (error: unknown) =>
    toast.error(errorMessage(error, 'The theme library could not complete this action.'))
  return (
    <div className='flex w-full min-w-0 flex-col gap-3' aria-label='Theme bundles'>
      <div className='text-muted-foreground flex h-(--bar-height) items-center gap-2 px-(--bar-padding-x) text-xs'>
        {library.isPending ? <OrbitLoader label='Loading your theme bundles' /> : null}
        <span className='tabular-nums'>{library.catalog.length} bundles</span>
      </div>
      {library.error ? (
        <p className='text-destructive text-xs' role='alert'>
          {errorMessage(library.error, 'Could not load your theme library.')}
        </p>
      ) : null}
      <div className='grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3'>
        {library.catalog.map((theme) => {
          const variants = themeVariants(theme, customizations)
          return (
            <ThemeCard
              key={theme.id}
              theme={{ ...theme, variants }}
              palettes={palettes}
              disabled={disabled}
              selected={selected?.id === theme.id}
              customized={!jsonEqual(variants, theme.variants)}
              onPreview={() => preview?.preview(theme)}
              onClear={() => preview?.clear()}
              onSelect={() => {
                selectBundle(theme)
                preview?.clear()
              }}
            />
          )
        })}
      </div>
      <p className='text-muted-foreground text-xs'>
        Choose a bundle, then adjust the controls below to customize its current version.
      </p>
      <div className='flex flex-wrap gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={disabled || !values}
          onClick={() => {
            if (values) {
              actions.create.reset()
              setEditing(newThemeDocument(values))
            }
          }}
        >
          New from current
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={disabled || !selected}
          onClick={() => selected && resetBundle(selected.id)}
        >
          Use theme defaults
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={!selected}
          onClick={() => selected && void exportBundle(selected.id).catch(fail)}
        >
          Export theme
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={disabled || actions.importArchive.isPending}
          onClick={() => input.current?.click()}
        >
          {actions.importArchive.isPending ? <Spinner /> : null}Import theme
        </Button>
        {selected?.source === 'user' ? (
          <Button
            variant='outline'
            size='sm'
            disabled={disabled || actions.remove.isPending}
            onClick={() => actions.remove.mutate(selected.id, { onError: fail })}
          >
            {actions.remove.isPending ? <Spinner /> : null}Delete theme
          </Button>
        ) : null}
        <Select
          value={null}
          disabled={disabled || actions.importOmarchy.isPending}
          onValueChange={(name) => {
            if (name)
              actions.importOmarchy.mutate(name, {
                onError: fail,
                onSuccess: ({ theme }) => selectBundle(theme),
              })
          }}
        >
          <SelectTrigger aria-label='Import Omarchy theme'>
            <SelectValue>
              {actions.importOmarchy.isPending ? <Spinner /> : 'Import from Omarchy'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='tokyo-night'>Tokyo Night</SelectItem>
            <SelectItem value='rose-pine'>Rosé Pine</SelectItem>
            <SelectItem value='catppuccin'>Catppuccin</SelectItem>
            <SelectItem value='gruvbox'>Gruvbox</SelectItem>
          </SelectContent>
        </Select>
        <Input
          ref={input}
          type='file'
          className='hidden'
          aria-label='Import theme archive'
          accept='.json,application/json'
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file)
              actions.importArchive.mutate(file, {
                onError: fail,
                onSuccess: (theme) => selectBundle(theme),
              })
            event.target.value = ''
          }}
        />
      </div>
      {editing ? (
        <ThemeEditor
          initial={editing}
          pending={actions.create.isPending}
          error={
            actions.create.error
              ? errorMessage(actions.create.error, 'Could not save theme.')
              : null
          }
          onClose={() => {
            setEditing(null)
            preview?.clear()
          }}
          onSave={(document) =>
            actions.create.mutate(document, {
              onSuccess: (theme) => {
                selectBundle(theme)
                setEditing(null)
                preview?.clear()
              },
            })
          }
        />
      ) : null}
    </div>
  )
}

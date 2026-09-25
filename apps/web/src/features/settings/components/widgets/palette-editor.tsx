import {
  paletteColorsFor,
  TERMINAL_COLOR_ROLES,
  type ColorMode,
  type Oklch,
  type Palette,
} from '@workspace/contracts'
import { CaretDownIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import { useEffect, useState } from 'react'

import { ColorField } from '@/features/settings/components/widgets/color-field'
import { PaletteContrast } from '@/features/settings/components/widgets/palette-contrast'
import { usePaletteActions } from '@/features/settings/hooks/use-palette-actions'
import {
  APP_ROLES_IN_ORDER,
  appRoleLabel,
  deriveFromAccent,
  deriveFromBackground,
  editableModes,
  renamePalette,
  setPaletteColor,
  TERMINAL_ROLE_LABELS,
  type ColorGroup,
} from '@/features/settings/utils/palette-editing'
import { useTheme } from '@/features/settings/hooks/use-theme'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

export type PaletteEditorTarget = {
  readonly palette: Palette
  /** `create` for a fresh copy; `update` rewrites the user palette in place. */
  readonly kind: 'create' | 'update'
}

/**
 * Edits a draft with Apply and Cancel. Every change repaints the app through
 * the palette preview and nothing touches settings until Apply.
 */
export function PaletteEditor({
  onClose,
  target,
}: {
  readonly onClose: () => void
  readonly target: PaletteEditorTarget | null
}) {
  return (
    <Dialog onOpenChange={(next) => next || onClose()} open={target !== null}>
      {target ? <PaletteEditorBody onClose={onClose} target={target} /> : null}
    </Dialog>
  )
}

function PaletteEditorBody({
  onClose,
  target,
}: {
  readonly onClose: () => void
  readonly target: PaletteEditorTarget
}) {
  const { clearPalettePreview, paletteId, previewPalette, selectPalette } = usePalette()
  const { resolvedTheme } = useTheme()
  const { create, update } = usePaletteActions()
  const [draft, setDraft] = useState(target.palette)
  // Start on the mode that is on screen, so the first edit is visible.
  const [mode, setMode] = useState<ColorMode>(() => initialMode(target.palette, resolvedTheme))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const colors = paletteColorsFor(draft, mode)
  const saving = create.isPending || update.isPending

  useEffect(() => {
    previewPalette(draft)
  }, [draft, previewPalette])

  useEffect(() => clearPalettePreview, [clearPalettePreview])

  const setColor = (group: ColorGroup, role: string) => (color: Oklch) =>
    setDraft((current) => setPaletteColor(current, mode, group, role, color))
  const setBackground = (color: Oklch) =>
    setDraft((current) => replaceColors(current, mode, deriveFromBackground(colors, color)))
  const setAccent = (color: Oklch) =>
    setDraft((current) => replaceColors(current, mode, deriveFromAccent(colors, color)))

  const apply = async () => {
    try {
      if (target.kind === 'create') await create.mutateAsync(draft)
      else await update.mutateAsync(draft)
      clearPalettePreview()
      if (draft.id !== paletteId) selectPalette(draft.id, 'settings.palette-editor')
      onClose()
    } catch (error) {
      toastError('Could not save the palette', {
        description: errorMessage(error, 'The palette library did not accept it.'),
      })
    }
  }

  return (
    // `--available-height` is a positioned-popup variable and undefined on a
    // dialog, so the cap is the viewport; the body scrolls, header and footer stay.
    <DialogContent className='flex max-h-[calc(100dvh-4rem)] w-[34rem] max-w-[calc(100vw-2rem)] flex-col'>
      <DialogHeader>
        <DialogTitle>{target.kind === 'create' ? 'New palette' : 'Customize palette'}</DialogTitle>
        <DialogDescription>
          Changes preview live. Nothing is saved until you apply.
        </DialogDescription>
      </DialogHeader>
      <div className='flex min-h-0 flex-1 flex-col gap-(--density-section-gap) overflow-y-auto pr-1'>
        <label className='flex items-center justify-between gap-2 text-xs' htmlFor='palette-name'>
          <span className='text-muted-foreground'>Name</span>
          <Input
            className='w-56'
            id='palette-name'
            onChange={(event) => setDraft((current) => renamePalette(current, event.target.value))}
            value={draft.name}
          />
        </label>
        <ModeSwitch modes={editableModes(draft)} onChange={setMode} value={mode} />
        <ColorField
          id='palette-background'
          label='Background'
          onChange={setBackground}
          value={colors.app.background}
        />
        <ColorField
          id='palette-accent'
          label='Accent'
          onChange={setAccent}
          value={colors.app.primary}
        />
        <p className='text-muted-foreground text-2xs'>
          Background sets the surfaces, ink and dividers. Accent sets the primary action and ring.
        </p>
        <Collapsible onOpenChange={setAdvancedOpen} open={advancedOpen}>
          <CollapsibleTrigger
            render={<Button className='w-full justify-between' size='sm' variant='ghost' />}
          >
            Advanced
            <CaretDownIcon className={advancedOpen ? 'rotate-180' : undefined} />
          </CollapsibleTrigger>
          <CollapsibleContent className='flex flex-col gap-(--density-section-gap) pt-2'>
            <h3 className='text-sm font-semibold'>App colors</h3>
            {APP_ROLES_IN_ORDER.map((role) => (
              <ColorField
                id={`palette-app-${role}`}
                key={role}
                label={appRoleLabel(role)}
                onChange={setColor('app', role)}
                value={colors.app[role]}
              />
            ))}
            <h3 className='text-sm font-semibold'>Terminal colors</h3>
            {TERMINAL_COLOR_ROLES.map((role) => (
              <ColorField
                id={`palette-terminal-${role}`}
                key={role}
                label={TERMINAL_ROLE_LABELS[role]}
                onChange={setColor('terminal', role)}
                value={colors.terminal[role]}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
        <PaletteContrast colors={colors} />
      </div>
      <DialogFooter>
        <Button onClick={onClose} type='button' variant='outline'>
          Cancel
        </Button>
        <Button
          disabled={saving || draft.name.trim() === ''}
          onClick={() => void apply()}
          type='button'
        >
          {saving ? <Spinner /> : null}
          Apply
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function ModeSwitch({
  modes,
  onChange,
  value,
}: {
  readonly modes: readonly ColorMode[]
  readonly onChange: (mode: ColorMode) => void
  readonly value: ColorMode
}) {
  if (modes.length < 2) {
    return (
      <p className='text-muted-foreground text-xs'>This palette is {modes[0] ?? value} only.</p>
    )
  }

  return (
    <div className='flex gap-1' role='radiogroup' aria-label='Editing mode'>
      {modes.map((mode) => (
        <Button
          aria-checked={mode === value}
          className={mode === value ? 'bg-accent' : undefined}
          key={mode}
          onClick={() => onChange(mode)}
          role='radio'
          size='sm'
          type='button'
          variant='ghost'
        >
          {mode === 'dark' ? 'Dark' : 'Light'}
        </Button>
      ))}
    </div>
  )
}

function initialMode(palette: Palette, onScreen: ColorMode): ColorMode {
  const modes = editableModes(palette)

  return modes.includes(onScreen) ? onScreen : (modes[0] ?? onScreen)
}

function replaceColors(
  palette: Palette,
  mode: ColorMode,
  colors: ReturnType<typeof paletteColorsFor>,
): Palette {
  const { variants } = palette
  if (variants.kind === 'single') return { ...palette, variants: { ...variants, colors } }

  return { ...palette, variants: { ...variants, [mode]: colors } }
}

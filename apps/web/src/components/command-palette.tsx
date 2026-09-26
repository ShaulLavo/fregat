import { useQuery } from '@tanstack/react-query'
import { CommandDialog, CommandInput } from '@workspace/ui/components/command'
import { Spinner } from '@workspace/ui/components/spinner'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import { ModuleLoadError } from '@/components/module-load-error'
import { paletteContentQueryOptions } from '@/features/command-palette/utils/content-query'
import { useCommand } from '@/keymap/hooks/use-command'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function CommandPalette() {
  const { paletteOpen, paletteSearch, setPaletteOpen, setPaletteSearch } = useCommand()
  const query = useQuery(
    { ...paletteContentQueryOptions, enabled: paletteOpen },
    resourceQueryClient,
  )
  if (!paletteOpen) return null
  if (query.isSuccess) {
    const { CommandPaletteContent } = query.data
    return (
      <RenderErrorBoundary label='command palette'>
        <CommandPaletteContent />
      </RenderErrorBoundary>
    )
  }

  return (
    // The command provider restores the palette's origin, as it does for the loaded palette.
    <CommandDialog finalFocus={false} open onOpenChange={setPaletteOpen}>
      <CommandInput
        autoFocus
        placeholder='Search…'
        value={paletteSearch}
        onValueChange={setPaletteSearch}
      />
      {query.isPending ? (
        <Spinner
          className='mx-auto my-(--density-section-padding)'
          size='md'
          label='Loading commands'
        />
      ) : (
        <ModuleLoadError label='commands' onRetry={() => void query.refetch()} />
      )}
    </CommandDialog>
  )
}

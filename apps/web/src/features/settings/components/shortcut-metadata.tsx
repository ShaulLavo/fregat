import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import type { PlatformName } from '@workspace/client-core/commands/chord'
import type { KeybindingPreset } from '@workspace/client-core/commands/metadata'
import { UnmappedShortcuts } from '@/features/settings/components/unmapped-shortcuts'
import type { useShortcutMetadata } from '@/features/settings/hooks/use-shortcut-metadata'

export function ShortcutMetadata({
  metadata,
  platform,
  preset,
}: {
  metadata: ReturnType<typeof useShortcutMetadata>
  platform: PlatformName
  preset: KeybindingPreset
}) {
  if (metadata.isPending) return <Spinner size='xs' label='Loading preset report' />
  if (metadata.isError)
    return (
      <div className='flex items-center gap-(--density-control-gap) pt-2 text-xs'>
        <span className='text-muted-foreground'>The preset report could not be loaded.</span>
        <Button size='sm' variant='outline' onClick={() => window.location.reload()}>
          Reload app
        </Button>
      </div>
    )
  return (
    <UnmappedShortcuts
      platform={platform}
      preset={preset}
      unmapped={metadata.data.unmappedPresetBindings(platform, preset)}
    />
  )
}

import type { SettingsLayerSnapshot } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'

import { selectSettingsScope } from '../state/scope-store'
import { selectSettingsView } from '../state/view-store'

/**
 * Says that a settings file cannot be parsed, and that it does not matter yet.
 *
 * Without this the state is invisible and contradictory: the page shows every
 * value at whatever is in force, the file on disk says something else, and every
 * write is refused with a typed error nobody asked for. The server holds the last
 * values that parsed precisely so the app keeps working through a hand-edit —
 * this is the part that tells the user their edit has not taken effect, which is
 * the one thing retention would otherwise hide.
 *
 * Separate from `DiagnosticsBanner` and louder: a diagnostic is one entry that
 * did not apply, this is a whole file that did not.
 */
export function MalformedBanner({ layers }: { layers: readonly SettingsLayerSnapshot[] }) {
  // `policy` carries no file, so it is filtered out here rather than cast away
  // below — it is an environment variable and there is nothing to open.
  const broken = layers.flatMap((layer) => {
    if (layer.id === 'policy') return []
    if (!layer.file || layer.file.parseErrors.length === 0) return []

    return [{ file: layer.file, target: layer.id }]
  })
  if (broken.length === 0) return null

  return (
    <div className='bg-destructive/10 mb-(--density-section-padding) rounded-lg p-(--density-section-padding)'>
      {broken.map(({ file, target }) => (
        <div className='flex flex-wrap items-center justify-between gap-2' key={target}>
          <div>
            <p className='text-destructive text-xs font-medium'>
              Your {target} settings.json has a syntax error
            </p>
            <p className='text-muted-foreground mt-1 text-xs'>
              {file.parseErrors[0]?.message ?? 'The document could not be parsed'} — the last
              settings that loaded are still in effect, and changes here cannot be saved until the
              file parses.
            </p>
          </div>
          {/* Both, in order: the broken file may not be the scope on screen. */}
          <Button
            onClick={() => {
              selectSettingsScope(target)
              selectSettingsView('json')
            }}
            size='sm'
            variant='secondary'
          >
            Fix in settings.json
          </Button>
        </div>
      ))}
    </div>
  )
}

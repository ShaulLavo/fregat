import type { BindingResolutionEntry } from '@/keymap/active-bindings'
import type { UnmappedKeyBinding } from '@/keymap/default-bindings'

export function KeybindingResolution({
  report,
  unmapped,
  omitted,
}: {
  readonly report: readonly BindingResolutionEntry[]
  readonly unmapped: readonly UnmappedKeyBinding[]
  readonly omitted: readonly string[]
}) {
  return (
    <details className='text-muted-foreground text-xs @max-3xl/settings:wrap-anywhere'>
      <summary className='cursor-pointer'>Shortcut resolution</summary>
      <ul
        aria-label='Shortcut resolution report'
        className='mt-2 flex max-h-48 flex-col gap-2 overflow-y-auto'
      >
        {report.map((entry) => (
          <li key={`${entry.bindingId}:${entry.reason}`}>
            <code>{entry.command ?? 'Browser reservation'}</code>
            {entry.keys ? ` · ${entry.keys}` : ''}
            {` · ${entry.reason}`}
            {entry.winner ? ` · ${entry.winner}` : ''}
          </li>
        ))}
      </ul>
      <p className='mt-2'>Unmapped VS Code bindings</p>
      <ul aria-label='Unmapped VS Code bindings' className='mt-1 flex flex-col gap-1'>
        {unmapped.length === 0 ? <li>None.</li> : null}
        {unmapped.map((entry) => (
          <li key={`${entry.command}:${entry.keys}`}>
            <code>{entry.command}</code>
            {` · ${entry.keys} · ${entry.reason}`}
          </li>
        ))}
      </ul>
      <p className='mt-2'>Commands without a shortcut in this preset</p>
      <ul
        aria-label='Preset omissions'
        className='mt-1 flex max-h-32 flex-col gap-1 overflow-y-auto'
      >
        {omitted.map((command) => (
          <li key={command}>
            <code>{command}</code>
          </li>
        ))}
      </ul>
    </details>
  )
}

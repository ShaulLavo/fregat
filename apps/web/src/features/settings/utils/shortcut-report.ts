import type { BindingResolutionEntry } from '@/keymap/active-bindings'
import type { UnmappedKeyBinding } from '@/keymap/default-bindings'

/** The raw resolution report as plain text, for pasting into an issue. */
export function shortcutReport(
  report: readonly BindingResolutionEntry[],
  unmapped: readonly UnmappedKeyBinding[],
  omitted: readonly string[],
): string {
  const lines = [
    'Shortcut resolution',
    ...report.map((entry) =>
      [entry.command ?? 'Browser reservation', entry.keys, entry.reason, entry.winner]
        .filter(Boolean)
        .join(' · '),
    ),
    '',
    'Unmapped VS Code bindings',
    ...unmapped.map((entry) => `${entry.command} · ${entry.keys} · ${entry.reason}`),
    '',
    'Commands without a shortcut in this preset',
    ...omitted,
  ]

  return `${lines.join('\n')}\n`
}

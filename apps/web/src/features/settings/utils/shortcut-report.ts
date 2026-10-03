import type { BindingResolutionEntry } from '@/keymap/active-bindings'
import type { UnmappedPresetBinding } from '@/keymap/default-bindings'

/** The raw resolution report as plain text, for pasting into an issue. */
export function shortcutReport(
  report: readonly BindingResolutionEntry[],
  unmapped: readonly UnmappedPresetBinding[],
): string {
  const lines = [
    'Shortcut resolution',
    ...report.map((entry) =>
      [
        entry.command ?? 'Reserved keys',
        entry.keys,
        entry.context,
        entry.reason,
        entry.winner,
        entry.winnerContext,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
    '',
    'Unmapped preset actions',
    ...unmapped.map(
      (entry) => `${entry.command} · ${entry.keys} · ${entry.context} · ${entry.reason}`,
    ),
  ]

  return `${lines.join('\n')}\n`
}

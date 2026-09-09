import { groupedCommandItems, quickAccessQuery } from '@workspace/client-core/commands/palette'
import type { CommandBus } from '@/commands/state/bus'
import type { TerminalBinding } from '@/commands/utils/bindings'

export function paletteOptions(
  captured: ReturnType<CommandBus['capture']>,
  bindings: readonly TerminalBinding[],
  query: string,
  recents: readonly string[],
) {
  const commands = captured.list().map((row) => ({
    id: row.command.id,
    title: row.command.title,
    category: row.command.category,
    keywords: [
      row.command.title,
      row.command.category,
      row.command.description ?? '',
      row.command.id,
      ...(row.command.aliases ?? []),
    ],
    reason: row.status === 'disabled' ? row.reason : null,
    shortcut: bindings.find((binding) => binding.command === row.command.id)?.keys,
  }))
  const search = quickAccessQuery(query).trim().toLocaleLowerCase()
  const groups = groupedCommandItems(commands, query, search ? [] : recents)
  const options = groups.flatMap(([group, rows]) =>
    rows.map((row) => ({
      name: row.shortcut ? `${row.title}  ${row.shortcut}` : row.title,
      description: row.reason ?? group,
      value: row,
    })),
  )
  if (!search) return options
  return options.toSorted(
    (left, right) =>
      Number(exactCommandMatch(right.value, search)) -
      Number(exactCommandMatch(left.value, search)),
  )
}

function exactCommandMatch(
  command: { readonly id: string; readonly title: string },
  search: string,
) {
  return command.id.toLocaleLowerCase() === search || command.title.toLocaleLowerCase() === search
}

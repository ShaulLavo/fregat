import {
  FILE_ICON_EXTENSIONS,
  FILE_ICON_FILE_NAMES,
  FILE_ICON_RULES,
  type FileIconRuleName,
} from '@/lib/file-icon-rules.generated'

export type IconRuleSample = {
  readonly name: FileIconRuleName
  readonly hue: string
  readonly matches: readonly string[]
}

/** Every icon rule with the file names and extensions that reach it, rules with matches first. */
export function iconRuleSamples(): readonly IconRuleSample[] {
  const matches = new Map<FileIconRuleName, string[]>()
  for (const [key, rule] of Object.entries(FILE_ICON_FILE_NAMES).concat(
    Object.entries(FILE_ICON_EXTENSIONS),
  )) {
    const list = matches.get(rule) ?? []
    list.push(key)
    matches.set(rule, list)
  }
  return (Object.keys(FILE_ICON_RULES) as FileIconRuleName[])
    .map((name) => ({ name, hue: FILE_ICON_RULES[name].hue, matches: matches.get(name) ?? [] }))
    .sort((left, right) => Number(right.matches.length > 0) - Number(left.matches.length > 0))
}

import { codexFileCitationsMarkdown } from '@/features/chat/utils/codex-file-citations'

const FENCE_LINE_REGEX = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/

type LanguageRepair = {
  readonly aliases: readonly string[]
  readonly codeStart: RegExp
}

const CODE_FENCE_LANGUAGE_REPAIRS: readonly LanguageRepair[] = [
  {
    aliases: ['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js'],
    codeStart:
      /^(?:import|export|const|let|var|function|class|type|interface|enum|async|await|return|\/\/|\/\*|\{|\[)/iu,
  },
  {
    aliases: ['python', 'py'],
    codeStart: /^(?:import|from|def|class|async|await|return|@|#|[A-Za-z_]\w*\s*=)/u,
  },
  {
    aliases: ['html', 'xml', 'svg'],
    codeStart: /^(?:<!doctype\b|<!--|<\/?[A-Za-z])/iu,
  },
  {
    aliases: ['css', 'scss', 'sass'],
    codeStart: /^(?:@|\/\*|[.#:[*]?[A-Za-z_-])/u,
  },
  {
    aliases: ['bash', 'shell', 'sh', 'zsh'],
    codeStart: /^(?:#!|echo\b|cd\b|npm\b|pnpm\b|bun\b|git\b|export\b|if\b|for\b|while\b)/u,
  },
  {
    aliases: ['json', 'jsonc'],
    codeStart: /^[{[]/u,
  },
  {
    aliases: ['sql'],
    codeStart: /^(?:select|with|insert|update|delete|create|alter|drop)\b/iu,
  },
  {
    aliases: ['rust', 'rs'],
    codeStart: /^(?:use|fn|let|struct|enum|impl|pub|mod)\b/u,
  },
  {
    aliases: ['go'],
    codeStart: /^(?:package|import|func|type|var|const)\b/u,
  },
]

const SORTED_LANGUAGE_REPAIRS = CODE_FENCE_LANGUAGE_REPAIRS.map((repair) => ({
  ...repair,
  aliases: [...repair.aliases].sort((first, second) => second.length - first.length),
}))

export function normalizeAgentMarkdown(markdown: string) {
  return codexFileCitationsMarkdown(markdown)
    .split(/(\r\n|\n|\r)/)
    .reduce(
      (state, part, index, parts) => {
        if (index % 2 === 1) {
          state.output += part
          return state
        }

        const nextLine = state.inFence ? part : normalizeFenceOpeningLine(part)
        state.output += nextLine
        state.inFence = nextFenceState({
          inFence: state.inFence,
          line: nextLine,
          nextPart: parts[index + 1],
        })
        return state
      },
      { inFence: false, output: '' },
    ).output
}

function normalizeFenceOpeningLine(line: string) {
  const match = line.match(FENCE_LINE_REGEX)
  if (!match) return line

  const [, indent = '', fence = '', info = ''] = match
  const repaired = repairedFenceInfo(info)
  if (!repaired) return line

  return `${indent}${fence}${repaired.language}\n${repaired.code}`
}

function repairedFenceInfo(info: string) {
  if (info.length === 0 || /^\s/u.test(info)) return null

  const normalizedInfo = info.toLowerCase()
  for (const repair of SORTED_LANGUAGE_REPAIRS) {
    for (const alias of repair.aliases) {
      if (!normalizedInfo.startsWith(alias)) continue

      const code = info.slice(alias.length)
      if (!repair.codeStart.test(code)) continue

      return { code, language: alias }
    }
  }

  return null
}

function nextFenceState({
  inFence,
  line,
  nextPart,
}: {
  readonly inFence: boolean
  readonly line: string
  readonly nextPart: string | undefined
}) {
  const match = firstLine(line).match(FENCE_LINE_REGEX)
  if (!match) return inFence
  if (nextPart === undefined) return inFence

  return !inFence
}

function firstLine(text: string) {
  return text.split(/\r\n|\n|\r/, 1)[0] ?? ''
}

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import { createScriptError } from '../structured-errors'

const packageSchema = v.object({
  name: v.string(),
  version: v.string(),
  license: v.optional(v.string()),
})

const permissiveChoices: Readonly<Record<string, string>> = {
  jszip: 'MIT',
  dompurify: 'Apache-2.0',
}

/** Package texts from the module paths the bundler actually emitted. */
export function packageNotices(files: readonly string[]) {
  const roots = new Set(files.map(packageRoot).filter((root) => root !== null))
  const entries = new Map<string, string>()
  for (const root of roots) {
    const metadata = v.parse(
      packageSchema,
      JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')),
    )
    const label = `${metadata.name}@${metadata.version}`
    const selected = permissiveChoices[metadata.name] ?? metadata.license
    const texts = noticeFiles(root).flatMap((file) => {
      const text = readFileSync(file, 'utf8').trim()
      return text ? [`${path.relative(root, file)}\n\n${text}`] : []
    })
    if (!texts.some((text) => text.trim())) {
      const fallback = path.join(import.meta.dirname, 'texts', `${label.replaceAll('/', '+')}.txt`)
      if (existsSync(fallback)) texts.push(readFileSync(fallback, 'utf8').trim())
    }
    if (!texts.some((text) => text.trim()))
      throw createScriptError(
        `Missing full licence text for ${label}. Add a reviewed version-specific text in scripts/licenses/texts.`,
      )
    entries.set(
      label,
      `${label}\nLicence: ${selected ?? 'See package licence files'}\nSource: https://www.npmjs.com/package/${metadata.name}/v/${metadata.version}\n\n${texts.join('\n\n')}`,
    )
  }
  return (
    [...entries]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, text]) => text)
      .join('\n\n---\n\n') + '\n'
  )
}

function packageRoot(file: string) {
  const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)/.exec(file)
  if (!match?.[1] || !existsSync(path.join(match[1], 'package.json'))) return null
  return realpathSync(match[1])
}

function noticeFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!/^(licen[cs]e|copying|copyright|notice|third.party.notices)/i.test(entry.name)) continue
    const file = path.join(root, entry.name)
    if (entry.isFile()) files.push(file)
    if (entry.isDirectory()) files.push(...nestedNoticeFiles(file))
  }
  return files.sort()
}

function nestedNoticeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return nestedNoticeFiles(file)
    return entry.isFile() ? [file] : []
  })
}

import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { bundleImports } from '../../../scripts/bundle-imports'
import { createScriptError } from '../../../scripts/structured-errors'
import { bundleStatsFile, GZIP_LEVEL, type BundleStats } from './bundle-stats-plugin'
import { SHELL_ENTRIES, PHONE_BOOT_SCREENS } from './shell-chunks-plugin'

type FirstLoadFile = {
  readonly fileName: string
  readonly kind: 'script' | 'stylesheet'
  readonly size: number
  readonly gzipSize: number
}

// What `index.html` names is what a cold browser fetches before the first
// frame: the entry script, every `modulepreload`, the stylesheet, and the
// chunks and stylesheets the boot script preloads for the shell it picks.
export function firstLoadFiles(dir: string, shell: 'phone' | 'workbench'): FirstLoadFile[] {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
  const files: FirstLoadFile[] = []
  const seen = new Set<string>()
  const add = (href: string, kind: FirstLoadFile['kind']) => {
    const fileName = assetPath(href)
    if (seen.has(fileName)) return
    seen.add(fileName)
    const bytes = fs.readFileSync(path.join(dir, fileName))
    files.push({
      fileName,
      kind,
      size: bytes.byteLength,
      gzipSize: gzipSync(bytes, { level: GZIP_LEVEL }).byteLength,
    })
  }
  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gu)) {
    const tag = match[1]
    const attributes = match[2] ?? ''
    const kind = firstLoadKind(tag ?? '', attributes)
    if (!kind) continue
    const href = attributeValue(attributes, tag === 'script' ? 'src' : 'href')
    if (href) add(href, kind)
  }
  for (const href of shellChunks(html, shell))
    add(href, href.endsWith('.css') ? 'stylesheet' : 'script')
  if (shell === 'phone') followPhoneImports(dir, files, add)
  return files
}

function shellChunks(html: string, shell: 'phone' | 'workbench'): readonly string[] {
  const json = /<script type="application\/json" id="shell-chunks">([^<]*)<\/script>/u.exec(html)
  if (!json?.[1]) return []
  const manifest = JSON.parse(json[1]) as Partial<Record<string, readonly string[]>>
  return manifest[shell] ?? []
}

function firstLoadKind(tag: string, attributes: string): FirstLoadFile['kind'] | null {
  if (tag === 'script') return attributeValue(attributes, 'src') ? 'script' : null
  const rel = attributeValue(attributes, 'rel')
  if (rel === 'modulepreload') return 'script'
  if (rel === 'stylesheet') return 'stylesheet'
  return null
}

function attributeValue(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}=["']([^"']+)["']`, 'u').exec(attributes)
  return match?.[1] ?? null
}

// Hrefs carry the deploy base (`/platform/assets/…`); the file lives at
// `<dir>/assets/…` regardless of base.
function assetPath(href: string): string {
  const index = href.indexOf('assets/')
  return index === -1 ? href.replace(/^\/+/u, '') : href.slice(index)
}

function followPhoneImports(
  dir: string,
  files: readonly FirstLoadFile[],
  add: (href: string, kind: FirstLoadFile['kind']) => void,
) {
  const stats: BundleStats = JSON.parse(fs.readFileSync(bundleStatsFile(dir), 'utf8'))
  const roots = [SHELL_ENTRIES.phone, ...PHONE_BOOT_SCREENS].map((entry) => {
    const chunk = stats.chunks.find((chunk) =>
      chunk.modules.some((module) => module.id.endsWith(`/${entry}`)),
    )
    if (!chunk) throw createScriptError(`Phone first-load root missing from build: ${entry}`)
    return chunk.fileName
  })
  for (const root of roots) add(root, 'script')
  // `add` extends the queue. Inspect every fetched chunk once, including dependencies the
  // import helper preloads for a different branch of a merged conditional.
  for (const file of files) {
    if (file.kind !== 'script') continue
    const graph = bundleImports(
      file.fileName,
      fs.readFileSync(path.join(dir, file.fileName), 'utf8'),
    )
    for (const dependency of graph.imports) add(dependency, 'script')
    for (const root of roots)
      for (const dependency of graph.dynamic.get(root) ?? [])
        add(dependency, dependency.endsWith('.css') ? 'stylesheet' : 'script')
  }
}

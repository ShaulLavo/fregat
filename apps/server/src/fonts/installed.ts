import { parseFontRef } from '@workspace/contracts'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { FontSubsetter } from './fetcher'

type InstalledFace = {
  readonly file: string
  readonly style: 'normal' | 'italic'
  /** A CSS `font-weight`: one weight, or a range for a variable file. */
  readonly weight: string
}

export type InstalledFont = {
  readonly family: string
  readonly monospace: boolean
  /** Files a browser can load; a family only in a `.ttc` collection has none and stays local. */
  readonly faces: readonly InstalledFace[]
}

export type FontLister = () => Promise<string>

type InstalledFontProviderOptions = {
  list?: FontLister
  read?: (file: string) => Promise<Buffer>
  subsetter: FontSubsetter
  now?: () => number
}

const LIST_MAX_AGE_MS = 60_000
const FC_FORMAT = '%{family[0]}\\t%{weight}\\t%{slant}\\t%{spacing}\\t%{file}\\n'
const SERVABLE = new Set(['.ttf', '.otf', '.woff', '.woff2'])
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}
// fontconfig's weight scale to CSS; the app sets text in 400–700 only.
const FC_WEIGHTS: Readonly<Record<number, number>> = {
  0: 100,
  40: 200,
  50: 300,
  80: 400,
  100: 500,
  180: 600,
  200: 700,
  205: 800,
  210: 900,
}
const SERVED_WEIGHTS = new Set([400, 500, 600, 700])

/**
 * Fonts installed on the server's machine, from fontconfig. Serving their files is what lets a
 * font installed here follow the user to a phone or another machine over the mesh.
 */
export class InstalledFontProvider {
  private readonly list: FontLister
  private readonly read: (file: string) => Promise<Buffer>
  private readonly subsetter: FontSubsetter
  private readonly now: () => number
  private cached: { at: number; fonts: Promise<readonly InstalledFont[]> } | null = null

  constructor(options: InstalledFontProviderOptions) {
    this.list = options.list ?? listWithFontconfig
    this.read = options.read ?? ((file) => readFile(file))
    this.subsetter = options.subsetter
    this.now = options.now ?? Date.now
  }

  /** Re-listed at most once a minute, so a font installed while the server runs shows up. */
  fonts(): Promise<readonly InstalledFont[]> {
    if (this.cached && this.now() - this.cached.at < LIST_MAX_AGE_MS) return this.cached.fonts

    const fonts = this.list()
      .then(parseFontconfigList)
      .catch(() => [])
    this.cached = { at: this.now(), fonts }
    return fonts
  }

  /** Empty for a family this machine lacks: the page's own installed copy may still render. */
  async stylesheet(family: string) {
    if (!parseFontRef(`local:${family}`)) return null

    const font = await this.font(family)
    const faces = font?.faces ?? []
    return faces.map((face, index) => fontFaceRule(family, face, index)).join('\n')
  }

  async file(family: string, index: number) {
    const face = (await this.font(family))?.faces[index]
    if (!face) return null

    return {
      data: await this.read(face.file),
      contentType: CONTENT_TYPES[path.extname(face.file)] ?? 'application/octet-stream',
    }
  }

  async preview(family: string, text: string) {
    const faces = (await this.font(family))?.faces ?? []
    const face = faces.find((candidate) => candidate.style === 'normal') ?? faces[0]
    if (!face) return null

    return this.subsetter(await this.read(face.file), text, { targetFormat: 'woff2' })
  }

  private async font(family: string) {
    const fonts = await this.fonts()
    return fonts.find((font) => font.family === family) ?? null
  }
}

async function listWithFontconfig() {
  const process = Bun.spawn(['fc-list', '--format', FC_FORMAT], { stderr: 'ignore' })
  const output = await new Response(process.stdout).text()
  await process.exited
  return output
}

export function parseFontconfigList(output: string): InstalledFont[] {
  const families = new Map<string, { monospace: boolean; faces: InstalledFace[] }>()
  // A variable file's range line first, so its named instances fold into it.
  const lines = output.split('\n').toSorted((left, right) => rangeRank(left) - rangeRank(right))
  for (const line of lines) {
    const record = fontconfigRecord(line)
    if (!record) continue

    const entry = families.get(record.family) ?? { monospace: false, faces: [] }
    entry.monospace ||= record.monospace
    if (record.face && !hasFace(entry.faces, record.face)) entry.faces.push(record.face)
    families.set(record.family, entry)
  }
  return [...families]
    .map(([family, entry]) => ({ family, ...entry }))
    .sort((left, right) => left.family.localeCompare(right.family))
}

function rangeRank(line: string) {
  return line.split('\t')[1]?.startsWith('[') ? 0 : 1
}

function fontconfigRecord(line: string) {
  const [family, weight, slant, spacing, file] = line.split('\t')
  if (!family || !file || family.startsWith('.')) return null
  // The family ends up as a setting value and inside CSS, so it must be a valid local ref.
  if (!parseFontRef(`local:${family}`)) return null

  // 100 is mono, 90 dual-width (a Nerd Font with wide icons).
  const monospace = spacing === '100' || spacing === '90'
  return { family, monospace, face: servableFace(file, weight, slant) }
}

function servableFace(file: string, weight = '', slant = ''): InstalledFace | null {
  if (!SERVABLE.has(path.extname(file).toLowerCase())) return null

  const style = slant === '0' ? 'normal' : 'italic'
  const range = /^\[(\d+) (\d+)\]$/u.exec(weight)
  if (range) {
    return { file, style, weight: `${cssWeight(Number(range[1]))} ${cssWeight(Number(range[2]))}` }
  }

  const css = cssWeight(Number(weight))
  if (!SERVED_WEIGHTS.has(css)) return null
  // Italic only at the regular weight, as the Fontsource faces.
  if (style === 'italic' && css !== 400) return null

  return { file, style, weight: String(css) }
}

function cssWeight(fcWeight: number) {
  let nearest = 80
  for (const candidate of Object.keys(FC_WEIGHTS).map(Number)) {
    if (Math.abs(candidate - fcWeight) < Math.abs(nearest - fcWeight)) nearest = candidate
  }
  return FC_WEIGHTS[nearest] ?? 400
}

// fontconfig lists a variable file once per named instance; one face per file and style is enough.
function hasFace(faces: readonly InstalledFace[], face: InstalledFace) {
  return faces.some(
    (existing) =>
      existing.style === face.style &&
      (existing.file === face.file || existing.weight === face.weight),
  )
}

function fontFaceRule(family: string, face: InstalledFace, index: number) {
  return [
    '@font-face {',
    `  font-family: ${JSON.stringify(family)};`,
    `  font-style: ${face.style};`,
    '  font-display: swap;',
    `  font-weight: ${face.weight};`,
    // Relative to the stylesheet, which is served beside the family's files.
    `  src: url(${JSON.stringify(`${encodeURIComponent(family)}/${index}`)});`,
    '}',
  ].join('\n')
}

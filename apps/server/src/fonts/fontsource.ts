import { fontFamilyName } from '@workspace/contracts'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { FsError } from '../fs/errors'
import { fontOperationFailed, readBinaryFile, readJsonFile } from './cache-files'
import type { Fetcher, FontSubsetter } from './fetcher'
import { Inflight } from './inflight'

export type FontsourceFont = {
  readonly id: string
  readonly family: string
  readonly subsets: readonly string[]
  readonly weights: readonly number[]
  readonly styles: readonly string[]
  readonly defSubset: string
  readonly variable: boolean
  readonly category: string
  readonly license: string | null
}

type FontsourceMeta = {
  readonly unicodeRange: Readonly<Record<string, string>>
  readonly weightAxis: { readonly min: number; readonly max: number } | null
}

type LoadedCatalog = {
  readonly fetchedAt: number
  readonly fonts: readonly FontsourceFont[]
  readonly byId: ReadonlyMap<string, FontsourceFont>
}

type Face = { readonly style: string; readonly weight: number | 'wght'; readonly cssWeight: string }

type FontsourceProviderOptions = {
  cacheRoot: string
  fetcher: Fetcher
  subsetter: FontSubsetter
  now?: () => number
  upstreamTimeoutMs?: number
}

// The only hosts this provider reaches; a font id only ever selects a path under them.
const API = 'https://api.fontsource.org/v1'
const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts'
const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000
// A failed refresh is not retried on every request while offline.
const CATALOG_RETRY_MS = 5 * 60 * 1000
// Boot's stylesheet is render-blocking, so no upstream wait may hang it.
const UPSTREAM_TIMEOUT_MS = 10_000
// The app sets text in these and nothing else, so a static family costs four files per subset.
const STATIC_WEIGHTS = [400, 500, 600, 700]
const FILE_NAME = /^([a-z0-9-]+)-(wght|\d{3})-(normal|italic)\.woff2$/u
// Glyphs only: an icon font set as the interface font renders every word as pictures.
const EXCLUDED_CATEGORIES = new Set(['icons'])

/** Fontsource, which carries all of Google Fonts; files are cached forever once fetched. */
export class FontsourceProvider {
  private readonly root: string
  private readonly catalogFile: string
  private readonly fetcher: Fetcher
  private readonly subsetter: FontSubsetter
  private readonly now: () => number
  private readonly inflight = new Inflight()
  private loaded: LoadedCatalog | null = null
  private refreshFailedAt = Number.NEGATIVE_INFINITY
  private readonly upstreamTimeoutMs: number

  constructor(options: FontsourceProviderOptions) {
    this.root = path.join(options.cacheRoot, 'fontsource')
    this.catalogFile = path.join(this.root, 'catalog.json')
    this.fetcher = options.fetcher
    this.subsetter = options.subsetter
    this.now = options.now ?? Date.now
    this.upstreamTimeoutMs = options.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS
  }

  async catalog(): Promise<readonly FontsourceFont[]> {
    return (await this.loadedCatalog()).fonts
  }

  async stylesheet(id: string) {
    const font = await this.font(id)
    if (!font) return null

    const meta = await this.meta(font)
    const family = fontFamilyName({ source: 'fontsource', id })
    const rules = font.subsets.flatMap((subset) =>
      plannedFaces(font, meta).map((face) => fontFaceRule(family, id, subset, face, meta)),
    )
    return rules.join('\n')
  }

  /** A file the stylesheet names, and only those: anything else is not ours to fetch. */
  async file(id: string, name: string) {
    const font = await this.font(id)
    if (!font) return null

    const parsed = FILE_NAME.exec(name)
    if (!parsed) return null

    const [, subset, weight, style] = parsed
    if (!subset || !font.subsets.includes(subset)) return null

    const meta = await this.meta(font)
    const planned = plannedFaces(font, meta).some(
      (face) => face.style === style && String(face.weight) === weight,
    )
    if (!planned) return null

    return this.cachedFile(id, name)
  }

  async preview(id: string, text: string, textHash: string) {
    const font = await this.font(id)
    if (!font) return null

    const previewPath = path.join(this.root, id, 'previews', `${textHash}.woff2`)
    const cached = await readBinaryFile(previewPath)
    if (cached) return cached

    const source = await this.cachedFile(id, previewFileName(font))
    const subset = await this.subsetter(source, text, { targetFormat: 'woff2' })
    await mkdir(path.dirname(previewPath), { recursive: true })
    await writeFile(previewPath, subset)
    return subset
  }

  private async font(id: string) {
    return (await this.loadedCatalog()).byId.get(id) ?? null
  }

  /**
   * Parsed once and kept. A stale catalog is served at once and refreshed behind the request:
   * yesterday's list still names every font we can serve, and nothing waits on the network.
   */
  private async loadedCatalog(): Promise<LoadedCatalog> {
    const current =
      this.loaded ?? (await this.inflight.join('catalog:disk', () => this.readCachedCatalog()))
    if (!current) return this.inflight.join('catalog:fetch', () => this.fetchCatalog(null))
    if (!this.catalogDue(current)) return current

    this.inflight.join('catalog:fetch', () => this.fetchCatalog(current)).catch(() => {})
    return current
  }

  private catalogDue(current: LoadedCatalog) {
    const now = this.now()
    return (
      now - current.fetchedAt >= CATALOG_MAX_AGE_MS &&
      now - this.refreshFailedAt >= CATALOG_RETRY_MS
    )
  }

  private async readCachedCatalog() {
    const fonts = await readJsonFile<FontsourceFont[]>(this.catalogFile)
    if (!fonts || fonts.length === 0) return null

    const { mtimeMs } = await stat(this.catalogFile)
    return this.remember(fonts, mtimeMs)
  }

  private async fetchCatalog(previous: LoadedCatalog | null) {
    const response = await this.fetcher(`${API}/fonts`, this.upstreamInit()).catch(
      (error: unknown) => error,
    )
    const fonts = response instanceof Response && response.ok ? await catalogBody(response) : []
    // A shape change or an error page served as 200 must not replace a good catalog.
    if (fonts.length > 0) {
      await mkdir(this.root, { recursive: true })
      await writeFile(this.catalogFile, JSON.stringify(fonts))
      return this.remember(fonts, this.now())
    }

    this.refreshFailedAt = this.now()
    if (previous) return previous

    throw catalogUnavailable(response)
  }

  private remember(fonts: readonly FontsourceFont[], fetchedAt: number): LoadedCatalog {
    this.loaded = { fetchedAt, fonts, byId: new Map(fonts.map((font) => [font.id, font])) }
    return this.loaded
  }

  private meta(font: FontsourceFont): Promise<FontsourceMeta> {
    return this.inflight.join(`meta:${font.id}`, async () => {
      const metaPath = path.join(this.root, font.id, 'meta.json')
      const cached = await readJsonFile<FontsourceMeta>(metaPath)
      if (cached) return cached

      const detail = await this.fetchJson(`${API}/fonts/${font.id}`, 'font details')
      const axes = font.variable
        ? await this.fetchJson(`${API}/variable/${font.id}`, 'variable axes')
        : null
      const meta: FontsourceMeta = {
        unicodeRange: unicodeRanges(detail),
        weightAxis: weightAxis(axes),
      }
      await mkdir(path.dirname(metaPath), { recursive: true })
      await writeFile(metaPath, JSON.stringify(meta))
      return meta
    })
  }

  private cachedFile(id: string, name: string): Promise<Buffer> {
    return this.inflight.join(`file:${id}/${name}`, async () => {
      const filePath = path.join(this.root, id, 'files', name)
      const cached = await readBinaryFile(filePath)
      if (cached) return cached

      const response = await this.fetcher(upstreamFileUrl(id, name), this.upstreamInit())
      if (!response.ok) throw fontOperationFailed('failed to download a Fontsource file', response)

      const data = Buffer.from(await response.arrayBuffer())
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, data)
      return data
    })
  }

  private upstreamInit(): RequestInit {
    return { signal: AbortSignal.timeout(this.upstreamTimeoutMs) }
  }

  private async fetchJson(url: string, what: string): Promise<unknown> {
    const response = await this.fetcher(url, this.upstreamInit())
    if (!response.ok) throw fontOperationFailed(`failed to fetch Fontsource ${what}`, response)

    return response.json()
  }
}

async function catalogBody(response: Response) {
  const payload: unknown = await response.json().catch(() => null)
  return catalogFonts(payload)
}

function catalogUnavailable(result: unknown) {
  if (result instanceof Response)
    return fontOperationFailed('failed to fetch the Fontsource catalog', result)

  return new FsError('OPERATION_FAILED', 'failed to reach the Fontsource catalog', result, {
    fix: 'Check the network connection; the catalog is cached for offline use after the first fetch.',
    internal: { url: `${API}/fonts` },
  })
}

function plannedFaces(font: FontsourceFont, meta: FontsourceMeta): Face[] {
  const axis = meta.weightAxis
  if (axis) {
    return font.styles.map((style) => ({
      style,
      weight: 'wght' as const,
      cssWeight: `${axis.min} ${axis.max}`,
    }))
  }

  const faces: Face[] = []
  if (font.styles.includes('normal')) {
    for (const weight of staticWeights(font.weights)) {
      faces.push({ style: 'normal', weight, cssWeight: String(weight) })
    }
  }
  if (font.styles.includes('italic')) {
    const weight = nearestWeight(font.weights, 400)
    faces.push({ style: 'italic', weight, cssWeight: String(weight) })
  }
  return faces
}

function staticWeights(available: readonly number[]) {
  const served = STATIC_WEIGHTS.filter((weight) => available.includes(weight))
  if (served.length > 0) return served

  return [nearestWeight(available, 400)]
}

function nearestWeight(available: readonly number[], target: number) {
  let nearest = available[0] ?? target
  for (const weight of available) {
    if (Math.abs(weight - target) < Math.abs(nearest - target)) nearest = weight
  }
  return nearest
}

function previewFileName(font: FontsourceFont) {
  const style = font.styles.includes('normal') ? 'normal' : (font.styles[0] ?? 'normal')
  const subset = font.subsets.includes('latin') ? 'latin' : font.defSubset
  return `${subset}-${nearestWeight(font.weights, 400)}-${style}.woff2`
}

function fontFaceRule(
  family: string,
  id: string,
  subset: string,
  face: Face,
  meta: FontsourceMeta,
) {
  const range = meta.unicodeRange[subset]
  const lines = [
    `  font-family: ${JSON.stringify(family)};`,
    `  font-style: ${face.style};`,
    `  font-display: swap;`,
    `  font-weight: ${face.cssWeight};`,
    // Relative to the stylesheet, so the page's own prefix (the mesh's /platform) carries over.
    `  src: url(${JSON.stringify(`${id}/${subset}-${face.weight}-${face.style}.woff2`)}) format("woff2");`,
  ]
  if (range) lines.push(`  unicode-range: ${range};`)
  return `@font-face {\n${lines.join('\n')}\n}`
}

function upstreamFileUrl(id: string, name: string) {
  if (name.includes('-wght-')) return `${CDN}/${id}:vf@latest/${name}`

  return `${CDN}/${id}@latest/${name}`
}

function catalogFonts(payload: unknown): FontsourceFont[] {
  if (!Array.isArray(payload)) return []

  return payload.flatMap((entry) => {
    const font = catalogFont(entry)
    return font ? [font] : []
  })
}

function catalogFont(entry: unknown): FontsourceFont | null {
  if (!entry || typeof entry !== 'object') return null

  const record = entry as Record<string, unknown>
  const { id, family, category } = record
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(id)) return null
  if (typeof family !== 'string' || typeof category !== 'string') return null
  if (EXCLUDED_CATEGORIES.has(category)) return null

  const subsets = stringList(record.subsets).filter((subset) => /^[a-z0-9-]+$/u.test(subset))
  const weights = numberList(record.weights)
  const styles = stringList(record.styles).filter(
    (style) => style === 'normal' || style === 'italic',
  )
  if (subsets.length === 0 || weights.length === 0 || styles.length === 0) return null

  return {
    id,
    family,
    subsets,
    weights,
    styles,
    defSubset: typeof record.defSubset === 'string' ? record.defSubset : (subsets[0] ?? 'latin'),
    variable: record.variable === true,
    category,
    license: typeof record.license === 'string' ? record.license : null,
  }
}

function unicodeRanges(detail: unknown): Record<string, string> {
  if (!detail || typeof detail !== 'object') return {}

  const ranges = (detail as { unicodeRange?: unknown }).unicodeRange
  if (!ranges || typeof ranges !== 'object') return {}

  return Object.fromEntries(
    Object.entries(ranges).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && /^[U+0-9A-Fa-f,\-? ]+$/u.test(entry[1]),
    ),
  )
}

/** A font marked variable may still lack a weight axis; it is then served as static files. */
function weightAxis(axes: unknown): FontsourceMeta['weightAxis'] {
  if (!axes || typeof axes !== 'object') return null

  const wght = (axes as { axes?: { wght?: { min?: unknown; max?: unknown } } }).axes?.wght
  const min = Number(wght?.min)
  const max = Number(wght?.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null

  return { min, max }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item) => Number.isInteger(item)) : []
}

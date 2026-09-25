import * as cheerio from 'cheerio'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { FsError } from '../fs/errors'
import { defaultPreviewText, isValidFontName } from './contracts'
import { platformCachePath } from '../home'

export type FontLinks = Record<string, string>

export type FontService = {
  getBatchFonts(fontNames: readonly string[]): Promise<Record<string, Buffer | null>>
  getExtractedFont(fontName: string): Promise<Buffer | null>
  getNerdFontLinks(): Promise<FontLinks>
  getPreviewSubset(fontName: string, previewText?: string): Promise<Buffer | null>
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type FontSubsetter = (
  buffer: Buffer,
  text: string,
  options?: { targetFormat?: 'sfnt' | 'woff' | 'woff2' | 'truetype' },
) => Promise<Buffer>
type ZipArchive = {
  readonly files: Record<string, { readonly dir: boolean }>
  file(filename: string): { async(type: 'arraybuffer'): Promise<ArrayBuffer> } | null
}
type JSZipModule = {
  loadAsync(data: Buffer): Promise<ZipArchive>
}

type NerdFontServiceOptions = {
  cacheRoot?: string
  fetcher?: Fetcher
  subsetter?: FontSubsetter
}

const nerdFontsDownloadUrl = 'https://www.nerdfonts.com/font-downloads'
const defaultCacheRoot = platformCachePath('fonts')
const require = createRequire(import.meta.url)
const JSZip = require('jszip') as JSZipModule
const subsetFont = require('subset-font') as FontSubsetter

export class NerdFontService implements FontService {
  private readonly cacheRoot: string
  private readonly fetcher: Fetcher
  private readonly fontDirectory: string
  private readonly linksFile: string
  private readonly previewDirectory: string
  private readonly subsetter: FontSubsetter

  constructor(options: NerdFontServiceOptions = {}) {
    this.cacheRoot = options.cacheRoot ?? defaultCacheRoot
    this.fetcher = options.fetcher ?? fetch
    this.fontDirectory = path.join(this.cacheRoot, 'files')
    this.linksFile = path.join(this.cacheRoot, 'font-links.json')
    this.previewDirectory = path.join(this.cacheRoot, 'previews')
    this.subsetter = options.subsetter ?? subsetFont
  }

  async getNerdFontLinks() {
    await this.ensureCacheDirectories()

    const cached = await readJsonFile<FontLinks>(this.linksFile)
    if (cached) return cached

    const response = await this.fetcher(nerdFontsDownloadUrl)
    if (!response.ok) throw fontOperationFailed('failed to fetch Nerd Fonts links', response)

    const html = await response.text()
    const links = parseNerdFontLinks(html)
    await writeFile(this.linksFile, JSON.stringify(links, null, 2))

    return links
  }

  async getExtractedFont(fontName: string) {
    if (!isValidFontName(fontName)) return null

    await this.ensureCacheDirectories()

    const cachedFontPath = this.cachedFontPath(fontName)
    const cachedFont = await readBinaryFile(cachedFontPath)
    if (cachedFont) return cachedFont

    const links = await this.getNerdFontLinks()
    const zipUrl = links[fontName]
    if (!zipUrl) return null

    const zipBuffer = await this.downloadFontZip(zipUrl)
    const fontBuffer = await extractRegularFont(zipBuffer)
    if (!fontBuffer) return null

    await writeFile(cachedFontPath, fontBuffer)
    return fontBuffer
  }

  async getPreviewSubset(fontName: string, previewText = defaultPreviewText) {
    if (!isValidFontName(fontName)) return null

    await this.ensureCacheDirectories()

    const cachedPreviewPath = this.cachedPreviewPath(fontName, previewText)
    const cachedPreview = await readBinaryFile(cachedPreviewPath)
    if (cachedPreview) return cachedPreview

    const fullFont = await this.getExtractedFont(fontName)
    if (!fullFont) return null

    const subset = await this.subsetter(fullFont, previewText, { targetFormat: 'woff2' })
    await writeFile(cachedPreviewPath, subset)

    return subset
  }

  async getBatchFonts(fontNames: readonly string[]) {
    const results = initialFontBatch(fontNames)
    const settled = await Promise.allSettled(
      fontNames.map(async (name) => ({
        data: await this.getExtractedFont(name),
        name,
      })),
    )

    for (const result of settled) {
      if (result.status !== 'fulfilled') continue
      results[result.value.name] = result.value.data
    }

    return results
  }

  private async downloadFontZip(zipUrl: string) {
    const response = await this.fetcher(zipUrl)
    if (!response.ok) throw fontOperationFailed('failed to download font archive', response)

    return Buffer.from(await response.arrayBuffer())
  }

  private cachedFontPath(fontName: string) {
    return path.join(this.fontDirectory, `${fontName}.ttf`)
  }

  private cachedPreviewPath(fontName: string, previewText: string) {
    const textHash = createHash('sha256').update(previewText).digest('hex').slice(0, 12)
    return path.join(this.previewDirectory, `${fontName}-${textHash}.woff2`)
  }

  private async ensureCacheDirectories() {
    await mkdir(this.fontDirectory, { recursive: true })
    await mkdir(this.previewDirectory, { recursive: true })
  }
}

export function parseNerdFontLinks(html: string): FontLinks {
  const $ = cheerio.load(html)
  const links: FontLinks = {}

  for (const link of $('a').toArray()) {
    const text = $(link).text().trim().toLowerCase()
    if (text !== 'download') continue

    const href = $(link).attr('href')
    const parsed = parsedFontLink(href)
    if (!parsed) continue

    links[parsed.name] = parsed.url
  }

  return links
}

async function extractRegularFont(zipBuffer: Buffer) {
  const zip = await JSZip.loadAsync(zipBuffer)
  const filename = selectRegularFontFile(zip)
  if (!filename) return null

  const file = zip.file(filename)
  if (!file) return null

  return Buffer.from(await file.async('arraybuffer'))
}

function selectRegularFontFile(zip: ZipArchive) {
  const files = Object.keys(zip.files).filter((filename) => isFontFile(zip, filename))
  const regular = files.find(isRegularFontFile)
  if (regular) return regular

  return files[0] ?? null
}

function isFontFile(zip: ZipArchive, filename: string) {
  if (zip.files[filename]?.dir) return false

  return filename.endsWith('.ttf') || filename.endsWith('.otf')
}

function isRegularFontFile(filename: string) {
  if (filename.includes('Windows Compatible')) return false

  return filename.endsWith('Regular.ttf') || filename.endsWith('Regular.otf')
}

function parsedFontLink(href: string | undefined) {
  if (!href) return null

  const url = absoluteFontUrl(href)
  const pathname = new URL(url).pathname
  if (!pathname.endsWith('.zip')) return null

  const name = path.basename(pathname, '.zip')
  if (!isValidFontName(name)) return null

  return { name, url }
}

function absoluteFontUrl(href: string) {
  return new URL(href, nerdFontsDownloadUrl).href
}

async function readJsonFile<T>(filename: string) {
  try {
    return JSON.parse(await readFile(filename, 'utf8')) as T
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return null
    throw error
  }
}

async function readBinaryFile(filename: string) {
  try {
    return await readFile(filename)
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return null
    throw error
  }
}

function initialFontBatch(fontNames: readonly string[]) {
  return Object.fromEntries(fontNames.map((name) => [name, null])) as Record<string, Buffer | null>
}

function fontOperationFailed(message: string, response: Response) {
  return new FsError('OPERATION_FAILED', message, {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
  })
}

function nodeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  if (!('code' in error)) return null

  return typeof error.code === 'string' ? error.code : null
}

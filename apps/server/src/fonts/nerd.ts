import * as cheerio from 'cheerio'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { fontOperationFailed, readBinaryFile, readJsonFile } from './cache-files'
import { isValidFontName } from './contracts'
import type { Fetcher, FontSubsetter } from './fetcher'

export type FontLinks = Record<string, string>

type ZipArchive = {
  readonly files: Record<string, { readonly dir: boolean }>
  file(filename: string): { async(type: 'arraybuffer'): Promise<ArrayBuffer> } | null
}
type JSZipModule = {
  loadAsync(data: Buffer): Promise<ZipArchive>
}

type NerdFontProviderOptions = {
  cacheRoot: string
  fetcher: Fetcher
  subsetter: FontSubsetter
}

const nerdFontsDownloadUrl = 'https://www.nerdfonts.com/font-downloads'
// The scraped links point at release assets; nothing else may be fetched from them.
const archiveHosts = new Set(['github.com'])
const require = createRequire(import.meta.url)
const JSZip = require('jszip') as JSZipModule

/** Nerd Fonts, scraped from the downloads page; each archive's Regular face is cached as ttf. */
export class NerdFontProvider {
  private readonly fetcher: Fetcher
  private readonly fontDirectory: string
  private readonly linksFile: string
  private readonly previewDirectory: string
  private readonly subsetter: FontSubsetter

  constructor(options: NerdFontProviderOptions) {
    this.fetcher = options.fetcher
    this.fontDirectory = path.join(options.cacheRoot, 'files')
    this.linksFile = path.join(options.cacheRoot, 'font-links.json')
    this.previewDirectory = path.join(options.cacheRoot, 'previews')
    this.subsetter = options.subsetter
  }

  async links() {
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

  async font(fontName: string) {
    if (!isValidFontName(fontName)) return null

    await this.ensureCacheDirectories()

    const cachedFontPath = path.join(this.fontDirectory, `${fontName}.ttf`)
    const cachedFont = await readBinaryFile(cachedFontPath)
    if (cachedFont) return cachedFont

    const links = await this.links()
    const zipUrl = links[fontName]
    if (!zipUrl) return null

    const zipBuffer = await this.downloadFontZip(zipUrl)
    if (!zipBuffer) return null

    const fontBuffer = await extractRegularFont(zipBuffer)
    if (!fontBuffer) return null

    await writeFile(cachedFontPath, fontBuffer)
    return fontBuffer
  }

  async preview(fontName: string, previewText: string, textHash: string) {
    if (!isValidFontName(fontName)) return null

    await this.ensureCacheDirectories()

    const cachedPreviewPath = path.join(this.previewDirectory, `${fontName}-${textHash}.woff2`)
    const cachedPreview = await readBinaryFile(cachedPreviewPath)
    if (cachedPreview) return cachedPreview

    const fullFont = await this.font(fontName)
    if (!fullFont) return null

    const subset = await this.subsetter(fullFont, previewText, { targetFormat: 'woff2' })
    await writeFile(cachedPreviewPath, subset)

    return subset
  }

  private async downloadFontZip(zipUrl: string) {
    // The links file is a cache on disk; it never widens where the server fetches from.
    if (!archiveHosts.has(new URL(zipUrl).hostname)) return null

    const response = await this.fetcher(zipUrl)
    if (!response.ok) throw fontOperationFailed('failed to download font archive', response)

    return Buffer.from(await response.arrayBuffer())
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

  const url = new URL(href, nerdFontsDownloadUrl)
  if (!archiveHosts.has(url.hostname)) return null
  if (!url.pathname.endsWith('.zip')) return null

  const name = path.basename(url.pathname, '.zip')
  if (!isValidFontName(name)) return null

  return { name, url: url.href }
}

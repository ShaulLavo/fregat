import { parseFontRef, type FontCatalogEntry } from '@workspace/contracts'
import { createHash } from 'node:crypto'

import { platformCachePath } from '../home'
import { defaultPreviewText } from './contracts'
import { subsetFont, type Fetcher, type FontSubsetter } from './fetcher'
import { FontsourceProvider, type FontsourceFont } from './fontsource'
import { InstalledFontProvider, type FontLister, type InstalledFont } from './installed'
import { NerdFontProvider } from './nerd'

type FontCatalogOptions = {
  cacheRoot?: string
  fetcher?: Fetcher
  subsetter?: FontSubsetter
  now?: () => number
  listInstalled?: FontLister
  readInstalled?: (file: string) => Promise<Buffer>
}

/** Every font the server can fetch and cache, from both providers, behind one list. */
export class FontCatalogService {
  readonly nerd: NerdFontProvider
  readonly fontsource: FontsourceProvider
  readonly installed: InstalledFontProvider

  constructor(options: FontCatalogOptions = {}) {
    const shared = {
      cacheRoot: options.cacheRoot ?? platformCachePath('fonts'),
      fetcher: options.fetcher ?? fetch,
      subsetter: options.subsetter ?? subsetFont,
    }
    this.nerd = new NerdFontProvider(shared)
    this.fontsource = new FontsourceProvider({ ...shared, now: options.now })
    this.installed = new InstalledFontProvider({
      list: options.listInstalled,
      read: options.readInstalled,
      subsetter: shared.subsetter,
      now: options.now,
    })
  }

  /** A provider failing still lists the others' fonts; only an empty answer is an error. */
  async catalog(): Promise<FontCatalogEntry[]> {
    const [nerd, fontsource, installed] = await Promise.allSettled([
      this.nerd.links(),
      this.fontsource.catalog(),
      this.installed.fonts(),
    ])
    const entries = [
      ...(installed.status === 'fulfilled' ? installed.value.map(installedEntry) : []),
      ...(nerd.status === 'fulfilled' ? Object.keys(nerd.value).map(nerdEntry) : []),
      ...(fontsource.status === 'fulfilled' ? fontsource.value.map(fontsourceEntry) : []),
    ]
    // Offline on a first run, the installed fonts are still a catalog worth answering with.
    if (entries.length === 0 && nerd.status === 'rejected') throw nerd.reason

    return entries
  }

  /** A woff2 holding only the glyphs of `text`, so a picker row costs a few KB. */
  async preview(ref: string, text = defaultPreviewText) {
    const parsed = parseFontRef(ref)
    if (!parsed) return null

    const hash = createHash('sha256').update(text).digest('hex').slice(0, 12)
    if (parsed.source === 'nerd') return this.nerd.preview(parsed.id, text, hash)
    if (parsed.source === 'fontsource') return this.fontsource.preview(parsed.id, text, hash)
    if (parsed.source === 'local') return this.installed.preview(parsed.id, text)

    return null
  }
}

function installedEntry(font: InstalledFont): FontCatalogEntry {
  return {
    ref: `local:${font.family}`,
    family: font.family,
    source: 'local',
    category: font.monospace ? 'monospace' : 'proportional',
    variable: font.faces.some((face) => face.weight.includes(' ')),
    weights: [400],
    license: null,
  }
}

function nerdEntry(id: string): FontCatalogEntry {
  return {
    ref: `nerd:${id}`,
    family: `${id} Nerd Font`,
    source: 'nerd',
    category: 'monospace',
    variable: false,
    weights: [400],
    license: null,
  }
}

function fontsourceEntry(font: FontsourceFont): FontCatalogEntry {
  return {
    ref: `fontsource:${font.id}`,
    family: font.family,
    source: 'fontsource',
    category: font.category,
    variable: font.variable,
    weights: font.weights,
    license: font.license,
  }
}

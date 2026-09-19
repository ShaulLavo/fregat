import { archivePartFiles, readArchivePart } from './archive-parts'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_PALETTE_ID,
  isBundledPaletteId,
  paletteIdSchema,
  parsePalette,
  serializePalette,
  type PaletteDocument,
  type PaletteId,
} from '@workspace/contracts'
import * as v from 'valibot'

import { recordRequestContext } from '../observability'
import type { SettingsStore } from '../settings/store'
import { themeErrors } from './structured-errors'

export type PaletteLibraryOptions = {
  /** `~/.platform/palettes` in production; a temp directory in tests. */
  readonly directory: string
  /** Deleting the selected palette lands Graphite through this store first. */
  readonly settings: Pick<SettingsStore, 'snapshot' | 'write'>
}

/**
 * User palettes, one JSON file each. Bundled palettes never live here; the
 * library refuses their ids so the two sources cannot shadow each other.
 */
export class PaletteLibrary {
  assertUnused: (id: string) => Promise<void> = async () => {}
  archiveDirectories: () => Promise<string[]> = async () => []
  readonly #directory: string
  readonly #settings: PaletteLibraryOptions['settings']

  constructor(options: PaletteLibraryOptions) {
    this.#directory = options.directory
    this.#settings = options.settings
  }

  async list(): Promise<(PaletteDocument & { source: 'theme' | 'user' })[]> {
    const names = await this.#fileNames()
    const documents = await Promise.all(names.map((name) => this.#readFile(name)))
    const palettes = documents.filter((document) => document !== null)
    recordRequestContext({ palettes: { files: names.length, valid: palettes.length } })

    const imported = await Promise.all(
      (await archivePartFiles(await this.archiveDirectories(), 'palettes')).map(async (file) =>
        normalize(JSON.parse(await readFile(file, 'utf8'))),
      ),
    )
    return [
      ...new Map(
        [
          ...imported.map((palette) => ({ ...palette, source: 'theme' as const })),
          ...palettes.map((palette) => ({ ...palette, source: 'user' as const })),
        ].map((palette) => [palette.id, palette]),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name))
  }

  async read(id: PaletteId): Promise<PaletteDocument> {
    const document = await this.#readFile(this.#fileName(id))
    if (document) return document
    const imported = await readArchivePart(await this.archiveDirectories(), 'palettes', id)
    if (imported) return normalize(imported)
    throw themeErrors.PALETTE_NOT_FOUND({ id })
  }

  async create(input: unknown): Promise<PaletteDocument> {
    const document = normalize(input)
    if (isBundledPaletteId(document.id)) throw themeErrors.PALETTE_BUNDLED({ id: document.id })
    if (
      (await this.#readFile(this.#fileName(document.id))) ||
      (await readArchivePart(await this.archiveDirectories(), 'palettes', document.id))
    ) {
      throw themeErrors.PALETTE_EXISTS({ id: document.id })
    }

    await this.#writeFile(document)
    return document
  }

  async update(id: PaletteId, input: unknown): Promise<PaletteDocument> {
    const document = normalize(input)
    if (document.id !== id) throw themeErrors.PALETTE_ID_MISMATCH({ id, bodyId: document.id })
    if (isBundledPaletteId(id)) throw themeErrors.PALETTE_BUNDLED({ id })
    if (!(await this.#readFile(this.#fileName(id)))) throw themeErrors.PALETTE_NOT_FOUND({ id })

    await this.#writeFile(document)
    return document
  }

  /**
   * Removes the file only after the selection no longer points at it, so a
   * rejected settings write leaves the palette on disk rather than the app
   * pointing at nothing.
   */
  async delete(id: PaletteId): Promise<void> {
    await this.assertUnused(id)
    if (isBundledPaletteId(id)) throw themeErrors.PALETTE_BUNDLED({ id })
    if (!(await this.#readFile(this.#fileName(id)))) throw themeErrors.PALETTE_NOT_FOUND({ id })

    await this.#releaseSelection(id)
    await rm(path.join(this.#directory, this.#fileName(id)), { force: true })
  }

  async #releaseSelection(id: PaletteId): Promise<void> {
    if (this.#settings.snapshot().values['workbench.palette'] !== id) return

    try {
      await this.#settings.write({
        mutationId: `palette-delete:${id}:${Date.now()}`,
        operations: [{ key: 'workbench.palette', kind: 'set', value: DEFAULT_PALETTE_ID }],
        target: 'user',
      })
    } catch (cause) {
      throw themeErrors.PALETTE_SELECTED_WRITE_REJECTED({ id, cause: asError(cause) })
    }
  }

  async #fileNames(): Promise<string[]> {
    try {
      const entries = await readdir(this.#directory)

      return entries.filter((entry) => entry.endsWith('.json')).sort()
    } catch (error) {
      if (isMissing(error)) return []

      throw error
    }
  }

  async #readFile(name: string): Promise<PaletteDocument | null> {
    let text: string
    try {
      text = await readFile(path.join(this.#directory, name), 'utf8')
    } catch (error) {
      if (isMissing(error)) return null

      throw error
    }

    const result = parsePalette(parseJson(text), 'user')
    // A hand-edited file that no longer parses is skipped, not fatal: one bad
    // palette must not take the library down with it.
    if (!result.success || `${result.palette.id}.json` !== name) return null

    return serializePalette(result.palette)
  }

  async #writeFile(document: PaletteDocument): Promise<void> {
    await mkdir(this.#directory, { recursive: true })
    const target = path.join(this.#directory, this.#fileName(document.id))
    const staging = `${target}.${process.pid}.tmp`
    await writeFile(staging, `${JSON.stringify(document, null, 2)}\n`)
    await rename(staging, target)
  }

  #fileName(id: PaletteId): string {
    return `${id}.json`
  }
}

/** Validates a request body and writes every color back as exact `oklch()`. */
function normalize(input: unknown): PaletteDocument {
  const result = parsePalette(input, 'user')
  if (!result.success) throw themeErrors.PALETTE_INVALID({ detail: v.summarize(result.issues) })

  return serializePalette(result.palette)
}

export function parsePaletteId(id: string): PaletteId {
  const result = v.safeParse(paletteIdSchema, id)
  if (!result.success) throw themeErrors.PALETTE_INVALID({ detail: `id ${JSON.stringify(id)}` })

  return result.output
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

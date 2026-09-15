import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import type { Page } from 'playwright'

import { createScriptError } from '../structured-errors'
import type { Evidence } from './evidence'
import { traceRecord, type GeneratedFrame } from './trace-types'

export type CapturedSourceMap = {
  readonly scriptId: string
  readonly url: string
  readonly mapUrl: string
  readonly map: string
}

export type OriginalFrame = {
  readonly functionName: string
  readonly source: string
  readonly line: number
  readonly column: number
}

type ScriptMetadata = {
  readonly scriptId: string
  readonly url: string
  readonly sourceMapURL: string
}

type SourceManifestEntry =
  | {
      readonly status: 'captured'
      readonly scriptId: string
      readonly url: string
      readonly mapUrl: string
      readonly mapFile: string
      readonly scriptFile: string
    }
  | {
      readonly status: 'unavailable'
      readonly scriptId: string
      readonly url: string
      readonly reason: string
    }

export async function captureTraceSources(
  page: Page,
  evidence: Evidence,
  frames: readonly GeneratedFrame[],
): Promise<readonly CapturedSourceMap[]> {
  const session = await page.context().newCDPSession(page)
  const scripts = new Map<string, ScriptMetadata>()
  session.on('Debugger.scriptParsed', (raw: unknown) => {
    const data = traceRecord(raw)
    const scriptId = String(data.scriptId ?? '')
    scripts.set(scriptId, {
      scriptId,
      url: String(data.url ?? ''),
      sourceMapURL: String(data.sourceMapURL ?? ''),
    })
  })
  const manifest: SourceManifestEntry[] = []
  const maps: CapturedSourceMap[] = []
  try {
    // Enabling after tracing exposes loaded scripts without changing the measured interval.
    await session.send('Debugger.enable')
    const unique = new Map(frames.map((frame) => [frame.scriptId, frame]))
    for (const frame of unique.values()) {
      const result = await captureSource(frame, scripts.get(frame.scriptId), page, evidence, () =>
        session.send('Debugger.getScriptSource', { scriptId: frame.scriptId }),
      )
      manifest.push(result.entry)
      if (result.source) maps.push(result.source)
    }
  } finally {
    await session.detach()
  }
  await evidence.json('trace-sources.json', manifest)
  return maps
}

async function captureSource(
  frame: GeneratedFrame,
  script: ScriptMetadata | undefined,
  page: Page,
  evidence: Evidence,
  readScript: () => Promise<{ scriptSource: string }>,
): Promise<{ entry: SourceManifestEntry; source: CapturedSourceMap | null }> {
  try {
    if (!script || script.url !== frame.url)
      throw createScriptError('Profile script is no longer loaded in this page.')
    const { scriptSource } = await readScript()
    const mapReference =
      script.sourceMapURL || scriptSource.match(/\/\/[#@]\s*sourceMappingURL=(\S+)/)?.[1]
    if (!mapReference) throw createScriptError('Loaded script has no sourceMappingURL.')
    const mapUrl = mapReference.startsWith('data:')
      ? script.url
      : new URL(mapReference, script.url).href
    const map = await readSourceMap(page, mapReference, mapUrl)
    new TraceMap(map, mapUrl)
    const prefix = `source-${frame.scriptId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const mapFile = `${prefix}.map.json`
    const scriptFile = `${prefix}.js`
    await evidence.write(mapFile, map)
    await evidence.write(scriptFile, scriptSource)
    return {
      entry: {
        status: 'captured',
        scriptId: frame.scriptId,
        url: frame.url,
        mapUrl,
        mapFile,
        scriptFile,
      },
      source: { scriptId: frame.scriptId, url: frame.url, mapUrl, map },
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      entry: { status: 'unavailable', scriptId: frame.scriptId, url: frame.url, reason },
      source: null,
    }
  }
}

async function readSourceMap(page: Page, reference: string, url: string): Promise<string> {
  if (reference.startsWith('data:')) {
    const comma = reference.indexOf(',')
    const header = reference.slice(0, comma)
    const content = reference.slice(comma + 1)
    return header.includes(';base64')
      ? Buffer.from(content, 'base64').toString('utf8')
      : decodeURIComponent(content)
  }
  const response = await page.request.get(url, { timeout: 10_000 })
  if (!response.ok())
    throw createScriptError(`Source map request failed: ${response.status()} ${url}`)
  return response.text()
}

export function sourceResolver(sources: readonly CapturedSourceMap[]) {
  const maps = new Map(
    sources.map((source) => [
      source.scriptId,
      { ...source, decoded: new TraceMap(source.map, source.mapUrl) },
    ]),
  )
  return (frame: GeneratedFrame): OriginalFrame | null => {
    const source = maps.get(frame.scriptId)
    if (!source || source.url !== frame.url || frame.line < 0 || frame.column < 0) return null
    const original = originalPositionFor(source.decoded, {
      line: frame.line + 1,
      column: frame.column,
    })
    if (!original.source || original.line === null || original.column === null) return null
    return {
      functionName: original.name ?? frame.functionName,
      source: original.source,
      line: original.line,
      column: original.column + 1,
    }
  }
}

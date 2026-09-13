import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Plugin } from 'vite'

export type BundleStatsModule = {
  readonly id: string
  readonly renderedLength: number
}

export type BundleStatsChunk = {
  readonly fileName: string
  readonly name: string
  readonly isEntry: boolean
  readonly isDynamicEntry: boolean
  readonly size: number
  readonly gzipSize: number
  readonly imports: readonly string[]
  readonly dynamicImports: readonly string[]
  readonly modules: readonly BundleStatsModule[]
}

export type BundleStatsAsset = {
  readonly fileName: string
  readonly size: number
  readonly gzipSize: number
}

export type BundleStats = {
  readonly generatedAt: string
  readonly outDir: string
  readonly chunks: readonly BundleStatsChunk[]
  readonly assets: readonly BundleStatsAsset[]
}

// Beside the build, not inside it: a release directory keeps the stats next to
// `web/`, and a plain `dist` build keeps them out of the served tree.
export function bundleStatsFile(outDir: string): string {
  return path.resolve(outDir, '..', 'bundle-stats.json')
}

export function bundleStatsPlugin(): Plugin {
  let outDir = ''
  return {
    name: 'platform-bundle-stats',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return

      const chunks: BundleStatsChunk[] = []
      const assets: BundleStatsAsset[] = []
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') {
          chunks.push(statsForChunk(output))
          continue
        }
        assets.push({
          fileName: output.fileName,
          size: byteLength(output.source),
          gzipSize: gzipSize(output.source),
        })
      }

      const stats: BundleStats = {
        generatedAt: new Date().toISOString(),
        outDir,
        chunks,
        assets,
      }
      fs.mkdirSync(path.dirname(bundleStatsFile(outDir)), { recursive: true })
      fs.writeFileSync(bundleStatsFile(outDir), JSON.stringify(stats))
    },
  }
}

type OutputChunkLike = {
  readonly fileName: string
  readonly name: string
  readonly isEntry: boolean
  readonly isDynamicEntry: boolean
  readonly code: string
  readonly imports: readonly string[]
  readonly dynamicImports: readonly string[]
  readonly modules: Record<string, { readonly renderedLength: number }>
}

function statsForChunk(chunk: OutputChunkLike): BundleStatsChunk {
  return {
    fileName: chunk.fileName,
    name: chunk.name,
    isEntry: chunk.isEntry,
    isDynamicEntry: chunk.isDynamicEntry,
    size: byteLength(chunk.code),
    gzipSize: gzipSize(chunk.code),
    imports: chunk.imports,
    dynamicImports: chunk.dynamicImports,
    modules: Object.entries(chunk.modules).map(([id, info]) => ({
      id,
      renderedLength: info.renderedLength,
    })),
  }
}

function byteLength(source: string | Uint8Array): number {
  return typeof source === 'string' ? Buffer.byteLength(source) : source.byteLength
}

// Level 9 is what the plan-106 baseline was measured with; keep it so the
// numbers stay comparable across releases.
export const GZIP_LEVEL = 9

function gzipSize(source: string | Uint8Array): number {
  return gzipSync(source, { level: GZIP_LEVEL }).byteLength
}

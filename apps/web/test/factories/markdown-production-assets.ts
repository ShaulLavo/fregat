import type { ProductionResourceKind } from './markdown-production-types'

export function productionAssetKind(url: string, initiatorType?: string): ProductionResourceKind {
  const pathname = new URL(url).pathname
  if (/\/web-tree-sitter(?:-[\w-]+)?\.wasm$/u.test(pathname)) return 'host'
  if (/\/tree-sitter-markdown(?:-[\w-]+)?\.wasm$/u.test(pathname)) return 'grammar'
  if (/\/tree-sitter-md(?:-[\w-]+)?\.wasm$/u.test(pathname)) return 'resolver'
  if (initiatorType === 'script' || pathname.endsWith('.js')) return 'javascript'
  return 'other'
}

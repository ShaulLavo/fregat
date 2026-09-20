import path from 'node:path'
const TYPE_SCRIPT_EXTENSIONS = new Set(['.cts', '.mts', '.ts', '.tsx'])
export function isTypeScriptFileName(fileName: string): boolean {
  return TYPE_SCRIPT_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

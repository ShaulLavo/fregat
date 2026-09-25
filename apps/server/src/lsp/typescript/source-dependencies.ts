import ts from 'typescript-language-service'
import { createHash } from 'node:crypto'

/** Import positions and surrounding edits do not change a program's dependency closure. */
export function sourceDependencies(filePath: string, text: string): string {
  if (/(?:^|\/)package\.json$/.test(filePath))
    return createHash('sha256').update(text).digest('hex')
  if (!/\.[cm]?[jt]sx?$/.test(filePath)) return ''
  const info = ts.preProcessFile(text, true, true)
  const names = (files: readonly ts.FileReference[]) =>
    [...new Set(files.map((file) => file.fileName))].sort()
  return JSON.stringify([
    names(info.importedFiles),
    names(info.referencedFiles),
    names(info.typeReferenceDirectives),
    names(info.libReferenceDirectives),
    info.isLibFile,
  ])
}

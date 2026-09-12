import { basename, displayPath } from '@/lib/path-formatters'
import { documentSourcePath } from '@/lib/documents/utils/capabilities'
import { encodedViewTarget, encodedSettingsTab } from '@/lib/documents/utils/codec'
import type { DocumentRef, GitComparison, TabContent } from '@/lib/documents/utils/types'

export type PresentationFacts = { readonly conflictPath?: string | null }

export function documentLabel(document: DocumentRef, facts: PresentationFacts = {}): string {
  switch (document.kind) {
    case 'file':
      return basename(document.resource.path)
    case 'settings-json':
      return `settings.json (${document.target})`
    case 'git-ref':
      return `${basename(document.source.path)} (${document.source.ref})`
    case 'git-diff':
      return comparisonLabel(document.source)
    case 'compare-saved':
      return `${basename(document.file.path)} (working tree)`
    case 'conflict':
      return facts.conflictPath ? basename(facts.conflictPath) : 'Conflict'
    case 'search':
      return 'Search'
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}

export function tabLabel(content: TabContent, facts: PresentationFacts = {}): string {
  return content.kind === 'settings' ? 'settings.json' : documentLabel(content.document, facts)
}

export function documentTitle(document: DocumentRef, facts: PresentationFacts = {}): string {
  switch (document.kind) {
    case 'file':
      return displayPath(document.resource.path)
    case 'settings-json':
      return `settings.json (${document.target})`
    case 'git-ref':
      return `${displayPath(document.source.path)} at ${document.source.ref}`
    case 'git-diff':
      return comparisonTitle(document.source)
    case 'compare-saved':
      return `${displayPath(document.file.path)} — working tree vs saved`
    case 'conflict':
      return facts.conflictPath
        ? `${displayResourcePath(facts.conflictPath)} conflict editor`
        : 'Filesystem conflict editor'
    case 'search':
      return `${displayResourcePath(document.root)} search results`
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}

export function tabTitle(content: TabContent, facts: PresentationFacts = {}): string {
  return content.kind === 'settings'
    ? displayPath(encodedSettingsTab())
    : documentTitle(content.document, facts)
}

export function tabCopyPath(content: TabContent, facts: PresentationFacts = {}): string {
  if (content.kind === 'settings') return encodedSettingsTab()
  const document = content.document
  if (document.kind === 'conflict') return facts.conflictPath ?? encodedViewTarget(document)
  if (document.kind === 'git-diff') return comparisonDisplayPath(document.source)
  return documentSourcePath(document) ?? ''
}

export function tabIconName(content: TabContent, facts: PresentationFacts = {}): string {
  if (content.kind === 'settings') return 'settings.json'
  const document = content.document
  if (document.kind === 'search') return 'search.txt'
  if (document.kind === 'conflict')
    return facts.conflictPath ? basename(facts.conflictPath) : 'conflict.txt'
  return basename(tabCopyPath(content, facts))
}

export function comparisonDisplayPath(source: GitComparison): string {
  switch (source.kind) {
    case 'snapshot':
      return source.path
    case 'checkpoint-file':
      return source.file.path
    case 'checkpoint-session':
      return `checkpoint-session-${source.toTurnCount}`
    case 'checkpoint-turn':
      return `checkpoint-turn-${source.toTurnCount}`
    default: {
      const exhaustive: never = source
      return exhaustive
    }
  }
}

export function comparisonShortHash(source: GitComparison): string {
  if (source.kind !== 'snapshot') return ''
  return (source.newObjectId ?? source.oldObjectId)?.slice(0, 7) ?? ''
}

function comparisonLabel(source: GitComparison): string {
  switch (source.kind) {
    case 'snapshot':
      return basename(source.path)
    case 'checkpoint-file':
      return basename(source.file.path)
    case 'checkpoint-session':
      return `Session diff ${source.toTurnCount}`
    case 'checkpoint-turn':
      return `Turn diff ${source.fromTurnCount}-${source.toTurnCount}`
    default: {
      const exhaustive: never = source
      return exhaustive
    }
  }
}

function comparisonTitle(source: GitComparison): string {
  if (source.kind === 'snapshot') {
    const hash = comparisonShortHash(source)
    return hash
      ? `${displayResourcePath(source.path)} diff at ${hash}`
      : `${displayResourcePath(source.path)} diff`
  }
  switch (source.kind) {
    case 'checkpoint-file':
      return `${displayResourcePath(source.file.path)} checkpoint diff ${source.fromTurnCount}-${source.toTurnCount}`
    case 'checkpoint-session':
      return `Session checkpoint diff 0-${source.toTurnCount}`
    case 'checkpoint-turn':
      return `Turn checkpoint diff ${source.fromTurnCount}-${source.toTurnCount}`
    default: {
      const exhaustive: never = source
      return exhaustive
    }
  }
}

function displayResourcePath(value: string): string {
  return value.startsWith('/') ? value : displayPath(value)
}

// The palette historically shows encoded view names; tab-strip titles have different fallbacks.
export function tabPalettePresentation(content: TabContent): { name: string; pathLabel: string } {
  if (content.kind === 'settings') {
    const display = encodedSettingsTab()
    return { name: basename(display), pathLabel: displayPath(display) }
  }
  const document = content.document
  if (document.kind === 'search') {
    return { name: 'Search', pathLabel: documentTitle(document) }
  }
  const display = document.kind === 'file' ? document.resource.path : encodedViewTarget(document)
  return { name: basename(display), pathLabel: displayPath(display) }
}

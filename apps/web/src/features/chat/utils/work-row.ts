import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

export function workRowSections(entry: ChatWorkLogEntry) {
  const reasoning = entry.tone === 'thinking' ? entry.title : null
  return [
    { label: 'Reasoning', value: reasoning },
    { label: 'Details', value: entry.detail },
    { label: 'Input', value: entry.input },
    { label: 'Command', value: entry.command },
    { label: 'Result', value: entry.result },
    { label: 'Output', value: entry.output },
    { label: 'Changed files', value: entry.changedFiles.join('\n') },
  ].filter(
    (section): section is { label: string; value: string } =>
      typeof section.value === 'string' &&
      section.value.length > 0 &&
      (section.label === 'Reasoning' || section.value !== entry.title),
  )
}

export function isWorkLogFailure(entry: ChatWorkLogEntry) {
  return entry.outcome === 'failed' || entry.tone === 'error' || entry.lifecycle === 'failed'
}

export function workRowExpandable(entry: ChatWorkLogEntry) {
  return Boolean(entry.questionAnswers?.length) || workRowSections(entry).length > 0
}

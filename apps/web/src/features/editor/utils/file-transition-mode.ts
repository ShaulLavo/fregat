import type { FileTransitionMode } from '@singapore-editor/file-animation'

// File-open "writes itself" animation. Off by default; opt in per session with
// `?transition=diffusion` (or `autoregressive` / `parallel` / `token` / `magicMove`). `?transition=1`
// picks the default mode below.
const TRANSITION_PARAM = 'transition'
const DEFAULT_TRANSITION_MODE: FileTransitionMode = 'diffusion'
const TRANSITION_MODES: readonly FileTransitionMode[] = [
  'autoregressive',
  'parallel',
  'diffusion',
  'token',
  'magicMove',
]

export function requestedFileTransitionMode(search: string): FileTransitionMode | null {
  const value = new URLSearchParams(search).get(TRANSITION_PARAM)?.trim()
  if (!value) return null
  if (value === '1' || value === 'true' || value === 'on') return DEFAULT_TRANSITION_MODE

  return TRANSITION_MODES.find((mode) => mode === value) ?? null
}

export function effectiveFileTransitionMode(
  setting: 'off' | FileTransitionMode,
  search: string,
): FileTransitionMode | null {
  return requestedFileTransitionMode(search) ?? (setting === 'off' ? null : setting)
}

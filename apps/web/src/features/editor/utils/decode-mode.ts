import type { DecodeMode } from '@singapore-editor/decode'

// File-open "writes itself" animation. Off by default; opt in per session with
// `?decode=diffusion` (or `autoregressive` / `parallel` / `token`). `?decode=1`
// picks the default mode below.
const DECODE_PARAM = 'decode'
const DEFAULT_DECODE_MODE: DecodeMode = 'diffusion'
const DECODE_MODES: readonly DecodeMode[] = ['autoregressive', 'parallel', 'diffusion', 'token']

export function requestedDecodeMode(search: string): DecodeMode | null {
  const value = new URLSearchParams(search).get(DECODE_PARAM)?.trim()
  if (!value) return null
  if (value === '1' || value === 'true' || value === 'on') return DEFAULT_DECODE_MODE

  return DECODE_MODES.find((mode) => mode === value) ?? null
}

export function effectiveDecodeMode(
  setting: 'off' | DecodeMode,
  search: string,
): DecodeMode | null {
  return requestedDecodeMode(search) ?? (setting === 'off' ? null : setting)
}

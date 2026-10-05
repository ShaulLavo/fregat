import { useSystemColorMode } from '@/theme/hooks/use-system-color-mode'

export function SystemColorModePreview() {
  return <text>{`Mode ${useSystemColorMode()}`}</text>
}

import { retryableImport } from '@/lib/retryable-import'

// The only value import of the panel: it carries ghostty-webgpu out of the entry chunk.
export const loadTerminalPanel = retryableImport(
  () => import('@/features/terminal/components/panel'),
)

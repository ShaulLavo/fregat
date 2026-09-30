import type { EditorPerformanceTraceHandle } from '../src/features/editor/state/performance-trace.ts'

declare global {
  interface Window {
    __diffFrames: import('./diff-reload-proof.ts').DiffFrame[]
    __reloadFrames: { at: number; shell: boolean; content: boolean }[]
    chatParityWorkspace: (entry: import('../src/lib/file-system-types.ts').PickedFsEntry) => void
    chatParityProof: {
      agents(
        running: boolean,
      ): ReturnType<typeof import('../src/features/chat/utils/timeline-items.ts').chatTimelineItems>
      replay(
        snapshot: Partial<import('@workspace/client-core/chat/types').ChatSession>,
      ): ReturnType<typeof import('../src/features/chat/utils/timeline-items.ts').chatTimelineItems>
      images(root: import('../src/lib/file-system-types.ts').PickedFsEntry): void
    }
    chatScrollProof: typeof import('./chat-scroll-proof-entry.tsx').chatScrollProof
    reviewFixes: typeof import('./chat-review-proof-entry.tsx').reviewFixes
    __editorPerfTrace: EditorPerformanceTraceHandle
    __typingBench: {
      start(): void
      stop(): void
      data(): { frames: number[]; keydowns: number[] }
    }
  }
}

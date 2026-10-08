import { inject } from 'vitest'
import { locateCharId } from '@singapore-editor/textbuffer'
import { ReferenceEngine, TextbufferEngine } from '../src/index'
import type { CharId, Engine, LeftOrigin, RightOrigin, TextbufferSnapshot } from '../src/index'
import type { PlacementRun } from '../src/textbuffer'
import type { Index } from '../src/run-index'

declare module 'vitest' {
  export interface ProvidedContext {
    engine: 'reference' | 'textbuffer'
  }
}
export type TestEngine = Engine<unknown> & {
  visibleOffset(id: CharId): number | null
  origins(offset: number): { readonly originLeft: LeftOrigin; readonly originRight: RightOrigin }
}
export function createEngine(): TestEngine {
  return inject('engine') === 'textbuffer' ? new TextbufferEngine() : new ReferenceEngine()
}
export function characters(engine: TestEngine): readonly { id: CharId; deleted: boolean }[] {
  if (engine instanceof ReferenceEngine)
    return engine.snapshot().nodes.map(({ id, deleted }) => ({ id, deleted }))
  const snapshot = engine.snapshot() as TextbufferSnapshot
  const result: { id: CharId; deleted: boolean }[] = []
  const stack: Index<PlacementRun>[] = snapshot.runs ? [snapshot.runs] : []
  while (stack.length) {
    const node = stack.pop()!
    if (node.left) stack.push(node.left)
    if (node.right) stack.push(node.right)
    for (
      let counter = node.value.start.counter;
      counter < node.value.start.counter + node.value.count;
      counter++
    ) {
      const id = { bunch: node.value.start.bunch, counter }
      result.push({ id, deleted: locateCharId(snapshot.buffer, id)!.liveness === 'deleted' })
    }
  }
  return result.sort((a, b) => a.id.bunch.localeCompare(b.id.bunch) || a.id.counter - b.id.counter)
}
export function liveIds(engine: TestEngine): readonly CharId[] {
  return characters(engine)
    .filter((node) => !node.deleted)
    .sort((a, b) => engine.visibleOffset(a.id)! - engine.visibleOffset(b.id)!)
    .map((node) => node.id)
}

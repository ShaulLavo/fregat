import { inject } from 'vitest'
import { ReferenceEngine, TextbufferEngine } from '../src/index'
import type { CharId, CharacterIdentity, Engine, LeftOrigin, RightOrigin } from '../src/index'

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
export function characters(engine: Engine): readonly CharacterIdentity[] {
  return engine.characters()
}
export function liveIds(engine: TestEngine): readonly CharId[] {
  return characters(engine)
    .filter((node) => !node.deleted)
    .sort((a, b) => engine.visibleOffset(a.id)! - engine.visibleOffset(b.id)!)
    .map((node) => node.id)
}

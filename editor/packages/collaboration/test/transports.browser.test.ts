import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import type { PeerSnapshot } from './peer'

declare const __COLLABORATION_TURN_AVAILABLE__: boolean

declare module 'vitest/browser' {
  interface BrowserCommands {
    collaborationScenario(
      kind:
        | 'webrtc'
        | 'broadcast'
        | 'combined'
        | 'turn'
        | 'duplicate-webrtc'
        | 'duplicate-broadcast',
    ): Promise<{
      before: readonly PeerSnapshot[]
      after: readonly PeerSnapshot[]
      rejoined: readonly PeerSnapshot[]
      texts: readonly string[]
    }>
  }
}

for (const kind of ['webrtc', 'broadcast', 'combined'] as const) {
  test(`${kind} exchanges chunked session edits between separate pages`, async () => {
    const result = await commands.collaborationScenario(kind)
    expect(new Set(result.after.map((peer) => peer.text)).size).toBe(1)
    for (const text of result.texts) expect(result.after[0]!.text).toContain(text)
    expect(result.after[0]!.text.length).toBe(
      result.texts.reduce((length, text) => length + text.length, 0),
    )
    for (const peer of result.before) {
      expect(peer.rtcLinks).toBe(kind === 'webrtc' ? 2 : 0)
      expect(peer.errors).toEqual([])
    }
    if (kind !== 'webrtc') return
    expect(new Set(result.rejoined.map((peer) => peer.text)).size).toBe(1)
    expect(result.rejoined[0]!.text).toContain('after-reconnect')
    expect(result.rejoined[0]!.credentialCalls).toBeGreaterThan(result.after[0]!.credentialCalls)
    expect(result.rejoined[0]!.offers.length).toBeGreaterThan(result.after[0]!.offers.length)
    expect(result.rejoined.every((peer) => peer.rtcLinks === 2)).toBe(true)
  })
}

for (const kind of ['duplicate-webrtc', 'duplicate-broadcast'] as const) {
  test(`${kind} reports a collision in both real tabs`, async () => {
    const result = await commands.collaborationScenario(kind)
    expect(result.after).toHaveLength(2)
    for (const peer of result.after) {
      expect(peer.errors.some((error) => error.includes('Duplicate peer-session'))).toBe(true)
      expect(peer.rtcLinks).toBe(0)
      expect(peer.members).toBe(1)
    }
  })
}

test.skipIf(!__COLLABORATION_TURN_AVAILABLE__)(
  'TURN-only path requires an explicitly configured local relay; see README',
  async () => {
    const result = await commands.collaborationScenario('turn')
    expect(new Set(result.after.map((peer) => peer.text)).size).toBe(1)
    expect(result.before.every((peer) => peer.rtcLinks === 1)).toBe(true)
  },
)

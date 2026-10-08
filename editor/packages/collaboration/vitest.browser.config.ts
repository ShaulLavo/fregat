import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'
import type { PeerOptions, PeerSnapshot } from './test/peer.ts'
import { browserTestResponses } from '../../scripts/browser-test-responses.ts'
import { workspaceRoot } from '../../scripts/workspace-root.ts'

const scenario: BrowserCommand<
  [kind: 'webrtc' | 'broadcast' | 'combined' | 'turn' | 'duplicate-webrtc' | 'duplicate-broadcast']
> = async ({ context, page }, kind) => {
  const origin = new URL(page.url()).origin
  const broker = spawn(
    'bun',
    [fileURLToPath(new URL('./test/broker-process.ts', import.meta.url)), origin],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const pages: Awaited<ReturnType<typeof context.newPage>>[] = []
  try {
    const url = await new Promise<string>((resolve, reject) => {
      // @justification A child can emit neither readiness nor exit; this bounds startup failure,
      // while stdout readiness, error, and exit notifications each clear the deadline.
      const timeout = setTimeout(
        () => reject(new TypeError('Signaling test broker failed to start')),
        10_000,
      )
      let output = ''
      broker.stdout.on('data', (data: Buffer) => {
        output += data.toString()
        if (!output.includes('\n')) return
        clearTimeout(timeout)
        try {
          resolve(JSON.parse(output.trim()).url)
        } catch (error) {
          reject(error)
        }
      })
      broker.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      broker.once('exit', (code) => {
        clearTimeout(timeout)
        reject(new TypeError(`Signaling test broker exited with ${code}`))
      })
    })
    const room = crypto.randomUUID()
    const secret = crypto.randomUUID() + crypto.randomUUID()
    const turn = JSON.parse(process.env.COLLABORATION_TEST_TURN ?? '[]') as RTCIceServer[]
    const count = kind === 'webrtc' ? 3 : 2
    for (let index = 0; index < count; index++) {
      const peerPage = await context.newPage()
      pages.push(peerPage)
      await peerPage.goto(`${origin}/test/peer.html`)
      await peerPage.waitForFunction(() => !!window.collaborationPeer)
      const options: PeerOptions = {
        peer: kind.startsWith('duplicate-') ? 'shared-peer' : `peer-${index}`,
        room,
        secret,
        url,
        broadcast: kind === 'broadcast' || kind === 'combined' || kind === 'duplicate-broadcast',
        rtc: kind !== 'broadcast' && kind !== 'duplicate-broadcast',
        iceServers: kind === 'turn' ? turn : [],
        transportPolicy: kind === 'turn' ? 'relay' : 'all',
      }
      await peerPage.evaluate(
        (configuration) => window.collaborationPeer.start(configuration),
        options,
      )
    }
    const snapshots = () =>
      Promise.all(
        pages.map((peerPage) => peerPage.evaluate(() => window.collaborationPeer.snapshot())),
      )
    if (kind.startsWith('duplicate-')) {
      await Promise.all(
        pages.map((peerPage) =>
          peerPage.waitForFunction(
            () =>
              window.collaborationPeer
                .snapshot()
                .errors.some((error) => error.includes('Duplicate peer-session')),
            undefined,
            { timeout: 10_000 },
          ),
        ),
      )
      return { before: [], after: await snapshots(), rejoined: [], texts: [] }
    }
    const stable = async (depth: number) => {
      await Promise.all(
        pages.map((peerPage) =>
          peerPage.waitForFunction(
            ({ count, depth }) => {
              const state = window.collaborationPeer.snapshot()
              return state.status === 'stable' && state.members === count && state.depth === depth
            },
            { count, depth },
            { timeout: 30_000 },
          ),
        ),
      )
    }
    await stable(0)
    const before = await snapshots()
    const texts = Array.from({ length: count }, (_, index) =>
      index === 0 ? `large-${'😀'.repeat(20_000)}` : `peer-${index}-edit`,
    )
    await Promise.all(
      pages.map((peerPage, index) =>
        peerPage.evaluate((text) => window.collaborationPeer.submit(text), texts[index]!),
      ),
    )
    await stable(count)
    const after = await snapshots()
    let rejoined: readonly PeerSnapshot[] = []
    if (kind === 'webrtc') {
      await pages[0]!.evaluate(() => window.collaborationPeer.stopRTC())
      await Promise.all(
        pages.slice(1).map((peerPage) =>
          peerPage.waitForFunction(
            () => {
              const state = window.collaborationPeer.snapshot()
              return state.status === 'stable' && state.members === 2 && state.host === 'peer-1'
            },
            undefined,
            { timeout: 30_000 },
          ),
        ),
      )
      await pages[0]!.evaluate(() => window.collaborationPeer.restartRTC())
      await stable(count)
      await pages[0]!.evaluate(() => window.collaborationPeer.submit('after-reconnect'))
      await stable(count + 1)
      rejoined = await snapshots()
    }
    return { before, after, rejoined, texts }
  } finally {
    await Promise.allSettled(
      pages.map(async (peerPage) => {
        try {
          await peerPage.evaluate(() => window.collaborationPeer?.close())
        } finally {
          await peerPage.close()
        }
      }),
    )
    broker.kill('SIGTERM')
    if (broker.exitCode === null) await once(broker, 'exit')
  }
}

export default defineConfig({
  plugins: [browserTestResponses()],
  server: { fs: { allow: [workspaceRoot] } },
  define: {
    __COLLABORATION_TURN_AVAILABLE__: JSON.stringify(Boolean(process.env.COLLABORATION_TEST_TURN)),
  },
  test: {
    include: ['test/**/*.browser.test.ts'],
    testTimeout: 90_000,
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      viewport: { width: 900, height: 650 },
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      commands: {
        collaborationScenario: scenario,
        presenceMotion: async ({ page }, reduced: boolean) => {
          await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
        },
      },
    },
  },
})

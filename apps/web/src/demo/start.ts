import { http, bypass } from 'msw'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { setupWorker } from 'msw/browser'
import { emptyAddress, formatAddress } from '@workspace/client-core/address/grammar'
import { writeBootMirror } from '@/features/settings/utils/boot-mirror'
import wallpaperUrl from '../../../site/src/assets/eyes-wide.jpg?url'
import { DEMO_ADDRESS, seedSession } from './seed'
import { DemoWorkspace } from './state/workspace'
import { DemoOrchestration } from './state/orchestration'
import { demoHttpHandler, type DemoDiagnostics } from './transport/http'
import { demoOrchestrationHandler, type DemoSocketFrame } from './transport/orchestration'
import { demoTerminalHandler } from './transport/terminal'

export async function startDemoBackend({
  assetBase,
  apiOrigin,
}: {
  assetBase: string
  apiOrigin: string
}) {
  const workspace = await DemoWorkspace.create()
  writeBootMirror(workspace.settings.values)
  const orchestration = new DemoOrchestration(workspace)
  const diagnostics: DemoDiagnostics = { requests: [], unhandled: [], logs: [] }
  const socketFrames: DemoSocketFrame[] = []
  const assets = {
    wallpaper: new URL(wallpaperUrl, location.href).href,
    font: new URL('demo-assets/fonts/JetBrainsMonoNerdFont-Regular.ttf', assetBase).href,
  }
  const worker = setupWorker(
    http.get(new URL('workbench/wallpaper.jpg', assetBase).href, () =>
      fetch(bypass(assets.wallpaper)),
    ),
    demoHttpHandler(apiOrigin, workspace, orchestration, assets, diagnostics),
    demoOrchestrationHandler(apiOrigin, orchestration, (frame) => {
      socketFrames.push(structuredClone(frame))
      if (socketFrames.length > 500) socketFrames.shift()
    }),
    demoTerminalHandler(apiOrigin, workspace),
  )
  Object.defineProperty(window, '__fregatDemo', {
    configurable: true,
    get: () =>
      Object.freeze({
        apiOrigin,
        requests: diagnostics.requests.map((request) => Object.freeze({ ...request })),
        unhandled: [...diagnostics.unhandled],
        logs: [...diagnostics.logs],
        socketFrames: structuredClone(socketFrames),
      }),
  })
  await worker.start({
    quiet: true,
    serviceWorker: {
      url: new URL('mockServiceWorker.js', assetBase).href,
      options: { scope: new URL(assetBase).pathname },
    },
    onUnhandledRequest(request, print) {
      if (allowedAsset(request, assetBase)) return
      diagnostics.unhandled.push(`${request.method} ${request.url}`)
      print.error()
    },
  })
  const initialAddress = formatAddress({
    ...emptyAddress(),
    workspace: workspaceToken(DEMO_ADDRESS),
    mode: 'workbench',
    document: 'f/src/garden.ts',
    tabs: ['f/src/garden.ts', 'f/src/plants.ts', 'f/README.md'],
    bottom: 'terminal',
    side: 'files',
    chat: `t/${seedSession().id}`,
  })
  return {
    initialAddress,
    stop() {
      orchestration.stop()
      worker.stop()
      workspace.listeners.clear()
      workspace.updates.clear()
    },
  }
}

function allowedAsset(request: Request, assetBase: string) {
  const url = new URL(request.url)
  if (url.origin !== new URL(assetBase).origin) return false
  if (['script', 'style', 'image', 'font', 'worker', 'document'].includes(request.destination))
    return true
  return (
    /\/(?:@vite|@fs|@id|src|node_modules|assets|demo-assets|\.vite)\//u.test(url.pathname) ||
    /\.(?:wasm|ttf|woff2?|css|js|mjs|jpeg|webp|png|svg)$/u.test(url.pathname)
  )
}

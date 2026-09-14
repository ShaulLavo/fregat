import { createMemoryHistory } from '@tanstack/react-router'
import { configureApplicationHost } from '@/lib/application-host'
import { isolateDemoStorage } from './demo-storage'
import './demo-wallpaper.css'

const parentOrigin = demoParentOrigin()
if (window.parent !== window) document.documentElement.dataset.demoEmbedded = ''
isolateDemoStorage()
void start().catch(showFailure)

async function start(): Promise<void> {
  const { startDemoBackend } = await import('./demo/start')
  const apiOrigin = 'https://fregat-demo.invalid'
  const assetBase = new URL(import.meta.env.BASE_URL, location.href).href
  const backend = await startDemoBackend({ assetBase, apiOrigin })
  configureApplicationHost({
    apiOrigin,
    initialAddress: backend.initialAddress,
    history: createMemoryHistory({ initialEntries: [backend.initialAddress] }),
    backdrop: 'app',
  })
  addEventListener('pagehide', backend.stop, { once: true })
  await import('./main')
  observeReady()
}

function observeReady(): void {
  const observer = new MutationObserver(check)
  const timeout = window.setTimeout(() => {
    stopObserving()
    showFailure('The demo did not finish loading. Reload to try again.')
  }, 30_000)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-workbench-wallpaper-layer'],
  })
  document.addEventListener('load', check, true)
  document.fonts.addEventListener('loadingdone', check)
  check()

  function stopObserving(): void {
    observer.disconnect()
    document.removeEventListener('load', check, true)
    document.fonts.removeEventListener('loadingdone', check)
  }

  function check(): void {
    if (!document.querySelector('[aria-label="Editor input"]')) return
    if (!document.querySelector('[aria-label="Terminal"] canvas')) return
    if (document.querySelector('[aria-label="Opening terminal"]')) return
    if (document.fonts.status !== 'loaded') return
    const wallpaper = document.querySelector<HTMLImageElement>(
      'img[data-workbench-wallpaper-layer="still"]',
    )
    if (!wallpaper?.complete || wallpaper.naturalWidth === 0) return
    stopObserving()
    window.clearTimeout(timeout)
    parent.postMessage({ type: 'fregat-demo-ready' }, parentOrigin)
  }
}

function showFailure(error: unknown): void {
  console.error('Demo bootstrap failed', error)
  const message = 'The demo could not start. Reload to try again.'
  const root = document.getElementById('root')
  if (root) {
    root.replaceChildren(Object.assign(document.createElement('p'), { textContent: message }))
    root.setAttribute('role', 'alert')
  }
  parent.postMessage({ type: 'fregat-demo-error', message }, parentOrigin)
}

function demoParentOrigin(): string {
  const supplied = new URL(location.href).searchParams.get('parentOrigin')
  if (!supplied) return location.origin
  try {
    const parsed = new URL(supplied)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin
  } catch {
    return location.origin
  }
  return location.origin
}

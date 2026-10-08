import { version, type Plugin, type ViteDevServer } from 'vite'
import { performance } from 'node:perf_hooks'
import {
  addColdDuration,
  coldClock,
  coldCpu,
  coldHistogram,
  coldProfilePrefix,
  safeColdObserve,
  observeColdPromise,
} from './retention-cold-profile.ts'

type State = {
  finished: boolean
  started: number
  inFlight: number
  observerMs: number
  transforms: ReturnType<typeof coldHistogram>
}
function observeTransforms(server: ViteDevServer, state: State) {
  const container = server.environments.client?.pluginContainer
  if (!container) return
  const transform = container.transform
  container.transform = function (...args) {
    if (state.finished) return Reflect.apply(transform, this, args)
    const start = performance.now()
    state.started++
    state.inFlight++
    return observeColdPromise(
      () => Reflect.apply(transform, this, args),
      () => {
        const now = performance.now()
        addColdDuration(state.transforms, now - start)
        state.inFlight--
        state.observerMs += performance.now() - now
      },
    )
  }
}
export function retentionColdServer(enabled: boolean): Plugin[] {
  if (!enabled) return []
  const state: State = {
    finished: false,
    started: 0,
    inFlight: 0,
    observerMs: 0,
    transforms: coldHistogram(),
  }
  let entries = 0
  let scanCompleteAt: ReturnType<typeof coldClock> | null = null,
    processingCompleteAt: ReturnType<typeof coldClock> | null = null
  const phases: object[] = []
  const snapshot = (server: ViteDevServer, phase: 'startup' | 'baseline' | 'reload' | 'end') => {
    const optimizer = server.environments.client?.depsOptimizer,
      metadata = optimizer?.metadata
    phases.push({
      phase,
      cpu: coldCpu(),
      transforms: { ...state.transforms, buckets: state.transforms.buckets.slice() },
      cache: {
        hash: metadata?.hash ?? null,
        lockfileHash: metadata?.lockfileHash ?? null,
        configHash: metadata?.configHash ?? null,
        browserHash: metadata?.browserHash ?? null,
        optimized: metadata ? Object.keys(metadata.optimized).length : null,
        discovered: metadata ? Object.keys(metadata.discovered).length : null,
        modules: server.environments.client?.moduleGraph.idToModuleMap.size ?? null,
        scanCompleteAt,
        processingCompleteAt,
        reason: optimizer ? (processingCompleteAt ? null : 'pending') : 'unsupported',
      },
    })
    if (optimizer?.scanProcessing)
      void optimizer.scanProcessing.then(
        () => {
          scanCompleteAt = coldClock()
        },
        () => {},
      )
    const processing =
      metadata?.depInfoList.flatMap((info) => (info.processing ? [info.processing] : [])) ?? []
    if (processing.length)
      void Promise.all(processing).then(
        () => {
          processingCompleteAt = coldClock()
        },
        () => {},
      )
  }
  const finish = (server: ViteDevServer) =>
    safeColdObserve(() => {
      if (state.finished) return
      snapshot(server, 'end')
      state.finished = true
      console.info(
        coldProfilePrefix +
          JSON.stringify({
            kind: 'server',
            version,
            phases,
            transforms: state.transforms,
            transformStarted: state.started,
            transformIncomplete: state.inFlight,
            transformOverflow: 0,
            observerMs: state.observerMs,
          }),
      )
    })
  return [
    {
      name: 'retention-cold-transform-cost',
      configureServer(server) {
        safeColdObserve(() => {
          snapshot(server, 'startup')
          observeTransforms(server, state)
        })
        const observeDocument = (url: string | undefined) => {
          if (
            state.finished ||
            url?.split('?')[0] !== '/test/factories/retention-acceptance-entry.html'
          )
            return
          entries++
          if (entries >= 3) {
            finish(server)
            return
          }
          snapshot(server, entries === 1 ? 'baseline' : 'reload')
        }
        server.httpServer?.prependListener('request', (request) =>
          safeColdObserve(() => observeDocument(request.url)),
        )
        server.httpServer?.once('close', () => finish(server))
      },
    },
  ]
}

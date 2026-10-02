import * as v from 'valibot'
import { createGateway, nativeEntrypoints, type GatewayOptions } from './gateway'
import { startResetOrder } from './reset-order'

const portSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535))
const resetOrderSchema = v.object({ managementKeyFile: v.string(), stateFile: v.string() })
export const configSchema = v.pipe(
  v.object({
    binary: v.string(),
    proxyConfig: v.string(),
    proxyPort: portSchema,
    gatewayPort: portSchema,
    apiKey: v.pipe(v.string(), v.nonEmpty()),
    resetOrder: v.optional(resetOrderSchema),
    // A second proxy instance, bound to loopback and kept off the tailnet route, owns the Claude logins.
    claudeProxy: v.optional(
      v.object({
        proxyConfig: v.string(),
        proxyPort: portSchema,
        apiKey: v.pipe(v.string(), v.nonEmpty()),
        resetOrder: v.optional(resetOrderSchema),
      }),
    ),
    // Claude Code User-Agent entrypoints the pool serves; anything else uses the caller's own login.
    claudePoolEntrypoints: v.optional(
      v.array(v.pipe(v.string(), v.toLowerCase(), v.nonEmpty())),
      nativeEntrypoints,
    ),
  }),
  v.check((config) => {
    const ports = [config.gatewayPort, config.proxyPort, config.claudeProxy?.proxyPort]
    const used = ports.filter((port) => port !== undefined)
    return new Set(used).size === used.length
  }, 'Choose separate ports for the gateway and each proxy.'),
)
if (import.meta.main) {
  try {
    process.exit(await run())
  } catch (error) {
    reportFailure('startup', error)
    process.exit(1)
  }
}

function reportFailure(operation: string, error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      source: 'be',
      area: 'claude-gpt',
      operation,
      errorType: error instanceof Error ? error.name : typeof error,
      why:
        operation === 'proxy-shutdown'
          ? 'The owned proxy process stayed alive after SIGKILL.'
          : undefined,
      fix: 'Check the runtime configuration, proxy login and mesh route.',
    })}\n`,
  )
}

async function stopProxy(proxy: Bun.Subprocess) {
  if (proxy.exitCode !== null) return true
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    proxy.kill(signal)
    const exited = await Promise.race([
      proxy.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ])
    if (exited) return true
  }
  reportFailure('proxy-shutdown', null)
  return false
}

function spawnProxy(binary: string, proxyConfig: string) {
  return Bun.spawn([binary, '-config', proxyConfig], { stdout: 'inherit', stderr: 'inherit' })
}

async function run() {
  const config = v.parse(configSchema, await Bun.file(Bun.argv[2] ?? '').json())
  const proxies = [spawnProxy(config.binary, config.proxyConfig)]
  if (config.claudeProxy) proxies.push(spawnProxy(config.binary, config.claudeProxy.proxyConfig))
  const stopping = Promise.withResolvers<number>()
  const stop = () => stopping.resolve(0)
  let server: ReturnType<typeof startGateway> | undefined
  const resetOrders: ReturnType<typeof startResetOrder>[] = []
  let exitCode = 1
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  try {
    // Claude forwarding can start while the GPT registry loads or remains unavailable.
    server = startGateway(gatewayOptions(config))
    for (const instance of [config, config.claudeProxy]) {
      if (!instance?.resetOrder) continue
      resetOrders.push(
        startResetOrder({
          proxyUrl: `http://127.0.0.1:${instance.proxyPort}`,
          ...instance.resetOrder,
        }),
      )
    }
    exitCode = await Promise.race([...proxies.map((proxy) => proxy.exited), stopping.promise])
  } finally {
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
    for (const resetOrder of resetOrders) resetOrder.stop()
    server?.stop(true)
    const stopped = await Promise.all(proxies.map(stopProxy))
    if (stopped.includes(false)) exitCode = 1
  }
  return exitCode
}

export function startGateway(options: GatewayOptions) {
  let gateway: ReturnType<typeof createGateway>
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.gatewayPort,
    maxRequestBodySize: 32 * 1024 * 1024,
    // SSE streams can remain quiet during a long model or tool operation.
    idleTimeout: 0,
    fetch(request) {
      return gateway(request)
    },
    error(error) {
      reportFailure('request', error)
      return Response.json(
        {
          type: 'error',
          error: {
            type: 'api_error',
            message:
              'The gateway could not reach the model provider. Check the proxy login and mesh route.',
          },
        },
        { status: 502 },
      )
    },
  })
  gateway = createGateway({ ...options, gatewayPort: server.port! })
  return server
}

export function gatewayOptions(config: v.InferOutput<typeof configSchema>): GatewayOptions {
  return {
    gatewayPort: config.gatewayPort,
    anthropicUrl: 'https://api.anthropic.com',
    proxyUrl: `http://127.0.0.1:${config.proxyPort}`,
    apiKey: config.apiKey,
    claudeProxy: config.claudeProxy && {
      proxyUrl: `http://127.0.0.1:${config.claudeProxy.proxyPort}`,
      apiKey: config.claudeProxy.apiKey,
    },
    claudePoolEntrypoints: config.claudePoolEntrypoints,
  }
}

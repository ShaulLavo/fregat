import * as v from 'valibot'
import { createGateway, type GatewayOptions } from './gateway'

const portSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535))
export const configSchema = v.pipe(
  v.object({
    binary: v.string(),
    proxyConfig: v.string(),
    proxyPort: portSchema,
    gatewayPort: portSchema,
    apiKey: v.pipe(v.string(), v.nonEmpty()),
  }),
  v.check(
    (config) => config.gatewayPort !== config.proxyPort,
    'Choose separate ports for the gateway and proxy.',
  ),
)
if (import.meta.main) {
  try {
    await run()
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
      fix: 'Check the runtime configuration, proxy login and mesh route.',
    })}\n`,
  )
}

async function run() {
  const config = v.parse(configSchema, await Bun.file(Bun.argv[2] ?? '').json())
  const server = startGateway(gatewayOptions(config))
  const proxy = Bun.spawn([config.binary, '-config', config.proxyConfig], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  function stop() {
    server.stop(true)
    proxy.kill('SIGTERM')
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  const exitCode = await proxy.exited
  server.stop(true)
  process.exit(exitCode)
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
  }
}

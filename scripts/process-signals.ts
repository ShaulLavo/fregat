export function installSignalHandlers(child: ReturnType<typeof Bun.spawn>) {
  const stop = (signal: NodeJS.Signals) => {
    child.kill(signal)
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

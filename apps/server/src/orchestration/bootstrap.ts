export async function bootstrapOrchestration(steps: {
  initialize: () => void
  catchUp: () => void
  load: () => void
  recover: () => Promise<void>
  startReactors: () => void
}) {
  await Promise.resolve()
  steps.initialize()
  steps.catchUp()
  steps.load()
  await steps.recover()
  steps.startReactors()
}

import type { Scenario } from './scenarios/index'

type ProviderAccessInput = {
  readonly scenario: Pick<Scenario, 'name' | 'readOnly' | 'realProviders' | 'surface'> | undefined
  /** The run starts its own throwaway server, whose Codex and Claude run fixture binaries only. */
  readonly isolatedServer: boolean
  /** The owner passed `--real-providers`. */
  readonly realProviders: boolean
}

/** Why a run must not start, or `null`: nothing reaches a real account without the owner's flag. */
export function providerAccessRefusal({
  scenario,
  isolatedServer,
  realProviders,
}: ProviderAccessInput) {
  if (realProviders || !scenario) return null
  if (scenario.realProviders)
    return `Scenario ${scenario.name} drives a real Codex or Claude account and spends real turns. It runs only when the owner passes --real-providers.`
  // Reads cannot start a turn, and site pages answer from a static preview.
  if (isolatedServer || scenario.readOnly || scenario.surface) return null

  return `Scenario ${scenario.name} would drive a server whose providers are real accounts. Drop --shared-dev and --url so the run gets a throwaway server with fixture providers; only the owner passes --real-providers.`
}

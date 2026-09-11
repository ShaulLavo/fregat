import type { OrchestrationSessionActivity } from '@workspace/contracts'
import { ProviderRuntimeIngestion, type ProviderRuntimeEvent } from 'server/testing'

export async function ingestProviderActivities(events: readonly ProviderRuntimeEvent[]) {
  const activities: OrchestrationSessionActivity[] = []
  const ingestion = new ProviderRuntimeIngestion(async (command) => {
    if (command.type === 'session.activity.append') activities.push(command.activity)
  })
  for (const event of events) await ingestion.ingest(event)

  return activities
}

import { healthDescriptorSchema } from '@workspace/contracts'
import { beforeAll } from 'vitest'
import * as v from 'valibot'
import { activeServerOrigin, getClient } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import './jest-dom'

beforeAll(async () => {
  const descriptor = v.parse(healthDescriptorSchema, (await getClient().health.get()).data)
  useEnvironmentsStore.getState().recordDescriptor(activeServerOrigin(), descriptor)
})

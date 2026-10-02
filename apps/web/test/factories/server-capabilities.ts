import { machineIdSchema, type EnvironmentId, type ServerCapabilities } from '@workspace/contracts'
import * as v from 'valibot'

export function serverCapabilities(
  environmentId: EnvironmentId,
  nativePicker = false,
): ServerCapabilities {
  return {
    machineId: v.parse(machineIdSchema, '0123456789abcdef0123456789abcdef'),
    environmentId,
    nativePicker,
  }
}

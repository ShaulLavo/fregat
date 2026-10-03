import { readSettingsMirror } from '@/lib/settings-boot-mirror'

export function updateRestartTimeoutMs(
  activationSeconds = readSettingsMirror()['server.activationTimeoutSeconds'],
): number {
  // Allow one activation budget for startup and one for the post-restart health check.
  return activationSeconds * 2000
}

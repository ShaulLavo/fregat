type AdapterInfo = Pick<
  GPUAdapterInfo,
  'vendor' | 'architecture' | 'description' | 'isFallbackAdapter'
>

export type DeviceReplacementQualification =
  | { kind: 'run' }
  | { kind: 'skip'; reason: string }
  | { kind: 'unresolved'; reason: string }

export function qualifyDeviceReplacement(
  _info: AdapterInfo,
  userAgent: string,
): DeviceReplacementQualification {
  if (userAgent.includes('Linux')) {
    return {
      kind: 'skip',
      reason: 'Linux SwiftShader cannot configure an independent replacement device.',
    }
  }
  return { kind: 'run' }
}

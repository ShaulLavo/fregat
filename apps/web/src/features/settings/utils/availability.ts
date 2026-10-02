import type { SettingId, SettingsValues } from '@workspace/contracts'

import { documentBackdrop, type ShellBackdrop } from '@/lib/platform/backdrop'
import { getPlatformBridge } from '@/lib/platform/bridge'

export type SettingEnvironment = {
  readonly backdrop: ShellBackdrop
  readonly nativeTransparency: boolean
  readonly platform?: string
  readonly windowAppearance?: boolean
  readonly windowGlass?: boolean
  readonly material?: SettingsValues['window.material']
}

export function settingEnvironment(
  material?: SettingsValues['window.material'],
): SettingEnvironment {
  const bridge = getPlatformBridge()
  return {
    backdrop: documentBackdrop(),
    platform: bridge?.platform,
    windowAppearance: typeof bridge?.setWindowAppearance === 'function',
    windowGlass: bridge?.capabilities?.windowGlass,
    nativeTransparency: bridge?.backdrop === 'transparent' || bridge?.backdrop === 'compositor',
    material,
  }
}

function supportsNativeMaterial(environment: SettingEnvironment): boolean {
  return (
    environment.platform === 'darwin' &&
    environment.backdrop === 'transparent' &&
    environment.windowAppearance === true
  )
}

/** Rows with an availability reason stay visible so the saved value can be inspected. */
export function settingAvailabilityReason(
  id: SettingId,
  environment: SettingEnvironment,
): string | null {
  const native = supportsNativeMaterial(environment)
  if (id === 'window.material' && !native) return 'Needs a transparent macOS app window.'
  if (
    (id === 'workbench.surface.opacity' || id === 'workbench.surface.contentOpacity') &&
    native &&
    environment.material &&
    environment.material !== 'none'
  ) {
    return 'Window material controls pane opacity.'
  }
  return null
}

export function materialOptionReason(
  option: string,
  environment: SettingEnvironment,
): string | null {
  if (option === 'glass' && environment.windowGlass !== true) return 'Glass needs macOS 26.'
  return null
}

export function isSettingAvailable(id: SettingId, environment: SettingEnvironment): boolean {
  if (id === 'workbench.surface.blur') return !supportsNativeMaterial(environment)
  if (id !== 'window.transparency') return true
  return environment.nativeTransparency && environment.backdrop !== 'app'
}

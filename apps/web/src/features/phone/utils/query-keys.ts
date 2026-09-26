import type { PhoneLevel } from '@/features/phone/utils/level'

export const phoneQueryKeys = {
  screenModule: (level: PhoneLevel) => ['phone', 'screen-module', level] as const,
}

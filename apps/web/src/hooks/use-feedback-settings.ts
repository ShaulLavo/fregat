import { hasNotificationSound } from '@workspace/contracts'
import { configureFeedback, type FeedbackChannel } from '@workspace/ui/patterns/feedback-layer'
import { useEffect } from 'react'

import { useSettingValue } from '@/hooks/use-setting-value'

/** Hands the sound settings to the feedback engine, which is the only place they are read. */
export function useFeedbackSettings() {
  const controls = useSettingValue('workbench.sounds.controls')
  const errors = useSettingValue('workbench.sounds.errors')
  const git = useSettingValue('workbench.sounds.git')
  const terminalBell = useSettingValue('workbench.sounds.terminalBell')
  const volume = useSettingValue('workbench.sounds.volume')
  const agent = hasNotificationSound(useSettingValue('chat.notificationMode'))

  useEffect(() => {
    const on: Record<FeedbackChannel, boolean> = {
      controls,
      errors,
      git,
      terminalBell,
      agent,
    }
    const channels = (Object.keys(on) as FeedbackChannel[]).filter((channel) => on[channel])
    configureFeedback({ channels, volume })
  }, [controls, errors, git, terminalBell, agent, volume])
}

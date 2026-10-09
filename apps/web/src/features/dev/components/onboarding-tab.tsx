import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'

import { Section } from '@/features/dev/components/section'
import { ChooseDialog } from '@/features/onboarding/components/choose-dialog'
import { EmptyChat } from '@/features/onboarding/components/empty-chat'
import { ProgressDialog } from '@/features/onboarding/components/progress-dialog'
import { ONBOARDING_SAMPLES, onboardingSample } from '@/features/dev/utils/onboarding-samples'

const MACHINE = 'omarchy'

/** The first-workspace screens over fixture state; `?dialog=<id>` opens one on load for captures. */
export function OnboardingTab() {
  const [shown, setShown] = useState(() =>
    onboardingSample(new URLSearchParams(window.location.search).get('dialog')),
  )
  const close = () => setShown(null)

  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-8 p-(--density-section-padding)'>
      <Section
        title='Empty chat'
        detail='No folder open. The composer waits for a project; both ways to choose one stay on screen.'
      >
        <div className='bg-background flex h-96 flex-col rounded-lg'>
          <EmptyChat
            machine={MACHINE}
            onChooseLocal={() => setShown('choose')}
            onChooseRemote={() => setShown('connecting')}
          />
        </div>
      </Section>
      <Section title='Dialog states' detail='Each step of the first-workspace flow.'>
        <div className='flex flex-wrap gap-(--density-control-gap)'>
          {ONBOARDING_SAMPLES.map((sample) => (
            <Button
              key={sample.id}
              size='sm'
              type='button'
              variant='secondary'
              onClick={() => setShown(sample.id)}
            >
              {sample.label}
            </Button>
          ))}
        </div>
      </Section>
      <ChooseDialog
        error={
          shown === 'error'
            ? 'The folder could not be opened. Check that the folder still exists on that machine, then try again.'
            : null
        }
        machine={MACHINE}
        open={shown === 'choose' || shown === 'error'}
        onLocal={close}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        onRemote={() => setShown('connecting')}
        onRetry={close}
      />
      {shown === 'connecting' ? (
        <ProgressDialog
          detail='Fregat lists the folders on build-box once it confirms which machine answered.'
          title='Connecting to build-box'
          onCancel={close}
        />
      ) : null}
      {shown === 'disconnected' ? (
        <ProgressDialog
          detail='Fregat lists the folders on build-box once it confirms which machine answered.'
          error='Cannot reach build-box. Check the address and try again.'
          title='build-box is not connected'
          onCancel={close}
        />
      ) : null}
      {shown === 'opening' ? (
        <ProgressDialog
          detail='The chat opens once build-box has the project ready.'
          title='Opening platform'
        />
      ) : null}
    </div>
  )
}

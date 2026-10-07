import type { useVoiceInput } from '../hooks/use-voice-input'

export function ChatInputDictationStatus({
  voice,
}: {
  readonly voice: ReturnType<typeof useVoiceInput>
}) {
  if (!voice.pending) return null
  let label = 'Preparing microphone…'
  if (voice.phase === 'recording') label = 'Listening…'
  if (voice.phase === 'transcribing') label = 'Transcribing…'
  const seconds = voice.elapsedSeconds
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <div className='flex min-w-0 items-center gap-2 px-3 pb-2 text-xs' data-dictation-status>
      <span className='text-muted-foreground shrink-0' role='status'>
        {label}
      </span>
      <span className='text-muted-foreground shrink-0 font-mono tabular-nums'>{elapsed}</span>
      {voice.preview ? (
        <span
          className='text-foreground flex min-w-0 flex-1 justify-end overflow-hidden'
          data-dictation-preview
          dir='auto'
          title={voice.preview}
        >
          <span className='min-w-full shrink-0 whitespace-nowrap'>{voice.preview}</span>
        </span>
      ) : null}
    </div>
  )
}

import { ChatTeardropDotsIcon } from '@phosphor-icons/react'

export function ChatWelcomeView() {
  return (
    <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center'>
      <div className='border-subtle bg-muted/40 text-muted-foreground flex size-11 items-center justify-center rounded-md border'>
        <ChatTeardropDotsIcon className='size-(--icon-size)' />
      </div>
      <div className='space-y-1'>
        <p className='text-foreground text-sm font-medium'>Ask about your workspace</p>
        <p className='text-muted-foreground text-xs leading-relaxed text-balance'>
          Reference files, run commands, or just start typing.
        </p>
      </div>
      <div className='text-muted-foreground text-2xs flex flex-wrap items-center justify-center gap-1.5'>
        <WelcomeHint glyph='@' label='mention files' />
        <WelcomeHint glyph='/' label='commands' />
      </div>
    </div>
  )
}

function WelcomeHint({ glyph, label }: { glyph: string; label: string }) {
  return (
    <span className='border-subtle bg-muted/40 inline-flex items-center gap-1.5 rounded-md border py-0.5 pr-2 pl-1.5'>
      <kbd className='text-foreground bg-background border-subtle text-3xs rounded-md border px-1 font-mono leading-none'>
        {glyph}
      </kbd>
      {label}
    </span>
  )
}

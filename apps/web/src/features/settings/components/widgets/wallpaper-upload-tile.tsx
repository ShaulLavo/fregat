import { UploadSimpleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import { useRef } from 'react'
import {
  ACCEPTED_WALLPAPER_TYPES,
  WALLPAPER_LIMITS_HINT,
} from '@/features/settings/utils/wallpaper-upload'

export function WallpaperUploadTile({
  disabled,
  uploading,
  dragging,
  onFiles,
}: {
  readonly disabled: boolean
  readonly uploading: boolean
  readonly dragging: boolean
  readonly onFiles: (files: readonly File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        variant='outline'
        className='data-[dragging=true]:border-primary text-muted-foreground h-auto min-h-24 w-full flex-col gap-1 border-dashed p-2 text-xs'
        data-dragging={dragging}
        title={WALLPAPER_LIMITS_HINT}
        disabled={disabled || uploading}
        onClick={() => input.current?.click()}
      >
        {uploading ? <Spinner /> : <UploadSimpleIcon aria-hidden='true' className='size-5' />}
        <span className='text-foreground'>{dragging ? 'Drop to add' : 'Add images'}</span>
        <span className='text-2xs'>Drop, paste or browse</span>
      </Button>
      <Input
        ref={input}
        type='file'
        multiple
        accept={ACCEPTED_WALLPAPER_TYPES.join(',')}
        aria-label='Upload wallpapers'
        className='sr-only'
        tabIndex={-1}
        onChange={(event) => {
          onFiles([...(event.currentTarget.files ?? [])])
          event.currentTarget.value = ''
        }}
      />
    </>
  )
}

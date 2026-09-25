import type { WallpaperAsset } from '@workspace/contracts'
import { toast } from 'sonner'
import { useWallpaperActions } from '@/features/settings/hooks/use-wallpaper-actions'
import { ACCEPTED_WALLPAPER_TYPES } from '@/features/settings/utils/wallpaper-upload'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

// Files go up in order and the last one to land is reported, so a drop of five selects one.
export function useWallpaperUpload(onUploaded: (asset: WallpaperAsset) => void) {
  const { upload } = useWallpaperActions()

  async function uploadOne(file: File) {
    if (!ACCEPTED_WALLPAPER_TYPES.includes(file.type)) {
      toast.error(`${file.name} was not added`, { description: 'Use a JPEG, PNG or WebP still.' })
      return null
    }
    try {
      return await upload.mutateAsync(file)
    } catch (error) {
      toastError(`${file.name} was not added`, { description: errorMessage(error, 'Try again.') })
      return null
    }
  }

  return async function uploadFiles(files: readonly File[]) {
    let last: WallpaperAsset | null = null
    for (const file of files) {
      last = (await uploadOne(file)) ?? last
    }
    if (last) onUploaded(last)
  }
}

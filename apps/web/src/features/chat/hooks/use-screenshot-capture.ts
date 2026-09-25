import { useIsMutating, useMutation } from '@tanstack/react-query'

import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { captureScreenshot, screenCaptureSupported } from '@/features/chat/utils/screenshot-capture'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { toastError } from '@/lib/toast-error'

/** Captures one frame and stages it through the same path as a picked file. */
export function useScreenshotCapture(scope: string, onCapture: (files: readonly File[]) => void) {
  const mutationKey = chatMutationKeys.screenshot(scope)
  const mutation = useMutation({
    mutationKey,
    mutationFn: () => captureScreenshot(navigator.mediaDevices),
    onSuccess: (file) => {
      if (file) onCapture([file])
    },
    onError: (error) =>
      toastError('Screenshot failed', {
        description: clientErrorDescription(toClientError(error)),
      }),
  })

  return {
    capture: () => mutation.mutate(),
    capturing: useIsMutating({ mutationKey }) > 0,
    supported: screenCaptureSupported(globalThis.navigator?.mediaDevices),
  }
}

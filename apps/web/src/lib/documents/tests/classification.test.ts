import { describe } from 'vitest'
import { expect, test } from '../../../../test/fixtures'
import {
  DOCUMENT_TARGET_CASES,
  INTERNAL_SETTINGS_DOCUMENT_IDS,
  INVALID_DOCUMENT_IDS,
  INVALID_SETTINGS_SURFACE_IDS,
} from '../../../../test/factories/document-targets'
import { decodeDocumentTarget } from '@/lib/documents/utils/codec'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { tabFileResource } from '@/lib/documents/utils/capabilities'

describe('typed file classification at the input boundary', () => {
  test.each(DOCUMENT_TARGET_CASES)(
    'classifies $kind without granting backing file ownership',
    ({ path, filePath }) => {
      const decoded = decodeDocumentTarget(path, filesystemPath('/repo'))
      const resource = decoded.kind === 'tab' ? tabFileResource(decoded.content) : null
      expect(resource?.path ?? null).toBe(filePath)
    },
  )

  test.each([...INVALID_DOCUMENT_IDS, ...INVALID_SETTINGS_SURFACE_IDS])(
    'rejects malformed target %s',
    (path) => {
      expect(decodeDocumentTarget(path, filesystemPath('')).kind).toBe('invalid')
    },
  )

  test.each(INTERNAL_SETTINGS_DOCUMENT_IDS)(
    'keeps internal settings member %s out of the filesystem namespace',
    (path) => {
      expect(decodeDocumentTarget(path, filesystemPath('')).kind).toBe('internal')
    },
  )
})

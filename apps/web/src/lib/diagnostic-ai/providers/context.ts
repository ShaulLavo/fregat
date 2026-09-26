import { createContext } from 'react'

import type { DiagnosticFixRequest } from '@/lib/diagnostic-ai/utils/prompt'

/**
 * Opens a new chat draft in the diagnostic's workspace with the prompt filled in. Resolves
 * false when no draft opened; rejects when the diagnostic no longer matches its file.
 */
export type RequestDiagnosticFix = (request: DiagnosticFixRequest) => Promise<boolean>

export const DiagnosticFixContext = createContext<RequestDiagnosticFix | null>(null)

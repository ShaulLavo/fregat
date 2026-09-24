// Registers the @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// against Vitest's expect. Shared by the happy-dom and browser projects.
import type {} from '@testing-library/jest-dom/vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { expect } from 'vitest'

// Not the package's `/vitest` entry: it imports the root-hoisted vitest, a second copy whose plugins
// wrap the shared chai's `throws` again and break `.rejects.toThrow(message)`.
expect.extend(matchers)

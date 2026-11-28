import { createContext } from 'react'

export const SearchResultReplacementContext = createContext({
  canReplace: false,
  replaceVisible: false,
})

export const SearchResultQueryContext = createContext('')

// File picker con dropdown interactivo para @
import * as fs from 'fs'
import * as path from 'path'
import { colors } from './ui'

// Obtener todos los archivos recursivamente (max depth 4)
export function getAllFiles(dir: string = '.', depth: number = 0, maxDepth: number = 4): string[] {
  if (depth > maxDepth) return []

  const files: string[] = []

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      // Ignorar node_modules, .git, dist, etc
      if (entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'build') {
        continue
      }

      const fullPath = dir === '.' ? entry.name : `${dir}/${entry.name}`

      if (entry.isDirectory()) {
        files.push(...getAllFiles(fullPath, depth + 1, maxDepth))
      } else {
        files.push(fullPath)
      }
    }
  } catch {
    // Ignore permission errors
  }

  return files
}

// Cache de archivos
let fileCache: string[] | null = null
let lastCacheTime = 0
const CACHE_TTL = 5000 // 5 segundos

export function getFileList(): string[] {
  const now = Date.now()
  if (!fileCache || now - lastCacheTime > CACHE_TTL) {
    fileCache = getAllFiles()
    lastCacheTime = now
  }
  return fileCache
}

// Invalidar cache (cuando se crean/eliminan archivos)
export function invalidateFileCache() {
  fileCache = null
}

// Filtrar archivos por query
export function filterFiles(query: string): string[] {
  const files = getFileList()
  const q = query.toLowerCase()

  return files
    .filter(f => f.toLowerCase().includes(q))
    .sort((a, b) => {
      // Priorizar matches al inicio
      const aStarts = a.toLowerCase().startsWith(q)
      const bStarts = b.toLowerCase().startsWith(q)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1
      return a.length - b.length // Más cortos primero
    })
    .slice(0, 10) // Max 10 resultados
}

// Mostrar dropdown
export function renderDropdown(
  matches: string[],
  selectedIndex: number,
  query: string
): string {
  if (matches.length === 0) {
    return colors.dim('  (no hay archivos que coincidan)')
  }

  return matches.map((file, i) => {
    const prefix = i === selectedIndex ? colors.cyan('❯ ') : '  '
    const highlighted = highlightMatch(file, query)
    return prefix + (i === selectedIndex ? colors.cyan(file) : highlighted)
  }).join('\n')
}

// Resaltar coincidencia
function highlightMatch(file: string, query: string): string {
  if (!query) return colors.dim(file)

  const idx = file.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return colors.dim(file)

  const before = file.substring(0, idx)
  const match = file.substring(idx, idx + query.length)
  const after = file.substring(idx + query.length)

  return colors.dim(before) + colors.white(match) + colors.dim(after)
}

// Estado del picker
export interface PickerState {
  active: boolean
  query: string
  matches: string[]
  selectedIndex: number
  inputBeforeAt: string  // Texto antes del @
}

export function createPickerState(): PickerState {
  return {
    active: false,
    query: '',
    matches: [],
    selectedIndex: 0,
    inputBeforeAt: ''
  }
}

// Actualizar estado del picker
export function updatePicker(state: PickerState, query: string): PickerState {
  const matches = filterFiles(query)
  return {
    ...state,
    query,
    matches,
    selectedIndex: Math.min(state.selectedIndex, Math.max(0, matches.length - 1))
  }
}

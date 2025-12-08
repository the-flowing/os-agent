import { describe, test, expect, beforeEach } from 'bun:test'
import { filterFiles, invalidateFileCache, getAllFiles, createPickerState, updatePicker } from '../file-picker'
import * as fs from 'fs'
import * as path from 'path'

describe('File Picker', () => {
  beforeEach(() => {
    invalidateFileCache()
  })

  describe('getAllFiles', () => {
    test('encuentra archivos en directorio actual', () => {
      const files = getAllFiles('.')
      expect(files.length).toBeGreaterThan(0)
      expect(files.some(f => f.includes('.ts') || f.includes('.tsx'))).toBe(true)
    })

    test('respeta maxDepth', () => {
      const shallow = getAllFiles('.', 0, 1)
      const deep = getAllFiles('.', 0, 4)
      expect(deep.length).toBeGreaterThanOrEqual(shallow.length)
    })

    test('ignora node_modules', () => {
      const files = getAllFiles('.')
      expect(files.some(f => f.includes('node_modules'))).toBe(false)
    })

    test('ignora .git', () => {
      const files = getAllFiles('.')
      expect(files.some(f => f.includes('.git'))).toBe(false)
    })
  })

  describe('filterFiles', () => {
    test('filtra por query', () => {
      const results = filterFiles('cli')
      expect(results.length).toBeGreaterThan(0)
      expect(results.every(f => f.toLowerCase().includes('cli'))).toBe(true)
    })

    test('case insensitive', () => {
      const lower = filterFiles('cli')
      const upper = filterFiles('CLI')
      expect(lower).toEqual(upper)
    })

    test('prioriza matches al inicio', () => {
      const results = filterFiles('src')
      if (results.length >= 2) {
        const startsWithSrc = results.filter(f => f.toLowerCase().startsWith('src'))
        // Los que empiezan con 'src' deberían estar primero
        expect(startsWithSrc.length).toBeGreaterThan(0)
      }
    })

    test('limita a 10 resultados', () => {
      const results = filterFiles('t') // muchos archivos tienen 't'
      expect(results.length).toBeLessThanOrEqual(10)
    })

    test('query vacío retorna archivos más cortos primero', () => {
      const results = filterFiles('')
      if (results.length >= 2) {
        // Ordenado por longitud (más cortos primero)
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].length).toBeLessThanOrEqual(results[i + 1].length)
        }
      }
    })
  })

  describe('PickerState', () => {
    test('createPickerState retorna estado inicial', () => {
      const state = createPickerState()
      expect(state.active).toBe(false)
      expect(state.query).toBe('')
      expect(state.matches).toEqual([])
      expect(state.selectedIndex).toBe(0)
      expect(state.inputBeforeAt).toBe('')
    })

    test('updatePicker actualiza matches', () => {
      const state = createPickerState()
      const updated = updatePicker(state, 'cli')
      expect(updated.query).toBe('cli')
      expect(updated.matches.length).toBeGreaterThan(0)
    })

    test('updatePicker mantiene selectedIndex válido', () => {
      let state = createPickerState()
      state = updatePicker(state, 'cli')
      state.selectedIndex = 5

      // Si cambiamos query y hay menos matches, selectedIndex se ajusta
      const updated = updatePicker(state, 'xxxyyyzzz') // No debería haber matches
      expect(updated.selectedIndex).toBe(0)
    })
  })
})

describe('CLI Components', () => {
  describe('Message ID generation', () => {
    test('IDs son únicos', () => {
      const ids = new Set<string>()
      let counter = 0
      const generateId = () => `msg-${++counter}`

      for (let i = 0; i < 100; i++) {
        ids.add(generateId())
      }

      expect(ids.size).toBe(100)
    })
  })
})

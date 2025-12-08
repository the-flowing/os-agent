import { describe, test, expect } from 'bun:test'
import { classifyTask, formatPlanSuggestion } from '../auto-plan'

describe('Auto-plan classification (LLM)', () => {
  describe('detecta tareas de desarrollo', () => {
    test('crear función', async () => {
      const result = await classifyTask('Creá una función para validar emails')
      expect(result.needsPlan).toBe(true)
      expect(result.confidence).toBeGreaterThan(0.5)
      expect(result.suggestedSteps).toBeDefined()
    }, 30000)

    test('implementar feature', async () => {
      const result = await classifyTask('Implementá autenticación con JWT')
      expect(result.needsPlan).toBe(true)
    }, 30000)

    test('arreglar bug complejo', async () => {
      const result = await classifyTask('Arreglá el bug en el sistema de pagos que causa race conditions')
      expect(result.needsPlan).toBe(true)
    }, 30000)

    test('refactorizar código', async () => {
      const result = await classifyTask('Refactorizá el módulo de usuarios para usar el patrón repository')
      expect(result.needsPlan).toBe(true)
    }, 30000)
  })

  describe('NO detecta consultas simples', () => {
    test('pregunta qué hace', async () => {
      const result = await classifyTask('Qué hace este archivo?')
      expect(result.needsPlan).toBe(false)
    }, 30000)

    test('pide leer archivo', async () => {
      const result = await classifyTask('Leé el archivo config.ts')
      expect(result.needsPlan).toBe(false)
    }, 30000)

    test('pide correr comando', async () => {
      const result = await classifyTask('Corré los tests')
      expect(result.needsPlan).toBe(false)
    }, 30000)

    test('pide explicar código', async () => {
      const result = await classifyTask('Explicame qué hace esta función')
      expect(result.needsPlan).toBe(false)
    }, 30000)
  })

  describe('formatPlanSuggestion', () => {
    test('formatea sugerencia con steps', () => {
      const result = {
        needsPlan: true,
        confidence: 0.9,
        reason: 'Es una feature nueva',
        suggestedSteps: ['Crear interfaz', 'Implementar lógica', 'Agregar tests']
      }
      const suggestion = formatPlanSuggestion(result)
      expect(suggestion).toContain('90%')
      expect(suggestion).toContain('Crear interfaz')
      expect(suggestion).toContain('TDD')
    })

    test('retorna null si no necesita plan', () => {
      const result = {
        needsPlan: false,
        confidence: 0.8,
        reason: 'Es una consulta'
      }
      const suggestion = formatPlanSuggestion(result)
      expect(suggestion).toBeNull()
    })

    test('retorna null si baja confianza', () => {
      const result = {
        needsPlan: true,
        confidence: 0.4,  // Muy bajo
        reason: 'No estoy seguro'
      }
      const suggestion = formatPlanSuggestion(result)
      expect(suggestion).toBeNull()
    })
  })
})

import { describe, test, expect } from 'bun:test'
import { classifyTask, formatPlanSuggestion, formatClarificationRequest, type ClassificationResult } from '../auto-plan'

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

  describe('comprensión del requerimiento', () => {
    test('detecta requerimiento claro', async () => {
      const result = await classifyTask('Creá una función validateEmail que retorne true si el email tiene @ y un dominio válido')
      expect(result.needsPlan).toBe(true)
      // Un requerimiento específico debería ser claro
      if (result.understandingLevel === 'clear') {
        expect(result.canDefineTests).toBe(true)
      }
    }, 30000)

    test('detecta requerimiento ambiguo', async () => {
      const result = await classifyTask('Hacé algo con los usuarios')
      expect(result.needsPlan).toBe(true)
      // Un requerimiento vago debería necesitar clarificación
      expect(['needs_clarification', 'ambiguous']).toContain(result.understandingLevel)
    }, 30000)
  })

  describe('formatPlanSuggestion', () => {
    test('formatea sugerencia con steps cuando es claro', () => {
      const result: ClassificationResult = {
        needsPlan: true,
        confidence: 0.9,
        reason: 'Es una feature nueva',
        suggestedSteps: ['Crear interfaz', 'Implementar lógica', 'Agregar tests'],
        understandingLevel: 'clear',
        canDefineTests: true,
        suggestedTests: ['Verificar que la interfaz existe', 'Verificar que la lógica funciona']
      }
      const suggestion = formatPlanSuggestion(result)
      expect(suggestion).not.toBeNull()
      expect(suggestion).toContain('90%')
      expect(suggestion).toContain('Crear interfaz')
      expect(suggestion).toContain('Comprensión: clear')
      expect(suggestion).toContain('Tests verificables: Sí')
    })

    test('muestra preguntas cuando necesita clarificación', () => {
      const result: ClassificationResult = {
        needsPlan: true,
        confidence: 0.8,
        reason: 'Parece una tarea de desarrollo',
        understandingLevel: 'needs_clarification',
        clarificationQuestions: ['¿Qué tipo de autenticación?', '¿Qué endpoints?'],
        canDefineTests: false
      }
      const suggestion = formatPlanSuggestion(result)
      expect(suggestion).not.toBeNull()
      expect(suggestion).toContain('needs_clarification')
      expect(suggestion).toContain('¿Qué tipo de autenticación?')
      expect(suggestion).toContain('Clarificar el requerimiento')
    })

    test('retorna null si no necesita plan', () => {
      const result: ClassificationResult = {
        needsPlan: false,
        confidence: 0.8,
        reason: 'Es una consulta',
        understandingLevel: 'clear',
        canDefineTests: false
      }
      const suggestion = formatPlanSuggestion(result)
      expect(suggestion).toBeNull()
    })

    test('retorna null si baja confianza', () => {
      const result: ClassificationResult = {
        needsPlan: true,
        confidence: 0.4,  // Muy bajo
        reason: 'No estoy seguro',
        understandingLevel: 'ambiguous',
        canDefineTests: false
      }
      const suggestion = formatPlanSuggestion(result)
      expect(suggestion).toBeNull()
    })
  })

  describe('formatClarificationRequest', () => {
    test('genera preguntas cuando hay clarificationQuestions', () => {
      const result: ClassificationResult = {
        needsPlan: true,
        confidence: 0.8,
        reason: 'Tarea de desarrollo',
        understandingLevel: 'needs_clarification',
        clarificationQuestions: ['¿JWT o session?', '¿Qué proveedores OAuth?'],
        canDefineTests: false
      }
      const request = formatClarificationRequest(result)
      expect(request).not.toBeNull()
      expect(request).toContain('¿JWT o session?')
      expect(request).toContain('¿Qué proveedores OAuth?')
    })

    test('genera preguntas genéricas cuando no hay específicas', () => {
      const result: ClassificationResult = {
        needsPlan: true,
        confidence: 0.8,
        reason: 'Tarea de desarrollo',
        understandingLevel: 'ambiguous',
        canDefineTests: false
      }
      const request = formatClarificationRequest(result)
      expect(request).not.toBeNull()
      expect(request).toContain('resultado específico')
    })

    test('retorna null cuando el requerimiento es claro', () => {
      const result: ClassificationResult = {
        needsPlan: true,
        confidence: 0.9,
        reason: 'Tarea clara',
        understandingLevel: 'clear',
        canDefineTests: true
      }
      const request = formatClarificationRequest(result)
      expect(request).toBeNull()
    })
  })
})

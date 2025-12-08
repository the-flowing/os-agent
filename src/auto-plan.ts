// Auto-detección de tareas de desarrollo usando LLM
import OpenAI from 'openai'
import { getConfig } from './config'

const config = getConfig()

const openai = new OpenAI({
  baseURL: config.baseURL,
  apiKey: config.apiKey
})

export interface ClassificationResult {
  needsPlan: boolean
  confidence: number  // 0-1
  reason: string
  suggestedSteps?: string[]  // Si needsPlan=true, sugerencias de steps
}

const CLASSIFIER_PROMPT = `Sos un clasificador de tareas de programación. Tu trabajo es determinar si una tarea del usuario requiere crear un PLAN DE DESARROLLO con TDD (Test-Driven Development).

NECESITA PLAN (needsPlan: true):
- Crear funciones, módulos, clases, componentes nuevos
- Implementar features o funcionalidades
- Arreglar bugs complejos
- Refactorizar código existente
- Agregar nuevas capacidades
- Escribir tests para código existente
- Migraciones de código
- Optimizaciones que requieren cambios de código

NO NECESITA PLAN (needsPlan: false):
- Preguntas sobre código ("qué hace esto?", "cómo funciona?")
- Leer archivos
- Ejecutar comandos (correr tests, npm install, git status)
- Explicaciones
- Búsquedas en código
- Tareas triviales (cambiar un string, agregar un import)
- Consultas generales

Respondé SOLO con JSON válido, sin markdown ni explicaciones:
{
  "needsPlan": true/false,
  "confidence": 0.0-1.0,
  "reason": "explicación corta",
  "suggestedSteps": ["step1", "step2"] // solo si needsPlan=true
}`

export async function classifyTask(userInput: string): Promise<ClassificationResult> {
  try {
    const response = await openai.chat.completions.create({
      model: config.model,
      max_tokens: 500,
      temperature: 0,  // Determinístico
      messages: [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user', content: userInput }
      ]
    })

    const content = response.choices[0]?.message?.content || ''

    // Parsear JSON (puede venir con ```json wrapper)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {
        needsPlan: false,
        confidence: 0.5,
        reason: 'No se pudo clasificar'
      }
    }

    const result = JSON.parse(jsonMatch[0])

    return {
      needsPlan: Boolean(result.needsPlan),
      confidence: Number(result.confidence) || 0.5,
      reason: String(result.reason || ''),
      suggestedSteps: result.suggestedSteps
    }
  } catch (error) {
    // En caso de error, asumir que no necesita plan
    return {
      needsPlan: false,
      confidence: 0.3,
      reason: `Error clasificando: ${error instanceof Error ? error.message : 'desconocido'}`
    }
  }
}

// Versión rápida con cache simple (evita llamadas repetidas)
const classificationCache = new Map<string, ClassificationResult>()

export async function classifyTaskCached(userInput: string): Promise<ClassificationResult> {
  // Normalizar input para cache
  const key = userInput.toLowerCase().trim().substring(0, 200)

  if (classificationCache.has(key)) {
    return classificationCache.get(key)!
  }

  const result = await classifyTask(userInput)
  classificationCache.set(key, result)

  // Limpiar cache si crece mucho
  if (classificationCache.size > 100) {
    const firstKey = classificationCache.keys().next().value
    if (firstKey) classificationCache.delete(firstKey)
  }

  return result
}

// Helper para mostrar sugerencia al usuario
export function formatPlanSuggestion(result: ClassificationResult): string | null {
  if (!result.needsPlan || result.confidence < 0.6) {
    return null
  }

  let msg = `💡 Esto parece una tarea de desarrollo (${Math.round(result.confidence * 100)}% seguro)\n`
  msg += `   Razón: ${result.reason}\n`

  if (result.suggestedSteps && result.suggestedSteps.length > 0) {
    msg += `   Steps sugeridos:\n`
    result.suggestedSteps.forEach((step, i) => {
      msg += `     ${i + 1}. ${step}\n`
    })
  }

  msg += `\n¿Querés que cree un plan con TDD? (s/n)`

  return msg
}

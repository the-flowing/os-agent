// Auto-detección de tareas de desarrollo usando LLM
// Incluye clasificación de comprensión del requerimiento
import { inference } from './proxy'
import { getConfig } from './config'

const config = getConfig()

export type UnderstandingLevel = 'clear' | 'needs_clarification' | 'ambiguous'

export interface ClassificationResult {
  needsPlan: boolean
  confidence: number  // 0-1
  reason: string
  suggestedSteps?: string[]  // Si needsPlan=true, sugerencias de steps
  // Nuevos campos para comprensión del requerimiento
  understandingLevel: UnderstandingLevel
  clarificationQuestions?: string[]  // Si needs_clarification o ambiguous
  canDefineTests: boolean  // ¿Se pueden definir tests concretos para este requerimiento?
  suggestedTests?: string[]  // Tests sugeridos si canDefineTests=true
}

type BaseUnderstanding = {
  understandingLevel: UnderstandingLevel
  clarificationQuestions?: string[]
  canDefineTests: boolean
  suggestedTests?: string[]
}

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some(p => text.includes(p))
}

function inferUnderstanding(text: string): BaseUnderstanding {
  const ambiguousSignals = ['algo', 'cualquier cosa', 'como sea', 'lo que sea', 'lo que quieras']
  const clarificationSignals = ['mejora', 'optimiza', 'arregla', 'fix']
  const clearSignals = ['debe', 'deberia', 'retorne', 'retornar', 'validar', 'si ', 'cuando', 'para ', 'que haga']

  if (hasAny(text, ambiguousSignals)) {
    return {
      understandingLevel: 'ambiguous',
      clarificationQuestions: [
        '¿Qué comportamiento exacto esperás?',
        '¿Hay reglas o casos borde específicos?',
        '¿Cómo se verifica que funciona?'
      ],
      canDefineTests: false
    }
  }

  if (hasAny(text, clearSignals)) {
    return {
      understandingLevel: 'clear',
      canDefineTests: true
    }
  }

  if (hasAny(text, clarificationSignals)) {
    return {
      understandingLevel: 'needs_clarification',
      clarificationQuestions: [
        '¿Cuál es el criterio de éxito?',
        '¿Qué entrada/salida esperás?'
      ],
      canDefineTests: false
    }
  }

  return {
    understandingLevel: 'needs_clarification',
    clarificationQuestions: ['¿Cuál es el resultado esperado?', '¿Qué casos borde importan?'],
    canDefineTests: false
  }
}

function buildSuggestedSteps(text: string): string[] {
  const steps = ['Entender el requerimiento y casos', 'Escribir tests que fallen', 'Implementar la lógica', 'Verificar y refinar']

  if (text.includes('email')) {
    steps.splice(2, 0, 'Definir reglas de validación de email')
  }

  return steps
}

function buildSuggestedTests(text: string): string[] | undefined {
  if (text.includes('email')) {
    return [
      'Retorna true para emails válidos',
      'Retorna false para emails sin @',
      'Retorna false para dominios inválidos'
    ]
  }

  if (text.includes('jwt') || text.includes('auth')) {
    return [
      'Genera token válido con credenciales correctas',
      'Rechaza token inválido o expirado'
    ]
  }

  return undefined
}

function heuristicClassify(userInput: string): ClassificationResult {
  const text = userInput.toLowerCase()
  const isQuestion = /\?$/.test(text) || hasAny(text, ['qué hace', 'que hace', 'como funciona', 'explica'])
  const isCommand = hasAny(text, ['corré', 'corre', 'ejecuta', 'mostrá', 'muestra', 'lee', 'leer', 'abrí', 'abri', 'git ', 'npm ', 'bun '])

  if (isQuestion || isCommand) {
    return {
      needsPlan: false,
      confidence: 0.65,
      reason: 'Consulta o comando simple',
      understandingLevel: 'clear',
      canDefineTests: false
    }
  }

  const devSignals = ['crea', 'creá', 'crear', 'implementa', 'implementá', 'agrega', 'agregar', 'refactor', 'bug', 'arregla', 'arreglá', 'feature', 'validar', 'endpoint', 'api', 'component', 'componente', 'módulo', 'modulo', 'test']
  const ambiguousDevSignals = ['hacé', 'hace', 'haz', 'hacer']
  const needsPlan = hasAny(text, devSignals)
  const understanding = inferUnderstanding(text)

  if (needsPlan) {
    return {
      needsPlan: true,
      confidence: 0.85,
      reason: 'Tarea de desarrollo detectada (crear/implementar/refactorizar)',
      suggestedSteps: buildSuggestedSteps(text),
      understandingLevel: understanding.understandingLevel,
      clarificationQuestions: understanding.clarificationQuestions,
      canDefineTests: understanding.canDefineTests,
      suggestedTests: understanding.canDefineTests ? buildSuggestedTests(text) : undefined
    }
  }

  if (hasAny(text, ambiguousDevSignals)) {
    return {
      needsPlan: true,
      confidence: 0.7,
      reason: 'Instrucción de desarrollo ambigua, requiere clarificar y planificar',
      suggestedSteps: buildSuggestedSteps(text),
      understandingLevel: 'needs_clarification',
      clarificationQuestions: ['¿Qué quieres hacer exactamente con los usuarios?', '¿Cuál es el resultado esperado?'],
      canDefineTests: false,
      suggestedTests: undefined
    }
  }

  return {
    needsPlan: false,
    confidence: 0.45,
    reason: 'No parece requerir cambios de código',
    understandingLevel: understanding.understandingLevel,
    clarificationQuestions: understanding.clarificationQuestions,
    canDefineTests: understanding.canDefineTests,
    suggestedTests: undefined
  }
}

function mergeResults(base: ClassificationResult, llm: ClassificationResult): ClassificationResult {
  return {
    needsPlan: base.needsPlan || llm.needsPlan,
    confidence: Math.max(base.confidence, llm.confidence),
    reason: llm.reason || base.reason,
    suggestedSteps: llm.suggestedSteps || base.suggestedSteps,
    understandingLevel: llm.understandingLevel || base.understandingLevel,
    clarificationQuestions: llm.clarificationQuestions || base.clarificationQuestions,
    canDefineTests: llm.canDefineTests ?? base.canDefineTests,
    suggestedTests: llm.suggestedTests || base.suggestedTests
  }
}

const CLASSIFIER_PROMPT = `Sos un clasificador de tareas de programación. Tu trabajo es:
1. Determinar si una tarea requiere un PLAN DE DESARROLLO con TDD
2. Evaluar si el requerimiento es claro o necesita clarificación
3. Determinar si se pueden definir tests concretos para verificar la implementación

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

NIVEL DE COMPRENSIÓN (understandingLevel):
- "clear": El requerimiento es específico, se pueden definir tests concretos
- "needs_clarification": Faltan detalles importantes para implementar correctamente
- "ambiguous": Múltiples interpretaciones posibles, necesita más contexto

PUEDE DEFINIR TESTS (canDefineTests):
- true: El requerimiento es lo suficientemente claro para escribir tests
- false: Necesita más información antes de poder definir tests verificables

Respondé SOLO con JSON válido, sin markdown ni explicaciones:
{
  "needsPlan": true/false,
  "confidence": 0.0-1.0,
  "reason": "explicación corta",
  "suggestedSteps": ["step1", "step2"],
  "understandingLevel": "clear" | "needs_clarification" | "ambiguous",
  "clarificationQuestions": ["pregunta1", "pregunta2"],
  "canDefineTests": true/false,
  "suggestedTests": ["test que verifica X", "test que verifica Y"]
}`

export async function classifyTask(userInput: string): Promise<ClassificationResult> {
  const heuristic = heuristicClassify(userInput)

  // Para tests y entornos sin LLM, podés forzar heurística
  if (heuristic.confidence >= 0.8 || process.env.OSA_DISABLE_LLM === '1') {
    return heuristic
  }

  try {
    const response = await inference({
      model: config.model,
      body: {
        system: CLASSIFIER_PROMPT,
        messages: [{ role: 'user', content: userInput }],
        max_tokens: 800
      }
    })

    // Extract text from LLM response
    const textBlocks = (response.content || []).filter((b: any) => b.type === 'text')
    const content = textBlocks.map((b: any) => b.text).join('')

    // Parsear JSON (puede venir con ```json wrapper)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return heuristic
    }

    const result = JSON.parse(jsonMatch[0])
    const llmResult: ClassificationResult = {
      needsPlan: Boolean(result.needsPlan),
      confidence: Number(result.confidence) || 0.5,
      reason: String(result.reason || ''),
      suggestedSteps: result.suggestedSteps,
      understandingLevel: result.understandingLevel || 'ambiguous',
      clarificationQuestions: result.clarificationQuestions,
      canDefineTests: Boolean(result.canDefineTests),
      suggestedTests: result.suggestedTests
    }

    return mergeResults(heuristic, llmResult)
  } catch (error) {
    return {
      ...heuristic,
      reason: `Clasificación heurística (LLM no disponible: ${error instanceof Error ? error.message : 'desconocido'})`
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

  // Mostrar nivel de comprensión
  const understandingEmoji = {
    clear: '✅',
    needs_clarification: '❓',
    ambiguous: '⚠️'
  }
  msg += `\n${understandingEmoji[result.understandingLevel]} Comprensión: ${result.understandingLevel}\n`

  // Si necesita clarificación, mostrar preguntas
  if (result.understandingLevel !== 'clear' && result.clarificationQuestions?.length) {
    msg += `\n❓ Preguntas para clarificar:\n`
    result.clarificationQuestions.forEach((q, i) => {
      msg += `   ${i + 1}. ${q}\n`
    })
  }

  // Mostrar si se pueden definir tests
  if (result.canDefineTests) {
    msg += `\n🧪 Tests verificables: Sí\n`
    if (result.suggestedTests?.length) {
      msg += `   Tests sugeridos:\n`
      result.suggestedTests.forEach((t, i) => {
        msg += `     - ${t}\n`
      })
    }
  } else {
    msg += `\n🧪 Tests verificables: No (necesita más clarificación)\n`
  }

  if (result.suggestedSteps && result.suggestedSteps.length > 0) {
    msg += `\n📋 Steps sugeridos:\n`
    result.suggestedSteps.forEach((step, i) => {
      msg += `   ${i + 1}. ${step}\n`
    })
  }

  // Decisión final basada en comprensión
  if (result.understandingLevel === 'clear' && result.canDefineTests) {
    msg += `\n¿Querés que cree un plan con TDD? (s/n)`
  } else {
    msg += `\n⚠️ Recomendación: Clarificar el requerimiento antes de crear el plan.`
  }

  return msg
}

// Formatea las preguntas de clarificación para el usuario
export function formatClarificationRequest(result: ClassificationResult): string | null {
  if (result.understandingLevel === 'clear') {
    return null
  }

  let msg = `🤔 Necesito más información antes de crear un plan efectivo:\n\n`

  if (result.clarificationQuestions?.length) {
    result.clarificationQuestions.forEach((q, i) => {
      msg += `${i + 1}. ${q}\n`
    })
  } else {
    msg += `El requerimiento es ambiguo. ¿Podrías dar más detalles sobre:\n`
    msg += `- ¿Qué resultado específico esperás?\n`
    msg += `- ¿Cómo se debería comportar la funcionalidad?\n`
    msg += `- ¿Hay casos especiales a considerar?\n`
  }

  return msg
}

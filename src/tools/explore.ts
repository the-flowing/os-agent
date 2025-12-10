// Tool: explorar codebase para obtener contexto antes de planificar
// Levanta un sub-agente que investiga y devuelve un resumen compacto

import { inference } from '../proxy'
import { getConfig } from '../config'
import { execute as executeGlob } from './glob'
import { execute as executeGrep } from './grep'
import { execute as executeRead } from './read'

const config = getConfig()

export const definition = {
  name: 'explore',
  description: `Explora el codebase para obtener contexto antes de planificar.

Usar ANTES de crear un plan cuando necesitás entender:
- Qué tecnologías/frameworks usa el proyecto
- Cómo está estructurado el código
- Cómo funcionan features existentes relacionadas
- Dónde están ciertos archivos o funciones

Devuelve un resumen compacto con la información encontrada.
Si algo NO está en el código, lo indica para que puedas preguntar al usuario.`,
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Lista de preguntas/temas a investigar en el codebase',
        items: { type: 'string' }
      },
      context: {
        type: 'string',
        description: 'Contexto adicional sobre qué está pidiendo el usuario'
      }
    },
    required: ['questions']
  }
}

interface ExploreParams {
  questions: string[]
  context?: string
}

const EXPLORER_PROMPT = `Sos un explorador de código. Tu trabajo es investigar un codebase para responder preguntas específicas.

REGLAS:
1. Usá las tools disponibles (glob, grep, read) para encontrar información
2. Sé conciso - solo reportá lo relevante
3. Si algo NO está en el código, decilo claramente: "[NO ENCONTRADO: X]"
4. No inventes información - solo reportá lo que encontrás
5. Máximo 3-4 tool calls por pregunta

FORMATO DE RESPUESTA:
Para cada pregunta, respondé con:
- La respuesta encontrada
- Los archivos relevantes
- O "[NO ENCONTRADO]" si no está en el código

Sé breve y directo.`

// Tools disponibles para el explorador
const explorerTools = [
  {
    name: 'glob',
    description: 'Buscar archivos por patrón. Ej: **/*.ts, src/**/*.tsx',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Patrón glob' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'grep',
    description: 'Buscar texto en archivos. Usa ripgrep.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Patrón de búsqueda (regex)' },
        path: { type: 'string', description: 'Directorio donde buscar' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'read',
    description: 'Leer contenido de un archivo',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del archivo' }
      },
      required: ['path']
    }
  }
]

async function executeExplorerTool(name: string, params: any): Promise<string> {
  switch (name) {
    case 'glob':
      return await executeGlob({ pattern: params.pattern })
    case 'grep':
      return await executeGrep({ pattern: params.pattern, path: params.path || '.' })
    case 'read':
      return await executeRead({ path: params.path })
    default:
      return `Tool desconocida: ${name}`
  }
}

export async function execute(params: ExploreParams): Promise<string> {
  const { questions, context } = params

  // Construir el mensaje inicial
  const userMessage = `${context ? `Contexto: ${context}\n\n` : ''}Preguntas a investigar:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Investigá el codebase y respondé cada pregunta.`

  const messages: any[] = [{ role: 'user', content: userMessage }]

  // Loop de exploración (máximo 10 iteraciones para evitar loops infinitos)
  let iterations = 0
  const maxIterations = 10

  while (iterations < maxIterations) {
    iterations++

    const response = await inference({
      model: config.model,
      body: {
        system: EXPLORER_PROMPT,
        messages,
        tools: explorerTools,
        max_tokens: 2000
      }
    })

    // Procesar respuesta
    const content = response.content || []
    let hasToolUse = false
    let textResponse = ''

    for (const block of content) {
      if (block.type === 'text') {
        textResponse += block.text
      } else if (block.type === 'tool_use') {
        hasToolUse = true
        const toolResult = await executeExplorerTool(block.name, block.input)

        // Agregar al historial
        messages.push({ role: 'assistant', content })
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult.substring(0, 3000) // Limitar tamaño
          }]
        })
        break // Procesar un tool call a la vez
      }
    }

    // Si no hay tool calls, terminamos
    if (!hasToolUse) {
      return `📋 EXPLORACIÓN COMPLETADA\n\n${textResponse}`
    }

    // Si el response solo fue tool_use sin texto, continuamos
    if (response.stop_reason === 'end_turn' && textResponse) {
      return `📋 EXPLORACIÓN COMPLETADA\n\n${textResponse}`
    }
  }

  return '⚠️ Exploración terminada por límite de iteraciones. Resultados parciales disponibles.'
}

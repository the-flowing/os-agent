// Cliente con streaming para CLI interactivo
import OpenAI from 'openai'
import { getConfig } from './config'
import { getToolDefinitions, executeTool } from './tool-loader'
import { ConversationHistory } from './history'
import { colors, print, Spinner } from './ui'

const config = getConfig()

const openai = new OpenAI({
  baseURL: config.baseURL,
  apiKey: config.apiKey
})

// Callbacks para UI
export interface StreamCallbacks {
  onToken?: (token: string) => void
  onToolStart?: (name: string, params: Record<string, unknown>) => void
  onToolEnd?: (name: string, result: string, params: Record<string, unknown>) => void | Promise<void>
  onToolError?: (name: string, error: string) => void
  onThinking?: () => void
  onDone?: () => void
}

// Convertir tools a formato OpenAI
async function getOpenAITools(): Promise<OpenAI.ChatCompletionTool[]> {
  const tools = await getToolDefinitions()
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema as Record<string, unknown>
    }
  }))
}

// Chat con streaming
export async function streamChat(
  userMessage: string,
  history: ConversationHistory,
  callbacks: StreamCallbacks = {}
): Promise<{ toolsUsed: string[] }> {
  const tools = await getOpenAITools()
  const toolsUsed: string[] = []

  history.addUser(userMessage)

  let continueLoop = true

  while (continueLoop) {
    callbacks.onThinking?.()

    const stream = await openai.chat.completions.create({
      model: config.model,
      max_tokens: 8096,
      tools,
      messages: history.getMessages(),
      stream: true
    })

    let assistantContent = ''
    let currentToolCalls: OpenAI.ChatCompletionMessageToolCall[] = []
    let toolCallsInProgress: Record<string, { name: string; arguments: string }> = {}

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      // Contenido de texto
      if (delta?.content) {
        assistantContent += delta.content
        callbacks.onToken?.(delta.content)
      }

      // Tool calls (pueden venir en chunks)
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index

          if (!toolCallsInProgress[index]) {
            toolCallsInProgress[index] = { name: '', arguments: '' }
          }

          if (toolCallDelta.function?.name) {
            toolCallsInProgress[index].name = toolCallDelta.function.name
          }
          if (toolCallDelta.function?.arguments) {
            toolCallsInProgress[index].arguments += toolCallDelta.function.arguments
          }
          if (toolCallDelta.id) {
            // Tool call completo
            currentToolCalls[index] = {
              id: toolCallDelta.id,
              type: 'function',
              function: {
                name: toolCallsInProgress[index].name,
                arguments: toolCallsInProgress[index].arguments
              }
            }
          }
        }
      }
    }

    // Agregar mensaje del asistente al historial
    const assistantMessage: OpenAI.ChatCompletionMessage = {
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: currentToolCalls.length > 0 ? currentToolCalls.filter(Boolean) : undefined,
      refusal: null
    }
    history.addToolCall(assistantMessage)

    // Ejecutar tool calls si hay
    if (currentToolCalls.length > 0 && currentToolCalls.some(Boolean)) {
      let shouldStopAfterTools = false

      for (const toolCall of currentToolCalls.filter(Boolean)) {
        const toolName = toolCall.function.name
        toolsUsed.push(toolName)

        const params = JSON.parse(toolCall.function.arguments || '{}')
        callbacks.onToolStart?.(toolName, params)

        try {
          const result = await executeTool(toolName, params)

          await callbacks.onToolEnd?.(toolName, result, params)
          history.addToolResult(toolCall.id, result)

          // Tools que terminan el loop (no necesitan respuesta adicional)
          const planActionsToStop = ['create', 'approve', 'cancel', 'batch_update', 'update_step', 'add_step', 'remove_step']
          if (toolName === 'plan' && planActionsToStop.includes(params.action as string)) {
            shouldStopAfterTools = true
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Error desconocido'
          callbacks.onToolError?.(toolName, errorMsg)
          history.addToolResult(toolCall.id, `Error: ${errorMsg}`)
        }
      }

      // Si una tool indica que debe terminar, cortamos el loop
      if (shouldStopAfterTools) {
        continueLoop = false
      }
      // Si no, continúa el loop para que el modelo responda
    } else {
      // No hay tool calls, terminamos
      continueLoop = false
      if (assistantContent) {
        // Ya se agregó al historial arriba
      }
    }
  }

  callbacks.onDone?.()
  return { toolsUsed }
}

// Versión no-streaming (para tests)
export async function chatWithHistory(
  userMessage: string,
  history: ConversationHistory
): Promise<{ text: string; toolsUsed: string[] }> {
  let fullText = ''

  const result = await streamChat(userMessage, history, {
    onToken: (token) => { fullText += token }
  })

  return { text: fullText, toolsUsed: result.toolsUsed }
}

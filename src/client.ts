// Cliente usando formato OpenAI (compatible con el proxy)
import OpenAI from 'openai'
import { getConfig } from './config'
import { getToolDefinitions, executeTool } from './tool-loader'

const config = getConfig()

export const client = new OpenAI({
  baseURL: config.baseURL,
  apiKey: config.apiKey
})

export interface ChatOptions {
  system?: string
  messages?: OpenAI.ChatCompletionMessageParam[]
}

export interface ChatResult {
  text: string
  toolCallCount: number
  toolsUsed: string[]
}

// Convertir tools de formato Anthropic a OpenAI
async function getOpenAITools(): Promise<OpenAI.ChatCompletionTool[]> {
  const anthropicTools = await getToolDefinitions()

  return anthropicTools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema as Record<string, unknown>
    }
  }))
}

// Chat stateless - para tests
export async function chat(
  userMessage: string,
  options: ChatOptions = {}
): Promise<ChatResult> {
  const tools = await getOpenAITools()
  const messages: OpenAI.ChatCompletionMessageParam[] = options.messages || []

  // System message
  if (options.system || !messages.some(m => m.role === 'system')) {
    messages.unshift({
      role: 'system',
      content: options.system || 'Sos un asistente de programación. Usá las tools disponibles para completar tareas.'
    })
  }

  messages.push({ role: 'user', content: userMessage })

  let toolCallCount = 0
  const toolsUsed: string[] = []

  let response = await client.chat.completions.create({
    model: config.model,
    max_tokens: 8096,
    tools,
    messages
  })

  let assistantMessage = response.choices[0].message
  messages.push(assistantMessage)

  // Loop de tool calls
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    for (const toolCall of assistantMessage.tool_calls) {
      toolCallCount++
      toolsUsed.push(toolCall.function.name)

      const params = JSON.parse(toolCall.function.arguments || '{}')
      const result = await executeTool(toolCall.function.name, params)

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result
      })
    }

    response = await client.chat.completions.create({
      model: config.model,
      max_tokens: 8096,
      tools,
      messages
    })

    assistantMessage = response.choices[0].message
    messages.push(assistantMessage)
  }

  return {
    text: assistantMessage.content || '',
    toolCallCount,
    toolsUsed
  }
}

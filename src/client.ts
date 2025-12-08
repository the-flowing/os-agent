// Cliente usando inference() directo (sin HTTP)
import { inference } from './proxy'
import { getConfig } from './config'
import { getToolDefinitions, executeTool } from './tool-loader'

const config = getConfig()

export interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

export interface ChatOptions {
  system?: string
  messages?: Message[]
}

export interface ChatResult {
  text: string
  toolCallCount: number
  toolsUsed: string[]
}

// Chat stateless - para tests
export async function chat(
  userMessage: string,
  options: ChatOptions = {}
): Promise<ChatResult> {
  const tools = await getToolDefinitions()
  const messages: Message[] = options.messages ? [...options.messages] : []
  const system = options.system || 'Sos un asistente de programación. Usá las tools disponibles para completar tareas.'

  messages.push({ role: 'user', content: userMessage })

  let toolCallCount = 0
  const toolsUsed: string[] = []

  let response = await inference({
    model: config.model,
    body: {
      system,
      messages,
      tools,
      max_tokens: 8096
    }
  })

  // Loop de tool calls
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = (response.content as ContentBlock[]).filter(
      (b: ContentBlock) => b.type === 'tool_use'
    )

    const toolResults: ContentBlock[] = []

    for (const toolUse of toolUseBlocks) {
      toolCallCount++
      toolsUsed.push(toolUse.name!)

      const result = await executeTool(toolUse.name!, toolUse.input || {})
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result
      })
    }

    // Add assistant response and tool results
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })

    response = await inference({
      model: config.model,
      body: {
        system,
        messages,
        tools,
        max_tokens: 8096
      }
    })
  }

  // Extract text from response
  const textBlocks = (response.content as ContentBlock[]).filter(
    (b: ContentBlock) => b.type === 'text'
  )
  const text = textBlocks.map((b: ContentBlock) => b.text).join('')

  return {
    text,
    toolCallCount,
    toolsUsed
  }
}

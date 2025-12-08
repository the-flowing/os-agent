// Cliente con streaming para CLI interactivo (sin HTTP)
import { inferenceStream } from './proxy'
import { getToolDefinitions, executeTool } from './tool-loader'
import { ConversationHistory } from './history'
import { parseStreamEvent as parseCodexStreamEvent, createStreamState as createCodexStreamState } from './providers/chatgpt'
import { parseStreamEvent as parseGeminiStreamEvent, createStreamState as createGeminiStreamState } from './providers/gemini'
import type { Provider } from './providers'

// Callbacks para UI
export interface StreamCallbacks {
  onToken?: (token: string) => void
  onToolStart?: (name: string, params: Record<string, unknown>) => void
  onToolEnd?: (name: string, result: string, params: Record<string, unknown>) => void | Promise<void>
  onToolError?: (name: string, error: string) => void
  onThinking?: () => void
  onDone?: () => void
}

interface ContentBlock {
  type: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

// Parse SSE stream - returns raw lines for protocol-specific parsing
async function* parseSSELines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          yield line
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// Parse Claude SSE events
function parseClaudeEvent(line: string): any | null {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6)
  if (data === '[DONE]') return { type: 'done' }
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

// Process stream based on provider protocol
async function processStream(
  stream: ReadableStream<Uint8Array>,
  provider: Provider,
  callbacks: StreamCallbacks
): Promise<{ contentBlocks: ContentBlock[]; assistantContent: string }> {
  const contentBlocks: ContentBlock[] = []
  let assistantContent = ''
  let currentBlockIndex = -1
  let currentToolInput = ''

  const protocol = provider.protocol

  if (protocol === 'codex') {
    // Codex protocol - parseCodexStreamEvent returns array of events
    const state = createCodexStreamState()
    let shouldStop = false
    for await (const line of parseSSELines(stream)) {
      if (shouldStop) break
      const events = parseCodexStreamEvent(line, state)
      for (const event of events) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          if (contentBlocks.length === 0) {
            contentBlocks.push({ type: 'text', text: '' })
            currentBlockIndex = 0
          }
          contentBlocks[currentBlockIndex].text += event.delta.text
          assistantContent += event.delta.text
          callbacks.onToken?.(event.delta.text)
        } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          currentBlockIndex = contentBlocks.length
          contentBlocks.push({
            type: 'tool_use',
            id: event.content_block.id,
            name: event.content_block.name,
            input: event.content_block.input as Record<string, unknown>,
          })
        } else if (event.type === 'message_stop') {
          shouldStop = true
          break
        }
      }
    }
  } else if (protocol === 'gemini') {
    // Gemini protocol - parseGeminiStreamEvent returns array of events
    const state = createGeminiStreamState()
    let shouldStop = false
    for await (const line of parseSSELines(stream)) {
      if (shouldStop) break
      const events = parseGeminiStreamEvent(line, state)
      for (const event of events) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          if (contentBlocks.length === 0) {
            contentBlocks.push({ type: 'text', text: '' })
            currentBlockIndex = 0
          }
          contentBlocks[currentBlockIndex].text += event.delta.text
          assistantContent += event.delta.text
          callbacks.onToken?.(event.delta.text)
        } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          currentBlockIndex = contentBlocks.length
          contentBlocks.push({
            type: 'tool_use',
            id: event.content_block.id,
            name: event.content_block.name,
            input: event.content_block.input as Record<string, unknown>,
          })
        } else if (event.type === 'message_stop') {
          shouldStop = true
          break
        }
      }
    }
  } else {
    // Claude protocol (default)
    for await (const line of parseSSELines(stream)) {
      const event = parseClaudeEvent(line)
      if (!event) continue
      if (event.type === 'done') break

      if (event.type === 'content_block_start') {
        currentBlockIndex = event.index
        const block = event.content_block
        if (block.type === 'text') {
          contentBlocks[currentBlockIndex] = { type: 'text', text: '' }
        } else if (block.type === 'tool_use') {
          contentBlocks[currentBlockIndex] = {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: {}
          }
          currentToolInput = ''
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta
        if (delta.type === 'text_delta') {
          contentBlocks[currentBlockIndex].text += delta.text
          assistantContent += delta.text
          callbacks.onToken?.(delta.text)
        } else if (delta.type === 'input_json_delta') {
          currentToolInput += delta.partial_json
        }
      } else if (event.type === 'content_block_stop') {
        if (contentBlocks[currentBlockIndex]?.type === 'tool_use' && currentToolInput) {
          try {
            contentBlocks[currentBlockIndex].input = JSON.parse(currentToolInput)
          } catch {}
        }
      }
    }
  }

  return { contentBlocks, assistantContent }
}

// Chat con streaming
export async function streamChat(
  userMessage: string,
  history: ConversationHistory,
  callbacks: StreamCallbacks = {},
  model: string = 'claude-sonnet'
): Promise<{ toolsUsed: string[] }> {
  const tools = await getToolDefinitions()
  const toolsUsed: string[] = []

  history.addUser(userMessage)

  let continueLoop = true

  while (continueLoop) {
    callbacks.onThinking?.()

    const { stream, provider } = await inferenceStream({
      model,
      body: {
        system: history.getSystem(),
        messages: history.getClaudeMessages(),
        tools,
        max_tokens: 8096
      }
    })

    const { contentBlocks, assistantContent } = await processStream(stream, provider, callbacks)

    // Add to history
    history.addClaudeAssistant(contentBlocks)

    // Execute tool calls if any
    const toolUseBlocks = contentBlocks.filter(b => b.type === 'tool_use')

    if (toolUseBlocks.length > 0) {
      let shouldStopAfterTools = false
      const toolResults: { tool_use_id: string; content: string }[] = []

      for (const toolUse of toolUseBlocks) {
        const toolName = toolUse.name!
        toolsUsed.push(toolName)

        const params = toolUse.input || {}
        callbacks.onToolStart?.(toolName, params)

        try {
          const result = await executeTool(toolName, params)
          await callbacks.onToolEnd?.(toolName, result, params)
          toolResults.push({ tool_use_id: toolUse.id!, content: result })

          // Tools que terminan el loop
          const planActionsToStop = ['create', 'approve', 'cancel', 'batch_update', 'update_step', 'add_step', 'remove_step']
          if (toolName === 'plan' && planActionsToStop.includes(params.action as string)) {
            shouldStopAfterTools = true
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Error desconocido'
          callbacks.onToolError?.(toolName, errorMsg)
          toolResults.push({ tool_use_id: toolUse.id!, content: `Error: ${errorMsg}` })
        }
      }

      history.addClaudeToolResults(toolResults)

      if (shouldStopAfterTools) {
        continueLoop = false
      }
    } else {
      continueLoop = false
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

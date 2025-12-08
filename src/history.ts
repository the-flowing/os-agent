// Historial de conversación
import type OpenAI from 'openai'

export type Message = OpenAI.ChatCompletionMessageParam

export class ConversationHistory {
  private messages: Message[] = []
  private maxTokenEstimate = 100000 // Límite aproximado

  constructor(private systemPrompt?: string) {
    if (systemPrompt) {
      this.messages.push({ role: 'system', content: systemPrompt })
    }
  }

  add(message: Message) {
    this.messages.push(message)
    this.maybeCompact()
  }

  addUser(content: string) {
    this.add({ role: 'user', content })
  }

  addAssistant(content: string) {
    this.add({ role: 'assistant', content })
  }

  addToolCall(assistantMessage: OpenAI.ChatCompletionMessage) {
    this.messages.push(assistantMessage)
  }

  addToolResult(toolCallId: string, content: string) {
    this.add({ role: 'tool', tool_call_id: toolCallId, content })
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  clear() {
    const system = this.messages.find(m => m.role === 'system')
    this.messages = system ? [system] : []
  }

  // Estimación muy básica de tokens
  private estimateTokens(): number {
    return this.messages.reduce((acc, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return acc + (content?.length || 0) / 4
    }, 0)
  }

  // Compactar si excede el límite (mantiene system + últimos mensajes)
  private maybeCompact() {
    if (this.estimateTokens() > this.maxTokenEstimate) {
      const system = this.messages.find(m => m.role === 'system')
      // Mantener últimos 20 mensajes
      const recent = this.messages.slice(-20)
      this.messages = system ? [system, ...recent] : recent
    }
  }

  // Resumen del historial
  summary(): string {
    const userCount = this.messages.filter(m => m.role === 'user').length
    const assistantCount = this.messages.filter(m => m.role === 'assistant').length
    const toolCount = this.messages.filter(m => m.role === 'tool').length
    return `${userCount} user, ${assistantCount} assistant, ${toolCount} tool calls`
  }
}

// Persistencia de historial entre sesiones (opcional)
const HISTORY_FILE = '.osa/history.json'

export async function saveHistory(history: ConversationHistory): Promise<void> {
  try {
    await Bun.spawn(['mkdir', '-p', '.osa']).exited
    await Bun.write(HISTORY_FILE, JSON.stringify(history.getMessages(), null, 2))
  } catch {}
}

export async function loadHistory(systemPrompt?: string): Promise<ConversationHistory> {
  const history = new ConversationHistory(systemPrompt)
  try {
    const file = Bun.file(HISTORY_FILE)
    if (await file.exists()) {
      const messages = JSON.parse(await file.text())
      // Solo cargar mensajes user/assistant (no system ni tools)
      for (const msg of messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          history.add(msg)
        }
      }
    }
  } catch {}
  return history
}

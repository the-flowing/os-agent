// Historial de conversación (formato Claude nativo)

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export class ConversationHistory {
  private messages: ClaudeMessage[] = []
  private system: string
  private maxTokenEstimate = 100000

  constructor(systemPrompt?: string) {
    this.system = systemPrompt || 'Sos un asistente de programación. Usá las tools disponibles para completar tareas.'
  }

  getSystem(): string {
    return this.system
  }

  addUser(content: string) {
    this.messages.push({ role: 'user', content })
    this.maybeCompact()
  }

  addAssistant(content: string) {
    this.messages.push({ role: 'assistant', content })
    this.maybeCompact()
  }

  // Add assistant message with content blocks (text + tool_use)
  addClaudeAssistant(content: ContentBlock[]) {
    this.messages.push({ role: 'assistant', content })
    this.maybeCompact()
  }

  // Add tool results as user message
  addClaudeToolResults(results: { tool_use_id: string; content: string }[]) {
    const blocks: ContentBlock[] = results.map(r => ({
      type: 'tool_result',
      tool_use_id: r.tool_use_id,
      content: r.content
    }))
    this.messages.push({ role: 'user', content: blocks })
    this.maybeCompact()
  }

  getClaudeMessages(): ClaudeMessage[] {
    return [...this.messages]
  }

  clear() {
    this.messages = []
  }

  private estimateTokens(): number {
    return this.messages.reduce((acc, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return acc + (content?.length || 0) / 4
    }, 0)
  }

  private maybeCompact() {
    if (this.estimateTokens() > this.maxTokenEstimate) {
      this.messages = this.messages.slice(-20)
    }
  }

  summary(): string {
    const userCount = this.messages.filter(m => m.role === 'user').length
    const assistantCount = this.messages.filter(m => m.role === 'assistant').length
    return `${userCount} user, ${assistantCount} assistant`
  }
}

// Persistencia de historial entre sesiones (opcional)
const HISTORY_FILE = '.osa/history.json'

export async function saveHistory(history: ConversationHistory): Promise<void> {
  try {
    await Bun.spawn(['mkdir', '-p', '.osa']).exited
    await Bun.write(HISTORY_FILE, JSON.stringify(history.getClaudeMessages(), null, 2))
  } catch {}
}

export async function loadHistory(systemPrompt?: string): Promise<ConversationHistory> {
  const history = new ConversationHistory(systemPrompt)
  try {
    const file = Bun.file(HISTORY_FILE)
    if (await file.exists()) {
      const messages = JSON.parse(await file.text()) as ClaudeMessage[]
      for (const msg of messages) {
        if (msg.role === 'user' && typeof msg.content === 'string') {
          history.addUser(msg.content)
        } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
          history.addAssistant(msg.content)
        }
      }
    }
  } catch {}
  return history
}

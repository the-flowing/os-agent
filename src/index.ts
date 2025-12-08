import { inference } from './proxy'
import { notify, notifyError } from './notify'
import { loadTools, getToolDefinitions, executeTool } from './tool-loader'
import { getConfig } from './config'

const config = getConfig()

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

// Estado de la conversación (stateful para el REPL)
const messages: Message[] = []
const system = `Sos un asistente de programación. Tenés acceso a tools que podés usar.
Cuando termines una tarea larga o necesites input del usuario, indicalo claramente.`

interface ChatResult {
  text: string
  toolCallCount: number
}

async function chat(userMessage: string): Promise<ChatResult> {
  messages.push({ role: 'user', content: userMessage })

  const tools = await getToolDefinitions()
  let toolCallCount = 0

  let response = await inference({
    model: config.model,
    body: { system, messages, tools, max_tokens: 8096 }
  })

  let assistantContent: ContentBlock[] = response.content
  messages.push({ role: 'assistant', content: assistantContent })

  while (response.stop_reason === 'tool_use') {
    const toolResults: ContentBlock[] = []

    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        toolCallCount++
        console.log(`\n🔧 Ejecutando tool: ${block.name}`)
        const result = await executeTool(block.name!, block.input || {})
        console.log(`   Resultado: ${result.substring(0, 100)}${result.length > 100 ? '...' : ''}`)

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result
        })
      }
    }

    messages.push({ role: 'user', content: toolResults })

    response = await inference({
      model: config.model,
      body: { system, messages, tools, max_tokens: 8096 }
    })

    assistantContent = response.content
    messages.push({ role: 'assistant', content: assistantContent })
  }

  const textBlocks = assistantContent.filter(block => block.type === 'text')
  const text = textBlocks.map(block => block.text || '').join('\n')
  return { text, toolCallCount }
}

// Loop principal
async function main() {
  console.log('🚀 OSA - Iniciando...\n')

  // Cargar tools
  await loadTools()
  console.log('✅ Tools cargadas\n')

  const prompt = '> '
  process.stdout.write(prompt)

  for await (const line of console) {
    const input = line.trim()

    if (input === 'exit' || input === 'quit') {
      break
    }

    if (input === '') {
      process.stdout.write(prompt)
      continue
    }

    try {
      const { text, toolCallCount } = await chat(input)
      console.log(`\n${text}\n`)

      // Solo notificar si fue una tarea larga (3+ tool calls)
      if (toolCallCount >= 3) {
        await notify('Tarea completada')
      }
    } catch (error) {
      console.error('Error:', error)
      // Errores sí notificar siempre - necesitan atención
      await notifyError('Algo falló')
    }

    process.stdout.write(prompt)
  }
}

main()

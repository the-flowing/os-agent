#!/usr/bin/env bun
import React, { useState, useEffect, useCallback } from 'react'
import { render, Box, Text, useInput, useApp, Static, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'
import { getAvailableModels, type AvailableModel } from './providers'
import { getConfig } from './config'

// Configurar marked para terminal
marked.setOptions({
  renderer: new TerminalRenderer()
})

// Renderizar markdown a texto con colores ANSI
const renderMarkdown = (text: string): string => {
  try {
    return (marked.parse(text) as string).trim()
  } catch {
    return text
  }
}

// Reproducir sonido de notificación
const playNotificationSound = () => {
  const soundPath = new URL('../assets/didgeridoo.wav', import.meta.url).pathname
  Bun.spawn(['afplay', soundPath], { stdout: 'ignore', stderr: 'ignore' })
}
import { loadTools } from './tool-loader'
import { streamChat } from './stream-client'
import { ConversationHistory } from './history'
import { SYSTEM_PROMPT } from './system-prompt'
import { detectBashCommand, runBashCommand } from './bash-detect'
import { loadPlans, type Plan, type Step, type StepStatus } from './plan'
import { LoginScreen, hasAnyCredentials } from './login-screen'
import { deleteCredential } from './proxy/credentials'
import { getProviderByModel } from './providers'
// import { filterFiles } from './file-picker' // TODO: re-agregar file picker
import * as fs from 'fs'

// Helper para console.log con dim (usado en exit)
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

// TODO: re-agregar FilePicker
// function FilePicker({ ... })

// Procesar referencias @archivo
function processFileReferences(message: string): { processed: string; files: string[] } {
  const fileRegex = /@([\w./-]+)/g
  const files: string[] = []
  let processed = message

  const matches = message.matchAll(fileRegex)
  for (const match of matches) {
    const filePath = match[1]
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      files.push(filePath)
      processed = processed.replace(match[0], `\n\n<file path="${filePath}">\n${content}\n</file>\n`)
    } catch {
      // Si no existe, dejar el @ como está
    }
  }

  return { processed, files }
}

type MessageRole = 'user' | 'user-bash' | 'user-cancelled' | 'user-result' | 'assistant' | 'tool' | 'bash' | 'bash-cmd' | 'error' | 'info' | 'system' | 'header' | 'plan'
type MessageWithId = { id: string; role: MessageRole; content: string; toolName?: string; toolParams?: Record<string, unknown>; isLatest?: boolean; plan?: Plan; model?: string }
let messageIdCounter = 0
const generateMessageId = () => `msg-${++messageIdCounter}`

// Formatear params de tool como comando CLI
function formatToolAsCommand(name: string, params: Record<string, unknown>): string {
  const parts = [name]

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue

    if (typeof value === 'boolean') {
      if (value) parts.push(`--${key}`)
    } else if (typeof value === 'string') {
      // Strings largos (más de 60 chars) se truncan
      const str = value.length > 60 ? value.substring(0, 57) + '...' : value
      // Escapar comillas y mostrar entre comillas si tiene espacios o caracteres especiales
      if (str.includes(' ') || str.includes('\n') || str.includes('"')) {
        parts.push(`--${key}="${str.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
      } else {
        parts.push(`--${key}=${str}`)
      }
    } else {
      parts.push(`--${key}=${JSON.stringify(value)}`)
    }
  }

  return parts.join(' ')
}

// Cajita para el prompt del usuario (último = cyan, anteriores = gris-celeste)
function UserPromptBox({ content, isLatest = false }: { content: string; isLatest?: boolean }) {
  return (
    <Box
      borderStyle="round"
      borderColor={isLatest ? 'cyan' : '#5a7a8a'}
      paddingX={2}
    >
      <Text color={isLatest ? undefined : '#8ab4c4'}>{content}</Text>
    </Box>
  )
}

// Comando (bash/tool) - amarillo, collapsed para agente, expandido para usuario
function CommandLine({ command, result, collapsed = false, showPrompt = false }: { command: string; result?: string; collapsed?: boolean; showPrompt?: boolean }) {
  const prefix = showPrompt ? '❯ ' : ''
  if (collapsed) {
    const flatResult = result?.replace(/\n/g, ' ').substring(0, 60)
    return (
      <Box paddingX={2}>
        <Text color="yellow">
          {prefix}{command}{flatResult ? <Text color="white"> → {flatResult}{result && result.length > 60 ? '...' : ''}</Text> : ''}
        </Text>
      </Box>
    )
  }
  return (
    <Box paddingX={2} flexDirection="column">
      <Text color="yellow">{prefix}{command}</Text>
      {result && <Text color="white">{result}</Text>}
    </Box>
  )
}

// Respuesta del asistente en cajita (streaming = naranja apagado, latest = naranja, viejo = naranja apagado)
function AssistantResponseBox({ content, streaming = false, isLatest = false, model }: { content: string; streaming?: boolean; isLatest?: boolean; model?: string }) {
  const dimOrange = '#8a6a4a' // naranja apagado/gris
  const borderColor = isLatest ? '#ffaa55' : dimOrange
  // Solo texto apagado si no es latest y no está streaming
  const textColor = (!isLatest && !streaming) ? '#b8956a' : undefined
  return (
    <Box
      borderStyle="round"
      borderColor={borderColor}
      paddingX={2}
      flexDirection="column"
    >
      {model && (
        <Box alignSelf="flex-end">
          <Text dimColor>{model}</Text>
        </Box>
      )}
      <Text color={textColor}>{renderMarkdown(content)}</Text>
    </Box>
  )
}

// Cajita para mostrar un plan con formato estructurado
function PlanBox({ plan, isLatest = false }: { plan: Plan; isLatest?: boolean }) {
  const dimMagenta = '#8a5a8a'
  const borderColor = isLatest ? '#dd88dd' : dimMagenta
  const titleColor = isLatest ? '#ffaaff' : '#cc99cc'
  const descColor = isLatest ? undefined : '#aa88aa'

  const getStepColor = (status: StepStatus, isLatest: boolean) => {
    if (!isLatest) return '#aa88aa'
    switch (status) {
      case 'passed': return '#88dd88'
      case 'testing':
      case 'implementing': return '#dddd88'
      case 'failed': return '#dd8888'
      case 'pending':
      default: return '#888888'
    }
  }

  return (
    <Box
      borderStyle="round"
      borderColor={borderColor}
      paddingX={2}
      flexDirection="column"
    >
      <Text color={titleColor} bold>{plan.title}</Text>
      {plan.description && (
        <Text color={descColor} dimColor={!isLatest}>{plan.description}</Text>
      )}
      <Text> </Text>
      {plan.steps.map((step) => (
        <Box key={step.id}>
          <Text color={getStepColor(step.status, isLatest)}>
            {step.id}. {step.description}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// Vista fullscreen para el plan con input y chat
function PlanFullscreen({
  plan,
  messages,
  currentOutput,
  onSubmit,
  isProcessing = false
}: {
  plan: Plan
  messages: MessageWithId[]
  currentOutput: string
  onSubmit: (value: string) => void
  isProcessing?: boolean
}) {
  const [input, setInput] = useState('')

  const handleSubmit = (value: string) => {
    if (!value.trim()) return
    onSubmit(value)
    setInput('')
  }

  const getStepIcon = (status: StepStatus) => {
    switch (status) {
      case 'passed': return '✓'
      case 'testing':
      case 'implementing': return '●'
      case 'failed': return '✗'
      case 'pending':
      default: return '○'
    }
  }

  const getStepColor = (status: StepStatus) => {
    switch (status) {
      case 'passed': return '#88dd88'
      case 'testing':
      case 'implementing': return '#dddd88'
      case 'failed': return '#dd8888'
      case 'pending':
      default: return '#aaaaaa'
    }
  }

  return (
    <Box flexDirection="column">
      {/* Plan pineado arriba */}
      <Box
        borderStyle="round"
        borderColor="#dd88dd"
        paddingX={2}
        flexDirection="column"
      >
        <Text color="#ffaaff" bold>{plan.title}</Text>
        {plan.description && (
          <Text dimColor>{plan.description}</Text>
        )}
        <Text> </Text>
        {plan.steps.map((step) => (
          <Box key={step.id}>
            <Text color={getStepColor(step.status)}>
              {getStepIcon(step.status)} {step.id}. {step.description}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Historial de chat durante el modo plan */}
      {messages.map((msg) => (
        <Box key={msg.id} paddingX={1}>
          {msg.role === 'user' && (
            <Box borderStyle="round" borderColor="cyan" paddingX={2}>
              <Text>{msg.content}</Text>
            </Box>
          )}
          {msg.role === 'assistant' && (
            <Box borderStyle="round" borderColor="#ffaa55" paddingX={2}>
              <Text>{renderMarkdown(msg.content)}</Text>
            </Box>
          )}
          {msg.role === 'error' && (
            <Text color="red">{msg.content}</Text>
          )}
          {msg.role === 'tool' && (
            <Text dimColor>⚡ {msg.toolName}</Text>
          )}
        </Box>
      ))}

      {/* Streaming output */}
      {currentOutput && (
        <Box paddingX={1}>
          <Box borderStyle="round" borderColor="#ffaa55" paddingX={2}>
            <Text>{renderMarkdown(currentOutput)}</Text>
          </Box>
        </Box>
      )}

      {/* Hint */}
      <Text dimColor>  aprobar · iterar · cancelar</Text>

      {/* Input */}
      {!isProcessing ? (
        <Box borderStyle="round" borderColor="cyan" paddingX={2}>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="..." />
        </Box>
      ) : (
        <Text dimColor>Pensando...</Text>
      )}
    </Box>
  )
}

// Componente para renderizar un item del historial
function HistoryItem({ role, content, toolName, toolParams, isLatest, plan, model }: MessageWithId) {
  switch (role) {
    case 'header':
      return <Text color="cyan">{content}</Text>
    case 'user':
      return <UserPromptBox content={content} isLatest={isLatest} />
    case 'plan':
      return plan ? <PlanBox plan={plan} isLatest={isLatest} /> : null
    case 'user-bash':
      return <CommandLine command={content} showPrompt />
    case 'user-cancelled':
      return <Text dimColor>{content}</Text>
    case 'user-result':
      // Solo el resultado, indentado debajo del comando
      return (
        <Box paddingLeft={6} paddingRight={2}>
          <Text color="white">{content}</Text>
        </Box>
      )
    case 'assistant':
      return <AssistantResponseBox content={content} isLatest={isLatest} model={model} />
    case 'tool':
      const cmd = toolName && toolParams ? formatToolAsCommand(toolName, toolParams) : toolName || ''
      return <CommandLine command={cmd} result={content} collapsed showPrompt />
    case 'bash':
      return null
    case 'bash-cmd':
      const bashResult = toolParams?.result as string | undefined
      return <CommandLine command={content} result={bashResult} collapsed showPrompt />
    case 'error':
      return <Text color="red">{content}</Text>
    case 'info':
      return <Text dimColor>{content}</Text>
    case 'system':
      return <Text dimColor>{content}</Text>
    default:
      return <Text>{content}</Text>
  }
}
// Cache para detección de comandos
const bashDetectionCache = new Map<string, { isBash: boolean; confidence: number }>()

// Model Picker - aparece con shift+tab
function ModelPicker({
  models,
  currentModel,
  onSelect,
  onClose
}: {
  models: AvailableModel[]
  currentModel: string
  onSelect: (model: string) => void
  onClose: () => void
}) {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = models.findIndex(m => m.alias === currentModel)
    if (idx >= 0) return idx
    const firstConnected = models.findIndex(m => m.hasCredential)
    return firstConnected >= 0 ? firstConnected : 0
  })
  const [notice, setNotice] = useState<string | null>(null)

  useInput((input, key) => {
    if (key.escape || (key.shift && key.tab)) {
      onClose()
      return
    }
    if (key.upArrow) {
      setSelectedIndex(i => (i > 0 ? i - 1 : models.length - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex(i => (i < models.length - 1 ? i + 1 : 0))
      return
    }
    if (key.return) {
      const chosen = models[selectedIndex]
      if (!chosen.hasCredential) {
        setNotice(`Necesita login para ${chosen.providerId}. Usá /login.`)
        return
      }
      onSelect(chosen.alias)
      onClose()
      return
    }
  })

  // Separar SOTA del resto
  const sotaModels = models.filter(m => m.isSota)
  const otherModels = models.filter(m => !m.isSota)
  const connectedModels = models.filter(m => m.hasCredential)
  const lockedModels = models.filter(m => !m.hasCredential)

  const renderModel = (model: AvailableModel, idx: number, globalIdx: number) => (
    <Box key={model.alias}>
      <Text color={!model.hasCredential ? '#666' : globalIdx === selectedIndex ? 'cyan' : undefined} dimColor={!model.hasCredential}>
        {globalIdx === selectedIndex ? '› ' : '  '}
        {model.alias}
        <Text dimColor> ({model.providerId}{!model.hasCredential ? ' · login' : ''})</Text>
        {model.alias === currentModel && <Text color="green"> ✓</Text>}
      </Text>
    </Box>
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text color="magenta" bold>Modelo (↑↓ enter esc)</Text>
      <Text dimColor>Enter elige solo modelos con login listo. Usa /login para conectar.</Text>
      <Text dimColor>── sota ──</Text>
      {sotaModels.map((m, i) => renderModel(m, i, i))}
      <Text dimColor>── otros ──</Text>
      {otherModels.map((m, i) => renderModel(m, i, sotaModels.length + i))}
      {lockedModels.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Modelos sin login: {lockedModels.map(m => m.alias).join(', ') || 'ninguno'}</Text>
        </Box>
      )}
      {connectedModels.length === 0 && (
        <Text color="yellow">No hay modelos disponibles. Conectá un proveedor con /login.</Text>
      )}
      {notice && <Text color="yellow">{notice}</Text>}
    </Box>
  )
}

// Input separado para evitar re-renders del historial
function InputBox({
  onSubmit,
  onInputChange,
  clearTrigger
}: {
  onSubmit: (value: string) => void
  onInputChange: (value: string, mode: 'text' | 'command') => void
  clearTrigger: number
}) {
  const [input, setInput] = useState('')
  const [inputMode, setInputMode] = useState<'text' | 'command'>('text')

  // Limpiar input cuando clearTrigger cambia
  useEffect(() => {
    if (clearTrigger > 0) {
      setInput('')
      setInputMode('text')
    }
  }, [clearTrigger])

  // Detección dinámica de comando vs texto
  useEffect(() => {
    if (!input.trim()) {
      setInputMode('text')
      onInputChange('', 'text')
      return
    }

    const cached = bashDetectionCache.get(input.trim())
    if (cached) {
      const mode = cached.isBash && cached.confidence > 0.7 ? 'command' : 'text'
      setInputMode(mode)
      onInputChange(input, mode)
      return
    }

    const trimmed = input.trim()
    detectBashCommand(trimmed).then(result => {
      bashDetectionCache.set(trimmed, result)
      if (input.trim() === trimmed) {
        const mode = result.isBash && result.confidence > 0.7 ? 'command' : 'text'
        setInputMode(mode)
        onInputChange(input, mode)
      }
    })
  }, [input, onInputChange])

  const handleChange = (value: string) => {
    setInput(value)
  }

  const handleSubmit = (value: string) => {
    if (!value.trim()) return
    onSubmit(value)
    setInput('')
    setInputMode('text')
  }

  if (inputMode === 'command') {
    return (
      <Box paddingX={2}>
        <Text color="yellow">❯ </Text>
        <TextInput value={input} onChange={handleChange} onSubmit={handleSubmit} />
      </Box>
    )
  }

  return (
    <Box borderStyle="round" borderColor={input.trim() ? 'cyan' : '#5a7a8a'} paddingX={2}>
      <TextInput value={input} onChange={handleChange} onSubmit={handleSubmit} />
    </Box>
  )
}

// Plan pineado arriba con checkmarks
function PinnedPlan({ plan }: { plan: Plan }) {
  const getStepIcon = (status: StepStatus) => {
    switch (status) {
      case 'passed': return '✓'
      case 'testing':
      case 'implementing': return '●'
      case 'failed': return '✗'
      case 'pending':
      default: return '○'
    }
  }

  const getStepColor = (status: StepStatus) => {
    switch (status) {
      case 'passed': return '#88dd88'
      case 'testing':
      case 'implementing': return '#dddd88'
      case 'failed': return '#dd8888'
      case 'pending':
      default: return '#888888'
    }
  }

  return (
    <Box
      borderStyle="round"
      borderColor="#dd88dd"
      paddingX={2}
      flexDirection="column"
      marginBottom={1}
    >
      <Text color="#ffaaff" bold>{plan.title}</Text>
      {plan.description && <Text dimColor>{plan.description}</Text>}
      <Text> </Text>
      {plan.steps.map((step) => (
        <Box key={step.id}>
          <Text color={getStepColor(step.status)}>
            {getStepIcon(step.status)} {step.id}. {step.description}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// Main App
function App() {
  const { exit } = useApp()
  const [ready, setReady] = useState(false)
  const [history] = useState(() => new ConversationHistory(SYSTEM_PROMPT))
  const [messages, setMessages] = useState<MessageWithId[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentOutput, setCurrentOutput] = useState('')
  const [runningTool, setRunningTool] = useState<string | null>(null)
  const [hasInput, setHasInput] = useState(false) // Solo para cambio de colores
  const [activePlan, setActivePlan] = useState<Plan | null>(null) // Plan en ejecución
  const [clearTrigger, setClearTrigger] = useState(0) // Para limpiar input desde Ctrl+C
  const [currentModel, setCurrentModel] = useState(() => getConfig().model)
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showLogin, setShowLogin] = useState(() => !hasAnyCredentials())
  const [banner, setBanner] = useState<string | null>(null)

  // Callback para cuando cambia el input (solo actualiza hasInput cuando cambia de vacío a no-vacío)
  const handleInputChange = useCallback((value: string, mode: 'text' | 'command') => {
    const newHasInput = value.trim().length > 0
    setHasInput(prev => prev !== newHasInput ? newHasInput : prev)
  }, [])

  // Cargar tools y modelos al inicio y limpiar pantalla
  useEffect(() => {
    // Limpiar terminal para efecto fullscreen
    console.clear()

    Promise.all([loadTools(), getAvailableModels()]).then(([_, models]) => {
      setAvailableModels(models)
      // Mensaje inicial del agente
      setMessages([
        { id: 'welcome', role: 'assistant', content: '¿Qué necesitás?', model: getConfig().model },
        { id: 'hint', role: 'system', content: 'Tips: /help · /login · /logout · Shift+Tab cambia modelo' }
      ])
      setReady(true)
    })
  }, [])

  // Handle Ctrl+C y Shift+Tab
  useInput((char, key) => {
    if (showLogin) return
    if (key.ctrl && char === 'c') {
      if (hasInput) {
        setClearTrigger(t => t + 1)
      } else {
        exit()
      }
      return
    }
    // Shift+Tab para model picker (solo si no está procesando y no tiene input)
    if (key.shift && key.tab && !isProcessing && !showModelPicker) {
      setShowModelPicker(true)
      return
    }
  })

  // Submit handler
  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (showLogin || !trimmed || isProcessing) return

    setHasInput(false)

    // Comandos especiales
    if (trimmed === '/exit') {
            exit()
      return
    }
    if (trimmed === '/login') {
      setShowLogin(true)
      setBanner(null)
      return
    }
    if (trimmed === '/logout') {
      const doLogout = async () => {
        const provider = await getProviderByModel(currentModel)
        if (!provider) {
          setMessages(m => [...m, { id: generateMessageId(), role: 'error', content: 'No se pudo determinar provider para el modelo actual.' }])
          return
        }
        const removed = deleteCredential(provider.id)
        const models = await getAvailableModels()
        setAvailableModels(models)
        setMessages(m => [...m, { id: generateMessageId(), role: removed ? 'info' : 'error', content: removed ? `Credencial de ${provider.id} eliminada. Usá /login para reconectar.` : 'No había credencial para eliminar.' }])
        setShowLogin(true)
      }
      await doLogout()
      return
    }
    if (trimmed === '/help') {
      setMessages(m => [...m, {
        id: generateMessageId(),
        role: 'system',
        content: `Comandos: /exit, /help\n@ para referenciar archivos\nShift+Tab para cambiar modelo\nCtrl+C limpia línea o sale`
      }])
      return
    }

    // Detectar bash
    const bashDetect = await detectBashCommand(trimmed)
    if (bashDetect.isBash && bashDetect.confidence > 0.7) {
      setMessages(m => [...m, { id: generateMessageId(), role: 'user-bash', content: trimmed }])
      try {
        const result = await runBashCommand(trimmed)
        setMessages(m => [...m, { id: generateMessageId(), role: 'user-result', content: result.formatted }])
        // Agregar al contexto
        history.addUser(`Ejecuté: \`${trimmed}\`\n\nResultado:\n\`\`\`\n${result.formatted}\n\`\`\``)
        history.addAssistant('Entendido.')
      } catch (e) {
        setMessages(m => [...m, { id: generateMessageId(), role: 'error', content: String(e) }])
      }
      return
    }

    // Procesar @ referencias
    let { processed, files } = processFileReferences(trimmed)
    if (files.length > 0) {
      setMessages(m => [...m, { id: generateMessageId(), role: 'info', content: `📎 ${files.join(', ')}` }])
    }

    // Mostrar mensaje del usuario inmediatamente
    setMessages(m => [...m, { id: generateMessageId(), role: 'user', content: trimmed }])

    // Chat con el modelo
    setIsProcessing(true)
    setCurrentOutput('')
    setRunningTool(null)

    // Acumular output en variable local para evitar closure stale
    let accumulatedOutput = ''
    let skipAssistantOutput = false

    try {
      await streamChat(processed, history, {
        onToken: (token) => {
          accumulatedOutput += token
          setCurrentOutput(accumulatedOutput)
        },
        onToolStart: (name) => {
          setRunningTool(name)
        },
        onToolEnd: async (name, result, params) => {
          setRunningTool(null)
          try {
            // Agregar resultado al historial - bash y tools se muestran igual
            if (name === 'bash') {
              const bashResult = result && result !== '(sin output)' ? result : ''
              setMessages(m => [...m, { id: generateMessageId(), role: 'bash-cmd', content: String(params.command), toolParams: { result: bashResult } }])
            } else if (name === 'plan') {
              const action = params.action as string

              if (action === 'approve') {
                // Activar plan mode: pinear arriba, limpiar historial
                const plans = await loadPlans()
                // Buscar el plan aprobado más reciente (por updatedAt)
                const approvedPlan = plans
                  .filter(p => p.status === 'approved' || p.status === 'in_progress')
                  .sort((a, b) => b.updatedAt - a.updatedAt)[0]
                if (approvedPlan) {
                  // Limpiar pantalla (Static de Ink no se borra con setState)
                  console.clear()
                  setActivePlan(approvedPlan)
                  // Limpiar contexto del modelo
                  history.clear()
                  history.addUser(`Plan aprobado: "${approvedPlan.title}". Steps: ${approvedPlan.steps.map(s => s.description).join(', ')}`)
                  history.addAssistant('Entendido. Comenzando ejecución del plan.')
                  // Limpiar mensajes de UI
                  setMessages([])
                }
                skipAssistantOutput = true
                accumulatedOutput = ''
                setCurrentOutput('')
              } else if (action === 'create' || action === 'batch_update' || action === 'update_step' || action === 'add_step' || action === 'remove_step') {
                // Mostrar plan draft en historial
                if (accumulatedOutput.trim()) {
                  setMessages(m => [...m, { id: generateMessageId(), role: 'assistant', content: accumulatedOutput, model: currentModel }])
                }
                const plans = await loadPlans()
                const planToShow = plans.find(p => p.status === 'draft') || plans[plans.length - 1]
                if (planToShow) {
                  setMessages(m => [...m, { id: generateMessageId(), role: 'plan', content: '', plan: planToShow }])
                }
                skipAssistantOutput = true
                accumulatedOutput = ''
                setCurrentOutput('')
              } else if (action === 'pass' || action === 'fail' || action === 'next') {
                // Actualizar plan pineado si está activo
                const plans = await loadPlans()
                const currentPlan = plans.find(p =>
                  p.status === 'approved' || p.status === 'in_progress' ||
                  p.status === 'completed' || p.status === 'failed'
                )
                if (currentPlan) {
                  if (currentPlan.status === 'completed') {
                    // Plan completado! Salir de plan mode
                    setActivePlan(null)
                    setMessages(m => [...m, { id: generateMessageId(), role: 'info', content: '🎉 ¡Plan completado!' }])
                  } else if (currentPlan.status === 'failed') {
                    // Plan falló
                    setActivePlan(currentPlan) // Mantener visible para ver qué falló
                    setMessages(m => [...m, { id: generateMessageId(), role: 'error', content: result }])
                  } else {
                    setActivePlan(currentPlan)
                    setMessages(m => [...m, { id: generateMessageId(), role: 'info', content: result }])
                  }
                } else {
                  setMessages(m => [...m, { id: generateMessageId(), role: 'info', content: result }])
                }
              } else if (action === 'cancel') {
                setActivePlan(null)
                setMessages(m => [...m, { id: generateMessageId(), role: 'info', content: 'Plan cancelado' }])
              } else {
                // Para show - mostrar como tool normal
                setMessages(m => [...m, { id: generateMessageId(), role: 'tool', content: result, toolName: name, toolParams: params }])
              }
            } else {
              setMessages(m => [...m, { id: generateMessageId(), role: 'tool', content: result, toolName: name, toolParams: params }])
            }
          } catch (err) {
            setMessages(m => [...m, { id: generateMessageId(), role: 'error', content: `Error en onToolEnd: ${err}` }])
          }
        },
        onToolError: (name, error) => {
          setRunningTool(null)
          setMessages(m => [...m, { id: generateMessageId(), role: 'error', content: `${name}: ${error}` }])
        },
        onDone: () => {
          if (accumulatedOutput && !skipAssistantOutput) {
            setMessages(m => [...m, { id: generateMessageId(), role: 'assistant', content: accumulatedOutput, model: currentModel }])
          }
          setCurrentOutput('')
          setIsProcessing(false)
          playNotificationSound()
        }
      }, currentModel)
    } catch (e) {
      const msg = String(e)
      setMessages(m => {
        const last = m[m.length - 1]
        if (last?.role === 'error' && last.content === msg) return m
        return [...m, { id: generateMessageId(), role: 'error', content: msg }]
      })
      const lowerMsg = msg.toLowerCase()
      if (lowerMsg.includes('credential') || lowerMsg.includes('login')) {
        setBanner('⚠️ Error de credenciales. Probá /login para reconectar.')
        setShowLogin(true)
      } else {
        setBanner('⚠️ Hubo un error. Probá nuevamente o revisá conexión/modelo.')
      }
      setIsProcessing(false)
    }
  }, [isProcessing, history, exit, currentModel, showLogin])

  // Marcar últimos elementos como "latest"
  let lastAssistantIndex = -1
  let lastUserPromptIndex = -1  // último user o user-bash
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role
    if (lastAssistantIndex === -1 && (role === 'assistant' || role === 'plan')) {
      lastAssistantIndex = i
    }
    if (lastUserPromptIndex === -1 && (role === 'user' || role === 'user-bash')) {
      lastUserPromptIndex = i
    }
    if (lastAssistantIndex !== -1 && lastUserPromptIndex !== -1) break
  }
  const hasLatestAssistant = lastAssistantIndex > lastUserPromptIndex

  if (showLogin) {
    return <LoginScreen onComplete={() => { setShowLogin(false); setBanner(null) }} onLoginSuccess={async () => {
      const models = await getAvailableModels()
      setAvailableModels(models)
      setBanner('✅ Login ok. Modelo activo: ' + currentModel)
    }} />
  }

  if (!ready) {
    return <Text>Cargando tools...</Text>
  }

  const cwd = process.cwd().split('/').slice(-2).join('/')

  return (
    <Box flexDirection="column">
      {/* Plan pineado arriba cuando está en ejecución */}
      {activePlan && <PinnedPlan plan={activePlan} />}

      {/* Historial viejo - Static para evitar flickering */}
      <Static items={messages.slice(0, -1)}>
        {(msg) => (
          <Box key={msg.id}>
            <HistoryItem {...msg} isLatest={false} />
          </Box>
        )}
      </Static>

      {/* Banner de estado/errores */}
      {banner && (
        <Box>
          <Text color="yellow">{banner}</Text>
        </Box>
      )}

      {/* Último mensaje - dinámico, puede cambiar de color */}
      {messages.length > 0 && (() => {
        const lastMsg = messages[messages.length - 1]
        const isUserMsg = lastMsg.role === 'user' || lastMsg.role === 'user-bash'
        const isAgentMsg = lastMsg.role === 'assistant' || lastMsg.role === 'plan'
        // Usuario: brillante si input vacío. Agente: brillante si es el último (no hay user después)
        const isLatest = isUserMsg ? !hasInput : isAgentMsg
        return (
          <Box key={`${lastMsg.id}-${isLatest}`}>
            <HistoryItem {...lastMsg} isLatest={isLatest} />
          </Box>
        )
      })()}

      {/* Tool ejecutándose */}
      {runningTool && (
        <Text color="yellow">⚡ <Text dimColor>{runningTool}...</Text></Text>
      )}

      {/* Current streaming output - cajita mientras streamea */}
      {currentOutput && (
        <AssistantResponseBox content={currentOutput} streaming={true} model={currentModel} />
      )}

      {/* Model Picker */}
      {showModelPicker && (
        <ModelPicker
          models={availableModels}
          currentModel={currentModel}
          onSelect={setCurrentModel}
          onClose={() => setShowModelPicker(false)}
        />
      )}

      {/* Input con indicador de modelo arriba a la derecha */}
      {!isProcessing && !showModelPicker && (
        <Box flexDirection="column">
          <Box justifyContent="flex-end">
            <Text dimColor>{currentModel} </Text>
            <Text color="#666">⇧⇥</Text>
          </Box>
          <InputBox onSubmit={handleSubmit} onInputChange={handleInputChange} clearTrigger={clearTrigger} />
        </Box>
      )}

      {isProcessing && (
        <Box flexDirection="column">
          <Box justifyContent="flex-end">
            <Text dimColor>{currentModel}</Text>
          </Box>
          <Text dimColor>Pensando...</Text>
        </Box>
      )}
    </Box>
  )
}

// Run - exitOnCtrlC: false para manejar Ctrl+C manualmente
render(<App />, { exitOnCtrlC: false })

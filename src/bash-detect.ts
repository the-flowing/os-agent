// Detección de comandos bash vs mensajes para el agente

// Cache de comandos ya verificados con `which`
const commandCache = new Map<string, boolean>()

// Verificar si un comando existe usando `which`
async function isValidCommand(cmd: string): Promise<boolean> {
  // Check cache first
  if (commandCache.has(cmd)) {
    return commandCache.get(cmd)!
  }

  try {
    const proc = Bun.spawn(['which', cmd], {
      stdout: 'ignore',
      stderr: 'ignore'
    })
    const exists = await proc.exited === 0
    commandCache.set(cmd, exists)
    return exists
  } catch {
    commandCache.set(cmd, false)
    return false
  }
}

// Patrones que indican bash
const BASH_PATTERNS = [
  /^\.\//,                    // ./script
  /^~\//,                     // ~/path
  /^\/[a-z]/i,                // /absolute/path
  /\|/,                       // pipes
  /[<>]/,                     // redirects
  /\$\(/,                     // command substitution
  /\$\{/,                     // variable expansion
  /&&|\|\|/,                  // logical operators
  /^\s*[A-Z_]+=.*/,          // VAR=value
  /^!!/,                      // !! repeat last
  /^!\d+/,                    // !123 history
]

// Patrones que indican mensaje para el agente (no bash)
const AGENT_PATTERNS = [
  /^(qué|que|cómo|como|cuál|cual|por qué|porque|dónde|donde|cuándo|cuando)/i,
  /^(explicá|explica|decime|contame|ayudame|ayuda)/i,
  /^(creá|crea|implementá|implementa|hacé|hace|arreglá|arregla)/i,
  /^(podés|podes|podrías|podrias|puedes)/i,
  /\?$/,  // Termina con pregunta
]

export interface DetectionResult {
  isBash: boolean
  command?: string
  confidence: number
  reason: string
}

export async function detectBashCommand(input: string): Promise<DetectionResult> {
  const trimmed = input.trim()

  // Vacío
  if (!trimmed) {
    return { isBash: false, confidence: 1, reason: 'empty' }
  }

  // Comandos especiales del CLI (empiezan con /)
  if (trimmed.startsWith('/')) {
    return { isBash: false, confidence: 1, reason: 'cli command' }
  }

  // Chequear si parece mensaje para el agente
  for (const pattern of AGENT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isBash: false, confidence: 0.9, reason: 'looks like question' }
    }
  }

  // Chequear patrones bash primero (pipes, redirects, etc)
  for (const pattern of BASH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isBash: true,
        command: trimmed,
        confidence: 0.85,
        reason: 'matches bash pattern'
      }
    }
  }

  // Obtener el primer "word" (comando potencial)
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase()

  // Verificar si es un comando real con `which`
  if (await isValidCommand(firstWord)) {
    return {
      isBash: true,
      command: trimmed,
      confidence: 0.95,
      reason: `valid command: ${firstWord}`
    }
  }

  // Si es muy corto y no tiene espacios, podría ser un comando
  if (trimmed.length < 20 && !trimmed.includes(' ') && /^[a-z0-9_-]+$/i.test(trimmed)) {
    // Podría ser un comando o un saludo... dejarlo para el agente
    return { isBash: false, confidence: 0.5, reason: 'ambiguous short input' }
  }

  // Default: es un mensaje para el agente
  return { isBash: false, confidence: 0.7, reason: 'default to agent' }
}

// Ejecutar comando bash y retornar resultado formateado
export async function runBashCommand(command: string): Promise<{
  stdout: string
  stderr: string
  exitCode: number
  formatted: string
}> {
  const proc = Bun.spawn(['bash', '-c', command], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited

  // Formatear para mostrar
  let formatted = ''
  if (stdout.trim()) {
    formatted += stdout
  }
  if (stderr.trim()) {
    formatted += stderr
  }
  if (!formatted && exitCode === 0) {
    formatted = '(comando ejecutado sin output)'
  }

  return { stdout, stderr, exitCode, formatted: formatted.trim() }
}

// UI utilities - colores y formateo para terminal

// ANSI escape codes
const ESC = '\x1b['
const RESET = `${ESC}0m`

export const colors = {
  // Foreground
  black: (s: string) => `${ESC}30m${s}${RESET}`,
  red: (s: string) => `${ESC}31m${s}${RESET}`,
  green: (s: string) => `${ESC}32m${s}${RESET}`,
  yellow: (s: string) => `${ESC}33m${s}${RESET}`,
  blue: (s: string) => `${ESC}34m${s}${RESET}`,
  magenta: (s: string) => `${ESC}35m${s}${RESET}`,
  cyan: (s: string) => `${ESC}36m${s}${RESET}`,
  white: (s: string) => `${ESC}37m${s}${RESET}`,
  gray: (s: string) => `${ESC}90m${s}${RESET}`,

  // Styles
  bold: (s: string) => `${ESC}1m${s}${RESET}`,
  dim: (s: string) => `${ESC}2m${s}${RESET}`,
  italic: (s: string) => `${ESC}3m${s}${RESET}`,
  underline: (s: string) => `${ESC}4m${s}${RESET}`,

  // Background
  bgRed: (s: string) => `${ESC}41m${s}${RESET}`,
  bgGreen: (s: string) => `${ESC}42m${s}${RESET}`,
  bgYellow: (s: string) => `${ESC}43m${s}${RESET}`,
  bgBlue: (s: string) => `${ESC}44m${s}${RESET}`,
}

// Símbolos
export const symbols = {
  check: '✓',
  cross: '✗',
  bullet: '•',
  arrow: '→',
  arrowRight: '❯',
  info: 'ℹ',
  warning: '⚠',
  error: '✖',
  star: '★',
  heart: '♥',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
}

// Spinner para operaciones async
export class Spinner {
  private frames = symbols.spinner
  private interval: ReturnType<typeof setInterval> | null = null
  private frameIndex = 0
  private message: string
  private stopped = false

  constructor(message: string = 'Cargando...') {
    this.message = message
  }

  start() {
    if (this.interval) return // Ya está corriendo
    this.stopped = false
    process.stdout.write('\x1b[?25l') // Ocultar cursor
    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex]
      process.stdout.write(`\r${colors.cyan(frame)} ${this.message}`)
      this.frameIndex = (this.frameIndex + 1) % this.frames.length
    }, 80)
  }

  update(message: string) {
    this.message = message
  }

  isRunning(): boolean {
    return this.interval !== null && !this.stopped
  }

  stop(finalMessage?: string) {
    if (this.stopped) return // Ya parado, no hacer nada
    this.stopped = true

    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      // Solo limpiar línea si había un spinner activo
      process.stdout.write('\r\x1b[K') // Limpiar línea del spinner
    }
    process.stdout.write('\x1b[?25h') // Mostrar cursor

    if (finalMessage) {
      console.log(finalMessage)
    }
  }

  success(message: string) {
    this.stop(`${colors.green(symbols.check)} ${message}`)
  }

  fail(message: string) {
    this.stop(`${colors.red(symbols.cross)} ${message}`)
  }
}

// Box drawing
export function box(content: string, title?: string): string {
  const lines = content.split('\n')
  const maxWidth = Math.max(...lines.map(l => l.length), title?.length || 0) + 2

  let result = ''

  // Top border
  if (title) {
    result += `┌─ ${colors.bold(title)} ${'─'.repeat(maxWidth - title.length - 3)}┐\n`
  } else {
    result += `┌${'─'.repeat(maxWidth)}┐\n`
  }

  // Content
  for (const line of lines) {
    result += `│ ${line.padEnd(maxWidth - 2)} │\n`
  }

  // Bottom border
  result += `└${'─'.repeat(maxWidth)}┘`

  return result
}

// Format markdown básico para terminal
export function formatMarkdown(text: string): string {
  return text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const header = lang ? colors.dim(`[${lang}]`) : ''
      return `${header}\n${colors.cyan(code.trim())}\n`
    })
    // Inline code
    .replace(/`([^`]+)`/g, (_, code) => colors.cyan(code))
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, (_, text) => colors.bold(text))
    // Italic
    .replace(/\*([^*]+)\*/g, (_, text) => colors.italic(text))
    // Headers
    .replace(/^### (.+)$/gm, (_, text) => colors.bold(colors.yellow(text)))
    .replace(/^## (.+)$/gm, (_, text) => colors.bold(colors.blue(text)))
    .replace(/^# (.+)$/gm, (_, text) => colors.bold(colors.magenta(text)))
    // Lists
    .replace(/^- (.+)$/gm, (_, text) => `  ${colors.cyan(symbols.bullet)} ${text}`)
    .replace(/^\* (.+)$/gm, (_, text) => `  ${colors.cyan(symbols.bullet)} ${text}`)
}

// Print helpers
export const print = {
  info: (msg: string) => console.log(`${colors.blue(symbols.info)} ${msg}`),
  success: (msg: string) => console.log(`${colors.green(symbols.check)} ${msg}`),
  warning: (msg: string) => console.log(`${colors.yellow(symbols.warning)} ${msg}`),
  error: (msg: string) => console.log(`${colors.red(symbols.error)} ${msg}`),
  tool: (name: string, status: 'start' | 'end' | 'error') => {
    const icon = status === 'start' ? colors.yellow('⚡') :
                 status === 'end' ? colors.green('✓') :
                 colors.red('✗')
    console.log(`${icon} ${colors.dim(`tool:${name}`)}`)
  }
}

// Logo ASCII
export function printLogo() {
  console.log(colors.cyan(`
   _____ _                 _        _____          _
  / ____| |               | |      / ____|        | |
 | |    | | __ _ _   _  __| | ___ | |     ___   __| | ___
 | |    | |/ _\` | | | |/ _\` |/ _ \\| |    / _ \\ / _\` |/ _ \\
 | |____| | (_| | |_| | (_| |  __/| |___| (_) | (_| |  __/
  \\_____|_|\\__,_|\\__,_|\\__,_|\\___| \\_____\\___/ \\__,_|\\___|
`))
  console.log(colors.dim('  v0.1.0 - Tu asistente de código con TDD\n'))
}

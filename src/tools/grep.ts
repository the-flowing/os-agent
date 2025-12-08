// Tool: buscar contenido en archivos usando ripgrep (rg)
// Mucho más rápido que grep, ignora .gitignore automáticamente

export const definition = {
  name: 'grep',
  description: `Busca texto o regex en archivos usando ripgrep (rg).
Muy rápido, ignora .gitignore automáticamente.
Retorna las líneas que coinciden con el patrón.`,
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Texto o regex a buscar'
      },
      path: {
        type: 'string',
        description: 'Archivo o directorio donde buscar'
      },
      ignore_case: {
        type: 'boolean',
        description: 'Ignorar mayúsculas/minúsculas. Default: false'
      },
      file_type: {
        type: 'string',
        description: 'Filtrar por tipo de archivo. Ej: "ts", "js", "py"'
      },
      context: {
        type: 'number',
        description: 'Líneas de contexto antes y después. Default: 0'
      }
    },
    required: ['pattern', 'path']
  }
}

interface GrepParams {
  pattern: string
  path: string
  ignore_case?: boolean
  file_type?: string
  context?: number
}

export async function execute(params: GrepParams): Promise<string> {
  try {
    const args = ['rg', '--line-number', '--no-heading']

    if (params.ignore_case) {
      args.push('-i')
    }

    if (params.file_type) {
      args.push('-t', params.file_type)
    }

    if (params.context && params.context > 0) {
      args.push('-C', String(params.context))
    }

    // Limitar resultados
    args.push('--max-count', '50')

    args.push(params.pattern, params.path)

    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe'
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    // rg retorna 1 si no encuentra nada (no es error)
    if (exitCode === 1 && !stderr) {
      return `No se encontró "${params.pattern}" en ${params.path}`
    }

    if (exitCode > 1) {
      return `Error: ${stderr}`
    }

    const lines = stdout.trim()
    if (!lines) {
      return `No se encontró "${params.pattern}" en ${params.path}`
    }

    const count = lines.split('\n').length
    const suffix = count >= 50 ? '\n... (limitado a 50 resultados)' : ''

    return `Encontradas ${count} coincidencias:\n${lines}${suffix}`
  } catch (error) {
    // Fallback a grep si rg no está instalado
    return await fallbackGrep(params)
  }
}

async function fallbackGrep(params: GrepParams): Promise<string> {
  const flags = params.ignore_case ? '-rni' : '-rn'
  const cmd = `grep ${flags} "${params.pattern}" "${params.path}" 2>/dev/null | head -50`

  const proc = Bun.spawn(['bash', '-c', cmd], {
    stdout: 'pipe',
    stderr: 'pipe'
  })

  const stdout = await new Response(proc.stdout).text()
  const lines = stdout.trim()

  if (!lines) {
    return `No se encontró "${params.pattern}" en ${params.path}`
  }

  const count = lines.split('\n').length
  return `Encontradas ${count} coincidencias:\n${lines}`
}

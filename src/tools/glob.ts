// Tool: buscar archivos por patrón glob

export const definition = {
  name: 'glob',
  description: `Busca archivos que coincidan con un patrón glob.
Ejemplos de patrones:
- "*.ts" → todos los .ts en el directorio
- "**/*.ts" → todos los .ts recursivamente
- "src/**/*.test.ts" → todos los tests en src/
- "*.{ts,js}" → archivos .ts y .js`,
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Patrón glob para buscar archivos'
      },
      cwd: {
        type: 'string',
        description: 'Directorio base para la búsqueda. Default: directorio actual'
      }
    },
    required: ['pattern']
  }
}

interface GlobParams {
  pattern: string
  cwd?: string
}

export async function execute(params: GlobParams): Promise<string> {
  try {
    const cwd = params.cwd || process.cwd()

    // Usar find via bash que es más confiable
    const findPattern = params.pattern
      .replace(/\*\*/g, 'DOUBLESTAR')
      .replace(/\*/g, '*')
      .replace(/DOUBLESTAR/g, '**')

    let cmd: string
    if (params.pattern.includes('**')) {
      // Búsqueda recursiva
      const ext = params.pattern.split('.').pop() || '*'
      cmd = `find "${cwd}" -type f -name "*.${ext}" 2>/dev/null | head -100`
    } else {
      // Búsqueda en directorio actual
      cmd = `ls -1 "${cwd}"/${params.pattern} 2>/dev/null | head -100`
    }

    const proc = Bun.spawn(['bash', '-c', cmd], {
      stdout: 'pipe',
      stderr: 'pipe'
    })

    const stdout = await new Response(proc.stdout).text()
    await proc.exited

    const files = stdout.trim().split('\n').filter(f => f.length > 0)

    if (files.length === 0) {
      return `No se encontraron archivos con el patrón "${params.pattern}" en ${cwd}`
    }

    const suffix = files.length >= 100 ? '\n... (limitado a 100 resultados)' : ''
    return `Encontrados ${files.length} archivos:\n${files.join('\n')}${suffix}`
  } catch (error) {
    return `Error buscando archivos: ${error}`
  }
}

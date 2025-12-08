// Tool: leer archivos
import type { Tool } from '../types'

export const definition = {
  name: 'read',
  description: 'Lee el contenido de un archivo',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del archivo a leer'
      }
    },
    required: ['path']
  }
}

export async function execute(params: { path: string }): Promise<string> {
  try {
    const file = Bun.file(params.path)
    const content = await file.text()
    return content
  } catch (error) {
    return `Error leyendo archivo: ${error}`
  }
}

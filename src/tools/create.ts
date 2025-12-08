// Tool: crear archivos nuevos
// SOLO para archivos que no existen. Para modificar existentes usar `patch`.

export const definition = {
  name: 'create',
  description: `Crea un archivo nuevo con el contenido especificado.
IMPORTANTE: Solo usar para archivos que NO existen.
Para modificar archivos existentes, usar la tool "patch".`,
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del archivo a crear'
      },
      content: {
        type: 'string',
        description: 'Contenido del archivo'
      }
    },
    required: ['path', 'content']
  }
}

interface CreateParams {
  path: string
  content: string
}

export async function execute(params: CreateParams): Promise<string> {
  try {
    // Verificar si el archivo ya existe
    const file = Bun.file(params.path)
    const exists = await file.exists()

    if (exists) {
      return `Error: el archivo ${params.path} ya existe. Usá "patch" para modificarlo.`
    }

    // Crear directorios si no existen
    const dir = params.path.substring(0, params.path.lastIndexOf('/'))
    if (dir) {
      await Bun.spawn(['mkdir', '-p', dir]).exited
    }

    await Bun.write(params.path, params.content)
    return `Archivo creado: ${params.path}`
  } catch (error) {
    return `Error creando archivo: ${error}`
  }
}

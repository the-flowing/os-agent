// Tool: modificar archivos existentes con reemplazo de strings
// SOLO para archivos que ya existen. Para crear nuevos usar `create`.

export const definition = {
  name: 'patch',
  description: `Modifica un archivo existente reemplazando texto.
IMPORTANTE: Solo usar para archivos que YA existen.
Para crear archivos nuevos, usar la tool "create".

El old_string debe ser único en el archivo para evitar reemplazos accidentales.
Si querés reemplazar todas las ocurrencias, usá replace_all: true.`,
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del archivo a modificar'
      },
      old_string: {
        type: 'string',
        description: 'El texto exacto a reemplazar'
      },
      new_string: {
        type: 'string',
        description: 'El texto nuevo que reemplazará al anterior'
      },
      replace_all: {
        type: 'boolean',
        description: 'Si es true, reemplaza todas las ocurrencias. Por defecto false.'
      }
    },
    required: ['path', 'old_string', 'new_string']
  }
}

interface PatchParams {
  path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export async function execute(params: PatchParams): Promise<string> {
  try {
    const file = Bun.file(params.path)
    const exists = await file.exists()

    if (!exists) {
      return `Error: el archivo ${params.path} no existe. Usá "create" para crearlo.`
    }

    const content = await file.text()

    // Verificar que old_string existe en el archivo
    if (!content.includes(params.old_string)) {
      return `Error: no se encontró el texto a reemplazar en ${params.path}`
    }

    let newContent: string
    let replacements: number

    if (params.replace_all) {
      // Contar ocurrencias y reemplazar todas
      const regex = new RegExp(escapeRegex(params.old_string), 'g')
      replacements = (content.match(regex) || []).length
      newContent = content.replace(regex, params.new_string)
    } else {
      // Verificar que old_string es único
      const firstIndex = content.indexOf(params.old_string)
      const lastIndex = content.lastIndexOf(params.old_string)

      if (firstIndex !== lastIndex) {
        const count = content.split(params.old_string).length - 1
        return `Error: old_string aparece ${count} veces en el archivo. Usá un string más específico o replace_all: true`
      }

      replacements = 1
      newContent = content.replace(params.old_string, params.new_string)
    }

    await Bun.write(params.path, newContent)

    const msg = replacements === 1
      ? `Archivo ${params.path} modificado (1 reemplazo)`
      : `Archivo ${params.path} modificado (${replacements} reemplazos)`

    return msg
  } catch (error) {
    return `Error: ${error}`
  }
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

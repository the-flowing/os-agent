// Tool: ejecutar una tarea con test E2E en sandbox
// Flujo: especificación → test → implementación → validación

import { Sandbox } from '../sandbox'
import { notifySuccess, notifyError, notifyNeedsInput } from '../notify'

export const definition = {
  name: 'task',
  description: `Ejecuta una tarea de desarrollo con validación E2E.
Pasos:
1. Recibe especificación y test E2E
2. Implementa el código
3. Corre el test en sandbox
4. Retorna si pasó o falló

Usar cuando necesites validar que entendiste el requerimiento.`,
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Nombre de la tarea'
      },
      files: {
        type: 'array',
        description: 'Archivos a crear en el sandbox',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['path', 'content']
        }
      },
      testCommand: {
        type: 'string',
        description: 'Comando para correr tests (default: bun test)'
      }
    },
    required: ['name', 'files']
  }
}

interface TaskParams {
  name: string
  files: Array<{ path: string; content: string }>
  testCommand?: string
}

export async function execute(params: TaskParams): Promise<string> {
  const sandbox = new Sandbox()

  try {
    console.log(`\n📦 Creando sandbox para: ${params.name}`)
    await sandbox.create()

    // Crear package.json base si no viene
    const hasPackageJson = params.files.some(f => f.path === 'package.json')
    if (!hasPackageJson) {
      await sandbox.writeFile('package.json', JSON.stringify({
        name: 'sandbox-task',
        type: 'module'
      }, null, 2))
    }

    // Escribir todos los archivos
    for (const file of params.files) {
      console.log(`   📄 ${file.path}`)
      await sandbox.writeFile(file.path, file.content)
    }

    // Correr tests
    console.log(`\n🧪 Corriendo tests...`)
    const result = await sandbox.runTests(params.testCommand || 'bun test')

    if (result.success) {
      await notifySuccess(`✅ ${params.name}: Tests pasaron`)
      return `✅ TAREA EXITOSA: ${params.name}

Tests pasaron correctamente.

Output:
${result.output}`
    } else {
      await notifyNeedsInput(`❌ ${params.name}: Tests fallaron`)
      return `❌ TAREA FALLIDA: ${params.name}

Los tests no pasaron. Revisar implementación.

Output:
${result.output}

Error:
${result.error || 'Ver output arriba'}`
    }
  } catch (error) {
    await notifyError(`Error en tarea: ${params.name}`)
    return `❌ ERROR: ${error}`
  } finally {
    await sandbox.destroy()
  }
}

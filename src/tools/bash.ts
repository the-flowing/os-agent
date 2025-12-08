// Tool: ejecutar comandos bash
import type { Tool } from '../types'

export const definition = {
  name: 'bash',
  description: 'Ejecuta un comando en bash y retorna el output',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'El comando a ejecutar'
      }
    },
    required: ['command']
  }
}

export async function execute(params: { command: string }): Promise<string> {
  const proc = Bun.spawn(['bash', '-c', params.command], {
    stdout: 'pipe',
    stderr: 'pipe'
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  await proc.exited

  if (stderr && !stdout) {
    return `Error: ${stderr}`
  }
  return stdout || stderr || '(sin output)'
}

import { describe, test, expect, beforeAll } from 'bun:test'
import { loadTools, getToolDefinitions, executeTool, addTool, reloadAllTools } from '../tool-loader'

describe('tool-loader', () => {
  beforeAll(async () => {
    await loadTools()
  })

  test('carga las tools básicas', async () => {
    const tools = await getToolDefinitions()
    const names = tools.map(t => t.name)

    expect(names).toContain('bash')
    expect(names).toContain('read')
    expect(names).toContain('create')
    expect(names).toContain('patch')
  })

  test('ejecuta tool bash', async () => {
    const result = await executeTool('bash', { command: 'echo "hola"' })
    expect(result.trim()).toBe('hola')
  })

  test('ejecuta tool read', async () => {
    const result = await executeTool('read', { path: './package.json' })
    expect(result).toContain('os-agent')
  })

  test('tool inexistente retorna error', async () => {
    const result = await executeTool('noexiste', {})
    expect(result).toContain('no encontrada')
  })

  test('agrega tool dinámicamente', async () => {
    const toolCode = `
export const definition = {
  name: 'test_dynamic',
  description: 'Tool de prueba',
  input_schema: {
    type: 'object',
    properties: {
      value: { type: 'string' }
    },
    required: ['value']
  }
}

export async function execute(params: { value: string }): Promise<string> {
  return \`recibido: \${params.value}\`
}
`
    const added = await addTool('test_dynamic', toolCode)
    expect(added).toBe(true)

    const result = await executeTool('test_dynamic', { value: 'prueba123' })
    expect(result).toBe('recibido: prueba123')

    // Cleanup
    const { unlink } = await import('node:fs/promises')
    await unlink('./src/tools/test_dynamic.ts')
  })
})

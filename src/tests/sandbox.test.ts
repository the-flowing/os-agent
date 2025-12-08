import { describe, test, expect } from 'bun:test'
import { Sandbox, runInSandbox } from '../sandbox'

describe('Sandbox', () => {
  test('crea y destruye directorio temporal', async () => {
    const sandbox = new Sandbox()
    const dir = await sandbox.create()

    expect(dir).toContain('osa-sandbox-')

    // Verificar que existe
    const { exitCode } = await sandbox.exec('pwd')
    expect(exitCode).toBe(0)

    await sandbox.destroy()
    expect(sandbox.dir).toBeNull()
  })

  test('escribe y lee archivos', async () => {
    const sandbox = new Sandbox()
    await sandbox.create()

    await sandbox.writeFile('test.txt', 'contenido de prueba')
    const content = await sandbox.readFile('test.txt')

    expect(content).toBe('contenido de prueba')

    await sandbox.destroy()
  })

  test('ejecuta comandos', async () => {
    const sandbox = new Sandbox()
    await sandbox.create()

    const { stdout, exitCode } = await sandbox.exec('echo "hola mundo"')

    expect(stdout.trim()).toBe('hola mundo')
    expect(exitCode).toBe(0)

    await sandbox.destroy()
  })

  test('corre tests y reporta resultado', async () => {
    const result = await runInSandbox(async (sandbox) => {
      // Crear un mini proyecto con test
      await sandbox.writeFile('package.json', JSON.stringify({
        name: 'test-sandbox',
        type: 'module'
      }))

      await sandbox.writeFile('sum.ts', `
export function sum(a: number, b: number): number {
  return a + b
}
`)

      await sandbox.writeFile('sum.test.ts', `
import { test, expect } from 'bun:test'
import { sum } from './sum'

test('suma correctamente', () => {
  expect(sum(2, 3)).toBe(5)
})
`)
    })

    expect(result.success).toBe(true)
    expect(result.testsPassed).toBe(true)
  })

  test('detecta tests fallidos', async () => {
    const result = await runInSandbox(async (sandbox) => {
      await sandbox.writeFile('package.json', JSON.stringify({
        name: 'test-sandbox',
        type: 'module'
      }))

      await sandbox.writeFile('bad.test.ts', `
import { test, expect } from 'bun:test'

test('esto falla', () => {
  expect(1).toBe(2)
})
`)
    })

    expect(result.success).toBe(false)
    expect(result.testsPassed).toBe(false)
  })
})

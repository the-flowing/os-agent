import { describe, test, expect } from 'bun:test'
import { detectBashCommand, runBashCommand } from '../bash-detect'

describe('Bash detection', () => {
  describe('detecta comandos bash', () => {
    test('ls', async () => {
      const result = await detectBashCommand('ls')
      expect(result.isBash).toBe(true)
      expect(result.confidence).toBeGreaterThan(0.7)
    })

    test('ls -la', async () => {
      const result = await detectBashCommand('ls -la')
      expect(result.isBash).toBe(true)
    })

    test('git status', async () => {
      const result = await detectBashCommand('git status')
      expect(result.isBash).toBe(true)
    })

    test('cat archivo.ts', async () => {
      const result = await detectBashCommand('cat archivo.ts')
      expect(result.isBash).toBe(true)
    })

    test('curl https://example.com', async () => {
      const result = await detectBashCommand('curl https://example.com')
      expect(result.isBash).toBe(true)
    })

    test('npm install', async () => {
      const result = await detectBashCommand('npm install')
      expect(result.isBash).toBe(true)
    })

    test('bun test', async () => {
      const result = await detectBashCommand('bun test')
      expect(result.isBash).toBe(true)
    })

    test('./script.sh', async () => {
      const result = await detectBashCommand('./script.sh')
      expect(result.isBash).toBe(true)
    })

    test('comando con pipe', async () => {
      const result = await detectBashCommand('cat file | grep pattern')
      expect(result.isBash).toBe(true)
    })

    test('comando con redirect', async () => {
      const result = await detectBashCommand('echo hola > file.txt')
      expect(result.isBash).toBe(true)
    })
  })

  describe('NO detecta mensajes para el agente', () => {
    test('pregunta qué hace', async () => {
      const result = await detectBashCommand('qué hace este archivo?')
      expect(result.isBash).toBe(false)
    })

    test('pregunta cómo funciona', async () => {
      const result = await detectBashCommand('cómo funciona el sistema?')
      expect(result.isBash).toBe(false)
    })

    test('pide crear algo', async () => {
      const result = await detectBashCommand('creá una función para validar emails')
      expect(result.isBash).toBe(false)
    })

    test('pide explicar', async () => {
      const result = await detectBashCommand('explicame este código')
      expect(result.isBash).toBe(false)
    })

    test('termina con pregunta', async () => {
      const result = await detectBashCommand('puedes ayudarme con esto?')
      expect(result.isBash).toBe(false)
    })

    test('comando /cli', async () => {
      const result = await detectBashCommand('/help')
      expect(result.isBash).toBe(false)
    })
  })

  describe('runBashCommand', () => {
    test('ejecuta echo', async () => {
      const result = await runBashCommand('echo hola')
      expect(result.stdout.trim()).toBe('hola')
      expect(result.exitCode).toBe(0)
    })

    test('ejecuta pwd', async () => {
      const result = await runBashCommand('pwd')
      expect(result.stdout).toContain('/')
      expect(result.exitCode).toBe(0)
    })

    test('comando con error', async () => {
      const result = await runBashCommand('ls /path/que/no/existe/seguro')
      expect(result.exitCode).not.toBe(0)
    })

    test('comando con pipe', async () => {
      const result = await runBashCommand('echo "linea1\nlinea2" | wc -l')
      expect(result.stdout.trim()).toBe('2')
    })
  })

})

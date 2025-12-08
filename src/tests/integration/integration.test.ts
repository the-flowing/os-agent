// Tests de integración - usan LLM real via proxy
// Corren en paralelo con k configurable (default 3)

import { describe, test, expect, beforeAll } from 'bun:test'
import { loadTools } from '../../tool-loader'
import { chat } from '../../client'
import { runTests, summarize, type TestCase } from '../../test-runner'
import { unlink } from 'node:fs/promises'

// Configurable: cuántos tests corren en paralelo
const K = Number(process.env.TEST_CONCURRENCY) || 3

describe('Integración: Tool Choice (parallel k=' + K + ')', () => {
  beforeAll(async () => {
    await loadTools()
  })

  test('todos los tests de tool choice', async () => {
    const testCases: TestCase[] = [
      {
        name: 'crea archivo cuando se le pide',
        fn: async () => {
          const testFile = `/tmp/osa-test-create-${Date.now()}.txt`
          const result = await chat(
            `Creá un archivo en ${testFile} con el contenido "hola mundo". Solo hacelo, no expliques.`
          )
          expect(result.toolsUsed).toContain('create')
          const file = Bun.file(testFile)
          const content = await file.text()
          expect(content).toContain('hola mundo')
          await unlink(testFile)
        }
      },
      {
        name: 'lee archivo cuando se le pide',
        fn: async () => {
          const testFile = `/tmp/osa-test-read-${Date.now()}.txt`
          await Bun.write(testFile, 'contenido secreto 12345')
          const result = await chat(
            `Leé el archivo ${testFile} y decime qué dice. Solo usá la tool y respondé.`
          )
          expect(result.toolsUsed).toContain('read')
          expect(result.text).toContain('12345')
          await unlink(testFile)
        }
      },
      {
        name: 'ejecuta comando bash',
        fn: async () => {
          const result = await chat(
            `Ejecutá el comando "echo prueba123" y decime el resultado.`
          )
          expect(result.toolsUsed).toContain('bash')
          expect(result.text).toContain('prueba123')
        }
      },
      {
        name: 'secuencia: crea y lee archivo',
        fn: async () => {
          const testFile = `/tmp/osa-seq-test-${Date.now()}.txt`
          const contenido = `test-${Date.now()}`
          const result = await chat(
            `Creá un archivo en ${testFile} con "${contenido}", después leelo y confirmame el contenido.`
          )
          expect(result.toolsUsed).toContain('create')
          expect(result.toolsUsed).toContain('read')
          expect(result.text).toContain(contenido)
          await unlink(testFile)
        }
      },
      {
        name: 'maneja error de archivo inexistente',
        fn: async () => {
          const result = await chat(
            `Leé el archivo /tmp/este-archivo-no-existe-${Date.now()}.txt`
          )
          expect(result.toolsUsed).toContain('read')
          expect(result.text.toLowerCase()).toMatch(/error|no existe|encontr/)
        }
      }
    ]

    console.log(`\nCorriendo ${testCases.length} tests con concurrency=${K}...\n`)
    const results = await runTests(testCases, { concurrency: K })
    const summary = summarize(results)

    expect(summary.failed).toBe(0)
  }, 120000) // 2 min timeout para todos
})

// Tests de integración complejos
// Escenarios más realistas para encontrar dónde falla

import { describe, test, expect, beforeAll } from 'bun:test'
import { loadTools } from '../../tool-loader'
import { chat } from '../../client'
import { runTests, summarize, type TestCase } from '../../test-runner'
import { unlink, rm } from 'node:fs/promises'

const K = Number(process.env.TEST_CONCURRENCY) || 3

describe('Integración: Escenarios Complejos (k=' + K + ')', () => {
  beforeAll(async () => {
    await loadTools()
  })

  test('escenarios complejos', async () => {
    const testCases: TestCase[] = [
      {
        name: 'crea módulo con su test',
        fn: async () => {
          const dir = `/tmp/osa-module-${Date.now()}`
          const result = await chat(
            `Creá un módulo en ${dir}/calculator.ts que exporte funciones add, subtract, multiply, divide.
             Después creá ${dir}/calculator.test.ts con tests para cada función.
             Usá bun:test para los tests.`
          )

          expect(result.toolsUsed).toContain('create')

          // Verificar que creó ambos archivos
          const mod = Bun.file(`${dir}/calculator.ts`)
          const modContent = await mod.text()
          expect(modContent).toContain('export')
          expect(modContent).toMatch(/add|subtract|multiply|divide/)

          const testFile = Bun.file(`${dir}/calculator.test.ts`)
          const testContent = await testFile.text()
          expect(testContent).toContain('bun:test')

          await rm(dir, { recursive: true, force: true })
        }
      },
      {
        name: 'encuentra y arregla bug',
        fn: async () => {
          const file = `/tmp/osa-bugfix-${Date.now()}.ts`
          // Código con bug obvio
          await Bun.write(file, `
export function sum(numbers: number[]): number {
  let total = 1; // BUG: debería ser 0
  for (const n of numbers) {
    total += n;
  }
  return total;
}
`)
          const result = await chat(
            `Leé ${file}, encontrá el bug y arreglalo. El bug es que sum([1,2,3]) debería dar 6 pero da 7.`
          )

          expect(result.toolsUsed).toContain('read')
          expect(result.toolsUsed).toContain('patch')

          const fixed = await Bun.file(file).text()
          expect(fixed).toContain('total = 0')

          await unlink(file)
        }
      },
      {
        name: 'refactoriza código',
        fn: async () => {
          const file = `/tmp/osa-refactor-${Date.now()}.ts`
          await Bun.write(file, `
// Código repetitivo que necesita refactor
function getUserName(user: any) {
  if (user && user.name) {
    return user.name;
  }
  return 'Unknown';
}

function getUserEmail(user: any) {
  if (user && user.email) {
    return user.email;
  }
  return 'Unknown';
}

function getUserAge(user: any) {
  if (user && user.age) {
    return user.age;
  }
  return 'Unknown';
}
`)
          const result = await chat(
            `Leé ${file} y refactorizá el código para eliminar la repetición.
             Creá una función genérica getUserField o similar.`
          )

          expect(result.toolsUsed).toContain('read')
          expect(result.toolsUsed).toContain('patch')

          const refactored = await Bun.file(file).text()
          // Debería tener una función genérica o similar
          expect(refactored).toMatch(/getUserField|getField|get.*Field|generic/i)

          await unlink(file)
        }
      },
      {
        name: 'entiende contexto multi-archivo',
        fn: async () => {
          const dir = `/tmp/osa-context-${Date.now()}`

          await Bun.write(`${dir}/types.ts`, `
export interface User {
  id: number;
  name: string;
  email: string;
}
`)
          await Bun.write(`${dir}/db.ts`, `
import { User } from './types';
export const users: User[] = [];
export function addUser(user: User) { users.push(user); }
`)
          await Bun.write(`${dir}/api.ts`, `
import { addUser } from './db';
// TODO: implementar createUser endpoint
`)

          const result = await chat(
            `Leé los archivos en ${dir}/ (types.ts, db.ts, api.ts) y completá el TODO en api.ts.
             Implementá una función createUser que use addUser del db.`
          )

          expect(result.toolsUsed).toContain('read')
          expect(result.toolsUsed).toContain('patch')

          const api = await Bun.file(`${dir}/api.ts`).text()
          expect(api).toContain('createUser')
          expect(api).toContain('addUser')

          await rm(dir, { recursive: true, force: true })
        }
      },
      {
        name: 'genera código desde descripción vaga',
        fn: async () => {
          const file = `/tmp/osa-vague-${Date.now()}.ts`

          const result = await chat(
            `Necesito algo para validar emails. Crealo en ${file}.`
          )

          expect(result.toolsUsed).toContain('create')

          const content = await Bun.file(file).text()
          // Debería haber creado algo relacionado a validación de email
          expect(content.toLowerCase()).toMatch(/email|valid|regex|@/)

          await unlink(file)
        }
      },
      {
        name: 'maneja instrucciones contradictorias',
        fn: async () => {
          const file = `/tmp/osa-contradict-${Date.now()}.ts`

          const result = await chat(
            `Creá en ${file} una función que retorne true y false al mismo tiempo.`
          )

          // Debería manejar esto gracefully, no crashear
          // Puede que escriba algo o que explique que no es posible
          expect(result.text.length).toBeGreaterThan(0)
        }
      },
      {
        name: 'trabaja con archivo grande',
        fn: async () => {
          const file = `/tmp/osa-large-${Date.now()}.ts`

          // Crear archivo con muchas líneas
          const lines = Array.from({ length: 200 }, (_, i) =>
            `export const var${i} = ${i};`
          ).join('\n')
          await Bun.write(file, lines)

          const result = await chat(
            `Leé ${file} y decime cuántas variables exporta aproximadamente.`
          )

          expect(result.toolsUsed).toContain('read')
          expect(result.text).toMatch(/200|doscient|cien|muchas|varias/)

          await unlink(file)
        }
      },
      {
        name: 'ejecuta comando y actúa sobre resultado',
        fn: async () => {
          const dir = `/tmp/osa-cmd-${Date.now()}`
          await Bun.spawn(['mkdir', '-p', dir]).exited
          await Bun.write(`${dir}/a.ts`, 'export const a = 1')
          await Bun.write(`${dir}/b.ts`, 'export const b = 2')
          await Bun.write(`${dir}/c.js`, 'module.exports = 3')

          const result = await chat(
            `Listá los archivos en ${dir}/ y después creá un index.ts que re-exporte solo los .ts`
          )

          expect(result.toolsUsed).toContain('bash')
          expect(result.toolsUsed).toContain('create')

          const index = await Bun.file(`${dir}/index.ts`).text()
          expect(index).toContain('a')
          expect(index).toContain('b')
          expect(index).not.toContain('c.js')

          await rm(dir, { recursive: true, force: true })
        }
      }
    ]

    console.log(`\nCorriendo ${testCases.length} tests complejos con concurrency=${K}...\n`)
    const results = await runTests(testCases, { concurrency: K })
    const summary = summarize(results)

    // Acá queremos ver cuáles fallan para mejorar
    console.log('\n--- Análisis para mejoras ---')
    results.forEach(r => {
      if (!r.passed) {
        console.log(`\n🔍 "${r.name}" falló:`)
        console.log(`   ${r.error?.substring(0, 200)}...`)
      }
    })

    // No hacemos expect(failed).toBe(0) porque queremos ver qué falla
    console.log(`\n📊 Tasa de éxito: ${summary.passed}/${testCases.length}`)
  }, 300000) // 5 min timeout
})

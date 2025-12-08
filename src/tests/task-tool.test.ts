import { describe, test, expect } from 'bun:test'
import { execute } from '../tools/task'

describe('task tool', () => {
  test('ejecuta tarea exitosa', async () => {
    const result = await execute({
      name: 'suma-basica',
      files: [
        {
          path: 'math.ts',
          content: `export const sum = (a: number, b: number) => a + b`
        },
        {
          path: 'math.test.ts',
          content: `
import { test, expect } from 'bun:test'
import { sum } from './math'

test('suma 2 + 2 = 4', () => {
  expect(sum(2, 2)).toBe(4)
})
`
        }
      ]
    })

    expect(result).toContain('TAREA EXITOSA')
  })

  test('detecta tarea fallida', async () => {
    const result = await execute({
      name: 'tarea-mal',
      files: [
        {
          path: 'bad.test.ts',
          content: `
import { test, expect } from 'bun:test'

test('esto falla', () => {
  expect(true).toBe(false)
})
`
        }
      ]
    })

    expect(result).toContain('TAREA FALLIDA')
  })
})

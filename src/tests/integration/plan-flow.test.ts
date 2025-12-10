// Test de integración: Flujo de Plan con TDD
// Verifica que el LLM puede crear y ejecutar planes

import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import { loadTools } from '../../tool-loader'
import { chat } from '../../client'
import { savePlans, loadPlans } from '../../plan'
import { rm } from 'node:fs/promises'

describe('Integración: Plan Flow', () => {
  beforeAll(async () => {
    await loadTools()
  })

  afterEach(async () => {
    try {
      await rm('.osa', { recursive: true, force: true })
    } catch {}
  })

  test('LLM crea plan para tarea de desarrollo', async () => {
    await savePlans([])

    const result = await chat(
      `Necesito implementar una función "formatDate" que convierta fechas a formato "DD/MM/YYYY".
       Usá la tool "plan" con action="create" para crear un plan de desarrollo con al menos 2 steps.
       Cada step debe tener un test descriptivo.`
    )

    expect(result.toolsUsed).toContain('plan')

    const plans = await loadPlans()
    expect(plans.length).toBeGreaterThan(0)
    expect(plans[0].status).toBe('draft')
    expect(plans[0].steps.length).toBeGreaterThanOrEqual(2)
  }, 60000)

  test('LLM puede aprobar y avanzar en plan', async () => {
    await savePlans([])

    // Crear plan
    await chat(
      `Creá un plan con action="create" para una función "isEven" que detecta números pares.
       Incluí 2 steps: uno para números pares y otro para impares.`
    )

    // Configurar testing strategy (obligatorio antes de aprobar)
    await chat(
      `Configurá la testing strategy con action="set_testing", unitTestCommand="bun test", unitTestPattern="**/*.test.ts".`
    )

    // Aprobar
    const approveResult = await chat(
      `Aprobá el plan usando la tool "plan" con action="approve".`
    )
    expect(approveResult.toolsUsed).toContain('plan')

    // Verificar aprobación
    const plans = await loadPlans()
    const plan = plans[0]
    expect(plan.status).toBe('approved')

    // Ver siguiente step
    const nextResult = await chat(
      `Mostrá el siguiente step con action="next".`
    )
    expect(nextResult.text).toContain('Step')
  }, 120000)

  test('flujo TDD completo simulado', async () => {
    await savePlans([])

    // 1. Crear plan simple
    await chat(
      `Usá plan con action="create", title="Test Simple", y un step que diga "Crear función hello".`
    )

    // 2. Configurar testing strategy (obligatorio)
    await chat(
      `Usá plan con action="set_testing", unitTestCommand="bun test", unitTestPattern="**/*.test.ts".`
    )

    // 3. Aprobar
    await chat(`Usá plan con action="approve".`)

    // 4. Ver step
    const nextResult = await chat(`Usá plan con action="next".`)
    expect(nextResult.text).toMatch(/Step|hello/i)

    // 5. Marcar como passed
    const passResult = await chat(`Usá plan con action="pass".`)
    expect(passResult.text).toMatch(/completado|🎉/i)

    // Verificar estado final
    const plans = await loadPlans()
    expect(plans[0].status).toBe('completed')
  }, 180000)
})

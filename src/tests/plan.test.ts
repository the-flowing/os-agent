import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  createPlan,
  approvePlan,
  getActivePlan,
  getCurrentStep,
  updateStepStatus,
  loadPlans,
  savePlans,
  formatPlanForDisplay,
  type Plan
} from '../plan'
import { unlink, rm } from 'node:fs/promises'

describe('Plan System', () => {
  // Limpiar plans antes de cada test
  beforeEach(async () => {
    await savePlans([])
  })

  afterEach(async () => {
    try {
      await rm('.osa', { recursive: true, force: true })
    } catch {}
  })

  test('crea plan en estado draft', async () => {
    const plan = await createPlan(
      'Test Plan',
      'Descripción del plan',
      [
        { description: 'Step 1', test: { description: 'Test para step 1' } },
        { description: 'Step 2', test: { description: 'Test para step 2' } }
      ]
    )

    expect(plan.status).toBe('draft')
    expect(plan.title).toBe('Test Plan')
    expect(plan.steps.length).toBe(2)
    expect(plan.steps[0].id).toBe(1)
    expect(plan.steps[1].id).toBe(2)
    expect(plan.steps[0].status).toBe('pending')
  })

  test('persiste plan en archivo', async () => {
    await createPlan('Persistido', '', [
      { description: 'Step', test: { description: 'Test' } }
    ])

    const plans = await loadPlans()
    expect(plans.length).toBe(1)
    expect(plans[0].title).toBe('Persistido')
  })

  test('aprueba plan draft', async () => {
    const plan = await createPlan('Para aprobar', '', [
      { description: 'Step', test: { description: 'Test' } }
    ])

    const approved = await approvePlan(plan.id)

    expect(approved).not.toBeNull()
    expect(approved!.status).toBe('approved')
  })

  test('no aprueba plan no-draft', async () => {
    const plan = await createPlan('Plan', '', [
      { description: 'Step', test: { description: 'Test' } }
    ])

    // Aprobar primero
    await approvePlan(plan.id)
    // Intentar aprobar de nuevo
    const result = await approvePlan(plan.id)

    expect(result).toBeNull()
  })

  test('obtiene plan activo', async () => {
    // Sin planes, no hay activo
    let active = await getActivePlan()
    expect(active).toBeNull()

    // Crear y aprobar
    const plan = await createPlan('Activo', '', [
      { description: 'Step', test: { description: 'Test' } }
    ])
    await approvePlan(plan.id)

    active = await getActivePlan()
    expect(active).not.toBeNull()
    expect(active!.title).toBe('Activo')
  })

  test('obtiene step actual', async () => {
    const plan = await createPlan('Con steps', '', [
      { description: 'Step 1', test: { description: 'Test 1' } },
      { description: 'Step 2', test: { description: 'Test 2' } }
    ])
    await approvePlan(plan.id)

    const step = await getCurrentStep(plan.id)
    expect(step).not.toBeNull()
    expect(step!.id).toBe(1)
    expect(step!.description).toBe('Step 1')
  })

  test('avanza al siguiente step cuando se marca passed', async () => {
    const plan = await createPlan('Avance', '', [
      { description: 'Step 1', test: { description: 'Test 1' } },
      { description: 'Step 2', test: { description: 'Test 2' } }
    ])
    await approvePlan(plan.id)

    // Marcar step 1 como passed
    await updateStepStatus(plan.id, 1, 'passed')

    const step = await getCurrentStep(plan.id)
    expect(step!.id).toBe(2)
  })

  test('plan se completa cuando todos los steps pasan', async () => {
    const plan = await createPlan('Completar', '', [
      { description: 'Step 1', test: { description: 'Test 1' } },
      { description: 'Step 2', test: { description: 'Test 2' } }
    ])
    await approvePlan(plan.id)

    await updateStepStatus(plan.id, 1, 'passed')
    await updateStepStatus(plan.id, 2, 'passed')

    const plans = await loadPlans()
    const updated = plans.find(p => p.id === plan.id)

    expect(updated!.status).toBe('completed')
  })

  test('plan falla si un step falla', async () => {
    const plan = await createPlan('Fallar', '', [
      { description: 'Step 1', test: { description: 'Test 1' } },
      { description: 'Step 2', test: { description: 'Test 2' } }
    ])
    await approvePlan(plan.id)

    await updateStepStatus(plan.id, 1, 'failed')

    const plans = await loadPlans()
    const updated = plans.find(p => p.id === plan.id)

    expect(updated!.status).toBe('failed')
  })

  test('getCurrentStep retorna null cuando plan está completo', async () => {
    const plan = await createPlan('Full', '', [
      { description: 'Step 1', test: { description: 'Test 1' } }
    ])
    await approvePlan(plan.id)
    await updateStepStatus(plan.id, 1, 'passed')

    const step = await getCurrentStep(plan.id)
    expect(step).toBeNull()
  })

  test('formatPlanForDisplay genera output legible', async () => {
    const plan = await createPlan('Display Test', 'Una descripción', [
      { description: 'Primer step', test: { description: 'Test primero' } },
      { description: 'Segundo step', test: { description: 'Test segundo' } }
    ])

    const output = formatPlanForDisplay(plan)

    expect(output).toContain('Display Test')
    expect(output).toContain('Una descripción')
    expect(output).toContain('Primer step')
    expect(output).toContain('Segundo step')
    expect(output).toContain('📝') // emoji de draft
  })
})

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { execute } from '../tools/plan'
import { savePlans, loadPlans } from '../plan'
import { rm } from 'node:fs/promises'

describe('Plan Tool', () => {
  beforeEach(async () => {
    await savePlans([])
  })

  afterEach(async () => {
    try {
      await rm('.osa', { recursive: true, force: true })
    } catch {}
  })

  test('create: crea plan con steps', async () => {
    const result = await execute({
      action: 'create',
      title: 'Mi Feature',
      description: 'Implementar algo',
      steps: [
        { description: 'Crear módulo', test: { description: 'Test del módulo' } },
        { description: 'Agregar función', test: { description: 'Test de función' } }
      ]
    })

    expect(result).toContain('Plan creado')
    expect(result).toContain('Mi Feature')
    expect(result).toContain('approve')

    const plans = await loadPlans()
    expect(plans.length).toBe(1)
  })

  test('create: error sin título', async () => {
    const result = await execute({
      action: 'create',
      steps: [{ description: 'Step', test: { description: 'Test' } }]
    })

    expect(result).toContain('Error')
    expect(result).toContain('title')
  })

  test('create: error sin steps', async () => {
    const result = await execute({
      action: 'create',
      title: 'Sin steps'
    })

    expect(result).toContain('Error')
  })

  test('show: muestra plan activo', async () => {
    // Crear y aprobar un plan
    await execute({
      action: 'create',
      title: 'Para mostrar',
      steps: [{ description: 'Step', test: { description: 'Test' } }]
    })
    await execute({ action: 'approve' })

    const result = await execute({ action: 'show' })

    expect(result).toContain('Para mostrar')
    expect(result).toContain('✅') // aprobado
  })

  test('show: sin planes', async () => {
    const result = await execute({ action: 'show' })
    expect(result).toContain('No hay planes')
  })

  test('approve: aprueba plan draft', async () => {
    await execute({
      action: 'create',
      title: 'Para aprobar',
      steps: [{ description: 'Step', test: { description: 'Test' } }]
    })

    const result = await execute({ action: 'approve' })

    expect(result).toContain('aprobado')
    expect(result).toContain('✅')
  })

  test('approve: error sin draft', async () => {
    const result = await execute({ action: 'approve' })
    expect(result).toContain('No hay plan en draft')
  })

  test('next: muestra step actual', async () => {
    await execute({
      action: 'create',
      title: 'Con next',
      steps: [
        { description: 'Primer paso', test: { description: 'Testear primer paso' } }
      ]
    })
    await execute({ action: 'approve' })

    const result = await execute({ action: 'next' })

    expect(result).toContain('Step 1')
    expect(result).toContain('Primer paso')
    expect(result).toContain('Testear primer paso')
    expect(result).toContain('Flujo')
  })

  test('next: sin plan activo', async () => {
    const result = await execute({ action: 'next' })
    expect(result).toContain('No hay plan activo')
  })

  test('pass: marca step como completado', async () => {
    await execute({
      action: 'create',
      title: 'Para pass',
      steps: [
        { description: 'Step 1', test: { description: 'Test 1' } },
        { description: 'Step 2', test: { description: 'Test 2' } }
      ]
    })
    await execute({ action: 'approve' })

    const result = await execute({ action: 'pass' })

    expect(result).toContain('✅')
    expect(result).toContain('completado')
    expect(result).toContain('Step 2') // siguiente
  })

  test('pass: plan completado cuando último step pasa', async () => {
    await execute({
      action: 'create',
      title: 'Para completar',
      steps: [{ description: 'Único step', test: { description: 'Test' } }]
    })
    await execute({ action: 'approve' })

    const result = await execute({ action: 'pass' })

    expect(result).toContain('Plan completado')
    expect(result).toContain('🎉')
  })

  test('fail: marca step como fallido', async () => {
    await execute({
      action: 'create',
      title: 'Para fail',
      steps: [{ description: 'Step que falla', test: { description: 'Test' } }]
    })
    await execute({ action: 'approve' })

    const result = await execute({ action: 'fail' })

    expect(result).toContain('❌')
    expect(result).toContain('falló')
  })

  test('flujo completo TDD', async () => {
    // 1. Crear plan
    let result = await execute({
      action: 'create',
      title: 'Flujo TDD',
      description: 'Test del flujo completo',
      steps: [
        { description: 'Crear función add', test: { description: 'add(1,2) === 3' } },
        { description: 'Crear función subtract', test: { description: 'subtract(5,3) === 2' } }
      ]
    })
    expect(result).toContain('Plan creado')

    // 2. Aprobar
    result = await execute({ action: 'approve' })
    expect(result).toContain('aprobado')

    // 3. Ver primer step
    result = await execute({ action: 'next' })
    expect(result).toContain('add')

    // 4. Marcar como pasado
    result = await execute({ action: 'pass' })
    expect(result).toContain('Step 2')

    // 5. Ver segundo step
    result = await execute({ action: 'next' })
    expect(result).toContain('subtract')

    // 6. Completar
    result = await execute({ action: 'pass' })
    expect(result).toContain('Plan completado')
  })
})

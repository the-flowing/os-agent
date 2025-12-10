import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { execute } from '../tools/plan'
import { savePlans, loadPlans } from '../plan'
import { rm } from 'node:fs/promises'

// Helper para configurar testing strategy y aprobar
async function createAndApprovePlan(title: string, steps: any[]) {
  await execute({
    action: 'create',
    title,
    steps
  })

  // Configurar testing strategy (requerido para aprobar)
  await execute({
    action: 'set_testing',
    testing_strategy: {
      unitTestCommand: 'bun test',
      unitTestPattern: '**/*.test.ts'
    }
  })

  return await execute({ action: 'approve' })
}

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
        { description: 'Crear módulo', tests: [{ description: 'Test del módulo', type: 'unit' }] },
        { description: 'Agregar función', tests: [{ description: 'Test de función', type: 'unit' }] }
      ]
    })

    expect(result).toContain('Plan creado')
    expect(result).toContain('Mi Feature')
    expect(result).toContain('approve')

    const plans = await loadPlans()
    expect(plans.length).toBe(1)
  })

  test('create: acepta formato legacy con test singular', async () => {
    const result = await execute({
      action: 'create',
      title: 'Legacy Format',
      steps: [
        { description: 'Step', test: { description: 'Test legacy' } }
      ]
    })

    expect(result).toContain('Plan creado')
  })

  test('create: error sin título', async () => {
    const result = await execute({
      action: 'create',
      steps: [{ description: 'Step', tests: [{ description: 'Test', type: 'unit' }] }]
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

  test('detect_testing: detecta configuración del proyecto', async () => {
    const result = await execute({ action: 'detect_testing' })

    // Este proyecto usa bun test
    expect(result).toContain('bun test')
  })

  test('set_testing: configura testing strategy', async () => {
    await execute({
      action: 'create',
      title: 'Con Strategy',
      steps: [{ description: 'Step', tests: [{ description: 'Test', type: 'unit' }] }]
    })

    const result = await execute({
      action: 'set_testing',
      testing_strategy: {
        unitTestCommand: 'npm test',
        unitTestPattern: '**/*.spec.ts'
      }
    })

    expect(result).toContain('Testing strategy configurada')
    expect(result).toContain('npm test')
  })

  test('approve: requiere testing strategy', async () => {
    await execute({
      action: 'create',
      title: 'Sin Strategy',
      steps: [{ description: 'Step', tests: [{ description: 'Test', type: 'unit' }] }]
    })

    const result = await execute({ action: 'approve' })

    expect(result).toContain('Testing Strategy')
    expect(result).toContain('set_testing')
  })

  test('show: muestra plan activo', async () => {
    await createAndApprovePlan('Para mostrar', [
      { description: 'Step', tests: [{ description: 'Test', type: 'unit' }] }
    ])

    const result = await execute({ action: 'show' })

    expect(result).toContain('Para mostrar')
    expect(result).toContain('✅') // aprobado
  })

  test('show: sin planes', async () => {
    const result = await execute({ action: 'show' })
    expect(result).toContain('No hay planes')
  })

  test('approve: aprueba plan con testing strategy', async () => {
    const result = await createAndApprovePlan('Para aprobar', [
      { description: 'Step', tests: [{ description: 'Test', type: 'unit' }] }
    ])

    expect(result).toContain('aprobado')
    expect(result).toContain('✅')
  })

  test('approve: error sin draft', async () => {
    const result = await execute({ action: 'approve' })
    expect(result).toContain('No hay plan en draft')
  })

  test('next: muestra step actual con tests', async () => {
    await createAndApprovePlan('Con next', [
      { description: 'Primer paso', tests: [{ description: 'Testear primer paso', type: 'unit' }] }
    ])

    const result = await execute({ action: 'next' })

    expect(result).toContain('Step 1')
    expect(result).toContain('Primer paso')
    expect(result).toContain('Testear primer paso')
    expect(result).toContain('Flujo TDD')
  })

  test('next: sin plan activo', async () => {
    const result = await execute({ action: 'next' })
    expect(result).toContain('No hay plan activo')
  })

  test('verify: ejecuta comando de verificación', async () => {
    await createAndApprovePlan('Con verify', [
      {
        description: 'Step con verify',
        tests: [{ description: 'Test', type: 'unit' }],
        verificationCommand: 'echo "test passed"'
      }
    ])

    const result = await execute({ action: 'verify' })

    expect(result).toContain('Verificación')
    expect(result).toContain('test passed')
  })

  test('pass: marca step como completado', async () => {
    await createAndApprovePlan('Para pass', [
      { description: 'Step 1', tests: [{ description: 'Test 1', type: 'unit' }] },
      { description: 'Step 2', tests: [{ description: 'Test 2', type: 'unit' }] }
    ])

    const result = await execute({ action: 'pass' })

    expect(result).toContain('✅')
    expect(result).toContain('completado')
    expect(result).toContain('Step 2') // siguiente
  })

  test('pass: plan completado cuando último step pasa', async () => {
    await createAndApprovePlan('Para completar', [
      { description: 'Único step', tests: [{ description: 'Test', type: 'unit' }] }
    ])

    const result = await execute({ action: 'pass' })

    expect(result).toContain('Plan completado')
    expect(result).toContain('🎉')
  })

  test('fail: marca step como fallido', async () => {
    await createAndApprovePlan('Para fail', [
      { description: 'Step que falla', tests: [{ description: 'Test', type: 'unit' }] }
    ])

    const result = await execute({ action: 'fail' })

    expect(result).toContain('❌')
    expect(result).toContain('falló')
  })

  test('flujo completo TDD con testing strategy', async () => {
    // 1. Detectar testing
    let result = await execute({ action: 'detect_testing' })
    expect(result).toContain('bun test')

    // 2. Crear plan
    result = await execute({
      action: 'create',
      title: 'Flujo TDD',
      description: 'Test del flujo completo',
      steps: [
        { description: 'Crear función add', tests: [{ description: 'add(1,2) === 3', type: 'unit' }] },
        { description: 'Crear función subtract', tests: [{ description: 'subtract(5,3) === 2', type: 'unit' }] }
      ]
    })
    expect(result).toContain('Plan creado')

    // 3. Configurar testing strategy
    result = await execute({
      action: 'set_testing',
      testing_strategy: {
        unitTestCommand: 'bun test',
        unitTestPattern: '**/*.test.ts'
      }
    })
    expect(result).toContain('Testing strategy configurada')

    // 4. Aprobar
    result = await execute({ action: 'approve' })
    expect(result).toContain('aprobado')

    // 5. Ver primer step
    result = await execute({ action: 'next' })
    expect(result).toContain('add')
    expect(result).toContain('verify')

    // 6. Marcar como pasado
    result = await execute({ action: 'pass' })
    expect(result).toContain('Step 2')

    // 7. Ver segundo step
    result = await execute({ action: 'next' })
    expect(result).toContain('subtract')

    // 8. Completar
    result = await execute({ action: 'pass' })
    expect(result).toContain('Plan completado')
  })

  test('batch_update: modifica plan existente', async () => {
    await execute({
      action: 'create',
      title: 'Para batch',
      steps: [{ description: 'Step original', tests: [{ description: 'Test', type: 'unit' }] }]
    })

    const result = await execute({
      action: 'batch_update',
      updates: [
        { action: 'add', description: 'Nuevo step', tests: [{ description: 'Test nuevo', type: 'unit' }] }
      ]
    })

    expect(result).toContain('Step agregado')
  })
})

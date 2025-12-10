// Tool: gestión de planes de desarrollo con TDD
// Crea planes, aprueba, ejecuta steps con tests
// Incluye Testing Strategy obligatoria para verificación determinista

import {
  createPlan,
  approvePlan,
  getActivePlan,
  getCurrentStep,
  updateStepStatus,
  formatPlanForDisplay,
  loadPlans,
  savePlans,
  setTestingStrategy,
  type Step,
  type TestingStrategy,
  type TestDefinition
} from '../plan'

import {
  detectTestingSetup,
  formatTestingDetection,
  generateTestingSetupStep
} from '../testing-detection'

export const definition = {
  name: 'plan',
  description: `Gestiona planes de desarrollo con TDD y Testing Strategy obligatoria.

FLUJO MEJORADO:
1. "detect_testing" → detecta configuración de tests del proyecto
2. "set_testing" → confirma/configura testing strategy
3. "create" → crea plan draft con tests verificables
4. Usuario pide cambios → usás "batch_update" para modificar
5. "approve" → REQUIERE testing strategy confirmada
6. Para cada step: "next" → escribir test → implementar → "verify" → "pass"/"fail"

ACCIONES:
- "detect_testing": Detecta automáticamente la configuración de tests del proyecto
- "set_testing": Configura/confirma la testing strategy (unit + e2e)
- "create": Crea plan NUEVO (solo si no hay draft activo)
- "show": Muestra el plan actual
- "approve": Aprueba draft para comenzar ejecución (REQUIERE testing strategy)
- "cancel": Cancela el draft (SOLO si usuario dice "cancelar"/"descartar")
- "batch_update": Modifica el plan draft existente
- "next": Obtiene siguiente step con test a escribir
- "verify": Ejecuta el comando de verificación del step actual
- "pass"/"fail": Marca resultado del step actual

TESTING STRATEGY (OBLIGATORIO):
- Antes de aprobar un plan, debe haber una testing strategy confirmada
- La strategy define cómo ejecutar tests unitarios y e2e
- Si no hay configuración de tests, el primer step debe ser configurarla

CUÁNDO USAR CADA ACCIÓN:
- Antes de crear cualquier plan → detect_testing (si no se hizo)
- Usuario confirma testing → set_testing
- Usuario pide "nuevo plan", "planificar X" → create
- Usuario pide cambios al plan → batch_update
- Usuario aprueba → approve (valida testing strategy)
- Durante ejecución → next, verify, pass/fail

VERIFICACIÓN DETERMINISTA:
- Cada step tiene un verificationCommand específico
- Usar "verify" para ejecutar el test del step actual
- Solo marcar "pass" si el test pasa

batch_update recibe array "updates": [{action: "update"|"add"|"remove", step_id, description, tests, verificationCommand}]`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['detect_testing', 'set_testing', 'create', 'show', 'approve', 'cancel', 'batch_update', 'update_step', 'add_step', 'remove_step', 'next', 'verify', 'pass', 'fail'],
        description: 'Acción a realizar'
      },
      title: {
        type: 'string',
        description: 'Título del plan (solo para action=create)'
      },
      description: {
        type: 'string',
        description: 'Descripción del plan (solo para action=create)'
      },
      steps: {
        type: 'array',
        description: 'Steps del plan (solo para action=create). Cada step debe tener tests y verificationCommand',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            tests: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  type: { type: 'string', enum: ['unit', 'e2e'] }
                }
              }
            },
            verificationCommand: { type: 'string' }
          }
        }
      },
      // Testing strategy params
      testing_strategy: {
        type: 'object',
        description: 'Configuración de testing (para action=set_testing)',
        properties: {
          unitTestCommand: { type: 'string' },
          unitTestPattern: { type: 'string' },
          e2eTestCommand: { type: 'string' },
          e2eTestPattern: { type: 'string' }
        }
      },
      step_id: {
        type: 'number',
        description: 'ID del step a modificar'
      },
      step_description: {
        type: 'string',
        description: 'Nueva descripción del step'
      },
      step_tests: {
        type: 'array',
        description: 'Tests del step (array de {description, type})',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            type: { type: 'string', enum: ['unit', 'e2e'] }
          }
        }
      },
      verification_command: {
        type: 'string',
        description: 'Comando de verificación del step'
      },
      updates: {
        type: 'array',
        description: 'Array de modificaciones para batch_update',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['update', 'add', 'remove'] },
            step_id: { type: 'number' },
            description: { type: 'string' },
            tests: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  type: { type: 'string', enum: ['unit', 'e2e'] }
                }
              }
            },
            verificationCommand: { type: 'string' }
          }
        }
      }
    },
    required: ['action']
  }
}

interface BatchUpdate {
  action: 'update' | 'add' | 'remove'
  step_id?: number
  description?: string
  tests?: Array<{ description: string; type: 'unit' | 'e2e' }>
  verificationCommand?: string
  // Legacy support
  test?: string
}

interface TestInput {
  description: string
  type?: 'unit' | 'e2e'
}

interface StepInput {
  description: string
  tests?: TestInput[]
  verificationCommand?: string
  // Legacy support
  test?: { description: string }
}

interface PlanParams {
  action: 'detect_testing' | 'set_testing' | 'create' | 'show' | 'approve' | 'cancel' | 'batch_update' | 'update_step' | 'add_step' | 'remove_step' | 'next' | 'verify' | 'pass' | 'fail'
  title?: string
  description?: string
  steps?: StepInput[]
  testing_strategy?: {
    unitTestCommand: string
    unitTestPattern: string
    e2eTestCommand?: string
    e2eTestPattern?: string
  }
  step_id?: number
  step_description?: string
  step_tests?: TestInput[]
  verification_command?: string
  // Legacy
  step_test?: string
  updates?: BatchUpdate[]
}

// Helper para convertir steps de input al formato interno
function convertStepInput(s: StepInput, defaultCommand: string): Omit<Step, 'id' | 'status'> {
  // Manejar formato legacy (test) y nuevo (tests)
  let tests: TestDefinition[]

  if (s.tests && s.tests.length > 0) {
    tests = s.tests.map(t => ({
      description: t.description,
      type: t.type || 'unit'
    }))
  } else if (s.test) {
    tests = [{ description: s.test.description, type: 'unit' }]
  } else {
    tests = [{ description: 'TODO: definir test', type: 'unit' }]
  }

  return {
    description: s.description,
    tests,
    verificationCommand: s.verificationCommand || defaultCommand
  }
}

export async function execute(params: PlanParams): Promise<string> {
  switch (params.action) {
    // ========== NUEVAS ACCIONES ==========

    case 'detect_testing': {
      const detection = await detectTestingSetup()
      return formatTestingDetection(detection)
    }

    case 'set_testing': {
      if (!params.testing_strategy) {
        return 'Error: set_testing requiere testing_strategy con unitTestCommand y unitTestPattern'
      }

      const plans = await loadPlans()
      const draft = plans.find(p => p.status === 'draft')

      const strategy: TestingStrategy = {
        unitTestCommand: params.testing_strategy.unitTestCommand,
        unitTestPattern: params.testing_strategy.unitTestPattern,
        e2eTestCommand: params.testing_strategy.e2eTestCommand,
        e2eTestPattern: params.testing_strategy.e2eTestPattern,
        confirmed: true,
        setupRequired: false
      }

      if (draft) {
        await setTestingStrategy(draft.id, strategy)
        return `✅ Testing strategy configurada para el plan "${draft.title}":\n\n` +
          `📦 Unit tests: ${strategy.unitTestCommand}\n` +
          `   Patrón: ${strategy.unitTestPattern}\n` +
          (strategy.e2eTestCommand ? `🌐 E2E tests: ${strategy.e2eTestCommand}\n   Patrón: ${strategy.e2eTestPattern}\n` : '') +
          `\n${formatPlanForDisplay(draft)}`
      }

      // Si no hay draft, guardar para el próximo plan
      return `✅ Testing strategy guardada:\n\n` +
        `📦 Unit tests: ${strategy.unitTestCommand}\n` +
        `   Patrón: ${strategy.unitTestPattern}\n` +
        (strategy.e2eTestCommand ? `🌐 E2E tests: ${strategy.e2eTestCommand}\n   Patrón: ${strategy.e2eTestPattern}\n` : '') +
        `\nSe aplicará al próximo plan que crees.`
    }

    // ========== ACCIONES EXISTENTES (ACTUALIZADAS) ==========

    case 'create': {
      if (!params.title || !params.steps || params.steps.length === 0) {
        return 'Error: Para crear un plan necesitás title y steps'
      }

      // Verificar si ya hay un draft - no permitir crear otro
      const existingPlans = await loadPlans()
      const existingDraft = existingPlans.find(p => p.status === 'draft')
      if (existingDraft) {
        return `ERROR: Ya existe un plan en draft ("${existingDraft.title}"). Usá action="batch_update" para modificarlo, o action="cancel" para descartarlo primero.`
      }

      // Detectar testing setup si no se especificó
      const detection = await detectTestingSetup()
      const defaultCommand = detection.strategy?.unitTestCommand || 'bun test'

      // Convertir steps al nuevo formato
      const steps = params.steps.map(s => convertStepInput(s, defaultCommand))

      // Si no hay testing configurado, agregar step de setup al principio
      if (!detection.found && detection.strategy?.setupRequired) {
        const setupStep = generateTestingSetupStep(detection)
        if (setupStep) {
          steps.unshift(setupStep)
        }
      }

      // Crear testing strategy basada en detección
      const testingStrategy: TestingStrategy | undefined = detection.found ? {
        unitTestCommand: detection.strategy?.unitTestCommand || defaultCommand,
        unitTestPattern: detection.strategy?.unitTestPattern || '**/*.test.ts',
        e2eTestCommand: detection.strategy?.e2eTestCommand,
        e2eTestPattern: detection.strategy?.e2eTestPattern,
        confirmed: false,  // Requiere confirmación del usuario
        setupRequired: !detection.found
      } : undefined

      const plan = await createPlan(
        params.title,
        params.description || '',
        steps,
        testingStrategy
      )

      let response = `Plan creado:\n${formatPlanForDisplay(plan)}\n\n`

      if (!testingStrategy?.confirmed) {
        response += `⚠️ Testing Strategy requiere confirmación.\n`
        response += `Usá action="set_testing" para confirmar o modificar la configuración.\n\n`
      }

      response += `¿Aprobás el plan? Usá action="approve" para comenzar.`

      return response
    }

    case 'show': {
      const plan = await getActivePlan()
      if (!plan) {
        const plans = await loadPlans()
        if (plans.length === 0) {
          return 'No hay planes. Creá uno con action="create".'
        }
        return `No hay plan activo. Planes existentes:\n${plans.map(p => `- ${p.title} (${p.status})`).join('\n')}`
      }
      return formatPlanForDisplay(plan)
    }

    case 'approve': {
      const plans = await loadPlans()
      // Buscar el draft más reciente (por updatedAt)
      const draft = plans
        .filter(p => p.status === 'draft')
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]

      if (!draft) {
        return 'No hay plan en draft para aprobar.'
      }

      // Validar que tenga testing strategy confirmada
      if (!draft.testingStrategy) {
        return `⚠️ No se puede aprobar el plan sin Testing Strategy configurada.\n\n` +
          `Usá action="detect_testing" para detectar la configuración, o\n` +
          `action="set_testing" para configurarla manualmente.`
      }

      if (!draft.testingStrategy.confirmed) {
        return `⚠️ Testing Strategy no confirmada.\n\n` +
          `Configuración detectada:\n` +
          `📦 Unit tests: ${draft.testingStrategy.unitTestCommand}\n` +
          `   Patrón: ${draft.testingStrategy.unitTestPattern}\n` +
          (draft.testingStrategy.e2eTestCommand ? `🌐 E2E: ${draft.testingStrategy.e2eTestCommand}\n` : '') +
          `\nUsá action="set_testing" para confirmar esta configuración.`
      }

      const approved = await approvePlan(draft.id)
      if (approved) {
        return `Plan aprobado! ✅\n${formatPlanForDisplay(approved)}\n\nUsá action="next" para ver el primer step.`
      }
      return 'Error aprobando el plan.'
    }

    case 'cancel': {
      const plans = await loadPlans()
      const draft = plans.find(p => p.status === 'draft')

      if (!draft) {
        return 'No hay plan en draft para cancelar.'
      }

      // Eliminar el plan draft
      const filteredPlans = plans.filter(p => p.id !== draft.id)
      await savePlans(filteredPlans)
      return `Plan "${draft.title}" cancelado. ❌`
    }

    case 'batch_update': {
      if (!params.updates || params.updates.length === 0) {
        return 'Error: batch_update requiere un array "updates" con las modificaciones'
      }

      const plans = await loadPlans()
      const draft = plans.find(p => p.status === 'draft')

      if (!draft) {
        return 'No hay plan en draft para modificar.'
      }

      const results: string[] = []

      for (const update of params.updates) {
        switch (update.action) {
          case 'update': {
            if (!update.step_id || !update.description) {
              results.push(`⚠️ update requiere step_id y description`)
              continue
            }
            const step = draft.steps.find(s => s.id === update.step_id)
            if (!step) {
              results.push(`⚠️ Step ${update.step_id} no existe`)
              continue
            }
            step.description = update.description
            if (update.test) {
              step.test.description = update.test
            }
            results.push(`✓ Step ${update.step_id} actualizado`)
            break
          }

          case 'add': {
            if (!update.description) {
              results.push(`⚠️ add requiere description`)
              continue
            }
            const newStep: Step = {
              id: draft.steps.length + 1,
              description: update.description,
              test: { description: update.test || 'TODO: definir test' },
              status: 'pending'
            }
            if (update.step_id) {
              const insertIndex = draft.steps.findIndex(s => s.id === update.step_id)
              if (insertIndex === -1) {
                results.push(`⚠️ Step ${update.step_id} no existe para insertar después`)
                continue
              }
              draft.steps.splice(insertIndex + 1, 0, newStep)
              draft.steps.forEach((s, i) => s.id = i + 1)
            } else {
              draft.steps.push(newStep)
            }
            results.push(`✓ Step agregado`)
            break
          }

          case 'remove': {
            if (!update.step_id) {
              results.push(`⚠️ remove requiere step_id`)
              continue
            }
            const stepIndex = draft.steps.findIndex(s => s.id === update.step_id)
            if (stepIndex === -1) {
              results.push(`⚠️ Step ${update.step_id} no existe`)
              continue
            }
            draft.steps.splice(stepIndex, 1)
            draft.steps.forEach((s, i) => s.id = i + 1)
            results.push(`✓ Step ${update.step_id} eliminado`)
            break
          }
        }
      }

      draft.updatedAt = Date.now()
      await savePlans(plans)

      return `Batch update completado:\n${results.join('\n')}\n\n${formatPlanForDisplay(draft)}`
    }

    case 'update_step': {
      if (!params.step_id || !params.step_description) {
        return 'Error: update_step requiere step_id y step_description'
      }

      const plans = await loadPlans()
      const draft = plans.find(p => p.status === 'draft')

      if (!draft) {
        return 'No hay plan en draft para modificar.'
      }

      const step = draft.steps.find(s => s.id === params.step_id)
      if (!step) {
        return `Error: No existe el step ${params.step_id}. Steps disponibles: ${draft.steps.map(s => s.id).join(', ')}`
      }

      step.description = params.step_description
      if (params.step_test) {
        step.test.description = params.step_test
      }
      draft.updatedAt = Date.now()
      await savePlans(plans)

      return `Step ${params.step_id} actualizado.\n${formatPlanForDisplay(draft)}`
    }

    case 'add_step': {
      if (!params.step_description) {
        return 'Error: add_step requiere step_description'
      }

      const plans = await loadPlans()
      const draft = plans.find(p => p.status === 'draft')

      if (!draft) {
        return 'No hay plan en draft para modificar.'
      }

      const newStep: Step = {
        id: draft.steps.length + 1,
        description: params.step_description,
        test: { description: params.step_test || 'TODO: definir test' },
        status: 'pending'
      }

      // Si se especifica step_id, insertar después de ese step
      if (params.step_id) {
        const insertIndex = draft.steps.findIndex(s => s.id === params.step_id)
        if (insertIndex === -1) {
          return `Error: No existe el step ${params.step_id}`
        }
        draft.steps.splice(insertIndex + 1, 0, newStep)
        // Renumerar steps
        draft.steps.forEach((s, i) => s.id = i + 1)
      } else {
        draft.steps.push(newStep)
      }

      draft.updatedAt = Date.now()
      await savePlans(plans)

      return `Step agregado.\n${formatPlanForDisplay(draft)}`
    }

    case 'remove_step': {
      if (!params.step_id) {
        return 'Error: remove_step requiere step_id'
      }

      const plans = await loadPlans()
      const draft = plans.find(p => p.status === 'draft')

      if (!draft) {
        return 'No hay plan en draft para modificar.'
      }

      const stepIndex = draft.steps.findIndex(s => s.id === params.step_id)
      if (stepIndex === -1) {
        return `Error: No existe el step ${params.step_id}. Steps disponibles: ${draft.steps.map(s => s.id).join(', ')}`
      }

      draft.steps.splice(stepIndex, 1)
      // Renumerar steps
      draft.steps.forEach((s, i) => s.id = i + 1)
      draft.updatedAt = Date.now()
      await savePlans(plans)

      return `Step eliminado.\n${formatPlanForDisplay(draft)}`
    }

    case 'next': {
      const plan = await getActivePlan()
      if (!plan) {
        return 'No hay plan activo.'
      }

      const step = await getCurrentStep(plan.id)
      if (!step) {
        return `Plan completado! 🎉\n${formatPlanForDisplay(plan)}`
      }

      // Formatear tests (nuevo formato con array)
      let testsSection = ''
      if (step.tests && step.tests.length > 0) {
        testsSection = step.tests.map(t => {
          const icon = t.type === 'e2e' ? '🌐' : '🧪'
          return `${icon} [${t.type}] ${t.description}`
        }).join('\n')
      } else if ((step as any).test) {
        // Legacy format
        testsSection = `🧪 [unit] ${(step as any).test.description}`
      }

      return `
📍 Step ${step.id}: ${step.description}

Tests a escribir:
${testsSection}

Comando de verificación:
→ ${step.verificationCommand || plan.testingStrategy?.unitTestCommand || 'bun test'}

Flujo TDD:
1. Escribí el/los test(s) primero
2. Ejecutá action="verify" → debe FALLAR (no hay implementación)
3. Implementá el código
4. Ejecutá action="verify" → debe PASAR
5. Usá action="pass" cuando todos los tests pasen
`
    }

    case 'verify': {
      const plan = await getActivePlan()
      if (!plan) {
        return 'No hay plan activo.'
      }

      const step = await getCurrentStep(plan.id)
      if (!step) {
        return 'No hay step pendiente para verificar.'
      }

      const command = step.verificationCommand || plan.testingStrategy?.unitTestCommand || 'bun test'

      // Ejecutar el comando de verificación
      try {
        const proc = Bun.spawn(['sh', '-c', command], {
          stdout: 'pipe',
          stderr: 'pipe',
          cwd: process.cwd()
        })

        const exitCode = await proc.exited
        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()

        const output = (stdout + stderr).trim()

        if (exitCode === 0) {
          return `✅ Verificación EXITOSA (exit code: 0)

Comando: ${command}

Salida:
${output.substring(0, 1000)}${output.length > 1000 ? '\n...(truncado)' : ''}

El test pasa. Si la implementación está completa, usá action="pass" para avanzar.`
        } else {
          return `❌ Verificación FALLÓ (exit code: ${exitCode})

Comando: ${command}

Salida:
${output.substring(0, 1000)}${output.length > 1000 ? '\n...(truncado)' : ''}

${step.status === 'pending' ? '✅ Esto es esperado en TDD - el test debe fallar antes de implementar.' : 'Revisá la implementación o el test.'}
`
        }
      } catch (error) {
        return `❌ Error ejecutando verificación: ${error instanceof Error ? error.message : 'desconocido'}`
      }
    }

    case 'pass': {
      const plan = await getActivePlan()
      if (!plan) {
        return 'No hay plan activo.'
      }

      const step = await getCurrentStep(plan.id)
      if (!step) {
        return 'No hay step pendiente.'
      }

      await updateStepStatus(plan.id, step.id, 'passed')

      const nextStep = await getCurrentStep(plan.id)
      if (nextStep) {
        return `✅ Step ${step.id} completado!\n\nSiguiente: Step ${nextStep.id}: ${nextStep.description}`
      }

      return `✅ Step ${step.id} completado!\n\n🎉 Plan completado!`
    }

    case 'fail': {
      const plan = await getActivePlan()
      if (!plan) {
        return 'No hay plan activo.'
      }

      const step = await getCurrentStep(plan.id)
      if (!step) {
        return 'No hay step pendiente.'
      }

      await updateStepStatus(plan.id, step.id, 'failed')
      return `❌ Step ${step.id} falló. Revisá el test o la implementación.`
    }

    default:
      return `Acción desconocida: ${params.action}`
  }
}

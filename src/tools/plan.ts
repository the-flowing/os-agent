// Tool: gestión de planes de desarrollo con TDD
// Crea planes, aprueba, ejecuta steps con tests

import {
  createPlan,
  approvePlan,
  getActivePlan,
  getCurrentStep,
  updateStepStatus,
  formatPlanForDisplay,
  loadPlans,
  savePlans,
  type Step
} from '../plan'

export const definition = {
  name: 'plan',
  description: `Gestiona planes de desarrollo con TDD.

FLUJO NORMAL:
1. "create" → crea plan draft → usuario lo revisa
2. Usuario pide cambios → usás "batch_update" para modificar
3. Usuario aprueba → "approve" → comienza ejecución
4. Para cada step: "next" → implementar → "pass"/"fail"

ACCIONES:
- "create": Crea plan NUEVO (solo si no hay draft activo)
- "show": Muestra el plan actual
- "approve": Aprueba draft para comenzar ejecución
- "cancel": Cancela el draft (SOLO si usuario dice "cancelar"/"descartar")
- "batch_update": Modifica el plan draft existente (expandir, detallar, cambiar steps)
- "next": Obtiene siguiente step a implementar
- "pass"/"fail": Marca resultado del step actual

CUÁNDO USAR CADA ACCIÓN:
- Usuario pide "expandir", "detallar", "agregar más steps", "modificar" → batch_update
- Usuario pide "nuevo plan", "planificar X" (sin draft existente) → create
- Usuario dice "dale", "ok", "aprobado" → approve
- NUNCA uses "create" si ya hay un draft, usá "batch_update"

batch_update recibe array "updates": [{action: "update"|"add"|"remove", step_id, description, test}]`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'show', 'approve', 'cancel', 'batch_update', 'update_step', 'add_step', 'remove_step', 'next', 'pass', 'fail'],
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
        description: 'Steps del plan (solo para action=create)',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            test: {
              type: 'object',
              properties: {
                description: { type: 'string' }
              }
            }
          }
        }
      },
      step_id: {
        type: 'number',
        description: 'ID del step a modificar (para update_step, add_step, remove_step)'
      },
      step_description: {
        type: 'string',
        description: 'Nueva descripción del step (para update_step, add_step)'
      },
      step_test: {
        type: 'string',
        description: 'Descripción del test del step (para update_step, add_step)'
      },
      updates: {
        type: 'array',
        description: 'Array de modificaciones para batch_update. Cada item tiene: action (update/add/remove), step_id, description, test',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['update', 'add', 'remove'] },
            step_id: { type: 'number' },
            description: { type: 'string' },
            test: { type: 'string' }
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
  test?: string
}

interface PlanParams {
  action: 'create' | 'show' | 'approve' | 'cancel' | 'batch_update' | 'update_step' | 'add_step' | 'remove_step' | 'next' | 'pass' | 'fail'
  title?: string
  description?: string
  steps?: Array<{
    description: string
    test: { description: string }
  }>
  step_id?: number
  step_description?: string
  step_test?: string
  updates?: BatchUpdate[]
}

export async function execute(params: PlanParams): Promise<string> {
  switch (params.action) {
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

      const plan = await createPlan(
        params.title,
        params.description || '',
        params.steps.map(s => ({
          description: s.description,
          test: { description: s.test.description }
        }))
      )

      return `Plan creado:\n${formatPlanForDisplay(plan)}\n\n¿Aprobás el plan? Usá action="approve" para comenzar.`
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

      return `
📍 Step ${step.id}: ${step.description}

🧪 Test a escribir:
${step.test.description}

Flujo:
1. Escribí el test primero
2. Verificá que falle (no hay implementación)
3. Implementá hasta que pase
4. Usá action="pass" cuando el test pase
`
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

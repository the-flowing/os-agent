// Sistema de Plan con Steps y Tests
// Cada tarea de desarrollo genera un plan con steps testeables

export type PlanStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'failed'
export type StepStatus = 'pending' | 'testing' | 'implementing' | 'passed' | 'failed'

export interface TestDefinition {
  description: string
  code?: string  // El código del test cuando se genera
}

export interface Step {
  id: number
  description: string
  test: TestDefinition
  status: StepStatus
  files?: string[]  // Archivos que se crean/modifican en este step
}

export interface Plan {
  id: string
  title: string
  description: string
  status: PlanStatus
  steps: Step[]
  createdAt: number
  updatedAt: number
}

// Archivo donde persisten los planes activos
const PLANS_FILE = '.osa/plans.json'

export async function loadPlans(): Promise<Plan[]> {
  try {
    const file = Bun.file(PLANS_FILE)
    if (await file.exists()) {
      const content = await file.text()
      return JSON.parse(content)
    }
  } catch {}
  return []
}

export async function savePlans(plans: Plan[]): Promise<void> {
  await Bun.spawn(['mkdir', '-p', '.osa']).exited
  await Bun.write(PLANS_FILE, JSON.stringify(plans, null, 2))
}

export async function getActivePlan(): Promise<Plan | null> {
  const plans = await loadPlans()
  return plans.find(p => p.status === 'approved' || p.status === 'in_progress') || null
}

export async function createPlan(title: string, description: string, steps: Omit<Step, 'id' | 'status'>[]): Promise<Plan> {
  const plans = await loadPlans()

  const plan: Plan = {
    id: `plan-${Date.now()}`,
    title,
    description,
    status: 'draft',
    steps: steps.map((s, i) => ({
      ...s,
      id: i + 1,
      status: 'pending' as StepStatus
    })),
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  plans.push(plan)
  await savePlans(plans)
  return plan
}

export async function approvePlan(planId: string): Promise<Plan | null> {
  const plans = await loadPlans()
  const plan = plans.find(p => p.id === planId)

  if (plan && plan.status === 'draft') {
    plan.status = 'approved'
    plan.updatedAt = Date.now()
    await savePlans(plans)
    return plan
  }
  return null
}

export async function updateStepStatus(planId: string, stepId: number, status: StepStatus): Promise<void> {
  const plans = await loadPlans()
  const plan = plans.find(p => p.id === planId)

  if (plan) {
    const step = plan.steps.find(s => s.id === stepId)
    if (step) {
      step.status = status
      plan.updatedAt = Date.now()

      // Actualizar status del plan
      if (plan.steps.every(s => s.status === 'passed')) {
        plan.status = 'completed'
      } else if (plan.steps.some(s => s.status === 'failed')) {
        plan.status = 'failed'
      } else if (plan.steps.some(s => s.status !== 'pending')) {
        plan.status = 'in_progress'
      }

      await savePlans(plans)
    }
  }
}

export async function getCurrentStep(planId: string): Promise<Step | null> {
  const plans = await loadPlans()
  const plan = plans.find(p => p.id === planId)

  if (plan) {
    // Retorna el primer step que no esté completado
    return plan.steps.find(s => s.status !== 'passed') || null
  }
  return null
}

export function formatPlanForDisplay(plan: Plan): string {
  const statusEmoji = {
    draft: '📝',
    approved: '✅',
    in_progress: '🔄',
    completed: '🎉',
    failed: '❌'
  }

  const stepStatusEmoji = {
    pending: '⏳',
    testing: '🧪',
    implementing: '🔨',
    passed: '✅',
    failed: '❌'
  }

  let output = `
┌─────────────────────────────────────────────────┐
│ ${statusEmoji[plan.status]} Plan: ${plan.title.padEnd(38)}│
├─────────────────────────────────────────────────┤
│ ${plan.description.substring(0, 47).padEnd(47)} │
├─────────────────────────────────────────────────┤
`

  for (const step of plan.steps) {
    output += `│ ${stepStatusEmoji[step.status]} Step ${step.id}: ${step.description.substring(0, 38).padEnd(38)}│\n`
    output += `│   Test: ${step.test.description.substring(0, 38).padEnd(38)}│\n`
  }

  output += `└─────────────────────────────────────────────────┘`

  return output
}

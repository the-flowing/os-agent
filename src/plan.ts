// Sistema de Plan con Steps y Tests
// Cada tarea de desarrollo genera un plan con steps testeables
// Incluye Testing Strategy obligatoria para verificación determinista

export type PlanStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'failed'
export type StepStatus = 'pending' | 'testing' | 'implementing' | 'passed' | 'failed'

// Testing Strategy - Define cómo se ejecutan y verifican tests en el proyecto
export interface TestingStrategy {
  unitTestCommand: string       // "bun test", "npm test", "vitest", etc
  unitTestPattern: string       // "*.test.ts", "__tests__/**", etc
  e2eTestCommand?: string       // "bun test:e2e", "playwright test", etc
  e2eTestPattern?: string       // "e2e/**/*.spec.ts", etc
  confirmed: boolean            // Usuario confirmó que la estrategia es correcta
  setupRequired: boolean        // Si true, el primer step debe ser configurar testing
}

export interface TestDefinition {
  description: string
  code?: string                 // El código del test cuando se genera
  type: 'unit' | 'e2e'          // Tipo de test
  filePath?: string             // Archivo donde se escribe el test
}

export interface Step {
  id: number
  description: string
  tests: TestDefinition[]       // Array de tests (unit + e2e)
  verificationCommand: string   // Comando específico para verificar este step
  status: StepStatus
  files?: string[]              // Archivos que se crean/modifican en este step
}

// Legacy support - mantener compatibilidad con planes existentes
export interface LegacyStep {
  id: number
  description: string
  test: { description: string }
  status: StepStatus
  files?: string[]
}

export interface Plan {
  id: string
  title: string
  description: string
  status: PlanStatus
  testingStrategy?: TestingStrategy  // Obligatorio antes de aprobar
  steps: Step[]
  createdAt: number
  updatedAt: number
}

// Helper para migrar steps legacy al nuevo formato
export function migrateStep(legacyStep: LegacyStep, unitTestCommand: string): Step {
  return {
    id: legacyStep.id,
    description: legacyStep.description,
    tests: [{
      description: legacyStep.test.description,
      type: 'unit'
    }],
    verificationCommand: unitTestCommand,
    status: legacyStep.status,
    files: legacyStep.files
  }
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

export async function createPlan(
  title: string,
  description: string,
  steps: Omit<Step, 'id' | 'status'>[],
  testingStrategy?: TestingStrategy
): Promise<Plan> {
  const plans = await loadPlans()

  const plan: Plan = {
    id: `plan-${Date.now()}`,
    title,
    description,
    status: 'draft',
    testingStrategy,
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

export async function setTestingStrategy(planId: string, strategy: TestingStrategy): Promise<Plan | null> {
  const plans = await loadPlans()
  const plan = plans.find(p => p.id === planId)

  if (plan) {
    plan.testingStrategy = strategy
    plan.updatedAt = Date.now()
    await savePlans(plans)
    return plan
  }
  return null
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
│ ${statusEmoji[plan.status]} Plan: ${plan.title.substring(0, 38).padEnd(38)}│
├─────────────────────────────────────────────────┤
│ ${plan.description.substring(0, 47).padEnd(47)} │
├─────────────────────────────────────────────────┤
`

  // Mostrar Testing Strategy si existe
  if (plan.testingStrategy) {
    const ts = plan.testingStrategy
    const confirmed = ts.confirmed ? '✅' : '⏳'
    output += `│ ${confirmed} Testing: ${ts.unitTestCommand.padEnd(36)}│\n`
    if (ts.e2eTestCommand) {
      output += `│    E2E: ${ts.e2eTestCommand.padEnd(38)}│\n`
    }
    output += `├─────────────────────────────────────────────────┤\n`
  } else if (plan.status === 'draft') {
    output += `│ ⚠️  Testing Strategy: NO CONFIGURADA            │\n`
    output += `├─────────────────────────────────────────────────┤\n`
  }

  for (const step of plan.steps) {
    output += `│ ${stepStatusEmoji[step.status]} Step ${step.id}: ${step.description.substring(0, 38).padEnd(38)}│\n`

    // Mostrar tests del step (nuevo formato)
    if (step.tests && Array.isArray(step.tests)) {
      for (const test of step.tests) {
        const typeIcon = test.type === 'e2e' ? '🌐' : '🧪'
        output += `│   ${typeIcon} ${test.description.substring(0, 43).padEnd(43)}│\n`
      }
    } else if ((step as any).test) {
      // Legacy format support
      output += `│   🧪 ${(step as any).test.description.substring(0, 43).padEnd(43)}│\n`
    }

    // Mostrar comando de verificación si existe
    if (step.verificationCommand) {
      output += `│   → ${step.verificationCommand.substring(0, 43).padEnd(43)}│\n`
    }
  }

  output += `└─────────────────────────────────────────────────┘`

  return output
}

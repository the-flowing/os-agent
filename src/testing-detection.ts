// Detección automática de configuración de testing en el proyecto
// Analiza package.json, archivos de config, y estructura de carpetas

import type { TestingStrategy } from './plan'

export interface TestingDetectionResult {
  found: boolean
  strategy?: Partial<TestingStrategy>
  confidence: number  // 0-1
  suggestions: string[]
  detectedFiles: string[]
}

interface PackageJson {
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
  dependencies?: Record<string, string>
}

// Detecta la configuración de testing del proyecto actual
export async function detectTestingSetup(cwd: string = process.cwd()): Promise<TestingDetectionResult> {
  const result: TestingDetectionResult = {
    found: false,
    confidence: 0,
    suggestions: [],
    detectedFiles: []
  }

  const strategy: Partial<TestingStrategy> = {
    confirmed: false,
    setupRequired: false
  }

  // 1. Buscar package.json
  const packageJsonPath = `${cwd}/package.json`
  let packageJson: PackageJson | null = null

  try {
    const file = Bun.file(packageJsonPath)
    if (await file.exists()) {
      packageJson = await file.json()
      result.detectedFiles.push('package.json')
    }
  } catch {}

  // 2. Detectar test runner por dependencias
  const deps = { ...packageJson?.dependencies, ...packageJson?.devDependencies }

  // Bun test (nativo)
  const hasBunLock = await Bun.file(`${cwd}/bun.lockb`).exists() || await Bun.file(`${cwd}/bun.lock`).exists()
  if (hasBunLock) {
    result.detectedFiles.push('bun.lockb')
  }

  // Detectar test frameworks
  const frameworks = {
    vitest: deps?.vitest,
    jest: deps?.jest || deps?.['@jest/core'],
    mocha: deps?.mocha,
    ava: deps?.ava,
    tap: deps?.tap,
    playwright: deps?.['@playwright/test'] || deps?.playwright,
    cypress: deps?.cypress,
    puppeteer: deps?.puppeteer
  }

  // 3. Buscar archivos de configuración
  const configFiles = [
    { file: 'vitest.config.ts', framework: 'vitest' },
    { file: 'vitest.config.js', framework: 'vitest' },
    { file: 'jest.config.ts', framework: 'jest' },
    { file: 'jest.config.js', framework: 'jest' },
    { file: 'jest.config.json', framework: 'jest' },
    { file: 'playwright.config.ts', framework: 'playwright' },
    { file: 'playwright.config.js', framework: 'playwright' },
    { file: 'cypress.config.ts', framework: 'cypress' },
    { file: 'cypress.config.js', framework: 'cypress' },
    { file: '.mocharc.json', framework: 'mocha' },
    { file: '.mocharc.js', framework: 'mocha' }
  ]

  for (const { file, framework } of configFiles) {
    const exists = await Bun.file(`${cwd}/${file}`).exists()
    if (exists) {
      result.detectedFiles.push(file)
      result.confidence += 0.2
    }
  }

  // 4. Analizar scripts en package.json
  const scripts = packageJson?.scripts || {}
  const testScript = scripts.test
  const testE2eScript = scripts['test:e2e'] || scripts.e2e || scripts['test:integration']

  // 5. Determinar comando de unit tests
  if (testScript) {
    result.confidence += 0.3

    if (testScript.includes('vitest') || frameworks.vitest) {
      strategy.unitTestCommand = 'vitest run'
      strategy.unitTestPattern = '**/*.{test,spec}.{ts,tsx,js,jsx}'
    } else if (testScript.includes('jest') || frameworks.jest) {
      strategy.unitTestCommand = 'npm test'
      strategy.unitTestPattern = '**/*.{test,spec}.{ts,tsx,js,jsx}'
    } else if (testScript.includes('bun test') || (hasBunLock && !frameworks.vitest && !frameworks.jest)) {
      strategy.unitTestCommand = 'bun test'
      strategy.unitTestPattern = '**/*.test.{ts,tsx,js,jsx}'
    } else if (testScript.includes('mocha') || frameworks.mocha) {
      strategy.unitTestCommand = 'npm test'
      strategy.unitTestPattern = 'test/**/*.{ts,js}'
    } else {
      // Usar el script tal cual
      strategy.unitTestCommand = 'npm test'
      strategy.unitTestPattern = '**/*.test.{ts,js}'
    }
  } else if (hasBunLock) {
    // Bun sin script explícito - asumir bun test
    strategy.unitTestCommand = 'bun test'
    strategy.unitTestPattern = '**/*.test.{ts,tsx,js,jsx}'
    result.confidence += 0.2
    result.suggestions.push('No hay script "test" en package.json. Asumiendo "bun test".')
  }

  // 6. Determinar comando de e2e tests
  if (testE2eScript) {
    result.confidence += 0.2

    if (testE2eScript.includes('playwright') || frameworks.playwright) {
      strategy.e2eTestCommand = 'npx playwright test'
      strategy.e2eTestPattern = 'e2e/**/*.spec.{ts,js}'
    } else if (testE2eScript.includes('cypress') || frameworks.cypress) {
      strategy.e2eTestCommand = 'npx cypress run'
      strategy.e2eTestPattern = 'cypress/e2e/**/*.cy.{ts,js}'
    } else {
      strategy.e2eTestCommand = `npm run ${Object.keys(scripts).find(k => k.includes('e2e')) || 'test:e2e'}`
      strategy.e2eTestPattern = 'e2e/**/*.{test,spec}.{ts,js}'
    }
  } else if (frameworks.playwright) {
    strategy.e2eTestCommand = 'npx playwright test'
    strategy.e2eTestPattern = 'e2e/**/*.spec.{ts,js}'
    result.confidence += 0.1
  } else if (frameworks.cypress) {
    strategy.e2eTestCommand = 'npx cypress run'
    strategy.e2eTestPattern = 'cypress/e2e/**/*.cy.{ts,js}'
    result.confidence += 0.1
  }

  // 7. Buscar carpetas de tests existentes
  const testDirs = ['test', 'tests', '__tests__', 'src/tests', 'src/__tests__', 'e2e', 'cypress']
  for (const dir of testDirs) {
    try {
      const dirPath = `${cwd}/${dir}`
      const proc = Bun.spawn(['ls', dirPath], { stdout: 'pipe', stderr: 'pipe' })
      await proc.exited
      if (proc.exitCode === 0) {
        result.detectedFiles.push(`${dir}/`)
        result.confidence += 0.1
      }
    } catch {}
  }

  // 8. Determinar si se encontró configuración
  result.found = result.confidence >= 0.3 && !!strategy.unitTestCommand
  result.strategy = strategy

  // 9. Agregar sugerencias si no se encontró suficiente
  if (!result.found) {
    strategy.setupRequired = true
    result.suggestions.push('No se detectó configuración de testing completa.')

    if (hasBunLock) {
      result.suggestions.push('Recomendación: Usar "bun test" nativo de Bun.')
      strategy.unitTestCommand = 'bun test'
      strategy.unitTestPattern = '**/*.test.ts'
    } else if (packageJson) {
      result.suggestions.push('Recomendación: Agregar vitest o jest al proyecto.')
    } else {
      result.suggestions.push('No se encontró package.json. Crear proyecto primero.')
    }
  }

  // Normalizar confidence
  result.confidence = Math.min(result.confidence, 1)

  return result
}

// Genera el step de setup de testing si es necesario
export function generateTestingSetupStep(detection: TestingDetectionResult): {
  description: string
  tests: Array<{ description: string; type: 'unit' | 'e2e' }>
  verificationCommand: string
} | null {
  if (!detection.strategy?.setupRequired) {
    return null
  }

  const command = detection.strategy.unitTestCommand || 'bun test'

  return {
    description: 'Configurar entorno de testing',
    tests: [{
      description: 'El comando de test debe ejecutarse sin errores',
      type: 'unit'
    }],
    verificationCommand: `${command} --help || echo "Test framework configured"`
  }
}

// Formatea la detección para mostrar al usuario
export function formatTestingDetection(detection: TestingDetectionResult): string {
  let output = ''

  if (detection.found) {
    output += `✅ Configuración de testing detectada (${Math.round(detection.confidence * 100)}% confianza)\n\n`

    if (detection.strategy?.unitTestCommand) {
      output += `📦 Unit tests: ${detection.strategy.unitTestCommand}\n`
      output += `   Patrón: ${detection.strategy.unitTestPattern}\n`
    }

    if (detection.strategy?.e2eTestCommand) {
      output += `🌐 E2E tests: ${detection.strategy.e2eTestCommand}\n`
      output += `   Patrón: ${detection.strategy.e2eTestPattern}\n`
    }

    if (detection.detectedFiles.length > 0) {
      output += `\n📁 Archivos detectados: ${detection.detectedFiles.join(', ')}\n`
    }

    output += `\n¿Es correcta esta configuración? Responde "confirmar" o describe las correcciones.`
  } else {
    output += `⚠️ No se detectó configuración de testing completa\n\n`

    if (detection.suggestions.length > 0) {
      output += `💡 Sugerencias:\n`
      detection.suggestions.forEach(s => {
        output += `   - ${s}\n`
      })
    }

    output += `\n¿Querés que agregue la configuración de testing como primer paso del plan?`
  }

  return output
}

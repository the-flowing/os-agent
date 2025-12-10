import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { loadCredential, hasAnyCredentialFiles, listCredentialFiles } from './proxy/credentials'
import { login } from './proxy/auth'

interface ProviderOption {
  id: string
  name: string
  key: string
  hasCredential: boolean
}

const PROVIDERS: Omit<ProviderOption, 'hasCredential'>[] = [
  { id: 'chatgpt', name: 'ChatGPT', key: '1' },
  { id: 'claude', name: 'Claude', key: '2' },
  { id: 'gemini', name: 'Gemini', key: '3' },
]

export function LoginScreen({ onComplete, onLoginSuccess }: { onComplete: () => void; onLoginSuccess?: (providerId: string) => void }) {
  const { exit } = useApp()
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshProviders = () => {
    const existing = new Set(listCredentialFiles())
    const withCreds = PROVIDERS.map(p => ({
      ...p,
      hasCredential: !!loadCredential(p.id) || Array.from(existing).some(f => f.includes(p.id))
    }))
    setProviders(withCreds)
    const firstWithCred = withCreds.findIndex(p => p.hasCredential)
    if (firstWithCred >= 0) setSelectedIndex(firstWithCred)
  }

  // Check credentials on mount
  useEffect(() => {
    refreshProviders()
  }, [])

  useInput((input, key) => {
    if (isLoggingIn) return

    // Number shortcuts - login directly
    if (input === '1' || input === '2' || input === '3') {
      const idx = parseInt(input) - 1
      if (idx < providers.length) {
        handleLogin(providers[idx])
      }
      return
    }

    // Arrow navigation
    if (key.leftArrow) {
      setSelectedIndex(i => (i > 0 ? i - 1 : providers.length - 1))
      return
    }
    if (key.rightArrow) {
      setSelectedIndex(i => (i < providers.length - 1 ? i + 1 : 0))
      return
    }

    // Enter/Space para ir al REPL
    if (key.return || input === ' ') {
      onComplete()
      return
    }

    // Escape, q o Ctrl+C para salir
    if (key.escape || input === 'q' || (key.ctrl && input === 'c')) {
      exit()
      return
    }
  })

  const handleLogin = async (provider: ProviderOption) => {
    setIsLoggingIn(true)
    setError(null)
    
    try {
      await login(provider.id)
      // Update credential status
      refreshProviders()
      onLoginSuccess?.(provider.id)
    } catch (e) {
      setError(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIsLoggingIn(false)
    }
  }

  const hasAnyCredential = providers.some(p => p.hasCredential)

  return (
    <Box flexDirection="column" alignItems="center" paddingY={2}>
      {/* Header - ASCII art style */}
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text color="cyan" bold>
          ┌───────────────────┐
        </Text>
        <Text color="cyan" bold>
          │     <Text color="white" bold>OS-AGENT</Text>      │
        </Text>
        <Text color="cyan" bold>
          └───────────────────┘
        </Text>
      </Box>

      {/* Login with */}
      <Box marginBottom={1}>
        <Text dimColor>Login with</Text>
      </Box>

      {/* Provider buttons - horizontal */}
      <Box gap={1}>
        {providers.map((provider, idx) => {
          const isSelected = selectedIndex === idx
          const hasAuth = provider.hasCredential
          
          return (
            <Box 
              key={provider.id}
              borderStyle="round"
              borderColor={isSelected ? 'cyan' : hasAuth ? 'green' : 'gray'}
              paddingX={1}
            >
              <Text 
                color={hasAuth ? 'green' : isSelected ? 'cyan' : 'white'}
                bold={isSelected}
              >
                <Text dimColor>[{provider.key}]</Text>
                {' '}{provider.name}
                {hasAuth && <Text color="green"> ✓</Text>}
              </Text>
            </Box>
          )
        })}
      </Box>

      {/* Status */}
      {isLoggingIn && (
        <Box marginTop={1}>
          <Text color="yellow">⏳ Abriendo browser para login...</Text>
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      )}

      {/* Continue hint */}
      {!isLoggingIn && (
        <Box marginTop={2}>
          <Text dimColor>Presioná </Text>
          <Text color="cyan" bold>Enter</Text>
          <Text dimColor> o </Text>
          <Text color="cyan" bold>Space</Text>
          <Text dimColor> para continuar al REPL</Text>
        </Box>
      )}

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>← → navegar · 1/2/3 login · q salir</Text>
      </Box>
    </Box>
  )
}

// Check if any provider has valid credentials
export function hasAnyCredentials(): boolean {
  // Primero, cualquier archivo de credenciales conocido
  if (hasAnyCredentialFiles()) return true
  // Fallback: intentar providers conocidos
  return PROVIDERS.some(p => !!loadCredential(p.id))
}

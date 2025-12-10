import { expect, describe, test, afterEach } from 'bun:test'
import { saveCredential, deleteCredential, credentialPath, hasAnyCredentialFiles, hasCredentialForProvider } from '../proxy/credentials'
import { hasAnyCredentials } from '../login-screen'
import fs from 'fs'
import path from 'path'

const providerId = 'test-provider'
const ALL = [providerId]

afterEach(() => {
  cleanupCreds()
})

function cleanupCreds() {
  ALL.forEach(deleteCredential)
  const dir = credentialPath('tmp').replace(/tmp\.json$/, '')
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) {
    if (f.includes(providerId) || f.includes('foo.bar')) {
      try { fs.unlinkSync(path.join(dir, f)) } catch {}
    }
  }
}

describe('Login helpers', () => {
  test('hasAnyCredentials refleja credencial guardada', () => {
    cleanupCreds()
    const baseline = hasAnyCredentials()

    saveCredential(providerId, { access_token: 'x', token_type: 'bearer', expires_at: Date.now() + 1000 })
    expect(fs.existsSync(credentialPath(providerId))).toBe(true)
    expect(hasAnyCredentials()).toBe(true)
    // Si ya había creds, seguimos en true; si no había, ahora es true
    expect(hasAnyCredentials()).toBe(true)
    // baseline is not asserted to avoid touching user creds
  })

  test('deleteCredential borra archivo', () => {
    saveCredential(providerId, { access_token: 'x', token_type: 'bearer', expires_at: Date.now() + 1000 })
    expect(deleteCredential(providerId)).toBe(true)
    expect(fs.existsSync(credentialPath(providerId))).toBe(false)
  })

  test('hasAnyCredentials detecta archivo genérico en credentials', () => {
    ALL.forEach(deleteCredential)
    const customPath = credentialPath(providerId).replace(`${providerId}.json`, 'foo.bar')
    fs.writeFileSync(customPath, '{"dummy":true}', 'utf8')
    expect(hasAnyCredentialFiles()).toBe(true)
    expect(hasAnyCredentials()).toBe(true)
    fs.unlinkSync(customPath)
  })

  test('hasCredentialForProvider detecta credenciales directas o por nombre', () => {
    cleanupCreds()
    expect(hasCredentialForProvider(providerId)).toBe(false)

    saveCredential(providerId, { access_token: 'x', token_type: 'bearer', expires_at: Date.now() + 1000 })
    expect(hasCredentialForProvider(providerId)).toBe(true)
    deleteCredential(providerId)

    const customPath = credentialPath(providerId).replace(`${providerId}.json`, `${providerId}.foo`)
    fs.writeFileSync(customPath, '{"dummy":true}', 'utf8')
    expect(hasCredentialForProvider(providerId)).toBe(true)
    fs.unlinkSync(customPath)
  })
})

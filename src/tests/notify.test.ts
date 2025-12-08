import { describe, test, expect, spyOn } from 'bun:test'
import * as notify from '../notify'

describe('notify', () => {
  test('notify existe y es función', () => {
    expect(typeof notify.notify).toBe('function')
    expect(typeof notify.notifySuccess).toBe('function')
    expect(typeof notify.notifyError).toBe('function')
    expect(typeof notify.notifyNeedsInput).toBe('function')
  })

  // No ejecutamos los sonidos en tests, solo verificamos que existen
  // Los tests de integración reales irían en el sandbox
})

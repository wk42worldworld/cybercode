import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { startMock, statusMock, logoutMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  statusMock: vi.fn(),
  logoutMock: vi.fn(),
}))

vi.mock('../api/cybercodeOAuth', () => ({
  cybercodeOAuthApi: {
    start: startMock,
    status: statusMock,
    logout: logoutMock,
  },
}))

import { useCybercodeOAuthStore } from './cybercodeOAuthStore'

const initialState = useCybercodeOAuthStore.getState()

describe('cybercodeOAuthStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    startMock.mockReset()
    statusMock.mockReset()
    logoutMock.mockReset()
    useCybercodeOAuthStore.setState({
      ...initialState,
      status: null,
      isPolling: false,
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    useCybercodeOAuthStore.getState().stopPolling()
    useCybercodeOAuthStore.setState(initialState)
    vi.useRealTimers()
  })

  it('login does not start polling until the browser launch succeeds', async () => {
    startMock.mockResolvedValue({
      authorizeUrl: 'http://localhost:3456/api/cybercode-oauth/callback',
      state: 'state-123',
    })

    const result = await useCybercodeOAuthStore.getState().login()

    expect(result.authorizeUrl).toContain('/api/cybercode-oauth/callback')
    expect(useCybercodeOAuthStore.getState().isPolling).toBe(false)
  })

  it('startPolling stops after the status becomes logged in', async () => {
    statusMock
      .mockResolvedValueOnce({ loggedIn: false })
      .mockResolvedValueOnce({
        loggedIn: true,
        expiresAt: Date.now() + 60_000,
        scopes: ['user:inference'],
        subscriptionType: 'max',
      })

    useCybercodeOAuthStore.getState().startPolling()
    expect(useCybercodeOAuthStore.getState().isPolling).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(useCybercodeOAuthStore.getState().isPolling).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(useCybercodeOAuthStore.getState().status).toMatchObject({
      loggedIn: true,
      subscriptionType: 'max',
    })
    expect(useCybercodeOAuthStore.getState().isPolling).toBe(false)
  })
})

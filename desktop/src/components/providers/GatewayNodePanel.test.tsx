import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  copyTextMock,
  createKeyMock,
  openExternalUrlMock,
  peekStatusMock,
  revokeKeyMock,
  rotateKeyMock,
  statusMock,
  updateConfigMock,
  updateKeyMock,
  p2pStartMock,
  p2pStatusMock,
  p2pJoinMock,
  createProviderMock,
  updateProviderMock,
  activateProviderMock,
} = vi.hoisted(() => ({
  copyTextMock: vi.fn(),
  createKeyMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
  peekStatusMock: vi.fn(),
  revokeKeyMock: vi.fn(),
  rotateKeyMock: vi.fn(),
  statusMock: vi.fn(),
  updateConfigMock: vi.fn(),
  updateKeyMock: vi.fn(),
  p2pStartMock: vi.fn(),
  p2pStatusMock: vi.fn(),
  p2pJoinMock: vi.fn(),
  createProviderMock: vi.fn(),
  updateProviderMock: vi.fn(),
  activateProviderMock: vi.fn(),
}))

vi.mock('../../api/gateway', () => ({
  gatewayApi: {
    peekStatus: peekStatusMock,
    status: statusMock,
    createKey: createKeyMock,
    updateConfig: updateConfigMock,
    updateKey: updateKeyMock,
    rotateKey: rotateKeyMock,
    revokeKey: revokeKeyMock,
  },
}))

vi.mock('../chat/clipboard', () => ({
  copyTextToClipboard: copyTextMock,
}))

vi.mock('../../lib/openExternalUrl', () => ({
  openExternalUrl: openExternalUrlMock,
}))

vi.mock('../../api/p2p', () => ({
  p2pApi: {
    status: p2pStatusMock,
    startSharing: p2pStartMock,
    stopSharing: vi.fn(),
    join: p2pJoinMock,
    revokePeer: vi.fn(),
  },
  isValidP2PPairingCode: (value: string) => /^[A-HJ-KM-NP-Z2-9]{8}$/.test(value),
}))

vi.mock('../../stores/providerStore', () => ({
  useProviderStore: {
    getState: () => ({
      providers: [],
      createProvider: createProviderMock,
      updateProvider: updateProviderMock,
      activateProvider: activateProviderMock,
    }),
  },
}))

import { useSettingsStore } from '../../stores/settingsStore'
import type { GatewayKeyStatus, GatewayStatus } from '../../types/gateway'
import { agentNodeGuideUrl, GatewayNodePanel } from './GatewayNodePanel'

function makeKey(overrides: Partial<GatewayKeyStatus> = {}): GatewayKeyStatus {
  return {
    id: 'key-1',
    name: 'Default node key',
    prefix: 'ccn_test',
    createdAt: '2026-07-29T00:00:00.000Z',
    monthlyRequestLimit: 100,
    allowedTargets: ['model/provider-1/kimi-k2.6', 'route/coding'],
    defaultTarget: 'route/coding',
    usage: { month: '2026-07', requests: 12 },
    ...overrides,
  }
}

function makeStatus(overrides: Partial<GatewayStatus> = {}): GatewayStatus {
  return {
    baseUrl: 'http://127.0.0.1:3456/v1',
    anthropicBaseUrl: 'http://127.0.0.1:3456',
    modelsUrl: 'http://127.0.0.1:3456/v1/models',
    enabled: true,
    keys: [makeKey()],
    targets: [
      {
        id: 'model/provider-1/kimi-k2.6',
        publicId: 'kimi/kimi-k2.6',
        kind: 'model',
        label: 'kimi-k2.6',
        description: 'Kimi',
        available: true,
        providerId: 'provider-1',
        modelId: 'kimi-k2.6',
      },
      {
        id: 'route/coding',
        publicId: 'route/coding',
        kind: 'route',
        label: 'Coding',
        description: 'Quality first',
        available: true,
        routeId: 'coding',
      },
    ],
    ...overrides,
  }
}

describe('GatewayNodePanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    statusMock.mockReset()
    peekStatusMock.mockReset()
    peekStatusMock.mockReturnValue(undefined)
    createKeyMock.mockReset()
    openExternalUrlMock.mockReset()
    openExternalUrlMock.mockResolvedValue(undefined)
    updateConfigMock.mockReset()
    updateKeyMock.mockReset()
    rotateKeyMock.mockReset()
    revokeKeyMock.mockReset()
    copyTextMock.mockReset()
    copyTextMock.mockResolvedValue(true)
    p2pStatusMock.mockReset()
    p2pStatusMock.mockResolvedValue({
      state: 'unavailable',
      reason: 'signal-not-configured',
      peerCount: 0,
      peers: [],
    })
    p2pStartMock.mockReset()
    p2pJoinMock.mockReset()
    createProviderMock.mockReset()
    updateProviderMock.mockReset()
    activateProviderMock.mockReset()
  })

  it('renders cached node data immediately while forcing a background refresh', async () => {
    peekStatusMock.mockReturnValue(makeStatus())
    statusMock.mockImplementation(() => new Promise(() => {}))

    render(<GatewayNodePanel />)

    expect(screen.getByText('http://127.0.0.1:3456/v1')).toBeInTheDocument()
    expect(screen.getAllByText('kimi-k2.6')).not.toHaveLength(0)
    await waitFor(() => expect(statusMock).toHaveBeenCalledWith({ force: true }))
  })

  it('silently refreshes an old cached status without keys instead of crashing', async () => {
    peekStatusMock.mockReturnValue({
      baseUrl: 'http://127.0.0.1:3456/v1',
      enabled: false,
      targets: [],
    } as unknown as GatewayStatus)
    statusMock.mockResolvedValue(makeStatus())

    expect(() => render(<GatewayNodePanel />)).not.toThrow()

    expect(await screen.findByText(
      'Target policy',
      {},
      { timeout: 5000 },
    )).toBeInTheDocument()
    expect(statusMock).toHaveBeenCalledWith({ force: true })
    expect(screen.queryByText(/older version|restart CyberCode/i)).not.toBeInTheDocument()
  })

  it('refreshes an old target cache instead of generating settings with an internal ID', async () => {
    const currentStatus = makeStatus()
    peekStatusMock.mockReturnValue({
      ...currentStatus,
      targets: currentStatus.targets.map((target) => (
        target.kind === 'model'
          ? { ...target, publicId: target.id }
          : target
      )),
    })
    statusMock.mockResolvedValue(currentStatus)

    render(<GatewayNodePanel />)

    expect(await screen.findByText('Connection configuration builder')).toBeInTheDocument()
    expect(statusMock).toHaveBeenCalledWith({ force: true })
    fireEvent.click(screen.getByRole('tab', { name: /Direct models 1/ }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Generate connection settings for kimi/kimi-k2.6',
    }))

    const dialog = screen.getByRole('dialog', { name: 'Connection settings' })
    expect(within(dialog).getByText('kimi/kimi-k2.6')).toBeInTheDocument()
    expect(within(dialog).queryByText(/model\/provider-1\//)).not.toBeInTheDocument()
  })

  it('migrates a legacy single-key cache and keeps its controls usable', async () => {
    peekStatusMock.mockReturnValue({
      baseUrl: 'http://127.0.0.1:3456/v1',
      enabled: true,
      keyId: 'key-legacy',
      keyName: 'Legacy user',
      keyPrefix: 'cc_legacy',
      keyCreatedAt: '2026-07-28T00:00:00.000Z',
      monthlyRequestLimit: 50,
      allowedTargets: ['model/provider-1/kimi-k2.6', 'route/coding'],
      defaultTarget: 'route/coding',
      usage: { month: '2026-07', requests: 7 },
      targets: makeStatus().targets,
    } as unknown as GatewayStatus)
    statusMock.mockImplementation(() => new Promise(() => {}))
    updateKeyMock.mockResolvedValue({
      status: makeStatus({
        keys: [makeKey({
          id: 'key-legacy',
          name: 'Legacy user',
          prefix: 'cc_legacy',
          monthlyRequestLimit: 75,
        })],
      }),
    })

    render(<GatewayNodePanel />)

    expect(await screen.findByTestId('gateway-key-row-key-legacy')).toBeInTheDocument()
    const monthlyLimit = await screen.findByRole('spinbutton', {
      name: 'Monthly request limit',
    })
    expect(monthlyLimit).toHaveValue(50)
    fireEvent.change(monthlyLimit, { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateKeyMock).toHaveBeenCalledWith(
      'key-legacy',
      expect.objectContaining({ monthlyRequestLimit: 75 }),
    ))
    expect(screen.queryByText(/older version|restart CyberCode/i)).not.toBeInTheDocument()
  }, 15_000)

  it('keeps the page structure and connection guide visible during the first load', () => {
    statusMock.mockImplementation(() => new Promise(() => {}))

    render(<GatewayNodePanel />)

    expect(screen.getByText('Model sharing')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connection guide' }))
    const dialog = screen.getByRole('dialog', { name: 'Connect another agent to CyberCode' })
    expect(within(dialog).getByText('Choose the receiving agent protocol, then fill the four fields below.')).toBeInTheDocument()
    const fillExample = screen.getByTestId('gateway-guide-fill-example')
    expect(within(fillExample).getByText('Fill these four fields')).toBeInTheDocument()
    expect(within(fillExample).getByText('OpenAI Chat Completions')).toBeInTheDocument()
    expect(within(fillExample).getByText('http://127.0.0.1:3456/v1')).toBeInTheDocument()
    expect(within(fillExample).getByText('cc_REPLACE_WITH_YOUR_NODE_KEY')).toBeInTheDocument()
    expect(within(fillExample).getByText('auto')).toBeInTheDocument()
    expect(within(fillExample).getAllByRole('term')).toHaveLength(4)
    expect(within(fillExample).queryByText(/publicId|provider ID|route\/|kimi\//i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/curl http/)).not.toBeInTheDocument()
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0)

    const advanced = within(dialog).getByRole('button', { name: /Advanced: pin a model or route/ })
    const requestExample = within(dialog).getByRole('button', { name: 'Connection test request' })
    expect(advanced).toHaveAttribute('aria-expanded', 'false')
    expect(requestExample).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('tab', { name: 'Anthropic' }))
    expect(within(fillExample).getByText('Anthropic Messages')).toBeInTheDocument()
    expect(within(fillExample).getByText('http://127.0.0.1:3456')).toBeInTheDocument()
    fireEvent.click(requestExample)
    expect(screen.getByText(/curl http:\/\/127\.0\.0\.1:3456\/v1\/messages/)).toBeInTheDocument()
    expect(screen.getByText(/"model":"auto"/)).toBeInTheDocument()
  }, 15_000)

  it('builds the complete guide URL for the current interface language', () => {
    expect(agentNodeGuideUrl('zh')).toBe(
      'https://wk42worldworld.github.io/cybercode/guide/agent-node.html',
    )
    expect(agentNodeGuideUrl('en')).toBe(
      'https://wk42worldworld.github.io/cybercode/en/guide/agent-node.html',
    )
    expect(agentNodeGuideUrl('ja')).toBe(
      'https://wk42worldworld.github.io/cybercode/ja/guide/agent-node.html',
    )
    expect(agentNodeGuideUrl('ko')).toBe(
      'https://wk42worldworld.github.io/cybercode/ko/guide/agent-node.html',
    )
  })

  it('opens the localized complete guide from the dialog', () => {
    useSettingsStore.setState({ locale: 'ja' })
    statusMock.mockImplementation(() => new Promise(() => {}))

    render(<GatewayNodePanel />)

    fireEvent.click(screen.getByRole('button', { name: '接続ガイド' }))
    fireEvent.click(screen.getByRole('button', { name: '完全な接続ガイドを開く' }))
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'https://wk42worldworld.github.io/cybercode/ja/guide/agent-node.html',
    )
  })

  it('shows the endpoint and separates model targets from routes', async () => {
    statusMock.mockResolvedValue(makeStatus())

    render(<GatewayNodePanel />)

    expect(await screen.findByText('Target policy')).toBeInTheDocument()
    expect(screen.getByText('http://127.0.0.1:3456/v1')).toBeInTheDocument()
    expect(screen.getAllByText('kimi-k2.6')).not.toHaveLength(0)
    expect(screen.getAllByText('Coding')).not.toHaveLength(0)
    expect(screen.getByRole('tab', { name: /Routes 1/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Direct models 1/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Connection guide' }))
    const dialog = screen.getByRole('dialog', { name: 'Connect another agent to CyberCode' })
    const fillExample = within(dialog).getByTestId('gateway-guide-fill-example')
    expect(within(fillExample).getByText('auto')).toBeInTheDocument()
    expect(within(fillExample).queryByText(/publicId|provider ID|route\/|kimi\//i)).not.toBeInTheDocument()

    const advanced = within(dialog).getByRole('button', { name: /Advanced: pin a model or route/ })
    expect(advanced).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(advanced)
    expect(within(dialog).getByText('Default · auto → Coding')).toBeInTheDocument()
    expect(within(dialog).getAllByText('route/coding')).not.toHaveLength(0)
    expect(within(dialog).getAllByText('kimi/kimi-k2.6')).not.toHaveLength(0)
  }, 15_000)

  it('searches authorized targets and opens a complete connection card', async () => {
    statusMock.mockResolvedValue(makeStatus())

    render(<GatewayNodePanel />)

    expect(await screen.findByText('Connection configuration builder')).toBeInTheDocument()
    const routeMenu = screen.getByRole('tab', { name: /Routes 1/ })
    const modelMenu = screen.getByRole('tab', { name: /Direct models 1/ })
    expect(routeMenu).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', {
      name: 'Generate connection settings for route/coding',
    })).toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: 'Generate connection settings for kimi/kimi-k2.6',
    })).not.toBeInTheDocument()
    fireEvent.click(modelMenu)

    const search = screen.getByRole('searchbox', { name: 'Search models or routes' })
    fireEvent.change(search, { target: { value: 'kimi' } })

    expect(screen.queryByRole('button', {
      name: 'Generate connection settings for route/coding',
    })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: 'Generate connection settings for kimi/kimi-k2.6',
    }))

    const dialog = screen.getByRole('dialog', { name: 'Connection settings' })
    expect(within(dialog).getByText('http://127.0.0.1:3456/v1/chat/completions')).toBeInTheDocument()
    expect(within(dialog).getByText('kimi/kimi-k2.6')).toBeInTheDocument()
    expect(within(dialog).queryByText('Provider alias / route')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Provider / route ID')).not.toBeInTheDocument()
    expect(within(dialog).getByText('ccn_test••••••••••••••••')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copy all settings' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Rotate and complete' })).toBeInTheDocument()
  }, 15_000)

  it('switches protocol and copies every generated setting when the full key is available', async () => {
    const created = makeStatus({
      keys: [makeKey({ prefix: 'ccn_new' })],
    })
    statusMock.mockResolvedValue(makeStatus({ keys: [], enabled: false }))
    createKeyMock.mockResolvedValue({
      status: created,
      keyId: 'key-1',
      apiKey: 'ccn_new_secret_value',
    })

    render(<GatewayNodePanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create API key' }))
    const createDialog = screen.getByRole('dialog', { name: 'Create access key' })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create API key' }))
    await screen.findByText('ccn_new_secret_value')
    fireEvent.click(screen.getByRole('tab', { name: 'Anthropic' }))
    fireEvent.click(screen.getByRole('tab', { name: /Direct models 1/ }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Generate connection settings for kimi/kimi-k2.6',
    }))

    const dialog = screen.getByRole('dialog', { name: 'Connection settings' })
    expect(within(dialog).getByText('http://127.0.0.1:3456/v1/messages')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy all settings' }))

    await waitFor(() => expect(copyTextMock).toHaveBeenCalledWith(expect.stringContaining(
      'Protocol: Anthropic Messages',
    )))
    expect(copyTextMock).toHaveBeenCalledWith(expect.stringContaining(
      'API key: ccn_new_secret_value',
    ))
    expect(copyTextMock).toHaveBeenCalledWith(expect.stringContaining(
      'Model: kimi/kimi-k2.6',
    ))
    const copiedSettings = copyTextMock.mock.calls.at(-1)?.[0] as string
    expect(copiedSettings).not.toContain('Provider alias')
    expect(copiedSettings).not.toContain('Provider / route ID')
  })

  it('keeps the model catalog collapsed and reveals matching models through search', async () => {
    statusMock.mockResolvedValue(makeStatus({
      targets: [
        ...makeStatus().targets,
        {
          id: 'model/provider-2/deepseek-chat',
          publicId: 'deepseek/deepseek-chat',
          kind: 'model',
          label: 'deepseek-chat',
          description: 'DeepSeek',
          available: true,
          providerId: 'provider-2',
          modelId: 'deepseek-chat',
        },
      ],
    }))

    render(<GatewayNodePanel />)

    expect(await screen.findByText('Target policy')).toBeInTheDocument()
    expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Direct models: 1 / 2' }))
    expect(screen.getByRole('dialog', { name: 'Manage allowed targets' })).toBeInTheDocument()
    expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search models or providers' }), {
      target: { value: 'deepseek' },
    })

    expect(screen.getByText('deepseek-chat')).toBeInTheDocument()
    const target = screen.getByRole('checkbox', { name: /deepseek-chat/i })
    expect(target).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(target)
    expect(target).toHaveAttribute('aria-checked', 'true')
  })

  it('uses a route-aware picker instead of a native select for the default target', async () => {
    statusMock.mockResolvedValue(makeStatus())

    render(<GatewayNodePanel />)

    expect(await screen.findByText('Target policy')).toBeInTheDocument()
    expect(document.querySelector('select')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('gateway-default-target'))
    const targetDialog = screen.getByRole('dialog', { name: 'Choose the auto target' })
    expect(targetDialog).toBeInTheDocument()
    fireEvent.click(within(targetDialog).getByRole('tab', { name: /Direct models/ }))
    fireEvent.click(screen.getByRole('button', { name: /Kimi/ }))
    fireEvent.click(screen.getByRole('radio', { name: /kimi-k2.6/ }))

    expect(screen.queryByRole('dialog', { name: 'Choose the auto target' })).not.toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  }, 15_000)

  it('reveals a new key once after it is created', async () => {
    const created = makeStatus({
      keys: [makeKey({ prefix: 'ccn_new' })],
    })
    statusMock.mockResolvedValue(makeStatus({ keys: [], enabled: false }))
    createKeyMock.mockResolvedValue({
      status: created,
      keyId: 'key-1',
      apiKey: 'ccn_new_secret_value',
    })

    render(<GatewayNodePanel />)

    expect(await screen.findByText('No access key yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create API key' }))
    const dialog = screen.getByRole('dialog', { name: 'Create access key' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create API key' }))
    await waitFor(() => expect(createKeyMock).toHaveBeenCalledOnce())
    expect(createKeyMock).toHaveBeenCalledWith({ name: 'User 1' })
    expect(await screen.findByText('ccn_new_secret_value')).toBeInTheDocument()
    expect(screen.getByText('visible this time only')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy complete key' }))
    expect(copyTextMock).toHaveBeenCalledWith('ccn_new_secret_value')
  })

  it('lists multiple user keys and edits each key name independently', async () => {
    const initial = makeStatus({
      keys: [
        makeKey({ id: 'key-alice', name: 'Alice', prefix: 'cc_alice' }),
        makeKey({
          id: 'key-bob',
          name: 'Bob',
          prefix: 'cc_bob',
          monthlyRequestLimit: 20,
          usage: { month: '2026-07', requests: 3 },
        }),
      ],
    })
    const renamed = makeStatus({
      keys: [
        makeKey({ id: 'key-alice', name: 'Alice', prefix: 'cc_alice' }),
        makeKey({
          id: 'key-bob',
          name: 'Backend team',
          prefix: 'cc_bob',
          monthlyRequestLimit: 20,
          usage: { month: '2026-07', requests: 3 },
        }),
      ],
    })
    statusMock.mockResolvedValue(initial)
    updateKeyMock.mockResolvedValue({ status: renamed })

    render(<GatewayNodePanel />)

    const bobRow = await screen.findByTestId('gateway-key-row-key-bob')
    expect(bobRow).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(bobRow)
    expect(bobRow).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Editing access, auto target, and monthly quota for “Bob”/)).toBeInTheDocument()
    fireEvent.click(within(bobRow).getByRole('button', { name: 'Edit name' }))
    fireEvent.change(within(bobRow).getByRole('textbox', { name: 'Key name' }), {
      target: { value: 'Backend team' },
    })
    fireEvent.click(within(bobRow).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateKeyMock).toHaveBeenCalledWith('key-bob', {
      name: 'Backend team',
    }))
    expect(await screen.findByText('Backend team')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('keeps an unsaved key policy when another key is selected', async () => {
    statusMock.mockResolvedValue(makeStatus({
      keys: [
        makeKey({ id: 'key-alice', name: 'Alice' }),
        makeKey({ id: 'key-bob', name: 'Bob', prefix: 'cc_bob' }),
      ],
    }))

    render(<GatewayNodePanel />)

    const bobRow = await screen.findByTestId('gateway-key-row-key-bob')
    const defaultTarget = await screen.findByTestId(
      'gateway-default-target',
      {},
      { timeout: 5000 },
    )
    fireEvent.click(defaultTarget)
    const targetDialog = screen.getByRole('dialog', { name: 'Choose the auto target' })
    fireEvent.click(within(targetDialog).getByRole('tab', { name: /Direct models/ }))
    fireEvent.click(screen.getByRole('button', { name: /Kimi/ }))
    fireEvent.click(screen.getByRole('radio', { name: /kimi-k2.6/ }))
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    fireEvent.click(bobRow)

    expect(bobRow).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Save or cancel this key’s unsaved target policy',
    )
    expect(updateKeyMock).not.toHaveBeenCalled()
    expect(screen.getByText(/Editing access, auto target, and monthly quota for “Alice”/)).toBeInTheDocument()
  }, 15_000)

  it('confirms key rotation before replacing the current value', async () => {
    const rotated = makeStatus({
      keys: [makeKey({ prefix: 'ccn_rotated' })],
    })
    statusMock.mockResolvedValue(makeStatus())
    rotateKeyMock.mockResolvedValue({
      status: rotated,
      keyId: 'key-1',
      apiKey: 'ccn_rotated_secret',
    })

    render(<GatewayNodePanel />)

    const row = await screen.findByTestId('gateway-key-row-key-1')
    fireEvent.click(within(row).getByRole('button', { name: 'Rotate key Default node key' }))

    const dialog = screen.getByRole('dialog', { name: 'Rotate access key' })
    expect(rotateKeyMock).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/current value stops working immediately/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }))

    await waitFor(() => expect(rotateKeyMock).toHaveBeenCalledWith('key-1'))
    expect(await screen.findByText('ccn_rotated_secret')).toBeInTheDocument()
  })

  it('confirms revocation and removes only the selected key', async () => {
    const initial = makeStatus({
      keys: [
        makeKey({ id: 'key-alice', name: 'Alice' }),
        makeKey({ id: 'key-bob', name: 'Bob', prefix: 'cc_bob' }),
      ],
    })
    const afterRevoke = makeStatus({
      keys: [makeKey({ id: 'key-alice', name: 'Alice' })],
    })
    statusMock.mockResolvedValue(initial)
    revokeKeyMock.mockResolvedValue({ status: afterRevoke })

    render(<GatewayNodePanel />)

    const bobRow = await screen.findByTestId('gateway-key-row-key-bob')
    fireEvent.click(within(bobRow).getByRole('button', { name: 'Revoke Bob' }))
    const dialog = screen.getByRole('dialog', { name: 'Revoke access key' })
    expect(within(dialog).getByText(/Other keys are not affected/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(revokeKeyMock).toHaveBeenCalledWith('key-bob'))
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('opens P2P sharing and starts it without asking for a server address', async () => {
    statusMock.mockResolvedValue(makeStatus())
    p2pStartMock.mockResolvedValue({
      state: 'connected',
      pairingCode: 'ABCD27KM',
      peerCount: 0,
      peers: [],
    })

    render(<GatewayNodePanel />)

    fireEvent.click(await screen.findByRole('tab', { name: 'P2P sharing' }))

    expect(screen.getByRole('heading', { name: 'P2P model sharing' })).toBeInTheDocument()
    expect(screen.getAllByText('Not connected').length).toBeGreaterThan(0)
    expect(screen.getByText('No devices connected')).toBeInTheDocument()
    expect(screen.getByText(/One 8-character code is enough/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Relay server URL')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Share my models' }))
    const code = await screen.findByText('ABCD27KM')
    expect(code).toBeInTheDocument()
    expect(p2pStartMock).toHaveBeenCalledWith()
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledWith(code.textContent))
  })

  it('activates a paired provider with a real shared model instead of an auto placeholder', async () => {
    statusMock.mockResolvedValue(makeStatus())
    p2pJoinMock.mockResolvedValue({
      sessionId: 'session-p2p',
      peerId: 'peer-p2p',
      nodeName: 'Workstation',
      baseUrl: 'http://127.0.0.1:3456/p2p/connections/peer-p2p',
      apiKey: 'ccn_p2p_secret',
      models: ['shared/kimi-k2.6', 'shared/glm-5.2'],
    })
    createProviderMock.mockResolvedValue({ id: 'provider-p2p' })

    render(<GatewayNodePanel />)
    fireEvent.click(await screen.findByRole('tab', { name: 'P2P sharing' }))
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'ABCD27KM' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(createProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      models: {
        main: 'shared/kimi-k2.6',
        haiku: 'shared/kimi-k2.6',
        sonnet: 'shared/kimi-k2.6',
        opus: 'shared/kimi-k2.6',
      },
      modelCatalog: [{ id: 'shared/kimi-k2.6' }, { id: 'shared/glm-5.2' }],
    })))
    expect(activateProviderMock).toHaveBeenCalledWith('provider-p2p')
  })
})

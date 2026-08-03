import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import {
  usbMigrationApi,
  type UsbMigrationJob,
  type UsbMigrationRecoveryStatus,
  type UsbMigrationScan,
} from '../api/usbMigration'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { portableFolderPreview } from '../utils/usbMigration'
import { UsbMigration } from './UsbMigration'

vi.mock('../api/usbMigration', () => ({
  usbMigrationApi: {
    scan: vi.fn(),
    start: vi.fn(),
    getJob: vi.fn(),
    cancel: vi.fn(),
    getRecoveryStatus: vi.fn(),
    getPortablePathStatus: vi.fn(),
    repairPortableProjectPaths: vi.fn(),
  },
}))

function scan(
  patch: Partial<UsbMigrationScan> = {},
): UsbMigrationScan {
  return {
    scannedAt: '2026-07-30T12:00:00.000Z',
    configPath: '/Users/test/.cyber',
    configSizeBytes: 12 * 1024,
    projects: [{
      id: 'a'.repeat(20),
      name: 'cybercode',
      path: '/Users/test/projects/cybercode',
      sizeBytes: 64 * 1024,
      modifiedAt: '2026-07-30T11:00:00.000Z',
      sessionCount: 3,
    }],
    currentPlatform: 'macos-arm64',
    release: {
      version: '1.1.10',
      generatedAt: '2026-07-30T10:00:00.000Z',
      platforms: {
        'macos-arm64': {
          filename: 'CyberCode_macos_arm64.tar.gz',
          sizeBytes: 100 * 1024,
          archiveType: 'app-tar-gz',
        },
        'macos-x64': {
          filename: 'CyberCode_macos_x64.tar.gz',
          sizeBytes: 110 * 1024,
          archiveType: 'app-tar-gz',
        },
        'windows-x64': {
          filename: 'CyberCode_windows_x64.zip',
          sizeBytes: 120 * 1024,
          archiveType: 'zip',
        },
        'linux-x64': {
          filename: 'CyberCode_linux_x64.AppImage',
          sizeBytes: 130 * 1024,
          archiveType: 'appimage',
        },
      },
    },
    releaseError: null,
    ...patch,
  }
}

function job(
  patch: Partial<UsbMigrationJob> = {},
): UsbMigrationJob {
  return {
    id: 'b'.repeat(24),
    status: 'queued',
    stage: 'queued',
    destinationPath: '/Volumes/USB',
    portablePath: '/Volumes/USB/CyberCode-Portable',
    currentItem: null,
    processedBytes: 0,
    totalBytes: 536 * 1024,
    progressPercent: 0,
    warnings: [],
    error: null,
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:00:00.000Z',
    completedAt: null,
    ...patch,
  }
}

describe('UsbMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'zh' })
    useUIStore.setState({ toasts: [] })
    vi.mocked(usbMigrationApi.scan).mockResolvedValue(scan())
    vi.mocked(usbMigrationApi.start).mockResolvedValue(job())
    vi.mocked(usbMigrationApi.getJob).mockResolvedValue(job({
      status: 'running',
      stage: 'config',
      currentItem: '/Users/test/.cyber',
      progressPercent: 10,
      processedBytes: 54 * 1024,
    }))
    vi.mocked(usbMigrationApi.getRecoveryStatus).mockResolvedValue({
      state: 'idle',
      totalJobs: 0,
      recoveredJobs: 0,
      waitingJobs: 0,
      failedJobs: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
      lastError: null,
    })
    vi.mocked(usbMigrationApi.getPortablePathStatus).mockResolvedValue({
      active: false,
      rootPath: null,
      registryPath: null,
      projectCount: 0,
    })
    vi.mocked(usbMigrationApi.repairPortableProjectPaths).mockResolvedValue({
      active: true,
      rootPath: 'E:\\CyberCode-Portable',
      registryPath: 'E:\\CyberCode-Portable\\data\\config\\portable-projects.json',
      projectCount: 1,
      scannedSessions: 3,
      eligibleSessions: 3,
      repairedSessions: 2,
      failedSessions: 0,
    })
  })

  it('repairs saved work folders when running from a portable drive', async () => {
    vi.mocked(usbMigrationApi.getPortablePathStatus).mockResolvedValue({
      active: true,
      rootPath: 'E:\\CyberCode-Portable',
      registryPath: 'E:\\CyberCode-Portable\\data\\config\\portable-projects.json',
      projectCount: 1,
    })

    render(<UsbMigration />)

    expect(await screen.findByText('便携路径修复')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '修复工作目录' }))

    await waitFor(() => {
      expect(usbMigrationApi.repairPortableProjectPaths).toHaveBeenCalledOnce()
    })
    expect(await screen.findByText('已检查 3 个会话，修复 2 个工作目录。')).toBeInTheDocument()
  })

  it('keeps a partial repair usable when one session cannot be processed', async () => {
    vi.mocked(usbMigrationApi.getPortablePathStatus).mockResolvedValue({
      active: true,
      rootPath: 'E:\\CyberCode-Portable',
      registryPath: 'E:\\CyberCode-Portable\\data\\config\\portable-projects.json',
      projectCount: 1,
    })
    vi.mocked(usbMigrationApi.repairPortableProjectPaths).mockResolvedValue({
      active: true,
      rootPath: 'E:\\CyberCode-Portable',
      registryPath: 'E:\\CyberCode-Portable\\data\\config\\portable-projects.json',
      projectCount: 1,
      scannedSessions: 3,
      eligibleSessions: 2,
      repairedSessions: 1,
      failedSessions: 1,
    })

    render(<UsbMigration />)
    fireEvent.click(await screen.findByRole('button', { name: '修复工作目录' }))

    expect(
      await screen.findByText('已检查 3 个会话，修复 1 个，另有 1 个无法处理。'),
    ).toBeInTheDocument()
  })

  it('starts with projects opt-in and only the current platform app selected', async () => {
    vi.mocked(usbMigrationApi.start).mockResolvedValue(job({
      status: 'running',
      stage: 'config',
      currentItem: '/Users/test/.cyber',
      progressPercent: 10,
      processedBytes: 54 * 1024,
    }))
    render(<UsbMigration />)

    expect(await screen.findByText('cybercode')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '包含桌面应用' })).toBeChecked()
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(1)

    fireEvent.change(screen.getByRole('textbox', { name: 'U 盘位置' }), {
      target: { value: '/Volumes/USB' },
    })
    fireEvent.click(screen.getByRole('checkbox', {
      name: /我了解便携数据包含账号凭据/,
    }))
    fireEvent.click(screen.getByRole('button', { name: '开始迁移' }))

    await waitFor(() => {
      expect(usbMigrationApi.start).toHaveBeenCalledWith({
        destinationPath: '/Volumes/USB',
        projectIds: [],
        platforms: ['macos-arm64'],
        includeApplications: true,
        replaceExisting: false,
      })
    })
    expect(await screen.findByText('正在复制配置与账号数据')).toBeInTheDocument()
  }, 20_000)

  it('submits only one migration while the start request is pending', async () => {
    let resolveStart!: (value: UsbMigrationJob) => void
    vi.mocked(usbMigrationApi.start).mockImplementation(() => new Promise(resolve => {
      resolveStart = resolve
    }))
    render(<UsbMigration />)

    await screen.findByText('cybercode')
    fireEvent.change(screen.getByRole('textbox', { name: 'U 盘位置' }), {
      target: { value: '/Volumes/USB' },
    })
    fireEvent.click(screen.getByRole('checkbox', {
      name: /我了解便携数据包含账号凭据/,
    }))

    const startButton = screen.getByRole('button', { name: '开始迁移' })
    fireEvent.click(startButton)
    fireEvent.click(startButton)

    expect(startButton).toBeDisabled()
    expect(usbMigrationApi.start).toHaveBeenCalledTimes(1)

    resolveStart(job({ status: 'running', stage: 'config' }))
    expect(await screen.findByText('正在复制配置与账号数据')).toBeInTheDocument()
  })

  it('shows durable recovery state when the original drive is offline', async () => {
    vi.mocked(usbMigrationApi.getRecoveryStatus).mockResolvedValue({
      state: 'waiting-for-drive',
      totalJobs: 1,
      recoveredJobs: 0,
      waitingJobs: 1,
      failedJobs: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
      lastError: null,
    } satisfies UsbMigrationRecoveryStatus)

    render(<UsbMigration />)

    expect(await screen.findByText('等待插入原 U 盘')).toBeInTheDocument()
    expect(screen.getByText(/插入后重启 CyberCode 即会继续恢复/)).toBeInTheDocument()
  })

  it('enters a non-repeatable cancelling state while cleanup finishes', async () => {
    vi.mocked(usbMigrationApi.start).mockResolvedValue(job({
      status: 'running',
      stage: 'projects',
      progressPercent: 42,
    }))
    vi.mocked(usbMigrationApi.cancel).mockImplementation(() => new Promise(() => undefined))
    render(<UsbMigration />)
    await screen.findByText('cybercode')
    fireEvent.change(screen.getByRole('textbox', { name: 'U 盘位置' }), {
      target: { value: '/Volumes/USB' },
    })
    fireEvent.click(screen.getByRole('checkbox', {
      name: /我了解便携数据包含账号凭据/,
    }))
    fireEvent.click(screen.getByRole('button', { name: '开始迁移' }))

    const cancel = await screen.findByRole('button', { name: '取消迁移' })
    fireEvent.click(cancel)
    fireEvent.click(cancel)

    expect(await screen.findAllByText('正在取消并清理')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '正在取消并清理' })).toBeDisabled()
    expect(usbMigrationApi.cancel).toHaveBeenCalledTimes(1)
  })

  it('leaves the progress state when the sidecar no longer knows the job', async () => {
    vi.mocked(usbMigrationApi.start).mockResolvedValue(job({
      status: 'running',
      stage: 'projects',
      progressPercent: 42,
    }))
    vi.mocked(usbMigrationApi.getJob).mockRejectedValue(new ApiError(404, {
      error: 'JOB_NOT_FOUND',
      message: 'Migration job not found',
    }))
    render(<UsbMigration />)
    await screen.findByText('cybercode')
    fireEvent.change(screen.getByRole('textbox', { name: 'U 盘位置' }), {
      target: { value: '/Volumes/USB' },
    })
    fireEvent.click(screen.getByRole('checkbox', {
      name: /我了解便携数据包含账号凭据/,
    }))
    fireEvent.click(screen.getByRole('button', { name: '开始迁移' }))

    expect(await screen.findByText(
      '迁移服务已重启，当前任务已中断。请检查恢复状态后重新开始。',
    )).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回设置' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消迁移' })).not.toBeInTheDocument()
  })

  it('allows a data-only migration when portable release packages are unavailable', async () => {
    vi.mocked(usbMigrationApi.scan).mockResolvedValue(scan({
      release: null,
      releaseError: '当前版本尚未发布便携运行包',
    }))

    render(<UsbMigration />)

    expect(await screen.findByText(
      '当前 Release 暂无完整便携运行包；仍可只迁移数据。',
    )).toBeInTheDocument()
    expect(screen.queryByText('当前版本尚未发布便携运行包')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '包含桌面应用' })).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'U 盘位置' }), {
      target: { value: '/Volumes/USB' },
    })
    fireEvent.click(screen.getByRole('checkbox', {
      name: /我了解便携数据包含账号凭据/,
    }))
    fireEvent.click(screen.getByRole('button', { name: '开始迁移' }))

    await waitFor(() => {
      expect(usbMigrationApi.start).toHaveBeenCalledWith({
        destinationPath: '/Volumes/USB',
        projectIds: [],
        platforms: [],
        includeApplications: false,
        replaceExisting: false,
      })
    })
  })

  it('previews existing portable folders without appending a duplicate directory', async () => {
    render(<UsbMigration />)
    await screen.findByText('cybercode')

    fireEvent.change(screen.getByRole('textbox', { name: 'U 盘位置' }), {
      target: { value: '/Volumes/USB/CyberCode-Portable/' },
    })

    expect(screen.getByText('将创建: /Volumes/USB/CyberCode-Portable')).toBeInTheDocument()
    expect(portableFolderPreview('D:\\CyberCode-Portable\\')).toBe(
      'D:\\CyberCode-Portable',
    )
    expect(portableFolderPreview('D:\\')).toBe('D:\\CyberCode-Portable')
  })

  it('passes an AbortSignal and exposes an obvious scan cancel action', async () => {
    let observedSignal: AbortSignal | undefined
    vi.mocked(usbMigrationApi.scan).mockImplementation((_force, signal) => {
      observedSignal = signal
      return new Promise<UsbMigrationScan>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    render(<UsbMigration />)
    fireEvent.click(await screen.findByRole('button', { name: '取消扫描' }))

    expect(usbMigrationApi.scan).toHaveBeenCalledWith(false, expect.any(AbortSignal))
    expect(observedSignal?.aborted).toBe(true)
    expect(await screen.findByText('扫描已取消，可随时重新扫描。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新扫描' })).toBeInTheDocument()
  })

  it('aborts the active scan when the migration page unmounts', async () => {
    let observedSignal: AbortSignal | undefined
    vi.mocked(usbMigrationApi.scan).mockImplementation((_force, signal) => {
      observedSignal = signal
      return new Promise<UsbMigrationScan>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const view = render(<UsbMigration />)
    await waitFor(() => expect(observedSignal).toBeDefined())
    view.unmount()

    expect(observedSignal?.aborted).toBe(true)
  })

  it('does not update state or toast when path repair finishes after unmount', async () => {
    vi.mocked(usbMigrationApi.getPortablePathStatus).mockResolvedValue({
      active: true,
      rootPath: 'E:\\CyberCode-Portable',
      registryPath: 'E:\\CyberCode-Portable\\data\\config\\portable-projects.json',
      projectCount: 1,
    })
    let resolveRepair!: (value: Awaited<ReturnType<typeof usbMigrationApi.repairPortableProjectPaths>>) => void
    vi.mocked(usbMigrationApi.repairPortableProjectPaths).mockReturnValue(new Promise((resolve) => {
      resolveRepair = resolve
    }))

    const view = render(<UsbMigration />)
    fireEvent.click(await screen.findByRole('button', { name: '修复工作目录' }))
    await waitFor(() => expect(usbMigrationApi.repairPortableProjectPaths).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => {
      resolveRepair({
        active: true,
        rootPath: 'E:\\CyberCode-Portable',
        registryPath: 'E:\\CyberCode-Portable\\data\\config\\portable-projects.json',
        projectCount: 1,
        scannedSessions: 3,
        eligibleSessions: 3,
        repairedSessions: 2,
        failedSessions: 0,
      })
      await Promise.resolve()
    })

    expect(useUIStore.getState().toasts).toEqual([])
  })
})

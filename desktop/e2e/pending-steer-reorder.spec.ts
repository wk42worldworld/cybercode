import { expect, test, type Page } from '@playwright/test'

const apiPort = Number.parseInt(process.env.CYBERCODE_E2E_API_PORT || '3467', 10)
const apiUrl = `http://127.0.0.1:${apiPort}`
const appUrl = `/?serverUrl=${encodeURIComponent(apiUrl)}`

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('cybercode-locale', 'en')
    window.localStorage.setItem('cybercode-theme', 'light')
  })
  await page.goto(appUrl)
  await expect(page.locator('[data-compact-layout]')).toBeVisible()
  await expect(page.locator('#boot-splash')).toHaveCount(0)
}

// While a turn is running, extra user messages become queued "pending steers".
// The drag handle must reorder them. This regresses a bug where HTML5 drag &
// drop never completed inside the Tauri WKWebView (the native drag-drop channel
// used for file attachments swallows dragover/drop), so the rows could not be
// swapped. Reorder is now pointer-driven.
test('reorders queued follow-ups by dragging while a turn is running', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await openApp(page)

  await page.getByRole('menuitem', { name: 'Temporary session' }).click()

  const composer = page.locator('.chat-composer-textarea')
  await expect(composer).toBeVisible()
  await composer.fill('__mock_wait_for_interrupt__')
  await composer.press('Enter')
  await expect(page.getByTestId('streaming-indicator')).toBeVisible()

  await composer.fill('First follow-up')
  await composer.press('Enter')
  await composer.fill('Second follow-up')
  await composer.press('Enter')

  const rows = page.getByTestId(/pending-steer-row-/)
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('First follow-up')
  await expect(rows.nth(1)).toContainText('Second follow-up')

  const secondHandle = page.getByRole('button', {
    name: 'Drag or use arrow keys to reorder: Second follow-up',
  })
  const firstRow = rows.nth(0)
  const handleBox = await secondHandle.boundingBox()
  const firstRowBox = await firstRow.boundingBox()
  expect(handleBox).not.toBeNull()
  expect(firstRowBox).not.toBeNull()

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(firstRowBox!.x + 60, firstRowBox!.y + firstRowBox!.height / 2, { steps: 8 })
  await expect(page.getByTestId('pending-steer-drop-indicator')).toBeVisible()
  await page.mouse.up()

  await expect(rows.nth(0)).toContainText('Second follow-up')
  await expect(rows.nth(1)).toContainText('First follow-up')
  expect(pageErrors).toEqual([])
})

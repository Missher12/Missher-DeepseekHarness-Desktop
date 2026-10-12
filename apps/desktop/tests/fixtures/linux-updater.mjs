/** Real Electron Linux transfer qualification; inert payloads never reach an installer. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import updaterModule from 'electron-updater'
import { DesktopUpdateCoordinator } from '../../lib/types/update-coordinator.js'
import { DesktopUpdateHttpExecutor } from '../../lib/types/update-http-executor.js'
import { createUpdateServer } from './update-server.mjs'

const root = process.env.DSH_LOCAL_UPDATE_TEST_ROOT
assert.ok(root)
app.setPath('userData', join(root, 'electron'))
app.on('window-all-closed', () => {})
const cases = []
const fixtures = []
let server
const previousAppImage = process.env.APPIMAGE
function restoreAppImage() {
  if (previousAppImage === undefined) delete process.env.APPIMAGE
  else process.env.APPIMAGE = previousAppImage
}
async function main() {
try {
  await app.whenReady()
  await mkdir(root, { recursive: true })
  process.env.APPIMAGE = join(root, 'previous.AppImage')
  await writeFile(process.env.APPIMAGE, 'previous inert image')
  for (const format of ['deb', 'AppImage']) {
  server = await createUpdateServer({ extension: format, feed: 'nightly-linux.yml' })
  async function fixture(mode = 'healthy', timeout = 5000) {
    server.select(mode)
    const directory = join(root, String(fixtures.length))
    await mkdir(directory, { recursive: true })
    const config = join(directory, 'app-update.yml')
    await writeFile(config, 'updaterCacheDirName: cache\n')
    const forbidden = () => { throw new Error('Installer, quit and relaunch are forbidden') }
    const Updater = format === 'deb' ? updaterModule.DebUpdater : updaterModule.AppImageUpdater
    const updater = new Updater(undefined, {
      version: '1.0.0', name: 'linux-update-qualification', isPackaged: true,
      appUpdateConfigPath: config, userDataPath: directory, baseCachePath: directory,
      whenReady: async () => {}, quit: forbidden, relaunch: forbidden, onQuit: forbidden,
    })
    updater.logger = null
    updater.disableDifferentialDownload = true
    updater.httpExecutor = new DesktopUpdateHttpExecutor(timeout)
    updater.setFeedURL({ provider: 'generic', url: server.url, channel: 'nightly' })
    updater.quitAndInstall = forbidden
    const states = []
    const coordinator = new DesktopUpdateCoordinator(state => { states.push(state); return state },
      async () => false, updater, () => true, () => '1.0.0')
    const result = { updater, coordinator, states }
    fixtures.push(result)
    return result
  }
  async function scenario(name, run) { await run(); cases.push(`${format}:${name}`); console.log(`Linux updater ${format}: ${name}`) }
  await scenario('real-download-sha512-progress-and-install-refusal', async () => {
    const f = await fixture()
    const available = await f.coordinator.check(true)
    assert.equal(available.phase, 'available')
    assert.equal((await f.coordinator.download(available.version)).phase, 'ready')
    assert.deepEqual(await readFile(f.updater.installerPath), server.payload)
    assert.ok(f.states.some(state => state.phase === 'verifying'))
    assert.equal((await f.coordinator.install(available.version)).phase, 'ready')
  })
  for (const mode of ['corrupt', 'disconnect', 'download-404', 'download-stall']) {
    await scenario(`${mode}-rejects-and-retries`, async () => {
      const f = await fixture(mode, 1000)
      const available = await f.coordinator.check(true)
      const failure = await f.coordinator.download(available.version)
      assert.equal(failure.failedOperation, 'download')
      assert.equal(f.updater.installerPath, null)
      await assert.rejects(f.coordinator.install(available.version), /not ready/)
      server.select('healthy')
      assert.equal((await f.coordinator.download(available.version)).phase, 'ready')
    })
  }
  await scenario('cancel-active-http-transfer-and-retry', async () => {
    const f = await fixture('hold-download')
    const available = await f.coordinator.check(true)
    const pending = f.coordinator.download(available.version)
    await server.arrived()
    f.coordinator.cancelDownload()
    assert.equal((await pending).phase, 'available')
    await assert.rejects(f.coordinator.install(available.version), /not ready/)
    server.select('healthy')
    assert.equal((await f.coordinator.download(available.version)).phase, 'ready')
  })
  for (const version of ['1.0.0', '0.9.0']) {
    await scenario(`no-update-${version}`, async () => {
      const f = await fixture()
      server.select('healthy', version)
      assert.equal((await f.coordinator.check(true)).phase, 'idle')
    })
  }
  assert.deepEqual(server.failures, [])
  await server.close()
  }
  await writeFile(join(root, 'result.json'), JSON.stringify({ platform: process.platform, arch: process.arch,
    electron: process.versions.electron, cases, installations: 0, modelRequests: 0,
    scope: 'Real Electron DebUpdater/AppImageUpdater HTTP, checksum, cancellation and retry; no package installation or restart',
    screenshot: { captured: false, reason: 'transport qualification without a window' }, dialogScreenshots: [] }, null, 2))
  fixtures.forEach(f => f.coordinator.dispose())
  restoreAppImage()
  app.exit(0)
} catch (error) {
  console.error(error)
  await server?.close()
  fixtures.forEach(f => f.coordinator.dispose())
  restoreAppImage()
  app.exit(1)
}

}
void main()

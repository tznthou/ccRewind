import { EventEmitter } from 'node:events'

// Electron BrowserWindow 的替身(給 vi.mock('electron') 用): 記下建構時的選項、載入了什麼、show 了幾次,
// 事件用 EventEmitter 由測試自己發(ready-to-show、focus、webContents 的 did-finish-load / will-navigate)

export class FakeWebContents extends EventEmitter {
  url = 'file:///app/out/renderer/index.html'
  openHandler: (() => unknown) | null = null

  setWindowOpenHandler(handler: () => unknown): void {
    this.openHandler = handler
  }

  getURL(): string {
    return this.url
  }
}

export class FakeBrowserWindow extends EventEmitter {
  static instances: FakeBrowserWindow[] = []

  readonly webContents = new FakeWebContents()
  readonly options: Record<string, unknown>
  showCalls = 0
  loadedURL: string | null = null
  loadedFile: string | null = null
  private visible = false

  constructor(options: Record<string, unknown>) {
    super()
    this.options = options
    FakeBrowserWindow.instances.push(this)
  }

  show(): void {
    this.showCalls++
    this.visible = true
  }

  isVisible(): boolean {
    return this.visible
  }

  isDestroyed(): boolean {
    return false
  }

  loadURL(url: string): Promise<void> {
    this.loadedURL = url
    return Promise.resolve()
  }

  loadFile(filePath: string): Promise<void> {
    this.loadedFile = filePath
    return Promise.resolve()
  }

  static reset(): void {
    FakeBrowserWindow.instances = []
  }
}

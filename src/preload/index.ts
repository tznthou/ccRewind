import { contextBridge } from 'electron'

// Task 4 會在這裡擴充 IPC API
contextBridge.exposeInMainWorld('api', {})

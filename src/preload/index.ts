import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  getProjects: () => ipcRenderer.invoke('projects:list'),
  getSessions: (projectId) => ipcRenderer.invoke('sessions:list', projectId),
  loadSession: (sessionId) => ipcRenderer.invoke('session:load', sessionId),
  search: (query, projectId) => ipcRenderer.invoke('search:query', query, projectId),
  onIndexerStatus: (callback) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron IPC event typing
    const listener = (_event: any, status: any) => callback(status)
    ipcRenderer.on('indexer:status', listener)
    return () => { ipcRenderer.removeListener('indexer:status', listener) }
  },
}

contextBridge.exposeInMainWorld('api', api)

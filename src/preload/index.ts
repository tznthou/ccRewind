import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, IndexerStatus } from '../shared/types'

const api: ElectronAPI = {
  getProjects: () => ipcRenderer.invoke('projects:list'),
  getSessions: (projectId) => ipcRenderer.invoke('sessions:list', projectId),
  loadSession: (sessionId) => ipcRenderer.invoke('session:load', sessionId),
  search: (query, projectId) => ipcRenderer.invoke('search:query', query, projectId),
  exportMarkdown: (sessionId) => ipcRenderer.invoke('export:markdown', sessionId),
  onIndexerStatus: (callback) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron IPC event param
    const listener = (_event: any, status: IndexerStatus) => callback(status)
    ipcRenderer.on('indexer:status', listener)
    return () => { ipcRenderer.removeListener('indexer:status', listener) }
  },
}

contextBridge.exposeInMainWorld('api', api)

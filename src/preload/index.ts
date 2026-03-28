import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  getProjects: () => ipcRenderer.invoke('projects:list'),
  getSessions: (projectId) => ipcRenderer.invoke('sessions:list', projectId),
  loadSession: (sessionId) => ipcRenderer.invoke('session:load', sessionId),
  search: (query, projectId) => ipcRenderer.invoke('search:query', query, projectId),
  onIndexerStatus: (callback) => {
    ipcRenderer.on('indexer:status', (_event, status) => callback(status))
  },
  offIndexerStatus: () => {
    ipcRenderer.removeAllListeners('indexer:status')
  },
}

contextBridge.exposeInMainWorld('api', api)

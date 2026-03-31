import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, IndexerStatus } from '../shared/types'

const api: ElectronAPI = {
  getProjects: () => ipcRenderer.invoke('projects:list'),
  getSessions: (projectId) => ipcRenderer.invoke('sessions:list', projectId),
  loadSession: (sessionId) => ipcRenderer.invoke('session:load', sessionId),
  search: (query, projectId, offset) => ipcRenderer.invoke('search:query', query, projectId, offset),
  searchSessions: (query, projectId, offset) => ipcRenderer.invoke('search:sessions', query, projectId, offset),
  getMessageContext: (messageId, range) => ipcRenderer.invoke('message:context', messageId, range),
  getSessionTokenStats: (sessionId) => ipcRenderer.invoke('session:token-stats', sessionId),
  exportMarkdown: (sessionId) => ipcRenderer.invoke('export:markdown', sessionId),
  getFileHistory: (filePath) => ipcRenderer.invoke('files:history', filePath),
  getSessionFiles: (sessionId) => ipcRenderer.invoke('files:session', sessionId),
  getUsageStats: (projectId, days) => ipcRenderer.invoke('stats:usage', projectId, days),
  getProjectStats: () => ipcRenderer.invoke('stats:projects'),
  getToolDistribution: (projectId) => ipcRenderer.invoke('stats:tools', projectId),
  getTagDistribution: (projectId) => ipcRenderer.invoke('stats:tags', projectId),
  getWorkPatterns: (projectId) => ipcRenderer.invoke('stats:patterns', projectId),
  getRelatedSessions: (sessionId, limit) => ipcRenderer.invoke('session:related', sessionId, limit),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  getUpdateState: () => ipcRenderer.invoke('updates:get-state'),
  openReleasePage: () => ipcRenderer.invoke('updates:open-release'),
  dismissUpdate: (version) => ipcRenderer.invoke('updates:dismiss', version),
  onIndexerStatus: (callback) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron IPC event param
    const listener = (_event: any, status: IndexerStatus) => callback(status)
    ipcRenderer.on('indexer:status', listener)
    return () => { ipcRenderer.removeListener('indexer:status', listener) }
  },
}

contextBridge.exposeInMainWorld('api', api)

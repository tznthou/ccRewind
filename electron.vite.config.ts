import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['better-sqlite3']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [
      react(),
      {
        name: 'strip-csp-in-dev',
        transformIndexHtml: {
          order: 'pre',
          handler(html, ctx) {
            if (ctx.server) {
              // Dev mode — strip meta CSP so Vite inline scripts work
              return html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/, '')
            }
            return html
          }
        }
      }
    ]
  }
})

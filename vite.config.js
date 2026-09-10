import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/contacts': 'http://localhost:3001',
      '/messages': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/me': 'http://localhost:3001',
      '/login': 'http://localhost:3001',
      '/logout': 'http://localhost:3001',
      '/cadastro': 'http://localhost:3001',
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served under /thePanel on the VDS (nginx); bare / in local dev
  base: process.env.NODE_ENV === 'production' ? '/thePanel/' : '/',
})

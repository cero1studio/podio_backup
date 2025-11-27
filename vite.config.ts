import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Redirige llamadas de API /podio-api -> https://api.podio.com
      '/podio-api': {
        target: 'https://api.podio.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/podio-api/, ''),
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Eliminar origen para evitar rechazo de Podio
            proxyReq.setHeader('Origin', 'https://podio.com');
          });
        },
      },
      // Redirige descargas de archivos /podio-files -> https://files.podio.com
      '/podio-files': {
        target: 'https://files.podio.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/podio-files/, ''),
        secure: false,
         configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
             proxyReq.setHeader('Origin', 'https://podio.com');
          });
        },
      }
    }
  }
})
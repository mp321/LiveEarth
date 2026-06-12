import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Same-origin dev proxy for NOAA NDBC, which doesn't send CORS headers (a
  // direct browser fetch is blocked and silently returns []). Routing through
  // the dev server makes the request same-origin; the prod equivalent lives in
  // vercel.json.
  //
  // NOTE: the /api/* serverless functions (api/flights.js, api/tle.js,
  // api/airquality.js) are NOT served by plain `vite` — they're proxied to
  // `vercel dev` below. Run `vercel dev --listen 3000` alongside `npm run dev`
  // (or just browse `vercel dev` directly; see README). Without it the proxy
  // 5xxes and the client degrades: flights fall back to airplanes.live,
  // satellites use the last localStorage TLE set, air quality stays empty.
  server: {
    proxy: {
      // Serverless functions live in api/ and only run under `vercel dev`.
      // Proxying (instead of letting Vite's SPA fallback answer) guarantees
      // /api/* either reaches the functions or fails loudly with a 5xx the
      // client fetchers can detect and degrade from.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/proxy/ndbc': {
        target: 'https://www.ndbc.noaa.gov',
        changeOrigin: true,
        rewrite: (p) =>
          p.replace(/^\/proxy\/ndbc/, '/data/latest_obs/latest_obs.txt'),
      },
      // RainViewer radar tiles same-origin so throttled (429) responses can't
      // surface as CORS errors during animation.
      '/proxy/rainviewer': {
        target: 'https://tilecache.rainviewer.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/rainviewer/, ''),
      },
    },
  },
});

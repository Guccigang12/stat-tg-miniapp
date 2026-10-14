/**
 * Anti-sleep self-pinger for Render.com Free Tier
 * Keeps the web service awake by sending HTTP requests every few minutes.
 */

function startPinger({ port = 3000, intervalMinutes = 9 } = {}) {
  // Render.com automatically provides RENDER_EXTERNAL_URL (e.g. https://my-app.onrender.com)
  const targetUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || `http://localhost:${port}`;
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

  console.log(`[Anti-Sleep Pinger] Initialized for: ${targetUrl}/ping (every ${intervalMinutes} minutes)`);

  // First ping after 30 seconds to verify connectivity
  setTimeout(() => {
    pingUrl(targetUrl);
  }, 30000);

  // Periodic recurring ping
  const timer = setInterval(() => {
    pingUrl(targetUrl);
  }, intervalMs);

  return timer;
}

async function pingUrl(baseUrl) {
  const pingEndpoint = `${baseUrl.replace(/\/+$/, '')}/ping`;
  const startTime = Date.now();

  try {
    const res = await fetch(pingEndpoint, {
      method: 'GET',
      headers: {
        'User-Agent': 'MyStat-Helper-SelfPinger/1.0',
        'X-Keep-Alive': 'true'
      }
    });

    const duration = Date.now() - startTime;
    const timeStr = new Date().toLocaleTimeString('ru-RU', { hour12: false });

    if (res.ok) {
      console.log(`[Anti-Sleep Pinger] [${timeStr}] ✅ Self-ping OK (${res.status}) in ${duration}ms -> Service active!`);
    } else {
      console.warn(`[Anti-Sleep Pinger] [${timeStr}] ⚠️ Self-ping responded with status ${res.status}`);
    }
  } catch (err) {
    const timeStr = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    console.warn(`[Anti-Sleep Pinger] [${timeStr}] ⚠️ Self-ping failed (${err.message}). Will retry on next interval.`);
  }
}

module.exports = {
  startPinger,
  pingUrl
};

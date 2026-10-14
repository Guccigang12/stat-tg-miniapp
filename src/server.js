/**
 * Main Express Web Server and Telegram Bot Service
 * Designed to run on Render.com free tier or locally.
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { MyStatClient, HomeworkStatus } = require('./mystat');
const db = require('./db');
const { createBot } = require('./bot');
const { startPinger } = require('./pinger');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';

// Base public URL for Render.com or local
const APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || `http://localhost:${PORT}`;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend (Telegram Mini App)
app.use(express.static(path.join(__dirname, 'public')));

// Keep-alive / Health-check endpoint for Render.com free tier
app.get('/ping', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    service: 'MyStat Telegram Assistant'
  });
});

app.get('/health', (req, res) => {
  res.redirect('/ping');
});

/**
 * Middleware: extract or resolve MyStatClient from request
 * Accepts:
 *  - Header `Authorization: Bearer <token>`
 *  - Or Header `X-Telegram-Id: <id>` (looks up in db)
 *  - Or Query param `token` / `telegramId`
 */
async function resolveClient(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const telegramId = req.headers['x-telegram-id'] || req.query.telegramId;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.query.token) {
      token = req.query.token;
    }

    // Try resolving from saved user session
    let savedUser = null;
    if (telegramId) {
      savedUser = db.getUser(telegramId);
    }

    if (!token && savedUser) {
      token = savedUser.accessToken;
    }

    if (!token && (!savedUser || !savedUser.password)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Необходима авторизация в MyStat.'
      });
    }

    // Create client instance
    const client = new MyStatClient({
      username: savedUser?.username,
      password: savedUser?.password,
      accessToken: token,
      tokenExpiresAt: savedUser?.tokenExpiresAt,
      groupId: savedUser?.groupId
    });

    req.mystat = client;
    req.currentUser = savedUser;
    req.telegramId = telegramId;
    next();
  } catch (err) {
    res.status(500).json({ error: 'ClientResolutionError', message: err.message });
  }
}

// ==================== API ROUTES FOR MINI APP ====================

/**
 * POST /api/login
 * Body: { username, password, telegramId }
 */
app.post('/api/login', async (req, res) => {
  const { username, password, telegramId } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'Пожалуйста, введите логин и пароль от MyStat.'
    });
  }

  try {
    const client = new MyStatClient();
    const loginResult = await client.login(username, password);

    // Save session in db
    if (telegramId) {
      db.saveUser(telegramId, {
        username,
        password, // stored to auto-refresh access token when it expires
        accessToken: loginResult.accessToken,
        tokenExpiresAt: loginResult.tokenExpiresAt,
        groupId: loginResult.userInfo?.current_group_id,
        userInfo: loginResult.userInfo
      });
    }

    res.json({
      success: true,
      token: loginResult.accessToken,
      tokenExpiresAt: loginResult.tokenExpiresAt,
      userInfo: loginResult.userInfo
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(401).json({
      error: 'AuthError',
      message: err.message || 'Ошибка авторизации в MyStat'
    });
  }
});

/**
 * GET /api/session
 * Check if telegramId already has an active session
 */
app.get('/api/session', async (req, res) => {
  const telegramId = req.headers['x-telegram-id'] || req.query.telegramId;
  if (!telegramId) {
    return res.json({ authenticated: false });
  }

  const user = db.getUser(telegramId);
  if (!user || (!user.accessToken && !user.password)) {
    return res.json({ authenticated: false });
  }

  try {
    const client = new MyStatClient({
      username: user.username,
      password: user.password,
      accessToken: user.accessToken,
      tokenExpiresAt: user.tokenExpiresAt,
      groupId: user.groupId
    });

    // Check token or fetch fresh user info
    const userInfo = await client.getUserInfo();

    // Update saved user info
    db.saveUser(telegramId, {
      accessToken: client.accessToken,
      tokenExpiresAt: client.tokenExpiresAt,
      groupId: client.groupId,
      userInfo
    });

    res.json({
      authenticated: true,
      token: client.accessToken,
      userInfo
    });
  } catch (err) {
    console.warn('Session check failed:', err.message);
    res.json({ authenticated: false, error: err.message });
  }
});

/**
 * GET /api/me
 * User profile info
 */
app.get('/api/me', resolveClient, async (req, res) => {
  try {
    const info = await req.mystat.getUserInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: 'ProfileError', message: err.message });
  }
});

/**
 * GET /api/homework
 * Query: status (3=active, 6=overdue, 1=checked, 2=uploaded, all), type (0=hw, 1=lab), page
 */
app.get('/api/homework', resolveClient, async (req, res) => {
  try {
    const statusParam = req.query.status;
    let status = HomeworkStatus.ACTIVE;

    if (statusParam === 'overdue') status = HomeworkStatus.OVERDUE;
    else if (statusParam === 'checked') status = HomeworkStatus.CHECKED;
    else if (statusParam === 'uploaded') status = HomeworkStatus.UPLOADED;
    else if (statusParam === 'all') status = null;
    else if (statusParam !== undefined && !isNaN(parseInt(statusParam))) {
      status = parseInt(statusParam);
    }

    const type = parseInt(req.query.type || '0');
    const page = parseInt(req.query.page || '1');

    if (statusParam === 'pending' || !statusParam) {
      // Returns both active and overdue (hanging homework)
      const pending = await req.mystat.getPendingHomework();
      return res.json(pending);
    }

    const data = await req.mystat.getHomeworkList({ status, type, page });
    res.json(data);
  } catch (err) {
    console.error('Homework API Error:', err.message);
    res.status(500).json({ error: 'HomeworkError', message: err.message });
  }
});

/**
 * GET /api/schedule
 * Query: date (YYYY-MM-DD) or month (YYYY-MM-DD)
 */
app.get('/api/schedule', resolveClient, async (req, res) => {
  try {
    const { date, month } = req.query;

    if (date) {
      const schedule = await req.mystat.getScheduleByDate(date);
      return res.json(schedule);
    }

    const targetDate = month ? new Date(month) : new Date();
    const monthSchedule = await req.mystat.getMonthSchedule(targetDate);
    res.json(monthSchedule);
  } catch (err) {
    console.error('Schedule API Error:', err.message);
    res.status(500).json({ error: 'ScheduleError', message: err.message });
  }
});

/**
 * GET /api/grades/today
 * Returns today's grades, visits, and recent grades
 */
app.get('/api/grades/today', resolveClient, async (req, res) => {
  try {
    const data = await req.mystat.getTodayGrades();
    res.json(data);
  } catch (err) {
    console.error('Grades API Error:', err.message);
    res.status(500).json({ error: 'GradesError', message: err.message });
  }
});

/**
 * GET /api/leaderboard
 * Query: type ('group' or 'stream')
 */
app.get('/api/leaderboard', resolveClient, async (req, res) => {
  try {
    const type = req.query.type || 'group';
    let leaders = [];

    if (type === 'stream') {
      leaders = await req.mystat.getStreamLeaders();
    } else {
      leaders = await req.mystat.getGroupLeaders();
    }

    res.json({
      type,
      leaders
    });
  } catch (err) {
    console.error('Leaderboard API Error:', err.message);
    res.status(500).json({ error: 'LeaderboardError', message: err.message });
  }
});

/**
 * GET /api/download-proxy
 * Direct download proxy to bypass CORS / Referer restrictions on files
 */
app.get('/api/download-proxy', async (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl) {
    return res.status(400).send('Missing file URL parameter.');
  }

  try {
    const targetUrl = fileUrl.startsWith('http') ? fileUrl : `https://mystat.itstep.org/${fileUrl.replace(/^\/+/, '')}`;
    const remoteRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mystat.itstep.org/'
      }
    });

    if (!remoteRes.ok) {
      return res.status(remoteRes.status).send('Unable to download file from MyStat.');
    }

    const contentType = remoteRes.headers.get('content-type') || 'application/octet-stream';
    const filename = path.basename(new URL(targetUrl).pathname) || 'homework_attachment';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    const arrayBuffer = await remoteRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Download proxy error:', err.message);
    res.status(500).send(`Download failed: ${err.message}`);
  }
});

/**
 * POST /api/logout
 */
app.post('/api/logout', (req, res) => {
  const telegramId = req.headers['x-telegram-id'] || req.body.telegramId;
  if (telegramId) {
    db.deleteUser(telegramId);
  }
  res.json({ success: true });
});

// Fallback all frontend routes to index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== INITIALIZE SERVICES ====================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚀 MyStat Telegram Assistant is running!`);
  console.log(`📡 Local URL:       http://localhost:${PORT}`);
  console.log(`🌐 Public App URL:  ${APP_URL}`);
  console.log(`⚡ Render Free Tier anti-sleep pinger enabled`);
  console.log(`===============================================`);

  // Start the anti-sleep self-pinger
  startPinger({ port: PORT, intervalMinutes: 9 });

  // Initialize Telegram Bot if BOT_TOKEN is provided
  if (BOT_TOKEN) {
    const bot = createBot(BOT_TOKEN, APP_URL);
    if (bot) {
      console.log('[Telegram Bot] Starting bot via Long Polling...');
      bot.start({
        onStart: (botInfo) => {
          console.log(`[Telegram Bot] ✅ Bot started successfully: @${botInfo.username}`);
        }
      }).catch(err => {
        console.error('[Telegram Bot] ❌ Failed to start bot:', err.message);
      });
    }
  } else {
    console.log('[Telegram Bot] ℹ️ BOT_TOKEN not found in environment. Create a bot with @BotFather and set BOT_TOKEN in .env to enable Telegram bot.');
  }
});

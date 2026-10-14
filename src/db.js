/**
 * Session and user storage
 * Supports Single-User Mode without database persistence:
 * Uses MYSTAT_USERNAME, MYSTAT_PASSWORD, and MY_TELEGRAM_ID from environment.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache
let usersMap = {};

function loadData() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      usersMap = JSON.parse(content || '{}');
    }
  } catch (err) {
    console.error('Error loading users.json:', err.message);
    usersMap = {};
  }
}

function saveData() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(usersMap, null, 2), 'utf8');
  } catch (err) {
    // Ephemeral disk on Render might throw or be wiped, ignore safe write errors
  }
}

loadData();

function isSingleUserMode() {
  return Boolean(process.env.MYSTAT_USERNAME && process.env.MYSTAT_PASSWORD);
}

function getSingleUserTelegramId() {
  return process.env.MY_TELEGRAM_ID ? String(process.env.MY_TELEGRAM_ID).trim() : null;
}

module.exports = {
  isSingleUserMode,
  getSingleUserTelegramId,

  getUser(telegramId) {
    const singleMode = isSingleUserMode();
    const myTgId = getSingleUserTelegramId();

    if (singleMode) {
      // In single user mode, match MY_TELEGRAM_ID or fallback if no ID or default
      const key = myTgId || 'single_user';
      const existing = usersMap[key] || {};

      return {
        username: process.env.MYSTAT_USERNAME,
        password: process.env.MYSTAT_PASSWORD,
        telegramId: myTgId,
        ...existing
      };
    }

    if (!telegramId) return null;
    return usersMap[String(telegramId)] || null;
  },

  saveUser(telegramId, userData) {
    const singleMode = isSingleUserMode();
    const myTgId = getSingleUserTelegramId();
    const idKey = singleMode ? (myTgId || 'single_user') : String(telegramId || 'default');

    const existing = usersMap[idKey] || {};
    usersMap[idKey] = {
      ...existing,
      ...userData,
      telegramId: idKey,
      updatedAt: new Date().toISOString()
    };

    saveData();
    return usersMap[idKey];
  },

  deleteUser(telegramId) {
    if (isSingleUserMode()) {
      // In single-user mode, clear tokens from memory but credentials remain in .env
      const myTgId = getSingleUserTelegramId() || 'single_user';
      if (usersMap[myTgId]) {
        delete usersMap[myTgId].accessToken;
        delete usersMap[myTgId].tokenExpiresAt;
      }
      return true;
    }

    if (!telegramId) return false;
    delete usersMap[String(telegramId)];
    saveData();
    return true;
  },

  getAllUsers() {
    return Object.values(usersMap);
  }
};

/**
 * Simple file-based storage for user sessions and MyStat credentials
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
    console.error('Error saving users.json:', err.message);
  }
}

// Initial load
loadData();

module.exports = {
  getUser(telegramId) {
    if (!telegramId) return null;
    return usersMap[String(telegramId)] || null;
  },

  saveUser(telegramId, userData) {
    if (!telegramId) return;
    const existing = usersMap[String(telegramId)] || {};
    usersMap[String(telegramId)] = {
      ...existing,
      ...userData,
      telegramId: String(telegramId),
      updatedAt: new Date().toISOString()
    };
    saveData();
    return usersMap[String(telegramId)];
  },

  deleteUser(telegramId) {
    if (!telegramId) return false;
    delete usersMap[String(telegramId)];
    saveData();
    return true;
  },

  getAllUsers() {
    return Object.values(usersMap);
  }
};

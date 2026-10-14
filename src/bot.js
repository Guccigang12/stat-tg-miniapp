/**
 * Telegram Bot implementation using Grammy
 * Provides Telegram Mini App launcher and direct chat commands.
 * Supports Single-User Mode and access protection via MY_TELEGRAM_ID.
 */

const { Bot, InlineKeyboard, Keyboard } = require('grammy');
const { MyStatClient, HomeworkStatus } = require('./mystat');
const db = require('./db');

function createBot(token, webAppUrl, defaultClient = null) {
  if (!token) {
    console.warn('[Telegram Bot] ⚠️ BOT_TOKEN is not provided. Telegram bot will not start. (Mini App web service will still work)');
    return null;
  }

  const bot = new Bot(token);

  // Security Guard: restrict bot access only to MY_TELEGRAM_ID if configured
  const myTelegramId = process.env.MY_TELEGRAM_ID ? String(process.env.MY_TELEGRAM_ID).trim() : null;

  if (myTelegramId) {
    console.log(`[Telegram Bot] 🔒 Private bot guard enabled for Telegram ID: ${myTelegramId}`);
    bot.use(async (ctx, next) => {
      const senderId = ctx.from ? String(ctx.from.id) : null;
      if (senderId !== myTelegramId) {
        console.warn(`[Telegram Bot] ⛔ Unauthorized access attempt from user ID: ${senderId} (@${ctx.from?.username || 'unknown'})`);
        await ctx.reply('⛔ Доступ ограничен. Это приватный бот.');
        return;
      }
      await next();
    });
  }

  // Main reply keyboard for quick actions
  const mainKeyboard = new Keyboard()
    .text('📚 Домашка').text('📅 Расписание').row()
    .text('⭐ Оценки').text('🏆 Лидеры').row()
    .text('🚀 Открыть Mini App').text('ℹ️ Помощь')
    .resized();

  // Helper to get client for user
  async function getClientForUser(ctx) {
    // If default single-user client is provided from server, use it directly!
    if (defaultClient && defaultClient.username) {
      if (defaultClient.isTokenExpired() || !defaultClient.accessToken) {
        await defaultClient.login(process.env.MYSTAT_USERNAME, process.env.MYSTAT_PASSWORD);
      }
      return { client: defaultClient, user: { username: process.env.MYSTAT_USERNAME } };
    }

    const userId = ctx.from.id;
    const user = db.getUser(userId);

    if (!user || (!user.accessToken && !user.password)) {
      await ctx.reply(
        '👋 Вы ещё не авторизованы в MyStat!\n\n' +
        'Пожалуйста, откройте Mini App по кнопке ниже и выполните вход под вашим логином и паролем от mystat.itstep.org.',
        {
          reply_markup: new InlineKeyboard().webApp('🔐 Войти в MyStat', webAppUrl)
        }
      );
      return null;
    }

    const client = new MyStatClient({
      username: user.username,
      password: user.password,
      accessToken: user.accessToken,
      tokenExpiresAt: user.tokenExpiresAt,
      groupId: user.groupId
    });

    return { client, user };
  }

  // /start command
  bot.command('start', async (ctx) => {
    const name = ctx.from.first_name || 'Студент';
    const inlineKeyboard = new InlineKeyboard()
      .webApp('🚀 Открыть MyStat Помощник', webAppUrl);

    await ctx.reply(
      `👋 Привет, <b>${name}</b>!\n\n` +
      `Я твой персональный помощник для <b>MyStat (IT Step Academy)</b>.\n\n` +
      `🎯 <b>Что я умею:</b>\n` +
      `• 📚 Показывать висящую домашку и прямые ссылки на скачивание файлов заданий\n` +
      `• 📅 Показывать расписание пар на все дни с аудиториями и преподавателями\n` +
      `• ⭐ Смотреть оценки за сегодня и недавние посещения\n` +
      `• 🏆 Отображать таблицу лидеров группы и потока\n\n` +
      `👇 Нажми на кнопку ниже, чтобы запустить интерактивный <b>Mini App</b>, или используй команды в меню!`,
      {
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      }
    );

    // Send the reply keyboard as well
    await ctx.reply('Или выбери быструю команду из меню:', {
      reply_markup: mainKeyboard
    });
  });

  // /help command
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '📖 <b>Список команд бота:</b>\n\n' +
      '• <code>/start</code> — Главное меню и запуск Mini App\n' +
      '• <code>/hw</code> — Список висящих домашних заданий со ссылками на скачивание\n' +
      '• <code>/schedule</code> — Расписание на сегодня и завтра\n' +
      '• <code>/grades</code> — Оценки за сегодня\n' +
      '• <code>/leaders</code> — Таблица лидеров группы\n' +
      '• <code>/logout</code> — Сбросить сессию MyStat\n\n' +
      '💡 В <b>Mini App</b> доступен полный календарь на месяц, фильтры и удобный интерфейс!',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().webApp('🚀 Запустить Mini App', webAppUrl)
      }
    );
  });

  // Homework command
  const handleHomework = async (ctx) => {
    const session = await getClientForUser(ctx);
    if (!session) return;

    await ctx.reply('⏳ Проверяю домашние задания в MyStat...');

    try {
      const { active, overdue, totalCount } = await session.client.getPendingHomework();

      if (totalCount === 0) {
        return await ctx.reply('🎉 <b>Отличная работа!</b>\nУ тебя нет висящих домашних заданий.', {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().webApp('📱 Открыть все ДЗ в Mini App', webAppUrl)
        });
      }

      let msg = `📚 <b>Висящие домашние задания (${totalCount}):</b>\n\n`;

      const keyboard = new InlineKeyboard();

      // Show overdue if any
      if (overdue.length > 0) {
        msg += `⚠️ <b>Просроченные (${overdue.length}):</b>\n`;
        overdue.slice(0, 5).forEach((hw, i) => {
          msg += `<b>${i + 1}. ${escapeHtml(hw.subject)}</b>\n`;
          msg += `📝 ${escapeHtml(hw.theme)}\n`;
          msg += `⏳ Срок был: <code>${hw.overdueTime || 'не указан'}</code>\n`;
          if (hw.teacher) msg += `👨‍🏫 Преподаватель: ${escapeHtml(hw.teacher)}\n`;
          if (hw.downloadUrl) {
            msg += `📥 <a href="${hw.downloadUrl}">Скачать файл задания</a>\n`;
            keyboard.url(`📥 ДЗ: ${hw.theme.slice(0, 20)}...`, hw.downloadUrl).row();
          }
          msg += '\n';
        });
      }

      // Show active
      if (active.length > 0) {
        msg += `⏳ <b>Активные (${active.length}):</b>\n`;
        active.slice(0, 5).forEach((hw, i) => {
          msg += `<b>${i + 1}. ${escapeHtml(hw.subject)}</b>\n`;
          msg += `📝 ${escapeHtml(hw.theme)}\n`;
          msg += `⏰ Сдать до: <code>${hw.overdueTime || 'не указан'}</code>\n`;
          if (hw.teacher) msg += `👨‍🏫 Преподаватель: ${escapeHtml(hw.teacher)}\n`;
          if (hw.downloadUrl) {
            msg += `📥 <a href="${hw.downloadUrl}">Скачать файл задания</a>\n`;
            keyboard.url(`📥 Скачать: ${hw.theme.slice(0, 20)}...`, hw.downloadUrl).row();
          }
          msg += '\n';
        });
      }

      keyboard.webApp('📱 Открыть полный список в Mini App', webAppUrl);

      await ctx.reply(msg, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: keyboard
      });

    } catch (err) {
      console.error('Bot HW Error:', err);
      await ctx.reply(`❌ Не удалось получить список ДЗ: ${err.message}`);
    }
  };

  bot.command('hw', handleHomework);
  bot.hears('📚 Домашка', handleHomework);

  // Schedule command
  const handleSchedule = async (ctx) => {
    const session = await getClientForUser(ctx);
    if (!session) return;

    await ctx.reply('⏳ Загружаю расписание...');

    try {
      const today = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todaySchedule = await session.client.getScheduleByDate(today);
      const tomorrowSchedule = await session.client.getScheduleByDate(tomorrow);

      let msg = `📅 <b>Расписание занятий</b>\n\n`;

      // Today
      const todayDateStr = MyStatClient.formatDate(today);
      msg += `📌 <b>Сегодня (${todayDateStr}):</b>\n`;
      if (todaySchedule.length === 0) {
        msg += '🎉 <i>Пар нет — выходной!</i>\n\n';
      } else {
        todaySchedule.forEach((item, idx) => {
          msg += `<b>${idx + 1}. ${item.started_at || ''} - ${item.finished_at || ''}</b>\n`;
          msg += `📖 ${escapeHtml(item.subject_name || 'Пара')}\n`;
          if (item.teacher_name) msg += `👨‍🏫 ${escapeHtml(item.teacher_name)}\n`;
          if (item.room_name) msg += `🚪 Ауд: <code>${escapeHtml(item.room_name)}</code>\n`;
          msg += '\n';
        });
      }

      // Tomorrow
      const tomorrowDateStr = MyStatClient.formatDate(tomorrow);
      msg += `📌 <b>Завтра (${tomorrowDateStr}):</b>\n`;
      if (tomorrowSchedule.length === 0) {
        msg += '🎉 <i>Пар нет — выходной!</i>\n\n';
      } else {
        tomorrowSchedule.forEach((item, idx) => {
          msg += `<b>${idx + 1}. ${item.started_at || ''} - ${item.finished_at || ''}</b>\n`;
          msg += `📖 ${escapeHtml(item.subject_name || 'Пара')}\n`;
          if (item.teacher_name) msg += `👨‍🏫 ${escapeHtml(item.teacher_name)}\n`;
          if (item.room_name) msg += `🚪 Ауд: <code>${escapeHtml(item.room_name)}</code>\n`;
          msg += '\n';
        });
      }

      const keyboard = new InlineKeyboard()
        .webApp('📅 Календарь на весь месяц в Mini App', webAppUrl);

      await ctx.reply(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

    } catch (err) {
      console.error('Bot Schedule Error:', err);
      await ctx.reply(`❌ Не удалось загрузить расписание: ${err.message}`);
    }
  };

  bot.command('schedule', handleSchedule);
  bot.hears('📅 Расписание', handleSchedule);

  // Grades command
  const handleGrades = async (ctx) => {
    const session = await getClientForUser(ctx);
    if (!session) return;

    await ctx.reply('⏳ Получаю оценки...');

    try {
      const data = await session.client.getTodayGrades();

      let msg = `⭐ <b>Оценки и успеваемость</b>\n\n`;

      if (data.todayGrades && data.todayGrades.length > 0) {
        msg += `🎯 <b>Оценки за сегодня (${data.todayDate}):</b>\n`;
        data.todayGrades.forEach(g => {
          msg += `• <b>${escapeHtml(g.subject || 'Предмет')}</b>\n`;
          if (g.classWorkMark) msg += `  Классная работа: <b>${g.classWorkMark}</b>\n`;
          if (g.homeWorkMark) msg += `  Домашняя работа: <b>${g.homeWorkMark}</b>\n`;
          if (g.labWorkMark) msg += `  Лабораторная: <b>${g.labWorkMark}</b>\n`;
          if (!g.classWorkMark && !g.homeWorkMark && !g.labWorkMark) {
            msg += `  Посещение: ${g.wasPresent ? '✅ Был(а)' : '❌ Отсутствовал(а)'}\n`;
          }
          msg += '\n';
        });
      } else {
        msg += `ℹ️ <i>За сегодня (${data.todayDate}) новых оценок пока нет.</i>\n\n`;
      }

      if (data.recentGrades && data.recentGrades.length > 0) {
        msg += `🕒 <b>Последние выставленные оценки:</b>\n`;
        data.recentGrades.slice(0, 4).forEach(g => {
          const marks = [
            g.classWorkMark ? `Кл: ${g.classWorkMark}` : null,
            g.homeWorkMark ? `ДЗ: ${g.homeWorkMark}` : null,
            g.labWorkMark ? `Лаб: ${g.labWorkMark}` : null
          ].filter(Boolean).join(' | ');

          msg += `• <code>${g.date}</code> — <b>${escapeHtml(g.subject)}</b>\n`;
          if (marks) msg += `  Оценки: <b>${marks}</b>\n`;
          if (g.teacher) msg += `  Преподаватель: ${escapeHtml(g.teacher)}\n`;
          msg += '\n';
        });
      }

      const keyboard = new InlineKeyboard()
        .webApp('📊 Подробнее в Mini App', webAppUrl);

      await ctx.reply(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

    } catch (err) {
      console.error('Bot Grades Error:', err);
      await ctx.reply(`❌ Не удалось получить оценки: ${err.message}`);
    }
  };

  bot.command('grades', handleGrades);
  bot.hears('⭐ Оценки', handleGrades);

  // Leaderboard command
  const handleLeaders = async (ctx) => {
    const session = await getClientForUser(ctx);
    if (!session) return;

    await ctx.reply('⏳ Загружаю таблицу лидеров...');

    try {
      const leaders = await session.client.getGroupLeaders();

      let msg = `🏆 <b>Таблица лидеров группы</b>\n\n`;

      if (!leaders || leaders.length === 0) {
        msg += 'ℹ️ Информация о лидерах пока недоступна.\n';
      } else {
        leaders.slice(0, 10).forEach((st, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
          msg += `${medal} <b>${escapeHtml(st.full_name || 'Студент')}</b> — 💎 ${st.amount || 0}\n`;
        });
      }

      const keyboard = new InlineKeyboard()
        .webApp('🏆 Лидеры потока и группы в Mini App', webAppUrl);

      await ctx.reply(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

    } catch (err) {
      console.error('Bot Leaders Error:', err);
      await ctx.reply(`❌ Не удалось загрузить таблицу лидеров: ${err.message}`);
    }
  };

  bot.command('leaders', handleLeaders);
  bot.hears('🏆 Лидеры', handleLeaders);

  // Open Mini App button text
  bot.hears('🚀 Открыть Mini App', async (ctx) => {
    await ctx.reply('Нажми кнопку ниже для открытия приложения:', {
      reply_markup: new InlineKeyboard().webApp('🚀 Запустить MyStat Mini App', webAppUrl)
    });
  });

  bot.hears('ℹ️ Помощь', async (ctx) => {
    await ctx.reply(
      '💡 <b>Как пользоваться:</b>\n\n' +
      '1. Нажми <b>🚀 Открыть Mini App</b>\n' +
      '2. Твой аккаунт синхронизируется автоматически без необходимости вводить логин и пароль!\n' +
      '3. Пользуйся удобным интерфейсом для просмотра домашки, скачивания файлов, расписания и оценок!',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().webApp('🚀 Запустить Mini App', webAppUrl)
      }
    );
  });

  // Logout command
  bot.command('logout', async (ctx) => {
    db.deleteUser(ctx.from.id);
    await ctx.reply('Сессия обновлена. В режиме Single-User учетные данные считываются из переменных окружения.');
  });

  return bot;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  createBot
};

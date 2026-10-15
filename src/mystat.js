/**
 * MyStat API Client for mystat.itstep.org
 * Handles modern IT Step MyStat API (mapi.itstep.org/v1/mystat)
 * Supports authentication, user profile, homework, schedules, grades, and leaderboards.
 */

const BASE_URL = 'https://mapi.itstep.org/v1/mystat';

// Homework Status Enum
const HomeworkStatus = {
  CHECKED: 1,
  UPLOADED: 2,
  ACTIVE: 3,    // "Висящая", активная домашка
  DELETED: 5,
  OVERDUE: 6    // Просроченная домашка
};

class MyStatClient {
  constructor({ username, password, accessToken = null, tokenExpiresAt = null, groupId = null, branch = null, userId = null } = {}) {
    this.username = username;
    this.password = password;
    this.accessToken = accessToken;
    this.tokenExpiresAt = tokenExpiresAt;
    this.groupId = groupId;
    this.branch = branch;
    this.userId = userId;
    this.userInfo = null;

    if (accessToken && (!this.branch || !this.userId)) {
      try {
        const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf-8'));
        this.branch = this.branch || payload.branch_alias || 'dp';
        this.userId = this.userId || payload.id || payload.sub;
      } catch (e) {
        // Ignored if token format is non-standard
      }
    }
  }

  /**
   * Helper to format Date object into YYYY-MM-DD
   */
  static formatDate(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Check if token is expired
   */
  isTokenExpired() {
    if (!this.accessToken || !this.tokenExpiresAt) return true;
    // Buffer of 60 seconds
    return Date.now() >= (this.tokenExpiresAt - 60000);
  }

  /**
   * Authenticate student with MyStat credentials
   */
  async login(username = this.username, password = this.password) {
    if (!username || !password) {
      throw new Error('Логин и пароль обязательны для входа в MyStat.');
    }

    this.username = username;
    this.password = password;

    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        login: this.username,
        password: this.password
      })
    });

    const bodyText = await res.text();
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Неверный логин или пароль в MyStat.');
      }
      throw new Error(`Ошибка сервера MyStat (HTTP ${res.status}): ${bodyText}`);
    }

    // Token is returned as plain text or quoted string
    this.accessToken = bodyText.trim().replace(/^"|"$/g, '');

    let tokenPayload = {};
    try {
      tokenPayload = JSON.parse(Buffer.from(this.accessToken.split('.')[1], 'base64').toString('utf-8'));
    } catch (e) {
      throw new Error('Не удалось расшифровать JWT токен от сервера MyStat.');
    }

    this.branch = tokenPayload.branch_alias || 'dp';
    this.userId = tokenPayload.id || tokenPayload.sub;
    this.tokenExpiresAt = tokenPayload.exp ? tokenPayload.exp * 1000 : Date.now() + 24 * 3600 * 1000;

    // Fetch user profile info
    await this.getUserInfo();

    return {
      accessToken: this.accessToken,
      tokenExpiresAt: this.tokenExpiresAt,
      userInfo: this.userInfo,
      branch: this.branch
    };
  }

  /**
   * Make authorized request with auto-refresh if token expired
   */
  async request(path, options = {}) {
    if (this.isTokenExpired()) {
      if (this.username && this.password) {
        await this.login(this.username, this.password);
      } else {
        throw new Error('Срок действия сессии MyStat истёк. Пожалуйста, выполните вход заново.');
      }
    }

    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Authorization': `Bearer ${this.accessToken}`,
      'X-UserId': String(this.userId || ''),
      'branch_alias': this.branch || 'dp',
      'X-Language': 'uk',
      ...(options.headers || {})
    };

    let url;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      url = path;
    } else {
      const cleanPath = path.replace(/^\/+/, '');
      const fullPath = cleanPath.startsWith('auth/') || cleanPath.startsWith(`${this.branch}/`)
        ? cleanPath
        : `${this.branch || 'dp'}/${cleanPath}`;
      url = `${BASE_URL}/${fullPath}`;
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      // Retry once after re-authenticating
      if (this.username && this.password) {
        await this.login(this.username, this.password);
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        headers['X-UserId'] = String(this.userId || '');
        headers['branch_alias'] = this.branch || 'dp';
        const retryRes = await fetch(url, { ...options, headers });
        if (!retryRes.ok) throw new Error(`Ошибка MyStat API: ${retryRes.statusText}`);
        return await retryRes.json();
      }
      throw new Error('Не авторизован в MyStat (401). Проверьте учётные данные.');
    }

    if (!res.ok) {
      let errMsg = `Ошибка сервера MyStat (HTTP ${res.status})`;
      try {
        const errData = await res.json();
        if (errData?.message) errMsg = errData.message;
      } catch (e) {}
      throw new Error(errMsg);
    }

    try {
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  /**
   * Get student user profile info
   */
  async getUserInfo() {
    const account = await this.request('auth/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    let balances = [];
    try {
      balances = await this.request('gaming/get-balances') || [];
    } catch (e) {}

    let personal = null;
    try {
      personal = await this.request('profile/get-personal-data');
    } catch (e) {}

    const profile = account?.user_profiles?.[account.project_id || 50]?.[account.branch_id || 100]?.[0] || {};
    const groupIdProp = profile?.properties?.find(p => p.key === 'id_tgroups')?.value;
    if (groupIdProp) {
      this.groupId = groupIdProp;
    }

    const cristals = Array.isArray(balances) ? (balances.find(b => b.alias === 'cristals')?.value || 0) : 0;
    const coins = Array.isArray(balances) ? (balances.find(b => b.alias === 'coins')?.value || 0) : 0;
    const gaming_points = [
      { new_gaming_point_types__id: 1, points: cristals },
      { new_gaming_point_types__id: 2, points: coins }
    ];

    this.userInfo = {
      id: account.id,
      full_name: account.name || personal?.fio || account.username,
      username: account.username,
      photo: profile.photo || personal?.photo || null,
      group_name: `Группа ${this.groupId || 'IT Step'}`,
      current_group_id: this.groupId,
      branch: account.branch_alias || this.branch,
      gaming_points,
      level: 1,
      email: account.email
    };

    return this.userInfo;
  }

  /**
   * Format file_path into direct absolute download URL
   */
  static formatDownloadUrl(filePath) {
    if (!filePath) return null;
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    if (filePath.startsWith('/')) {
      return `https://mystat.itstep.org${filePath}`;
    }
    return `https://mystat.itstep.org/${filePath}`;
  }

  /**
   * Get Homework List with filters
   * status: 3 (active), 6 (overdue), 1 (checked), 2 (uploaded), or null (all)
   * type: 0 (homework), 1 (lab)
   */
  async getHomeworkList({ status = HomeworkStatus.ACTIVE, type = 0, page = 1 } = {}) {
    let query = `page=${page}&per_page=30`;
    if (status !== null && status !== undefined) {
      query += `&status=${status}`;
    }
    if (type !== null && type !== undefined) {
      query += `&type=${type}`;
    }

    const res = await this.request(`homework/list?${query}`);

    let rawItems = [];
    let pagination = { currentPage: page, totalPages: 1 };

    if (Array.isArray(res)) {
      for (const group of res) {
        if (Array.isArray(group.data)) {
          rawItems.push(...group.data);
        }
      }
    } else if (res && Array.isArray(res.data)) {
      rawItems = res.data;
      if (res._meta) {
        pagination = {
          currentPage: res._meta.currentPage || page,
          totalPages: res._meta.pageCount || 1,
          totalCount: res._meta.totalCount
        };
      }
    }

    const items = rawItems.map(hw => {
      const downloadUrl = MyStatClient.formatDownloadUrl(hw.file_path);
      return {
        id: hw.id,
        subject: hw.name_spec || 'Предмет без названия',
        theme: hw.theme || 'Тема не указана',
        comment: hw.comment || '',
        creationTime: hw.creation_time || '',
        completionTime: hw.completion_time || '',
        overdueTime: hw.overdue_time || '',
        filePath: hw.file_path || null,
        downloadUrl: downloadUrl,
        filename: hw.file_path ? hw.file_path.split('/').pop() : null,
        teacher: hw.fio_teach || '',
        status: hw.status,
        statusName: hw.status === HomeworkStatus.ACTIVE ? 'Активно' :
                    hw.status === HomeworkStatus.OVERDUE ? 'Просрочено' :
                    hw.status === HomeworkStatus.CHECKED ? 'Проверено' :
                    hw.status === HomeworkStatus.UPLOADED ? 'На проверке' : 'Другое',
        studentSolution: hw.homework_stud ? {
          mark: hw.homework_stud.mark,
          creationTime: hw.homework_stud.creation_time,
          filePath: hw.homework_stud.file_path,
          downloadUrl: MyStatClient.formatDownloadUrl(hw.homework_stud.file_path),
          answer: hw.homework_stud.stud_answer
        } : null,
        teacherComment: hw.homework_comment?.text_comment || null
      };
    });

    return {
      items,
      pagination
    };
  }

  /**
   * Get Active ("висящие") homework assignments
   */
  async getPendingHomework() {
    const active = await this.getHomeworkList({ status: HomeworkStatus.ACTIVE });
    const overdue = await this.getHomeworkList({ status: HomeworkStatus.OVERDUE });

    return {
      active: active.items,
      overdue: overdue.items,
      totalCount: active.items.length + overdue.items.length
    };
  }

  /**
   * Get Homework Counter counts
   */
  async getHomeworkCounters() {
    return await this.request('count/homework');
  }

  /**
   * Get monthly schedule (all days of month)
   */
  async getMonthSchedule(date = new Date()) {
    const dateStr = typeof date === 'string' ? date : MyStatClient.formatDate(date);
    const data = await this.request(`schedule/get-month?date_filter=${dateStr}`);
    return Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  }

  /**
   * Get schedule for a specific day
   */
  async getScheduleByDate(date = new Date()) {
    const dateStr = typeof date === 'string' ? date : MyStatClient.formatDate(date);
    const monthSchedule = await this.getMonthSchedule(date);
    return monthSchedule.filter(item => item.date === dateStr);
  }

  /**
   * Get today's schedule
   */
  async getTodaySchedule() {
    return await this.getScheduleByDate(new Date());
  }

  /**
   * Get student marks and recent performance
   */
  async getTodayGrades() {
    const todayStr = MyStatClient.formatDate(new Date());
    let marks = [];
    try {
      marks = await this.request('statistic/marks') || [];
    } catch (e) {
      console.warn('Could not fetch marks:', e.message);
    }

    const todayMarks = Array.isArray(marks) ? marks.filter(m => m.mark_date === todayStr) : [];
    const recentMarks = Array.isArray(marks) ? marks.slice(0, 6) : [];

    return {
      todayDate: todayStr,
      todayLessonsCount: todayMarks.length,
      todayGrades: todayMarks.map(m => ({
        subject: m.name_spec || 'Предмет',
        theme: m.nlenta ? `Урок ${m.nlenta}` : '',
        teacher: m.fio_teach || '',
        classWorkMark: m.mark,
        homeWorkMark: null,
        labWorkMark: null,
        wasPresent: true
      })),
      recentGrades: recentMarks.map(m => ({
        date: m.mark_date,
        subject: m.name_spec || 'Предмет',
        theme: m.nlenta ? `Урок ${m.nlenta}` : '',
        teacher: m.fio_teach || '',
        classWorkMark: m.mark,
        homeWorkMark: null,
        labWorkMark: null,
        wasPresent: true
      }))
    };
  }

  /**
   * Get Group Leaderboard
   */
  async getGroupLeaders() {
    const res = await this.request('progress/leader-table');
    const top = res?.group?.month?.top || [];
    return top.map(l => ({
      full_name: l.fio_stud || l.full_name || 'Студент',
      amount: l.amount || 0,
      photo_path: l.photo || l.photo_path || null,
      position: l.position
    }));
  }

  /**
   * Get Stream (Поток) Leaderboard
   */
  async getStreamLeaders() {
    const res = await this.request('progress/leader-table');
    const top = res?.stream?.month?.top || [];
    return top.map(l => ({
      full_name: l.fio_stud || l.full_name || 'Студент',
      amount: l.amount || 0,
      photo_path: l.photo || l.photo_path || null,
      position: l.position
    }));
  }
}

module.exports = {
  MyStatClient,
  HomeworkStatus
};

/**
 * MyStat API Client for mystat.itstep.org
 * Handles authentication, profile, homework, schedule, visits, and leaderboards.
 */

const BASE_URL = 'https://msapi.itstep.org/api/v2';
const APP_KEY = '6a56a5df2667e65aab73ce76d1dd737f7d1faef9c52e8b8c55ac75f565d8e8a6';

// Homework Status Enum
const HomeworkStatus = {
  CHECKED: 1,
  UPLOADED: 2,
  ACTIVE: 3,    // "Висящая", активная домашка
  DELETED: 5,
  OVERDUE: 6    // Просроченная домашка
};

class MyStatClient {
  constructor({ username, password, accessToken = null, tokenExpiresAt = null, groupId = null } = {}) {
    this.username = username;
    this.password = password;
    this.accessToken = accessToken;
    this.tokenExpiresAt = tokenExpiresAt;
    this.groupId = groupId;
    this.userInfo = null;
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

    const payload = {
      application_key: APP_KEY,
      id_city: null,
      username: this.username,
      password: this.password
    };

    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok || Array.isArray(data) || !data.access_token) {
      const errorMsg = Array.isArray(data) && data[0]?.message 
        ? data[0].message 
        : data.message || 'Неверный логин или пароль в MyStat.';
      throw new Error(errorMsg);
    }

    this.accessToken = data.access_token;
    // expires_in_access is in seconds or timestamp
    this.tokenExpiresAt = data.expires_in_access 
      ? Date.now() + (data.expires_in_access * 1000) 
      : Date.now() + (24 * 60 * 60 * 1000);

    // Fetch user info to store group ID and full name
    await this.getUserInfo();

    return {
      accessToken: this.accessToken,
      tokenExpiresAt: this.tokenExpiresAt,
      userInfo: this.userInfo
    };
  }

  /**
   * Make authorized GET/POST request with auto-refresh if token expired
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
      'Accept': 'application/json',
      'Authorization': `Bearer ${this.accessToken}`,
      'x-language': 'ru',
      ...(options.headers || {})
    };

    const url = path.startsWith('http') ? path : `${BASE_URL}/${path}`;
    const res = await fetch(url, {
      ...options,
      headers
    });

    if (res.status === 401) {
      // Retry once after re-authenticating
      if (this.username && this.password) {
        await this.login(this.username, this.password);
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        const retryRes = await fetch(url, { ...options, headers });
        if (!retryRes.ok) throw new Error(`Ошибка MyStat API: ${retryRes.statusText}`);
        return await retryRes.json();
      }
      throw new Error('Не авторизован в MyStat (401). Проверьте учётные данные.');
    }

    if (!res.ok) {
      let errMsg = `Ошибка запроса к MyStat API: ${res.status}`;
      try {
        const errData = await res.json();
        if (errData.message) errMsg = errData.message;
      } catch (e) {}
      throw new Error(errMsg);
    }

    return await res.json();
  }

  /**
   * Get student user profile info
   */
  async getUserInfo() {
    const data = await this.request('settings/user-info');
    this.userInfo = data;
    if (data && data.current_group_id) {
      this.groupId = data.current_group_id;
    }
    return data;
  }

  /**
   * Ensure student group ID is available
   */
  async ensureGroupId() {
    if (!this.groupId) {
      const info = await this.getUserInfo();
      this.groupId = info?.current_group_id;
    }
    return this.groupId;
  }

  /**
   * Format file_path into direct absolute download URL
   */
  static formatDownloadUrl(filePath) {
    if (!filePath) return null;
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    // Often file_path in MyStat is a relative path like /upload/homework/...
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
    const groupId = await this.ensureGroupId();
    let query = `page=${page}&type=${type}&group_id=${groupId}`;
    if (status !== null && status !== undefined) {
      query += `&status=${status}`;
    }

    const res = await this.request(`homework/operations/list?${query}`);
    
    // Normalize data and enrich with full download URLs
    const items = (res.data || []).map(hw => {
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
        filename: hw.filename || (downloadUrl ? downloadUrl.split('/').pop() : null),
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
      pagination: res._meta || { currentPage: page, totalPages: 1 }
    };
  }

  /**
   * Get Active ("висящие") homework assignments
   */
  async getPendingHomework() {
    // Get active homeworks
    const active = await this.getHomeworkList({ status: HomeworkStatus.ACTIVE });
    // Also fetch overdue homeworks because they are also "hanging" until submitted
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
    const dateStr = MyStatClient.formatDate(date);
    const data = await this.request(`schedule/operations/get-month?date_filter=${dateStr}`);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Get schedule for a specific day
   */
  async getScheduleByDate(date = new Date()) {
    const dateStr = typeof date === 'string' ? date : MyStatClient.formatDate(date);
    const data = await this.request(`schedule/operations/get-by-date?date_filter=${dateStr}`);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Get today's schedule
   */
  async getTodaySchedule() {
    return await this.getScheduleByDate(new Date());
  }

  /**
   * Get student visits and grades
   */
  async getVisits() {
    const data = await this.request('progress/operations/student-visits');
    return Array.isArray(data) ? data : [];
  }

  /**
   * Get recent activity log (points, marks, diamonds, coins)
   */
  async getActivityLog() {
    const data = await this.request('dashboard/progress/activity-web');
    return data || [];
  }

  /**
   * Get today's marks / grades
   * Inspects visits and activity log for current date
   */
  async getTodayGrades() {
    const todayStr = MyStatClient.formatDate(new Date());
    const visits = await this.getVisits();
    
    // Find visits for today
    const todayVisits = visits.filter(v => {
      if (!v.date_visit) return false;
      return v.date_visit.startsWith(todayStr);
    });

    // Also get activity log to capture any marks awarded today
    let activities = [];
    try {
      const logs = await this.getActivityLog();
      // logs can be array of { date, activity_log: [...] }
      if (Array.isArray(logs)) {
        const todayLog = logs.find(l => l.date === todayStr);
        if (todayLog && Array.isArray(todayLog.activity_log)) {
          activities = todayLog.activity_log;
        }
      }
    } catch (e) {
      console.warn('Could not fetch activity log for today grades:', e.message);
    }

    // Get recent visits if today has no marks yet so the user sees their latest marks
    const recentVisits = visits.slice(0, 5).map(v => ({
      date: v.date_visit,
      subject: v.spec_name || 'Предмет',
      theme: v.lesson_theme || '',
      teacher: v.teacher_name || '',
      classWorkMark: v.class_work_mark,
      homeWorkMark: v.home_work_mark,
      labWorkMark: v.lab_work_mark,
      wasPresent: v.status_was === 1
    }));

    return {
      todayDate: todayStr,
      todayLessonsCount: todayVisits.length,
      todayGrades: todayVisits.map(v => ({
        subject: v.spec_name,
        theme: v.lesson_theme,
        teacher: v.teacher_name,
        classWorkMark: v.class_work_mark,
        homeWorkMark: v.home_work_mark,
        labWorkMark: v.lab_work_mark,
        wasPresent: v.status_was === 1
      })),
      todayActivities: activities,
      recentGrades: recentVisits
    };
  }

  /**
   * Get Group Leaderboard
   */
  async getGroupLeaders() {
    const data = await this.request('dashboard/progress/leader-group');
    return Array.isArray(data) ? data : [];
  }

  /**
   * Get Stream (Поток) Leaderboard
   */
  async getStreamLeaders() {
    const data = await this.request('dashboard/progress/leader-stream');
    return Array.isArray(data) ? data : [];
  }
}

module.exports = {
  MyStatClient,
  HomeworkStatus
};

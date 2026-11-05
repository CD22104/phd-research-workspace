(() => {
  'use strict';
  if (location.protocol !== 'https:' || location.hostname !== 'choose-project-name.pages.dev' || window.top !== window) return;
  let queue = Promise.resolve();
  const post = payload => window.webkit.messageHandlers.researchTimer.postMessage(payload);
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/' + path, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'research-menu', 'X-Actor': 'web' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 || response.status === 403 || !response.headers.get('Content-Type')?.includes('application/json')) {
        throw new Error('请打开工作台重新登录');
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '同步失败，请重试');
      return result;
    } finally { clearTimeout(timeout); }
  }
  async function sync() {
    const result = await request('timer');
    post({ ok: true, running: result.running, background: result.background || [], now: result.now });
  }
  function enqueue(action) {
    queue = queue.then(action).catch(e => post({ ok: false, reason: e.message || '连接中断，请重试' }));
    return queue;
  }
  const routes = { pause: 'timer/pause', resume: 'timer/resume', stop: 'timer/stop', backgroundStop: 'background-timer/stop' };
  window.researchTimer = Object.freeze({
    sync: () => enqueue(sync),
    command: (action, sessionId) => enqueue(async () => {
      if (!Object.prototype.hasOwnProperty.call(routes, action) || !Number.isSafeInteger(sessionId) || sessionId <= 0) throw new Error('无效计时操作');
      await request(routes[action], { session_id: sessionId });
      await sync();
    }),
  });
  window.researchTimer.sync();
})();

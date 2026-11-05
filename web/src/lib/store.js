// 全局状态：设置、项目列表、收件箱计数、正在进行的计时
import { reactive } from 'vue';
import { api } from './api';
import { mergeConferences } from './conference-state';

export const store = reactive({
  ready: false,
  error: '',
  settings: null,
  projects: [],
  paperGroups: [],
  conferences: [],
  conferenceSyncing: false,
  conferenceSyncError: '',
  timezone: 'Asia/Singapore',
  counts: {},
  running: null,
  background: [],
  today: '',
  llm: { provider: 'off', available: false },
  // 打开论文详情抽屉 / 导入对话框（任何页面都能调用）
  paperId: null,
  importOpen: false,
  importPreset: null,
  captureOpen: false,
  version: 0, // 数据变化时递增，页面据此刷新
});

export async function bootstrap() {
  try {
    const b = await api.get('/bootstrap');
    Object.assign(store, { settings: b.settings, conferences: mergeConferences(store.conferences, b.conferences || []), timezone: b.timezone || 'Asia/Singapore', paperGroups: b.paper_groups || [], projects: b.projects, counts: b.counts, running: b.running, background: b.background || [], today: b.today, llm: b.llm, ready: true, error: '' });
  } catch (e) {
    store.error = e.message;
  }
}

// Refresh only conference preferences so open task/note drafts and timers stay intact.
let conferenceRequest = null;
let conferenceRefreshAgain = false;
export function refreshConferences({ force = false } = {}) {
  if (conferenceRequest) {
    if (force) conferenceRefreshAgain = true;
    return conferenceRequest;
  }
  store.conferenceSyncing = true;
  conferenceRequest = (async () => {
    do {
      conferenceRefreshAgain = false;
      try {
        const result = await api.get('/conferences');
        store.conferences = mergeConferences(store.conferences, result.conferences);
        store.conferenceSyncError = '';
      } catch (e) {
        store.conferenceSyncError = e.message;
      }
    } while (conferenceRefreshAgain);
  })().finally(() => {
    conferenceRequest = null;
    store.conferenceSyncing = false;
  });
  return conferenceRequest;
}

export function changed() {
  store.version++;
  bootstrap();
}

export function openPaper(id) {
  store.paperId = id;
}

export function openImport(preset = null) {
  store.importPreset = preset;
  store.importOpen = true;
}

export function projectName(id) {
  return store.projects.find((p) => p.id === id)?.name || '';
}

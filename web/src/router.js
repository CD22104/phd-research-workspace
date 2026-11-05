import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'today', component: () => import('./views/Today.vue'), meta: { title: '今日', icon: '🍯' } },
  { path: '/week', name: 'week', component: () => import('./views/Week.vue'), meta: { title: '周计划', icon: '🗓️' } },
  { path: '/submissions', name: 'submissions', component: () => import('./views/Submissions.vue'), meta: { title: '投稿', icon: '◇' } },
  { path: '/calendar', name: 'calendar', component: () => import('./views/Calendar.vue'), meta: { title: '日程', icon: '📅' } },
  { path: '/inbox', name: 'inbox', component: () => import('./views/Inbox.vue'), meta: { title: '收件箱', icon: '📥' } },
  { path: '/papers', name: 'papers', component: () => import('./views/Papers.vue'), meta: { title: '论文', icon: '📚' } },
  { path: '/ideas/:id?', name: 'ideas', component: () => import('./views/Ideas.vue'), meta: { title: 'Idea 仓库', icon: '💡' } },
  { path: '/projects/:id?', name: 'projects', component: () => import('./views/Projects.vue'), meta: { title: '项目 / 探索', icon: '🧭' } },
  { path: '/notes/:id', name: 'note', component: () => import('./views/Note.vue'), meta: { title: '笔记', hidden: true } },
  { path: '/feeds', name: 'feeds', component: () => import('./views/Feeds.vue'), meta: { title: '信息流', icon: '📰' } },
  { path: '/stats', name: 'stats', component: () => import('./views/Stats.vue'), meta: { title: '统计', icon: '📊' } },
  { path: '/sessions', name: 'sessions', component: () => import('./views/Sessions.vue'), meta: { title: '计时记录', icon: '⏱️' } },
  { path: '/settings', name: 'settings', component: () => import('./views/Settings.vue'), meta: { title: '设置', icon: '⚙️' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });
export const navRoutes = routes.filter((r) => r.meta && !r.meta.hidden);

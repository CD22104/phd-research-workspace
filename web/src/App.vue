<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider, NMenu, NButton, NBadge, NDrawer, NDrawerContent, NResult, zhCN, dateZhCN, darkTheme,
} from 'naive-ui';
import { theme, applyTheme, naiveOverrides, sidebarMenuOverrides } from './lib/theme';
import BearLogo from './components/BearLogo.vue';
import { syncTimer } from './lib/timer';
import { store, bootstrap, refreshConferences } from './lib/store';
import { listenForConferenceChanges } from './lib/conferences';
import { navRoutes } from './router';
import UiBridge from './components/UiBridge.vue';
import TimerChip from './components/TimerChip.vue';
import QuickCapture from './components/QuickCapture.vue';
import ImportDialog from './components/ImportDialog.vue';
import PaperDrawer from './components/PaperDrawer.vue';

const route = useRoute();
const router = useRouter();
const naiveTheme = computed(() => (theme.dark ? darkTheme : null));
const overrides = computed(() => naiveOverrides(theme.tokens));
const sideMenu = computed(() => sidebarMenuOverrides(theme.tokens));
// 设置里保存的皮肤（跨设备同步）；本机记住的只用来避免首屏闪烁
watch(() => store.settings?.theme, (id) => { if (id && id !== theme.id) applyTheme(id); });
const mobile = ref(window.innerWidth < 800);
const moreOpen = ref(false);
window.addEventListener('resize', () => (mobile.value = window.innerWidth < 800));
let timerPoll, stopConferenceListener;
function refreshVisibleState() {
  if (document.visibilityState !== 'visible') return;
  syncTimer();
  if (store.ready) refreshConferences({ force: true });
}
onMounted(() => {
  bootstrap();
  stopConferenceListener = listenForConferenceChanges();
  timerPoll = setInterval(() => {
    syncTimer();
    if (store.ready && document.visibilityState === 'visible') refreshConferences();
  }, 30000);
  window.addEventListener('focus', refreshVisibleState);
  document.addEventListener('visibilitychange', refreshVisibleState);
});
onUnmounted(() => {
  clearInterval(timerPoll);
  stopConferenceListener?.();
  window.removeEventListener('focus', refreshVisibleState);
  document.removeEventListener('visibilitychange', refreshVisibleState);
});
watch(() => route.name, () => { if (store.ready) refreshConferences({ force: true }); });

const badge = (name) => (name === 'inbox' ? (store.counts.captures || 0) + (store.counts.candidates || 0) + (store.counts.dup_suspects || 0) : name === 'feeds' ? store.counts.feed_items || 0 : 0);
const menuOptions = computed(() => navRoutes.map((r) => ({
  key: r.name,
  label: () => [r.meta.title, badge(r.name) ? ` · ${badge(r.name)}` : ''].join(''),
})));
const active = computed(() => {
  if (route.name !== 'note') return route.name;
  if (route.query.from === 'paper' || route.query.paper_id) return 'papers';
  if (route.query.from === 'idea') return 'ideas';
  if (route.query.from === 'project' || route.query.project_id) return 'projects';
  return null;
});
const title = computed(() => route.meta?.title || '');
watch(title, (t) => (document.title = `${t} · ${store.settings?.app_name || '研究工作台'}`));
const go = (name) => {
  moreOpen.value = false;
  router.push({ name });
};
const tabs = [
  { name: 'today', icon: '◷', label: '今日' },
  { name: 'inbox', icon: '↓', label: '收件箱' },
  { name: 'papers', icon: '▤', label: '论文' },
  { name: 'ideas', icon: '◇', label: 'Idea' },
];

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    store.captureOpen = true;
  }
}
window.addEventListener('keydown', onKey);
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="overrides" :locale="zhCN" :date-locale="dateZhCN">
    <NNotificationProvider>
      <NMessageProvider placement="top">
        <NDialogProvider>
          <UiBridge />
          <div class="shell" :class="{ mobile }">
            <aside v-if="!mobile" class="side">
              <div class="brand" @click="go('today')">
                <BearLogo v-if="theme.mascot" :size="44" />
                <span v-else class="brand-mark" aria-hidden="true">R<span>·</span></span>
                <div>
                  <div class="name">{{ store.settings?.app_name || '研究工作台' }}</div>
                  <div class="sub">RESEARCH WORKSPACE</div>
                </div>
              </div>
              <NMenu :theme-overrides="sideMenu" :value="active" :options="menuOptions" @update:value="go" />
              <div class="side-foot">
                <TimerChip />
                <NButton class="capture-button" block size="small" @click="store.captureOpen = true">随手记 <span class="kbd">Ctrl K</span></NButton>
              </div>
            </aside>

            <main class="main">


              <NResult v-if="store.error" status="warning" title="暂时无法连接" :description="store.error" style="margin-top: 60px">
                <template #footer><NButton type="primary" @click="bootstrap">重试</NButton></template>
              </NResult>
              <RouterView v-else-if="store.ready" v-slot="{ Component }">
                <component :is="Component" />
              </RouterView>
              <div v-else class="loading"><p class="muted">正在加载工作台…</p></div>
            </main>

            <div v-if="mobile && store.running" class="mobile-timer"><TimerChip /></div>
            <nav v-if="mobile" class="tabbar">
              <button v-for="t in tabs" :key="t.name" :class="{ on: active === t.name }" @click="go(t.name)">
                <NBadge :value="badge(t.name)" :show="!!badge(t.name)" :max="99" :offset="[6, -2]"><span class="ti">{{ t.icon }}</span></NBadge>
                <span>{{ t.label }}</span>
              </button>
              <button @click="moreOpen = true"><span class="ti">☰</span><span>更多</span></button>
            </nav>
            <NDrawer v-model:show="moreOpen" placement="bottom" height="auto">
              <NDrawerContent title="更多">
                <div class="more-grid">
                  <button v-for="r in navRoutes" :key="r.name" @click="go(r.name)">{{ r.meta.title }}</button>
                  <button @click="moreOpen = false; store.captureOpen = true">随手记</button>
                </div>
              </NDrawerContent>
            </NDrawer>
          </div>

          <QuickCapture />
          <ImportDialog />
          <PaperDrawer />
        </NDialogProvider>
      </NMessageProvider>
    </NNotificationProvider>
  </NConfigProvider>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; background: var(--surface-warm); }
.side {
  width: 216px; flex: none; position: sticky; top: 12px; height: calc(100vh - 24px); margin: 12px 0 12px 12px; overflow-y: auto; padding: 20px 10px; background: var(--sidebar-bg);
  border-radius: 16px; display: flex; flex-direction: column;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px 18px; margin-bottom: 18px; cursor: pointer; }
.brand-mark { font: 600 38px Georgia, serif; color: var(--sidebar-ink); }
.brand-mark span { color: var(--brand-mark); }
.brand .name { font-family: var(--font-cute); font-size: 16px; font-weight: 600; color: var(--sidebar-ink); line-height: 1.5; }
.brand .sub { font-size: 8px; color: var(--sidebar-muted); letter-spacing: .7px; white-space: nowrap; }
.side-foot :deep(.chip) { max-width:100%; }
.side-foot :deep(.chip:not(.long)) { background:var(--surface-sand); color:var(--ink); border-color:transparent; }
.mobile-timer { position:fixed; right:14px; bottom:calc(88px + env(safe-area-inset-bottom)); z-index:29; max-width:calc(100vw - 28px); }
.side-foot { margin-top: auto; padding: 20px 4px 0; display:grid; gap:10px; }
.kbd { font-size: 11px; opacity: 0.6; margin-left: 6px; border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; }
.main { flex: 1; min-width: 0; background: var(--surface-warm); }
.capture-button { --n-color: var(--capture-bg) !important; --n-color-hover: var(--card) !important; --n-color-pressed: var(--capture-pressed) !important; --n-text-color: var(--capture-ink) !important; --n-text-color-hover: var(--capture-ink) !important; --n-text-color-pressed: var(--capture-ink) !important; --n-border: 1px solid transparent !important; --n-border-hover: 1px solid transparent !important; --n-border-pressed: 1px solid transparent !important; --n-height: 36px !important; }

.loading { text-align: center; padding-top: 18vh; }
.tabbar {
  position: fixed; left: 10px; right: 10px; bottom: max(10px, env(safe-area-inset-bottom)); z-index: 30; display: flex; background: var(--sidebar-bg); border-radius: 16px;
  padding: 5px; box-shadow: 0 4px 20px var(--shadow-ink);
}
.tabbar button { flex: 1; border: 0; background: none; padding: 6px 0; border-radius: 11px; display: flex; flex-direction: column; align-items: center; gap: 1px; font-size: 11px; color: var(--sidebar-muted); }
.tabbar button.on { color: var(--sidebar-active-ink); background: var(--sidebar-active-bg); font-weight: 600; }
.ti { font-size: 20px; line-height: 24px; }
.side :deep(:focus-visible), .tabbar button:focus-visible { outline-color: var(--sidebar-active-bg); }
.more-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding-bottom: 12px; }
.more-grid button { border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 10px 4px; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 12px; color: var(--ink); }
</style>

<script setup>
// 统一收件箱：随手记、候选论文、疑似重复、未整理的动态。这里的东西都不会自动变成待办。
import { reactive, ref, watch } from 'vue';
import { NButton, NInput, NModal, NSelect, NDropdown, NTabs, NTabPane } from 'naive-ui';
import { api } from '../lib/api';
import { store, changed, openPaper, openImport } from '../lib/store';
import { fail, toast } from '../lib/ui';
import { fmtDateTime, fmtDate, STATUS } from '../lib/format';
import Empty from '../components/Empty.vue';
import ItemPicker from '../components/ItemPicker.vue';

const d = ref(null);
const tab = ref('captures');
const quick = ref('');
async function load() {
  try {
    d.value = await api.get('/inbox');
  } catch (e) {
    fail(e);
  }
}
watch(() => store.version, load);
load();

async function addCapture() {
  if (!quick.value.trim()) return;
  await api.post('/captures', { content: quick.value });
  quick.value = '';
  changed();
}
async function setCapture(c, status, linked = {}) {
  await api.patch(`/captures/${c.id}`, { status, ...linked });
  changed();
}
const convertMenu = [
  { label: '→ 今天的任务', key: 'task' },
  { label: '→ 新 Idea', key: 'idea' },
  { label: '→ 导入为论文', key: 'paper' },
  { label: '→ 新项目 / 探索主题', key: 'project' },
];
async function convert(c, to) {
  try {
    const firstLine = c.content.split('\n')[0].slice(0, 80);
    if (to === 'task') {
      const t = await api.post('/tasks', { date: store.today, title: firstLine, note: c.content.length > 80 ? c.content : null });
      await setCapture(c, 'done', { linked_type: 'task', linked_id: t.id });
      toast('已加到今天的任务（计划外）');
    } else if (to === 'idea') {
      const i = await api.post('/ideas', { title: firstLine, content: c.content });
      await setCapture(c, 'done', { linked_type: 'idea', linked_id: i.id });
      toast('已变成 Idea');
    } else if (to === 'project') {
      const p = await api.post('/projects', { name: firstLine, question: c.content.length > 80 ? c.content : null });
      await setCapture(c, 'done', { linked_type: 'project', linked_id: p.id });
      toast('已建成项目');
    } else if (to === 'paper') {
      openImport({ text: c.content, source: { kind: 'paste', name: '随手记' }, defaults: { stage: 'candidate' } });
      await setCapture(c, 'done', { linked_type: 'paper' });
    }
  } catch (e) {
    fail(e);
  }
}

const accept = reactive({ open: false, paper: null, purpose: '', priority: null, depth: null, idea_id: null, project_id: null });
function openAccept(p) {
  Object.assign(accept, { open: true, paper: p, purpose: p.rec_reason || '', priority: null, depth: null, idea_id: null, project_id: null });
}
async function doAccept(withPlan) {
  const p = accept.paper;
  await api.post(`/papers/${p.id}/stage`, { stage: 'library', plan: withPlan ? { purpose: accept.purpose, priority: accept.priority, depth: accept.depth, idea_id: accept.idea_id, project_id: accept.project_id } : undefined });
  if (accept.project_id) await api.post(`/projects/${accept.project_id}/links`, { item_type: 'paper', item_id: p.id });
  if (accept.idea_id) await api.post(`/ideas/${accept.idea_id}/papers`, { paper_id: p.id });
  accept.open = false;
  toast('已放进正式清单');
  changed();
}
async function reject(p) {
  await api.post(`/papers/${p.id}/stage`, { stage: 'rejected' });
  toast('已拒绝：同一篇之后不会再出现在候选区');
  changed();
}
async function notDup(p) {
  await api.patch(`/papers/${p.id}`, { possible_dup_of: null });
  changed();
}
const opt = (k) => (store.settings?.options?.[k] || []).map((v) => ({ label: v, value: v }));
</script>

<template>
  <div class="page">
    <div class="page-head"><h1>📥 收件箱</h1><span class="muted small">这里的东西都不会自动变成待办，整理时再决定去向</span></div>
    <NTabs v-if="d" v-model:value="tab" type="segment" animated>
      <NTabPane name="captures" :tab="`随手记 ${d.captures.length}`">
        <div class="card">
          <div class="row"><NInput v-model:value="quick" placeholder="一个想法、一个链接…写完后点「放进来」" class="grow" /><NButton type="primary" @click="addCapture">放进来</NButton></div>
        </div>
        <Empty v-if="!d.captures.length" text="收件箱已清空" mood="happy" />
        <div v-for="c in d.captures" :key="c.id" class="card cap">
          <div class="content">{{ c.content }}</div>
          <div class="row" style="margin-top: 8px">
            <span class="muted small grow">{{ fmtDateTime(c.created_at) }}</span>
            <NDropdown :options="convertMenu" @select="(k) => convert(c, k)"><NButton size="small" type="primary" secondary>整理成…</NButton></NDropdown>
            <NButton size="small" @click="setCapture(c, 'done')">✓ 处理完了</NButton>
            <NButton size="small" quaternary @click="setCapture(c, 'archived')">归档</NButton>
          </div>
        </div>
      </NTabPane>

      <NTabPane name="candidates" :tab="`候选论文 ${d.candidates.length}`">
        <Empty v-if="!d.candidates.length" text="没有候选论文。从动态里提取、或导入时选「候选区」的论文会出现在这里。" />
        <div v-for="p in d.candidates" :key="p.id" class="card cand">
          <div class="row">
            <a class="grow ptitle" href="javascript:void 0" @click="openPaper(p.id)">{{ p.title }}</a>
            <span v-if="p.possible_dup_of" class="pill berry">疑似重复</span>
          </div>
          <div class="muted small" style="margin-top: 4px">{{ [p.venue, p.arxiv_id && 'arXiv ' + p.arxiv_id, p.rec_kind && '来自 ' + p.rec_kind, p.source_name].filter(Boolean).join(' · ') }}</div>
          <div v-if="p.rec_reason" class="small" style="margin-top: 4px">推荐理由：{{ p.rec_reason }}</div>
          <div v-else-if="p.summary" class="small clamp-2" style="margin-top: 4px">{{ p.summary }}</div>
          <div class="row" style="margin-top: 8px">
            <NButton size="small" type="primary" @click="openAccept(p)">放进清单…</NButton>
            <NButton size="small" @click="reject(p)">拒绝</NButton>
            <a v-if="p.url" :href="p.url" target="_blank" rel="noopener" class="small">打开原文 ↗</a>
          </div>
        </div>
      </NTabPane>

      <NTabPane name="dups" :tab="`疑似重复 ${d.dups.length}`">
        <Empty v-if="!d.dups.length" text="没有待确认的疑似重复" />
        <div v-for="p in d.dups" :key="p.id" class="card">
          <div class="small muted">这一条</div>
          <a href="javascript:void 0" @click="openPaper(p.id)">#{{ p.id }} {{ p.title }}</a>
          <div class="small muted" style="margin-top: 6px">可能和这一条是同一篇</div>
          <a href="javascript:void 0" @click="openPaper(p.possible_dup_of)">#{{ p.possible_dup_of }} {{ p.dup_title }}</a>
          <div class="row" style="margin-top: 8px"><NButton size="small" type="primary" @click="openPaper(p.id)">打开比较并合并</NButton><NButton size="small" @click="notDup(p)">不是同一篇</NButton></div>
        </div>
      </NTabPane>

      <NTabPane name="feeds" :tab="`未整理动态 ${d.feed_items.length}`">
        <Empty v-if="!d.feed_items.length" text="没有未整理的动态" />
        <div v-for="it in d.feed_items" :key="it.id" class="card row">
          <span class="grow"><b>{{ it.title }}</b><span class="muted small"> · {{ it.task_name || '手动上传' }} · {{ fmtDate(it.date) }}</span></span>
          <span class="pill" :class="{ sky: it.read_state === 'read' }">{{ it.read_state === 'read' ? '已读' : '未读' }}</span>
          <span class="pill tigger">{{ STATUS.triage[it.triage] }}</span>
          <RouterLink :to="{ name: 'feeds', query: { item: it.id } }"><NButton size="small">去整理</NButton></RouterLink>
        </div>
      </NTabPane>
    </NTabs>

    <NModal v-model:show="accept.open" preset="card" title="放进正式清单" style="width: min(540px, 95vw)">
      <div v-if="accept.paper" class="small" style="margin-bottom: 10px"><b>{{ accept.paper.title }}</b></div>
      <div class="form">
        <label>阅读原因</label><NInput v-model:value="accept.purpose" type="textarea" :autosize="{ minRows: 2 }" placeholder="为什么和当前工作相关" />
        <label>优先级</label><NSelect v-model:value="accept.priority" :options="opt('priorities')" clearable />
        <label>目标深度</label><NSelect v-model:value="accept.depth" :options="opt('depths')" clearable />
        <label>服务于 Idea</label><ItemPicker v-model="accept.idea_id" type="idea" />
        <label>项目</label><ItemPicker v-model="accept.project_id" type="project" />
      </div>
      <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="doAccept(false)">只入库，不建计划</NButton><NButton type="primary" @click="doAccept(true)">入库并建阅读计划</NButton></div></template>
    </NModal>
  </div>
</template>

<style scoped>
.cap .content { white-space: pre-wrap; word-break: break-word; font-size: 14.5px; }
.ptitle { color: var(--ink); font-weight: 600; }
.card { margin-top: 12px; }
.form { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.form > label { font-size: 13px; color: var(--ink-2); text-align: right; }
</style>

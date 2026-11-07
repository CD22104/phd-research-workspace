<script setup>
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NInput, NSelect, NDynamicTags, NSwitch, NModal, NPopconfirm, NDropdown, NRadioGroup, NRadioButton, NTooltip } from 'naive-ui';
import { api } from '../lib/api';
import { store, changed, openPaper } from '../lib/store';
import { fail, toast, confirm } from '../lib/ui';
import { STATUS, IDEA_TONE, fmtDateTime, fmtMin } from '../lib/format';
import MdEditor from '../components/MdEditor.vue';
import Md from '../components/Md.vue';
import ItemPicker from '../components/ItemPicker.vue';
import Empty from '../components/Empty.vue';
import Attachments from '../components/Attachments.vue';

const TEMPLATES = {
  idea: '## 一句话\n\n## 动机：为什么值得做\n\n## 核心想法\n\n## 和已有工作的区别\n\n## 怎么验证（最小实验）\n\n## 风险与可能的反例\n\n## 下一步\n',
  proposal: '## 背景与问题\n\n## 研究问题（RQ）\n\n## 相关工作与差距\n\n## 方法\n\n## 实验设计（数据、基线、指标）\n\n## 预期贡献\n\n## 风险与备选方案\n\n## 时间线\n',
};
const route = useRoute();
const router = useRouter();
const list = ref([]);
const filter = reactive({ status: null, kind: null });
const cur = ref(null);
const form = reactive({ title: '', one_liner: '', kind: 'idea', status: 'seed', priority: null, tags: [], project_id: null, no_llm: true, content: '' });
const version = ref(null);
const saveState = ref('saved');
const linkPaper = reactive({ id: null, relation: '相关工作' });
const reread = reactive({ open: false, paper: null, purpose: '', depth: '精读验证', focus_sections: '', criteria: '' });
const versionView = ref(null);
let timer = null;
let loadingDetail = false;

async function loadList() {
  try {
    list.value = (await api.get('/ideas')).ideas;
  } catch (e) {
    fail(e);
  }
}
async function loadDetail(id) {
  if (!id) {
    cur.value = null;
    return;
  }
  loadingDetail = true;
  try {
    cur.value = await api.get(`/ideas/${id}`);
    const i = cur.value.idea;
    Object.assign(form, { title: i.title, one_liner: i.one_liner || '', kind: i.kind, status: i.status, priority: i.priority, tags: i.tags, project_id: i.project_id, no_llm: !!i.no_llm, content: i.content || '' });
    version.value = i.version;
    saveState.value = 'saved';
  } catch (e) {
    fail(e);
  } finally {
    setTimeout(() => (loadingDetail = false), 0);
  }
}
watch(() => route.params.id, (id) => loadDetail(id ? Number(id) : null), { immediate: true });
watch(() => store.version, loadList);
loadList();

const shown = computed(() => list.value.filter((i) => (!filter.status || i.status === filter.status) && (!filter.kind || i.kind === filter.kind)));

// 自动保存：停止输入 2 秒后保存；不产生正式版本
watch(form, () => {
  if (loadingDetail || !cur.value) return;
  saveState.value = 'dirty';
  clearTimeout(timer);
  timer = setTimeout(save, 2000);
}, { deep: true });
onBeforeUnmount(() => { if (saveState.value === 'dirty') save(); });

async function save() {
  if (!cur.value) return;
  clearTimeout(timer);
  saveState.value = 'saving';
  try {
    const r = await api.patch(`/ideas/${cur.value.idea.id}`, { ...form, base_version: version.value });
    version.value = r.version;
    saveState.value = 'saved';
    const it = list.value.find((x) => x.id === r.id);
    if (it) Object.assign(it, { title: r.title, status: r.status, kind: r.kind, one_liner: r.one_liner });
  } catch (e) {
    saveState.value = 'dirty';
    if (e.status === 409 && e.data?.current) {
      const theirs = e.data.current;
      const overwrite = await confirm('版本冲突', `这个 Idea 在别处（${fmtDateTime(theirs.updated_at)}）被改过。「覆盖」用你现在的内容；「取消」会先把你的内容存成一个正式版本，再载入另一边的版本。`, '覆盖');
      if (overwrite) {
        version.value = theirs.version;
        return save();
      }
      await api.post('/versions', { entity: 'idea', entity_id: cur.value.idea.id, label: '冲突时保留的本地版本' }).catch(() => {});
      const mine = form.content;
      await loadDetail(cur.value.idea.id);
      navigator.clipboard?.writeText(mine);
      toast('已载入另一边的版本；你刚才的内容已复制到剪贴板', 'warning');
    } else fail(e);
  }
}

async function create(kind) {
  try {
    const r = await api.post('/ideas', { title: kind === 'proposal' ? '新 Proposal' : '新 Idea', kind, content: TEMPLATES[kind] });
    await loadList();
    router.push(`/ideas/${r.id}`);
  } catch (e) {
    fail(e);
  }
}
async function remove() {
  const a = cur.value.attachments?.length || 0;
  if (!(await confirm('删除这个 Idea？', `关联的论文不会被删除，只是解除关联。${a ? `它的 ${a} 个附件会一起删除，无法恢复。` : ''}`, '删除'))) return;
  await api.del(`/ideas/${cur.value.idea.id}`);
  router.push('/ideas');
  changed();
}
async function snapshot() {
  await save();
  const label = window.prompt('给这个版本起个名字（例如「给导师看的初稿」）', '');
  if (label === null) return;
  await api.post('/versions', { entity: 'idea', entity_id: cur.value.idea.id, label: label || null });
  toast('已存为正式版本');
  loadDetail(cur.value.idea.id);
}
async function viewVersion(id) {
  versionView.value = await api.get(`/versions/${id}`);
}
function restoreVersion() {
  form.content = versionView.value.content;
  versionView.value = null;
  toast('已恢复到该版本（会自动保存）');
}

async function addPaper() {
  if (!linkPaper.id) return;
  await api.post(`/ideas/${cur.value.idea.id}/papers`, { paper_id: linkPaper.id, relation: linkPaper.relation });
  linkPaper.id = null;
  loadDetail(cur.value.idea.id);
}
async function unlink(p) {
  await api.del(`/ideas/${cur.value.idea.id}/papers/${p.id}`);
  loadDetail(cur.value.idea.id);
}
function openReread(p) {
  Object.assign(reread, { open: true, paper: p, purpose: `为「${form.title}」核对`, depth: '精读验证', focus_sections: '', criteria: '' });
}
async function doReread() {
  await api.post(`/ideas/${cur.value.idea.id}/reread`, { paper_id: reread.paper.id, purpose: reread.purpose, depth: reread.depth, focus_sections: reread.focus_sections, criteria: reread.criteria });
  reread.open = false;
  toast('已新建一轮阅读计划');
  loadDetail(cur.value.idea.id);
  changed();
}
async function addTask(p) {
  await api.post('/tasks', { date: store.today, title: `为「${form.title}」读《${(p.short_name || p.title).slice(0, 40)}》`, paper_id: p.id, plan_id: p.reading.plan_id, idea_id: cur.value.idea.id, project_id: form.project_id });
  toast('已加入今日任务');
  changed();
}
const READ_TAG = { satisfied: ['已达到本 Idea 的阅读目标', 'leaf'], reading: ['在读（为本 Idea）', 'tigger'], planned: ['已计划（为本 Idea）', 'sky'], no_plan: ['还没有为本 Idea 读', 'eeyore'] };
const generalText = (g) => (g && g.state !== 'none' ? `一般阅读：${STATUS.reading[g.state]}${g.done_depth ? ' · ' + g.done_depth : ''}` : '');
const opt = (k) => (store.settings?.options?.[k] || []).map((v) => ({ label: v, value: v }));
const statusOpts = Object.entries(STATUS.idea).map(([value, label]) => ({ value, label }));
</script>

<template>
  <div class="page wide">
    <div class="layout">
      <aside class="list">
        <div class="row" style="margin-bottom: 10px">
          <NButton type="primary" size="small" @click="create('idea')">＋ Idea</NButton>
          <NButton size="small" @click="create('proposal')">＋ Proposal</NButton>
        </div>
        <div class="row" style="margin-bottom: 8px">
          <NSelect v-model:value="filter.status" :options="statusOpts" clearable placeholder="状态" size="small" style="flex: 1" />
          <NSelect v-model:value="filter.kind" :options="[{ label: 'Idea', value: 'idea' }, { label: 'Proposal', value: 'proposal' }]" clearable placeholder="类型" size="small" style="flex: 1" />
        </div>
        <Empty v-if="!list.length" text="还没有 Idea。有一点点想法也可以先记下来～" mood="happy" />
        <RouterLink v-for="i in shown" :key="i.id" :to="`/ideas/${i.id}`" class="item" :class="{ on: cur?.idea.id === i.id }">
          <div class="row"><b class="grow ellipsis">{{ i.kind === 'proposal' ? '📄 ' : '💡 ' }}{{ i.title }}</b><span class="pill" :class="IDEA_TONE[i.status]">{{ STATUS.idea[i.status] }}</span></div>
          <div v-if="i.one_liner" class="small muted clamp-2">{{ i.one_liner }}</div>
          <div class="small muted">关联 {{ i.paper_count }} 篇 · {{ i.satisfied_count }} 篇已读够 · {{ fmtDateTime(i.updated_at) }}</div>
        </RouterLink>
      </aside>

      <section class="detail">
        <Empty v-if="!cur" text="选一个 Idea，或者新建一个" mood="happy" />
        <template v-else>
          <div class="card">
            <div class="row">
              <NInput v-model:value="form.title" size="large" class="title-input grow" placeholder="标题" />
              <span class="small muted save">{{ { saved: '已保存', dirty: '未保存…', saving: '保存中…' }[saveState] }}</span>
            </div>
            <NInput v-model:value="form.one_liner" placeholder="一句话说清楚这个想法" style="margin-top: 8px" />
            <div class="meta">
              <NRadioGroup v-model:value="form.kind" size="small"><NRadioButton value="idea">Idea</NRadioButton><NRadioButton value="proposal">Proposal</NRadioButton></NRadioGroup>
              <NSelect v-model:value="form.status" :options="statusOpts" size="small" style="width: 110px" />
              <NSelect v-model:value="form.priority" :options="opt('priorities')" size="small" clearable placeholder="优先级" style="width: 96px" />
              <ItemPicker v-model="form.project_id" type="project" size="small" style="width: 180px" />
              <NDynamicTags v-model:value="form.tags" size="small" />
              <NTooltip><template #trigger><div class="row small"><NSwitch v-model:value="form.no_llm" size="small" />🔒 不发给外部模型</div></template>未公开的想法默认不会被发送给大模型</NTooltip>
            </div>
          </div>

          <div class="card">
            <div class="card-title">
              <h3>✍️ 正文</h3>
              <NDropdown v-if="cur.versions.length" :options="cur.versions.map((v) => ({ label: `${v.label || '未命名版本'} · ${fmtDateTime(v.created_at)}`, key: v.id }))" @select="viewVersion">
                <NButton size="small" quaternary>历史版本（{{ cur.versions.length }}）</NButton>
              </NDropdown>
              <NButton size="small" @click="snapshot">存为正式版本</NButton>
            </div>
            <MdEditor v-model="form.content" :min-rows="20" />
            <div class="muted small" style="margin-top: 6px">自动保存不会产生版本；需要留档（例如发给导师前）时点「存为正式版本」。在别的设备同时编辑时会提示冲突，不会悄悄覆盖。</div>
          </div>

          <div class="card">
            <Attachments owner-type="idea" :owner-id="cur.idea.id" />
          </div>

          <div class="card">
            <div class="card-title">
              <h3>关联论文</h3>
              <span class="small">关联 <b>{{ cur.papers.length }}</b> 篇；其中 <b>{{ cur.satisfied }}</b> 篇已完成本 Idea 所需的阅读目标</span>
            </div>
            <div v-for="p in cur.papers" :key="p.id" class="lp">
              <div class="row">
                <a class="grow" href="javascript:void 0" @click="openPaper(p.id)">{{ p.title }}</a>
                <span class="pill eeyore">{{ p.relation || '相关' }}</span>
              </div>
              <div class="row small" style="margin-top: 4px">
                <span class="pill" :class="READ_TAG[p.reading.state][1]">{{ READ_TAG[p.reading.state][0] }}{{ p.reading.depth ? ' · ' + p.reading.depth : '' }}</span>
                <span class="muted">{{ generalText(p.reading.general) }}</span>
                <span class="grow" />
                <NButton v-if="p.reading.state === 'no_plan' || p.reading.state === 'satisfied'" size="tiny" secondary @click="openReread(p)">为这个 Idea {{ p.reading.state === 'satisfied' ? '再' : '' }}读一次</NButton>
                <NButton v-if="p.reading.state === 'planned' || p.reading.state === 'reading'" size="tiny" secondary @click="addTask(p)">＋ 今日任务</NButton>
                <NPopconfirm @positive-click="unlink(p)"><template #trigger><NButton size="tiny" quaternary>移除</NButton></template>解除关联？</NPopconfirm>
              </div>
            </div>
            <div class="row" style="margin-top: 10px">
              <ItemPicker v-model="linkPaper.id" type="paper" size="small" style="flex: 1; min-width: 220px" />
              <NSelect v-model:value="linkPaper.relation" :options="opt('relations')" size="small" style="width: 110px" />
              <NButton size="small" @click="addPaper">关联</NButton>
            </div>
          </div>

          <div class="row small muted" style="margin-top: 10px">
            <span>创建于 {{ fmtDateTime(cur.idea.created_at) }} · v{{ version }}</span>
            <span v-if="cur.minutes">· 计时 {{ fmtMin(cur.minutes) }}</span>
            <span class="grow" />
            <NButton size="tiny" quaternary type="error" @click="remove">删除</NButton>
          </div>
        </template>
      </section>
    </div>

    <NModal v-model:show="reread.open" preset="card" title="为这个 Idea 读一次" style="width: min(520px, 95vw)">
      <div v-if="reread.paper" class="small" style="margin-bottom: 8px"><b>{{ reread.paper.title }}</b></div>
      <div class="form">
        <label>阅读原因</label><NInput v-model:value="reread.purpose" type="textarea" :autosize="{ minRows: 2 }" />
        <label>目标深度</label><NSelect v-model:value="reread.depth" :options="opt('depths')" />
        <label>重点章节</label><NInput v-model:value="reread.focus_sections" placeholder="例如 实验 §5、局限" />
        <label>完成标准</label><NInput v-model:value="reread.criteria" placeholder="例如 确认它的基线是否用了同一份数据" />
      </div>
      <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="reread.open = false">取消</NButton><NButton type="primary" @click="doReread">新建阅读计划</NButton></div></template>
    </NModal>

    <NModal :show="!!versionView" preset="card" :title="`版本：${versionView?.label || '未命名'}`" style="width: min(900px, 96vw)" @update:show="(v) => !v && (versionView = null)">
      <div class="muted small">{{ fmtDateTime(versionView?.created_at) }}</div>
      <div style="max-height: 60vh; overflow: auto"><Md :src="versionView?.content || ''" /></div>
      <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="versionView = null">关闭</NButton><NButton type="primary" @click="restoreVersion">恢复到这个版本</NButton></div></template>
    </NModal>
  </div>
</template>

<style scoped>
.page.wide { max-width: 1500px; }
.layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
.list { position: sticky; top: 76px; max-height: calc(100vh - 96px); overflow-y: auto; }
.item { display: block; padding: 10px 12px; border-radius: 12px; border: 1px solid transparent; color: var(--ink); text-decoration: none !important; margin-bottom: 4px; }
.item:hover { background: var(--card); border-color: var(--line); }
.item.on { background: var(--card); border-color: var(--honey); box-shadow: var(--shadow); }
.title-input :deep(input) { font-family: var(--font-cute); font-size: 20px; }
.save { white-space: nowrap; }
.meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.card-title { flex-wrap: wrap; row-gap: 4px; }
.card-title h3 { white-space: nowrap; }
.lp { padding: 8px 0; border-bottom: 1px dashed var(--line-soft); }
.lp a { color: var(--ink); font-weight: 500; }
.form { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.form > label { font-size: 13px; color: var(--ink-2); text-align: right; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .list { position: static; max-height: none; } }
</style>

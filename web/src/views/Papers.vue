<script setup>
import { useRoute } from 'vue-router';
import PaperGroups from '../components/PaperGroups.vue';
import { computed, h, reactive, ref, watch } from 'vue';
import { NButton, NInput, NSelect, NDataTable, NRadioGroup, NRadioButton, NModal, NUpload, NCheckbox, NSwitch, NTag, NDropdown } from 'naive-ui';
import { api, uuid } from '../lib/api';
import { store, changed, openPaper, openImport } from '../lib/store';
import { fail, toast } from '../lib/ui';
import { STATUS, READING_TONE, fmtMin, readingLabel, readFileText, hasRead, paperReadLabel } from '../lib/format';
import ItemPicker from '../components/ItemPicker.vue';
import Empty from '../components/Empty.vue';
import { MATERIAL, VERIFIED, bibliographic } from '../lib/paper-meta';

const route = useRoute();
const manageGroups = ref(false);
const papers = ref([]);
const loading = ref(false);
const mobile = window.innerWidth < 800;
const view = ref(mobile ? 'list' : localStorage.getItem('papers-view') || 'table');
const showFilters = ref(!mobile);
const groupBy = ref(localStorage.getItem('papers-group') || 'collection');
const sortBy = ref('added');
const f = reactive({ q: '', reading: [], collection: [], side: [], priority: [], tag: [], rec: [], project: null, candidates: false });
watch(() => route.query.group, value => { f.collection = typeof value === 'string' ? [value] : []; }, { immediate: true });
watch(view, (v) => { if (!mobile) localStorage.setItem('papers-view', v); });
watch(groupBy, (v) => localStorage.setItem('papers-group', v));

async function load() {
  loading.value = true;
  try {
    papers.value = (await api.get('/papers')).papers;
  } catch (e) {
    fail(e);
  } finally {
    loading.value = false;
  }
}
watch(() => store.version, load);
load();

const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort().map((v) => ({ label: v, value: v }));
const opts = computed(() => ({
  collection: uniq([...store.paperGroups.map(g => g.name), ...papers.value.map((p) => p.collection)]),
  side: uniq(papers.value.map((p) => p.side)),
  tag: uniq(papers.value.flatMap((p) => p.tags)),
  rec: uniq(papers.value.flatMap((p) => p.rec_kinds)),
  priority: ['P0', 'P1', 'P2', 'P3'].map((v) => ({ label: v, value: v })),
  reading: Object.entries(STATUS.reading).map(([value, label]) => ({ label, value })),
}));

const PRIO = { P0: 0, P1: 1, P2: 2, P3: 3 };
const filtered = computed(() => {
  const q = f.q.trim().toLowerCase();
  let list = papers.value.filter((p) => (f.candidates ? true : p.stage === 'library'));
  if (q) list = list.filter((p) => [p.title, p.short_name, p.authors, p.venue, p.direction, p.summary, p.arxiv_id, p.team, ...(p.tags || [])].some((x) => x && String(x).toLowerCase().includes(q)));
  if (f.reading.length) list = list.filter((p) => f.reading.includes(p.reading.state));
  if (f.collection.length) list = list.filter((p) => f.collection.includes(p.collection));
  if (f.side.length) list = list.filter((p) => f.side.includes(p.side));
  if (f.priority.length) list = list.filter((p) => f.priority.includes(p.reading.priority));
  if (f.tag.length) list = list.filter((p) => f.tag.some((t) => p.tags.includes(t)));
  if (f.rec.length) list = list.filter((p) => f.rec.some((t) => p.rec_kinds.includes(t)));
  if (f.project) list = list.filter((p) => p.project_ids.includes(f.project));
  const cmp = {
    added: (a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')) || b.id - a.id,
    published: (a, b) => String(b.published_date || '').localeCompare(String(a.published_date || '')),
    priority: (a, b) => (PRIO[a.reading.priority] ?? 9) - (PRIO[b.reading.priority] ?? 9),
    title: (a, b) => a.title.localeCompare(b.title),
    minutes: (a, b) => (b.minutes || 0) - (a.minutes || 0),
  }[sortBy.value];
  return [...list].sort(cmp);
});
const activeFilters = computed(() => ['reading', 'collection', 'side', 'priority', 'tag', 'rec'].reduce((n, k) => n + f[k].length, 0) + (f.project ? 1 : 0) + (f.q ? 1 : 0));
function clearFilters() {
  Object.assign(f, { q: '', reading: [], collection: [], side: [], priority: [], tag: [], rec: [], project: null });
}

const GROUPS = [
  { label: '按论文组', value: 'collection' }, { label: '按阅读状态', value: 'reading' }, { label: '按优先级', value: 'priority' },
  { label: '按侧重', value: 'side' }, { label: '按研究问题', value: 'direction' }, { label: '按推荐来源', value: 'rec' }, { label: '不分组', value: 'none' },
];
const groupKey = (p) => ({
  collection: p.collection || '未分组', reading: STATUS.reading[p.reading.state], priority: p.reading.priority || '未定优先级',
  side: p.side || '未分侧重', direction: p.direction || '未写研究问题', rec: p.rec_kinds[0] || '未知来源',
}[groupBy.value]);
const collapsed = ref(new Set());
const pinned = computed(() => store.settings?.pinned_collections || []);
const pinBusy = ref(false);
async function togglePin(k) {
  if (pinBusy.value) return;
  pinBusy.value = true;
  try {
    const next = pinned.value.includes(k) ? pinned.value.filter(v => v !== k) : [...pinned.value, k];
    store.settings = await api.put('/settings', { pinned_collections: next });
    toast(next.includes(k) ? '论文组已置顶' : '已取消置顶');
  } catch (e) { fail(e); } finally { pinBusy.value = false; }
}
function pinOrder(a, b) {
  if (groupBy.value !== 'collection') return 0;
  const ai = pinned.value.indexOf(a), bi = pinned.value.indexOf(b);
  return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
}

const rows = computed(() => {
  if (groupBy.value === 'none') return filtered.value;
  const m = new Map();
  for (const p of filtered.value) {
    const k = groupKey(p);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p);
  }
  if (groupBy.value === 'collection' && !f.q && !f.reading.length && !f.side.length && !f.priority.length && !f.tag.length && !f.rec.length && !f.project) {
    for (const g of store.paperGroups) if (!m.has(g.name) && !papers.value.some(p => p.collection === g.name) && (!f.collection.length || f.collection.includes(g.name))) m.set(g.name, []);
  }
  const order = groupBy.value === 'priority' ? (a, b) => (PRIO[a] ?? 9) - (PRIO[b] ?? 9) : groupBy.value === 'reading' ? (a, b) => Object.values(STATUS.reading).indexOf(a) - Object.values(STATUS.reading).indexOf(b) : () => 0;
  const out = [];
  for (const [k, list] of [...m.entries()].sort(([a], [b]) => pinOrder(a, b) || order(a, b))) {
    out.push({ id: 'g:' + k, group: k, count: list.length });
    if (!collapsed.value.has(k)) out.push(...list);
  }
  return out;
});
function toggleGroup(k) {
  const s2 = new Set(collapsed.value);
  s2.has(k) ? s2.delete(k) : s2.add(k);
  collapsed.value = s2;
}

const pill = (text, tone = '') => h('span', { class: 'pill ' + tone }, text);
const columns = [
  {
    title: '论文', key: 'title', width: 440, fixed: 'left',
    render: (r) => r.group !== undefined
      ? h('span', { class: 'grp', onClick: () => toggleGroup(r.group) }, [h('span', { class: 'caret' }, collapsed.value.has(r.group) ? '▸' : '▾'), h('b', r.group), h('span', { class: 'muted small' }, ` ${r.count} 篇`), groupBy.value === 'collection' ? h('button', { class: 'pin-button', 'data-pin': r.group, 'aria-pressed': pinned.value.includes(r.group), disabled: pinBusy.value, onClick: e => { e.stopPropagation(); togglePin(r.group); } }, pinned.value.includes(r.group) ? '取消置顶' : '置顶') : null])
      : h('div', { class: 'tcell' }, [
          h('a', { class: 'ptitle', href: 'javascript:void 0', onClick: () => openPaper(r.id), title: r.title }, r.title),
          h('div', { class: 'paper-meta small muted' }, bibliographic(r)),
          h('div', { class: 'paper-focus small muted' }, r.reading.target_focus ? `阅读重点：${r.reading.target_focus}` : ''),
          h('span', { class: 'icons' }, [
            pill(MATERIAL[r.material_type] || MATERIAL.unknown),
            r.verification_status !== 'verified' ? pill(VERIFIED[r.verification_status] || VERIFIED.unverified) : null,
            r.stage === 'candidate' ? pill('候选', 'tigger') : null,
            r.possible_dup_of ? pill('疑似重复', 'berry') : null,
            r.notes_count ? h('span', { title: `${r.notes_count} 篇笔记` }, '📝') : null,
            r.ideas_count ? h('span', { title: `关联 ${r.ideas_count} 个 Idea` }, '💡') : null,
          ]),
        ]),
  },
  { title: '阅读', key: 'reading', width: 170, render: (r) => r.group !== undefined ? null : pill(readingLabel(r.reading), READING_TONE[r.reading.state]) },
  { title: '优先级', key: 'prio', width: 72, render: (r) => (r.reading?.priority ? pill(r.reading.priority, r.reading.priority === 'P0' ? 'piglet' : '') : null) },
  { title: '侧重', key: 'side', width: 80, render: (r) => (r.side ? pill(r.side, r.side === '安全侧' ? 'sky' : r.side === '能力侧' ? 'leaf' : 'eeyore') : null) },
  { title: '主题标签', key: 'tags', width: 180, render: (r) => (r.tags ? h('div', { class: 'tags' }, r.tags.slice(0, 3).map((t) => pill(t))) : null) },
  { title: '研究问题', key: 'direction', width: 200, ellipsis: { tooltip: true } },
  { title: '发表地', key: 'venue', width: 120, ellipsis: { tooltip: true } },
  { title: '发布', key: 'published_date', width: 96 },
  { title: '加入', key: 'added_at', width: 96 },
  { title: '推荐来源', key: 'rec', width: 110, render: (r) => (r.rec_kinds ? r.rec_kinds.join('、') : null) },
  { title: '工时', key: 'minutes', width: 80, render: (r) => (r.minutes ? fmtMin(r.minutes) : r.group !== undefined ? null : '') },
];

const BOARD = [
  { key: 'none', title: '未计划' }, { key: 'planned', title: '待读' }, { key: 'reading', title: '在读' },
  { key: 'done', title: '已读', also: ['done_more'] }, { key: 'dropped', title: '放弃' },
];
const board = computed(() => BOARD.map((c) => ({ ...c, items: filtered.value.filter((p) => p.reading.state === c.key || c.also?.includes(p.reading.state)) })));

// ───── 手动添加 ─────
const add = reactive({ open: false, title: '', url: '', collection: null, rec_kind: null, recommender: '', purpose: '', priority: null, depth: null, stage: 'library' });
async function doAdd() {
  if (!add.title && !add.url) return fail(new Error('至少填写标题或链接'));
  try {
    const r = await api.post('/papers', {
      title: add.title || undefined, url: add.url || undefined, collection: add.collection, rec_kind: add.rec_kind, recommender: add.recommender || undefined,
      defaults: { stage: add.stage, create_plan: add.stage === 'library', purpose: add.purpose, priority: add.priority, depth: add.depth },
      source: { kind: 'manual', name: add.rec_kind ? `${add.rec_kind}推荐` : '手动添加' },
    });
    if (r.skipped) toast(r.note || '已跳过', 'warning');
    else if (r.merged?.length) toast('这篇已经在清单里了：记下了一条新的推荐记录', 'info');
    else if (r.candidates?.length && r.match) toast('疑似与已有论文重复，已放进候选区等你确认', 'warning');
    else toast('已添加');
    Object.assign(add, { open: false, title: '', url: '', purpose: '' });
    changed();
    const id = r.created?.[0] || r.merged?.[0] || r.candidates?.[0];
    if (id) openPaper(id);
  } catch (e) {
    fail(e);
  }
}

// ───── 批量上传笔记 ─────
const up = reactive({ open: false, files: [], busy: false });
async function pickNotes({ fileList }) {
  const files = await Promise.all(fileList.map(async (fi) => ({ filename: fi.name, text: await readFileText(fi.file) })));
  up.busy = true;
  try {
    const r = await api.post('/notes/match', { files: files.map((x) => ({ filename: x.filename, text: x.text.slice(0, 3000) })) });
    up.files = files.map((x, i) => {
      const m = r.matches[i];
      return { ...x, paper_id: m.paper_id, confidence: m.confidence, why: m.why, use: m.confidence === 'high', label: papers.value.find((p) => p.id === m.paper_id)?.title };
    });
  } catch (e) {
    fail(e);
  } finally {
    up.busy = false;
  }
}
async function saveNotes() {
  let n = 0;
  for (const x of up.files.filter((x) => x.use && x.paper_id)) {
    await api.post('/notes', { paper_id: x.paper_id, title: x.filename.replace(/\.(md|markdown|txt)$/i, ''), filename: x.filename, content: x.text });
    n++;
  }
  toast(`已上传 ${n} 篇笔记`);
  Object.assign(up, { open: false, files: [] });
  changed();
}
async function enrichAll() {
  try {
    const r = await api.post('/papers/enrich', {});
    toast(`检查了 ${r.checked} 篇有 arXiv 号但缺信息的论文，补全 ${r.results.filter((x) => x.changed.length).length} 篇`);
    changed();
  } catch (e) {
    fail(e);
  }
}
const moreMenu = [{ label: '批量上传阅读笔记', key: 'notes' }, { label: '从 arXiv 补全缺失信息', key: 'enrich' }];
function onMore(k) {
  if (k === 'notes') up.open = true;
  else enrichAll();
}
const optList = (k) => (k === 'collections' ? store.paperGroups.map(g => g.name) : store.settings?.options?.[k] || []).map((v) => ({ label: v, value: v }));
</script>

<template>
  <div class="page wide">
    <div class="page-head">
      <NInput v-model:value="f.q" placeholder="搜索标题、作者、标签、研究问题…" clearable style="max-width: 320px" />
      <NRadioGroup v-model:value="view" size="small"><NRadioButton v-if="mobile" value="list">列表</NRadioButton><NRadioButton v-else value="table">表格</NRadioButton><NRadioButton value="board">看板</NRadioButton></NRadioGroup>
      <NButton v-if="mobile" size="small" @click="showFilters = !showFilters">筛选{{ activeFilters ? ` (${activeFilters})` : '' }}</NButton>
      <NSelect v-if="view !== 'board'" v-model:value="groupBy" :options="GROUPS" size="small" style="width: 130px" />
      <NSelect v-model:value="sortBy" size="small" style="width: 120px" :options="[{ label: '最近加入', value: 'added' }, { label: '发布时间', value: 'published' }, { label: '优先级', value: 'priority' }, { label: '工时', value: 'minutes' }, { label: '标题', value: 'title' }]" />
      <span class="grow" />
      <NButton size="small" @click="manageGroups = true">论文组</NButton>
      <NButton size="small" @click="add.open = true">＋ 添加</NButton>
      <NDropdown :options="moreMenu" @select="onMore"><NButton size="small">更多 ▾</NButton></NDropdown>
      <NButton size="small" type="primary" @click="openImport()">导入论文</NButton>
    </div>
    <div v-show="showFilters" class="filters">
      <NSelect v-model:value="f.reading" multiple :options="opts.reading" placeholder="阅读状态" size="small" clearable max-tag-count="responsive" />
      <NSelect v-model:value="f.collection" multiple :options="opts.collection" placeholder="论文组" size="small" clearable max-tag-count="responsive" />
      <NSelect v-model:value="f.priority" multiple :options="opts.priority" placeholder="优先级" size="small" clearable max-tag-count="responsive" />
      <NSelect v-model:value="f.side" multiple :options="opts.side" placeholder="侧重" size="small" clearable max-tag-count="responsive" />
      <NSelect v-model:value="f.tag" multiple :options="opts.tag" placeholder="主题标签" size="small" clearable filterable max-tag-count="responsive" />
      <NSelect v-model:value="f.rec" multiple :options="opts.rec" placeholder="推荐来源" size="small" clearable max-tag-count="responsive" />
      <ItemPicker v-model="f.project" type="project" size="small" />
      <div class="row small"><NSwitch v-model:value="f.candidates" size="small" />含候选</div>
    </div>
    <div class="row small muted" style="margin: 8px 2px">
      共 {{ filtered.length }} 篇<template v-if="activeFilters"> · 已筛选 <a href="javascript:void 0" @click="clearFilters">清除</a></template>
      <span class="grow" />
      <span><span class="read-legend" aria-hidden="true" /> 绿灰底表示已读；可另建重读计划</span>
    </div>

    <Empty v-if="!loading && !papers.length && !store.paperGroups.length" text="论文清单还是空的。可以导入飞书导出的 CSV，或粘贴对话里的推荐。" mood="happy">
      <NButton type="primary" @click="openImport()">导入论文</NButton>
    </Empty>
    <NDataTable v-else-if="view === 'table'" :columns="columns" :data="rows" :row-key="(r) => r.id"
      :loading="loading" size="small" :scroll-x="1664" :max-height="'calc(100vh - 250px)'" :row-class-name="(r) => (r.group !== undefined ? 'group-row' : hasRead(r) ? 'paper-read' : '')" />
    <div v-else-if="view === 'list'" class="mlist">
      <template v-for="r in rows" :key="r.id">
        <div v-if="r.group !== undefined" class="mgroup" @click="toggleGroup(r.group)">{{ collapsed.has(r.group) ? '▸' : '▾' }} {{ r.group }} <span class="muted small">{{ r.count }}</span><button v-if="groupBy === 'collection'" class="pin-button" :data-pin="r.group" :aria-pressed="pinned.includes(r.group)" :disabled="pinBusy" @click.stop="togglePin(r.group)">{{ pinned.includes(r.group) ? '取消置顶' : '置顶' }}</button></div>
        <div v-else class="pcard" :class="{ 'paper-read': hasRead(r) }" @click="openPaper(r.id)">
          <div class="clamp-2">{{ r.title }}</div><div class="paper-meta small muted">{{ bibliographic(r) }}</div><div v-if="r.reading.target_focus" class="paper-focus small muted">阅读重点：{{ r.reading.target_focus }}</div>
          <div class="row" style="margin-top: 5px">
            <span class="pill" :class="READING_TONE[r.reading.state]">{{ readingLabel(r.reading) }}</span>
            <span v-if="r.reading.priority" class="pill piglet">{{ r.reading.priority }}</span>
            <span class="pill">{{ MATERIAL[r.material_type] || MATERIAL.unknown }}</span><span v-if="r.verification_status !== 'verified'" class="pill">{{ VERIFIED[r.verification_status] || VERIFIED.unverified }}</span>
            <span v-if="r.notes_count">📝</span>
          </div>
        </div>
      </template>
    </div>
    <div v-else class="board">
      <div v-for="col in board" :key="col.key" class="col">
        <div class="col-head"><b>{{ col.title }}</b><span class="muted small">{{ col.items.length }}</span></div>
        <div v-for="p in col.items" :key="p.id" class="pcard" :class="{ 'paper-read': hasRead(p) }" @click="openPaper(p.id)">
          <div class="clamp-2">{{ p.title }}</div><div class="paper-meta small muted">{{ bibliographic(p) }}</div>
          <div class="row" style="margin-top: 5px">
            <span v-if="hasRead(p)" class="pill read">{{ paperReadLabel(p) }}</span>
            <span v-if="p.reading.priority" class="pill piglet">{{ p.reading.priority }}</span>
            <span v-if="p.reading.target_depth || p.reading.done_depth" class="pill">{{ p.reading.target_depth || p.reading.done_depth }}</span>
            <span v-if="p.collection" class="pill eeyore">{{ p.collection }}</span>
            <span v-if="p.notes_count">📝</span>
          </div>
        </div>
      </div>
    </div>

    <PaperGroups v-model:show="manageGroups" />
    <NModal v-model:show="add.open" preset="card" title="手动添加论文" style="width: min(560px, 95vw)">
      <div class="form">
        <label>标题</label><NInput v-model:value="add.title" placeholder="只写链接也可以，会自动从 arXiv 补全" />
        <label>链接</label><NInput v-model:value="add.url" placeholder="arXiv / 论文页面" />
        <label>推荐来源</label><NSelect v-model:value="add.rec_kind" :options="optList('rec_kinds')" clearable tag />
        <label>推荐人</label><NInput v-model:value="add.recommender" placeholder="可空" />
        <label>论文组</label><NSelect v-model:value="add.collection" :options="optList('collections')" clearable tag filterable />
        <label>放进</label><NRadioGroup v-model:value="add.stage" size="small"><NRadioButton value="library">正式清单</NRadioButton><NRadioButton value="candidate">候选区</NRadioButton></NRadioGroup>
        <template v-if="add.stage === 'library'">
          <label>阅读原因</label><NInput v-model:value="add.purpose" placeholder="为什么和当前工作相关" />
          <label>优先级</label><NSelect v-model:value="add.priority" :options="optList('priorities')" clearable />
          <label>目标深度</label><NSelect v-model:value="add.depth" :options="optList('depths')" clearable />
        </template>
      </div>
      <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="add.open = false">取消</NButton><NButton type="primary" @click="doAdd">添加</NButton></div></template>
    </NModal>

    <NModal v-model:show="up.open" preset="card" title="批量上传阅读笔记" style="width: min(860px, 96vw)">
      <div class="muted small" style="margin-bottom: 8px">
        按文件内容匹配论文：文件开头写 <code>---\npaper_id: 12\n---</code> 或 <code>arxiv: 2210.03629</code> 最准确；只靠文件名匹配、相似度不高的，需要你确认后才会上传。
      </div>
      <NUpload multiple accept=".md,.markdown,.txt" :default-upload="false" :show-file-list="false" @change="pickNotes"><NButton>选择 .md 文件</NButton></NUpload>
      <div v-for="x in up.files" :key="x.filename" class="row match">
        <NCheckbox v-model:checked="x.use" :disabled="!x.paper_id" />
        <span class="fname ellipsis" :title="x.filename">{{ x.filename }}</span>
        <ItemPicker v-model="x.paper_id" type="paper" :label="x.label" size="small" style="flex: 1; min-width: 200px" @pick="() => (x.use = true)" />
        <NTag size="small" :type="x.confidence === 'high' ? 'success' : x.confidence === 'low' ? 'warning' : 'default'" :bordered="false">{{ { high: '高置信', low: '待确认', none: '未匹配' }[x.confidence] }}</NTag>
        <span class="muted small">{{ x.why }}</span>
      </div>
      <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="up.open = false">取消</NButton><NButton type="primary" :disabled="!up.files.some((x) => x.use && x.paper_id)" @click="saveNotes">上传选中的 {{ up.files.filter((x) => x.use && x.paper_id).length }} 篇</NButton></div></template>
    </NModal>
  </div>
</template>

<style scoped>
:deep(.paper-read td) { background:var(--read-bg) !important; border-bottom-color:var(--read-line) !important; }
:deep(.paper-read:hover td) { background:var(--read-hover) !important; }
:deep(.paper-read td:first-child) { box-shadow:inset 3px 0 var(--read-accent); }
:deep(.paper-read .ptitle) { color:var(--read-ink); }
.pcard.paper-read { background:var(--read-bg); border-color:var(--read-line); }
.pcard.paper-read:hover { background:var(--read-hover); }
.read-legend { display:inline-block; width:11px; height:11px; border-radius:3px; margin-right:4px; background:var(--read-bg); border:1px solid var(--read-line); vertical-align:-1px; }

:deep(.pin-button), .pin-button { margin-left: auto; padding: 2px 8px; border: 1px solid transparent; border-radius: 7px; background: white; font: inherit; font-size: 12px; color: var(--ink-2); white-space: nowrap; }
:deep(.pin-button[aria-pressed="true"]), .pin-button[aria-pressed="true"] { color: var(--honey-deep); background: var(--honey-mist); }
:deep(.paper-meta), .paper-meta { margin-top: 5px; line-height: 1.5; overflow-wrap: anywhere; }
:deep(.paper-focus), .paper-focus { margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.page.wide { max-width: 1600px; }
.filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
:deep(.group-row td) { background: var(--group-bg) !important; color: var(--group-ink); border-bottom-color: var(--group-line) !important; }
:deep(.group-row .muted), :deep(.group-row .caret) { color: var(--group-muted); }
:deep(.group-row .pin-button) { color: var(--accent-deep); background: var(--chip-on-tint); border-color: transparent; }
:deep(.group-row .pin-button[aria-pressed="true"]) { background: var(--sand); color: var(--ink); border-color: var(--sand); }
:deep(.grp b) { font-family: var(--font-cute); font-size: 15px; font-weight: 650; color: var(--group-ink); }
:deep(.tcell) { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 0; text-align: left; }
:deep(.tcell .paper-meta) { width: 100%; margin-top: 0; }
:deep(.tcell .paper-focus:empty) { display: none; }
:deep(.grp) { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
:deep(.grp b) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:deep(.grp .muted), :deep(.caret) { flex-shrink: 0; }
:deep(.caret) { display: inline-block; width: 18px; color: var(--ink-3); }
:deep(.ptitle) { color: var(--ink); width: 100%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.5; }
:deep(.ptitle:hover) { color: var(--honey-deep); }
:deep(.icons) { display: inline-flex; flex-wrap: wrap; gap: 4px; flex: none; }
:deep(.tags) { display: flex; gap: 3px; overflow: hidden; }
.mgroup { background: var(--group-bg); color: var(--group-ink); font-weight: 650; padding: 13px 14px; border-radius: 11px; display: flex; align-items: center; gap: 8px; font-family: var(--font-cute); font-size: 16px; margin: 14px 2px 6px; cursor: pointer; }
.mgroup .muted { color: var(--group-muted); }
.mgroup .pin-button { color: var(--accent-deep); border-color: transparent; background: var(--chip-on-tint); }
.mgroup .pin-button[aria-pressed="true"] { color: var(--ink); border-color: var(--sand); background: var(--sand); }
.board { display: grid; grid-template-columns: repeat(5, minmax(220px, 1fr)); gap: 12px; overflow-x: auto; padding-bottom: 10px; }
.col { background: var(--surface-muted); border-radius: 12px; padding: 12px; min-height: 200px; }
.col-head { color: var(--accent-deep); font-weight: 600; padding: 4px 2px 10px; display: flex; justify-content: space-between; margin-bottom: 8px; font-family: var(--font-cute); }
.pcard { background: var(--card); border: 1px solid var(--line-soft); border-radius: 10px; padding: 16px; margin-bottom: 8px; cursor: pointer; font-size: 13.5px; }
.pcard:hover { box-shadow: var(--shadow-lg); }
.form { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.form > label { font-size: 13px; color: var(--ink-2); text-align: right; }
.match { padding: 6px 0; border-bottom: 1px dashed var(--line-soft); }
.fname { width: 180px; font-size: 13px; }
</style>

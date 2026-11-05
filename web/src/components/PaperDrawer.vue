<script setup>
// 论文详情：资料 / 阅读（计划 + 记录）/ 笔记 / 关联 / 溯源
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  NDrawer, NDrawerContent, NTabs, NTabPane, NInput, NSelect, NButton, NDynamicTags, NDatePicker, NAlert, NPopconfirm,
  NCollapse, NCollapseItem, NTimeline, NTimelineItem, NSpin, NModal, NUpload,
} from 'naive-ui';
import { api } from '../lib/api';
import { store, changed, openPaper } from '../lib/store';
import { fail, toast, confirm } from '../lib/ui';
import { STATUS, READING_TONE, fmtMin, fmtDateTime, readingLabel, readFileText } from '../lib/format';
import { startTimer, isRunning, stopTimer } from '../lib/timer';
import Md from './Md.vue';
import ItemPicker from './ItemPicker.vue';
import { MATERIAL, VERIFIED } from '../lib/paper-meta';

const router = useRouter();
const data = ref(null);
const loading = ref(false);
const tab = ref('info');
const form = reactive({});
const show = computed({ get: () => !!store.paperId, set: (v) => { if (!v) store.paperId = null; } });
const width = computed(() => (window.innerWidth < 800 ? '100%' : 780));

const FIELDS = ['title', 'short_name', 'authors', 'team', 'venue', 'published_date', 'url', 'pdf_url', 'code_url', 'arxiv_id', 'doi', 'collection', 'side', 'direction', 'tags', 'summary', 'abstract', 'my_note', 'my_question', 'material_type'];
const FIELD_LABEL = {
  title: '标题', short_name: '简称', authors: '作者', team: '主要团队', venue: '发表地', published_date: '发布日期', url: '链接', pdf_url: 'PDF', code_url: '代码',
  arxiv_id: 'arXiv', doi: 'DOI', collection: '论文组', side: '侧重', direction: '研究问题', tags: '主题标签', summary: '简介', abstract: '摘要', my_note: '我的备注',
  material_type: '资料类型', verification_status: '核验状态', verification_note: '核验说明', verified_at: '核验日期', my_question: '我的问题', stage: '位置', links: '其他链接', possible_dup_of: '疑似重复', added_at: '加入日期',
};
const opt = (k) => (store.settings?.options?.[k] || []).map((v) => ({ label: v, value: v }));

async function load() {
  if (!store.paperId) return;
  loading.value = true;
  try {
    data.value = await api.get(`/papers/${store.paperId}`);
    for (const f of FIELDS) form[f] = data.value.paper[f] ?? (f === 'tags' ? [] : '');
  } catch (e) {
    fail(e);
    store.paperId = null;
  } finally {
    loading.value = false;
  }
}
watch(() => store.paperId, (id) => { if (id) { tab.value = 'info'; load(); } });

const dirty = computed(() => data.value && FIELDS.filter((f) => JSON.stringify(form[f] ?? '') !== JSON.stringify(data.value.paper[f] ?? (f === 'tags' ? [] : ''))));
async function save() {
  const patch = {};
  for (const f of dirty.value) patch[f] = form[f];
  try {
    await api.patch(`/papers/${store.paperId}`, patch);
    toast('已保存');
    await load();
    changed();
  } catch (e) {
    fail(e);
  }
}

const enriching = ref(false);
const enrichConflicts = ref([]);
async function enrich() {
  enriching.value = true;
  try {
    const r = await api.post(`/papers/${store.paperId}/enrich`);
    if (!r.found) toast('arXiv 上没有找到足够匹配的论文', 'warning');
    else {
      toast(`从 ${r.origin} 补了 ${Object.keys(r.changed).length} 个字段`);
      enrichConflicts.value = r.conflicts || [];
    }
    await load();
    changed();
  } catch (e) {
    fail(e);
  } finally {
    enriching.value = false;
  }
}
async function acceptConflict(c) {
  await api.patch(`/papers/${store.paperId}`, { [c.field]: c.new, origin: 'arXiv API（确认替换）' });
  enrichConflicts.value = enrichConflicts.value.filter((x) => x !== c);
  load();
}

// ───── 阅读计划 ─────
const planForm = reactive({ open: false, id: null, purpose: '', priority: null, depth: null, focus_sections: '', criteria: '', due_date: null, idea_id: null, project_id: null });
function editPlan(p = null) {
  Object.assign(planForm, { open: true, id: p?.id ?? null, purpose: p?.purpose || '', priority: p?.priority || null, depth: p?.depth || null, focus_sections: p?.focus_sections || '', criteria: p?.criteria || '', due_date: p?.due_date ? Date.parse(p.due_date) : null, idea_id: p?.idea_id ?? null, project_id: p?.project_id ?? null });
}
async function savePlan() {
  const b = { ...planForm, due_date: planForm.due_date ? new Date(planForm.due_date).toISOString().slice(0, 10) : null };
  delete b.open;
  delete b.id;
  try {
    if (planForm.id) await api.patch(`/plans/${planForm.id}`, b);
    else await api.post('/plans', { ...b, paper_id: store.paperId });
    planForm.open = false;
    await load();
    changed();
  } catch (e) {
    fail(e);
  }
}
async function setPlanStatus(p, status) {
  try {
    await api.patch(`/plans/${p.id}`, { status });
    await load();
    changed();
  } catch (e) {
    fail(e);
  }
}
async function delPlan(p) {
  await api.del(`/plans/${p.id}`);
  load();
  changed();
}
async function addTodayTask(p) {
  try {
    await api.post('/tasks', { date: store.today, title: `读《${data.value.paper.short_name || data.value.paper.title.slice(0, 40)}》${p.focus_sections ? '：' + p.focus_sections.slice(0, 30) : ''}`, paper_id: store.paperId, plan_id: p.id, idea_id: p.idea_id, project_id: p.project_id });
    toast('已加入今日任务');
    changed();
  } catch (e) {
    fail(e);
  }
}
const planRunning = (p) => isRunning({ plan_id: p.id });
function togglePlanTimer(p) {
  if (planRunning(p)) stopTimer();
  else startTimer({ plan_id: p.id, paper_id: store.paperId, label: `阅读：${data.value.paper.short_name || data.value.paper.title}` });
}

// ───── 阅读记录 ─────
const logForm = reactive({ open: false, id: null, plan_id: null, date: null, sections: '', content: '', questions: '', minutes: null });
function editLog(l = null) {
  Object.assign(logForm, { open: true, id: l?.id ?? null, plan_id: l?.plan_id ?? (data.value.plans.find((p) => p.status !== 'done' && p.status !== 'dropped')?.id ?? null), date: l?.date ? Date.parse(l.date) : Date.parse(store.today), sections: l?.sections || '', content: l?.content || '', questions: l?.questions || '', minutes: l?.minutes ?? null });
}
async function saveLog() {
  const b = { plan_id: logForm.plan_id, date: new Date(logForm.date).toISOString().slice(0, 10), sections: logForm.sections, content: logForm.content, questions: logForm.questions, minutes: logForm.minutes };
  try {
    if (logForm.id) await api.patch(`/logs/${logForm.id}`, b);
    else await api.post('/logs', { ...b, paper_id: store.paperId });
    logForm.open = false;
    load();
  } catch (e) {
    fail(e);
  }
}
async function delLog(l) {
  await api.del(`/logs/${l.id}`);
  load();
}
const planOptions = computed(() => (data.value?.plans || []).map((p) => ({ label: `${p.purpose || '阅读计划'}（${p.depth || '未定深度'}，${STATUS.plan[p.status]}）`, value: p.id })));

// ───── 笔记 ─────
async function openNotePage(n = null, mode = 'read') {
  const target = { path: n ? `/notes/${n.id}` : '/notes/new', query: { from: 'paper', paper_id: store.paperId, ...(mode === 'edit' ? { mode: 'edit' } : {}) } };
  await router.push(target);
  if (router.currentRoute.value.path === target.path) store.paperId = null;
}
async function delNote(n) {
  await api.del(`/notes/${n.id}`);
  load();
}
async function uploadNote({ file }) {
  const content = await readFileText(file.file);
  try {
    await api.post('/notes', { paper_id: store.paperId, title: file.name.replace(/\.(md|markdown|txt)$/i, ''), filename: file.name, content });
    toast('笔记已上传');
    load();
  } catch (e) {
    fail(e);
  }
  return false;
}

// ───── 关联 ─────
const linkIdea = ref(null);
async function addIdea() {
  if (!linkIdea.value) return;
  await api.post(`/ideas/${linkIdea.value}/papers`, { paper_id: store.paperId });
  linkIdea.value = null;
  load();
}
async function mergeDup() {
  const d = data.value.possible_dup;
  if (!(await confirm('确认合并？', `把这一条合并到 #${d.id}「${d.title}」：只补空字段，推荐记录、计划和笔记都迁过去，这一条删除。`))) return;
  try {
    const r = await api.post(`/papers/${store.paperId}/merge-into/${d.id}`, {});
    toast('已合并');
    openPaper(r.target);
    changed();
  } catch (e) {
    fail(e);
  }
}
async function notDup() {
  await api.patch(`/papers/${store.paperId}`, { possible_dup_of: null });
  load();
  changed();
}
async function setStage(stage) {
  await api.post(`/papers/${store.paperId}/stage`, { stage });
  toast(stage === 'rejected' ? '已拒绝，之后同一篇不会再进候选区' : '已放进正式清单');
  load();
  changed();
}
async function remove() {
  const n = data.value.notes.length;
  if (!(await confirm('删除这篇论文？', `会同时删除它的阅读计划、阅读记录${n ? `和 ${n} 篇笔记` : ''}。删除记录会保留在变更日志里。`, '删除'))) return;
  await api.del(`/papers/${store.paperId}`);
  store.paperId = null;
  changed();
}
const tone = (s) => READING_TONE[s] || '';
</script>

<template>
  <NDrawer v-model:show="show" :width="width" placement="right">
    <NDrawerContent closable :native-scrollbar="false" body-content-style="padding: 14px 20px 40px">
      <template #header>
        <div v-if="data" class="head">
          <div class="row small">
            <span class="pill" :class="tone(data.reading.state)">{{ readingLabel(data.reading) }}</span>
            <span v-if="data.paper.stage !== 'library'" class="pill tigger">{{ STATUS.stage[data.paper.stage] }}</span>
            <span v-if="data.minutes" class="pill">{{ fmtMin(data.minutes) }}</span>
            <span class="muted">#{{ data.paper.id }}</span>
          </div>
          <div class="title">{{ data.paper.title }}</div>
        </div>
        <span v-else>论文</span>
      </template>
      <NSpin :show="loading">
        <template v-if="data">
          <NAlert v-if="data.possible_dup" type="warning" style="margin-bottom: 10px" title="疑似重复（没有自动合并）">
            可能和 <a href="javascript:void 0" @click="openPaper(data.possible_dup.id)">#{{ data.possible_dup.id }} {{ data.possible_dup.title }}</a> 是同一篇。
            <div class="row" style="margin-top: 6px"><NButton size="small" type="primary" @click="mergeDup">是同一篇，合并</NButton><NButton size="small" @click="notDup">不是同一篇</NButton></div>
          </NAlert>
          <NAlert v-if="data.paper.stage === 'candidate'" type="info" style="margin-bottom: 10px" title="候选论文">
            还没进入正式清单。<div class="row" style="margin-top: 6px"><NButton size="small" type="primary" @click="setStage('library')">放进正式清单</NButton><NButton size="small" @click="setStage('rejected')">拒绝</NButton></div>
          </NAlert>

          <NTabs v-model:value="tab" type="line" animated>
            <!-- 资料 -->
            <NTabPane name="info" tab="资料">
              <div class="verification small" style="padding: 10px 12px; background: var(--honey-mist); border-radius: 6px; margin-bottom: 14px">
                <div class="row"><b>{{ VERIFIED[data.paper.verification_status] || VERIFIED.unverified }}</b><span class="muted">{{ data.paper.verified_at || '' }}</span></div>
                <div v-if="data.paper.verification_note" style="margin-top: 5px; white-space: pre-wrap">{{ data.paper.verification_note }}</div>
                <div v-else class="muted">尚未记录来源核验。可在「溯源」中查看已有来源和字段记录。</div>
              </div>
              <div class="form">
                <label>资料类型</label><NSelect v-model:value="form.material_type" :options="Object.entries(MATERIAL).map(([value, label]) => ({ value, label }))" />
                <label>标题</label><NInput v-model:value="form.title" type="textarea" :autosize="{ minRows: 1 }" />
                <label>简称</label><NInput v-model:value="form.short_name" placeholder="例如 ReAct" />
                <label>作者</label><NInput v-model:value="form.authors" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" />
                <label>主要团队</label><NInput v-model:value="form.team" />
                <label>发表地</label><NInput v-model:value="form.venue" placeholder="会议 / 期刊 / arXiv" />
                <label>发布日期</label><NInput v-model:value="form.published_date" placeholder="YYYY-MM-DD 或 YYYY" />
                <label>链接</label><div class="row"><NInput v-model:value="form.url" class="grow" /><a v-if="form.url" :href="form.url" target="_blank" rel="noopener">打开 ↗</a></div>
                <label>PDF</label><div class="row"><NInput v-model:value="form.pdf_url" class="grow" /><a v-if="form.pdf_url" :href="form.pdf_url" target="_blank" rel="noopener">打开 ↗</a></div>
                <label>代码</label><NInput v-model:value="form.code_url" />
                <label>arXiv / DOI</label><div class="row"><NInput v-model:value="form.arxiv_id" placeholder="arXiv 号" style="flex: 1" /><NInput v-model:value="form.doi" placeholder="DOI" style="flex: 1" /></div>
                <template v-if="data.paper.links?.length">
                  <label>其他版本</label>
                  <div><div v-for="l in data.paper.links" :key="l.url" class="small"><span class="muted">{{ l.label }}：</span><a :href="l.url" target="_blank" rel="noopener">{{ l.url }}</a></div></div>
                </template>
                <label>论文组</label><NSelect v-model:value="form.collection" :options="store.paperGroups.map(g => ({label:g.name,value:g.name}))" filterable tag clearable />
                <label>侧重</label><NSelect v-model:value="form.side" :options="opt('sides')" clearable tag />
                <label>研究问题</label><NInput v-model:value="form.direction" placeholder="这篇和哪个问题相关" />
                <label>主题标签</label><NDynamicTags v-model:value="form.tags" />
                <label>简介</label><NInput v-model:value="form.summary" type="textarea" :autosize="{ minRows: 2 }" />
                <label>摘要</label><NInput v-model:value="form.abstract" type="textarea" :autosize="{ minRows: 2, maxRows: 10 }" />
                <label>我的备注</label><NInput v-model:value="form.my_note" type="textarea" :autosize="{ minRows: 2 }" placeholder="个人字段：导入永远不会覆盖" />
                <label>我的问题</label><NInput v-model:value="form.my_question" type="textarea" :autosize="{ minRows: 2 }" placeholder="读的时候冒出来的疑问" />
              </div>
              <NAlert v-for="c in enrichConflicts" :key="c.field" type="warning" style="margin-top: 8px">
                arXiv 上的{{ FIELD_LABEL[c.field] || c.field }}是「{{ c.new }}」，现在是「{{ c.old }}」。
                <NButton size="tiny" style="margin-left: 6px" @click="acceptConflict(c)">用 arXiv 的</NButton>
              </NAlert>
              <div class="row actions">
                <NButton type="primary" :disabled="!dirty?.length" @click="save">保存{{ dirty?.length ? `（${dirty.length} 处修改）` : '' }}</NButton>
                <NButton :loading="enriching" @click="enrich">从 arXiv 补全</NButton>
                <span class="grow" />
                <NButton v-if="data.paper.stage !== 'rejected'" quaternary size="small" @click="setStage('rejected')">拒绝</NButton>
                <NButton quaternary type="error" size="small" @click="remove">删除</NButton>
              </div>
            </NTabPane>

            <!-- 阅读 -->
            <NTabPane name="reading" :tab="`阅读（${data.plans.length}）`">
              <div class="row" style="margin-bottom: 8px">
                <b class="grow">阅读计划</b>
                <NButton size="small" type="primary" @click="editPlan()">＋ 新建阅读计划</NButton>
              </div>
              <div v-if="!data.plans.length" class="muted small">还没有阅读计划。一篇论文可以有多轮计划，例如先速览、之后为某个 Idea 精读验证。</div>
              <div v-for="p in data.plans" :key="p.id" class="plan" :class="p.status">
                <div class="row">
                  <span class="pill" :class="{ leaf: p.status === 'done', tigger: p.status === 'reading', sky: p.status === 'planned', berry: p.status === 'dropped' }">{{ STATUS.plan[p.status] }}</span>
                  <span v-if="p.depth" class="pill">{{ p.depth }}</span>
                  <span v-if="p.priority" class="pill piglet">{{ p.priority }}</span>
                  <span v-if="p.idea_title" class="pill sky">💡 {{ p.idea_title }}</span>
                  <span v-if="p.project_name" class="pill eeyore">{{ p.project_name }}</span>
                  <span class="grow" />
                  <span v-if="p.minutes" class="muted small">{{ fmtMin(p.minutes) }}</span>
                </div>
                <div class="plan-body">
                  <div v-if="p.purpose"><span class="muted">阅读原因：</span>{{ p.purpose }}</div>
                  <div v-if="p.focus_sections"><span class="muted">重点章节：</span>{{ p.focus_sections }}</div>
                  <div v-if="p.criteria"><span class="muted">完成标准：</span>{{ p.criteria }}</div>
                  <div v-if="p.due_date || p.done_at" class="muted small">{{ p.due_date ? `计划 ${p.due_date} 前` : '' }} {{ p.done_at ? `· ${p.done_at} 完成` : '' }}</div>
                </div>
                <div class="row">
                  <NButton v-if="p.status !== 'done' && p.status !== 'dropped'" size="tiny" :type="planRunning(p) ? 'warning' : 'primary'" secondary @click="togglePlanTimer(p)">{{ planRunning(p) ? '⏸ 停止计时' : '▶ 开始阅读' }}</NButton>
                  <NButton v-if="p.status !== 'done'" size="tiny" secondary type="success" @click="setPlanStatus(p, 'done')">✓ 达到目标</NButton>
                  <NButton v-if="p.status === 'done' || p.status === 'dropped'" size="tiny" quaternary @click="setPlanStatus(p, 'planned')">重新打开</NButton>
                  <NButton v-if="p.status !== 'done' && p.status !== 'dropped'" size="tiny" quaternary @click="addTodayTask(p)">＋ 今日任务</NButton>
                  <NButton size="tiny" quaternary @click="editPlan(p)">编辑</NButton>
                  <NButton v-if="p.status !== 'dropped' && p.status !== 'done'" size="tiny" quaternary @click="setPlanStatus(p, 'dropped')">放弃</NButton>
                  <NPopconfirm @positive-click="delPlan(p)"><template #trigger><NButton size="tiny" quaternary type="error">删除</NButton></template>删除这个计划？阅读记录会保留。</NPopconfirm>
                </div>
              </div>

              <div class="row" style="margin: 18px 0 8px">
                <b class="grow">阅读记录</b>
                <NButton size="small" @click="editLog()">＋ 记一笔</NButton>
              </div>
              <div v-if="!data.logs.length" class="muted small">实际读了什么、何时读的、有什么收获和疑问。</div>
              <NTimeline>
                <NTimelineItem v-for="l in data.logs" :key="l.id" :title="l.date + (l.minutes ? ` · ${l.minutes} 分钟` : '')">
                  <div v-if="l.sections" class="small"><span class="muted">读了：</span>{{ l.sections }}</div>
                  <div v-if="l.content" class="small"><span class="muted">收获：</span>{{ l.content }}</div>
                  <div v-if="l.questions" class="small"><span class="muted">疑问：</span>{{ l.questions }}</div>
                  <div class="row"><NButton size="tiny" quaternary @click="editLog(l)">编辑</NButton><NButton size="tiny" quaternary type="error" @click="delLog(l)">删除</NButton></div>
                </NTimelineItem>
              </NTimeline>
            </NTabPane>

            <!-- 笔记 -->
            <NTabPane name="notes" :tab="`笔记（${data.notes.length}）`">
              <div class="row" style="margin-bottom: 10px">
                <NButton size="small" type="primary" @click="openNotePage(null, 'edit')">＋ 写笔记</NButton>
                <NUpload :show-file-list="false" accept=".md,.markdown,.txt" multiple :custom-request="() => {}" @before-upload="uploadNote"><NButton size="small">📎 上传 .md</NButton></NUpload>
              </div>
              <div v-if="!data.notes.length" class="muted small">还没有笔记。可以直接上传读完后写的 .md 文件。</div>
              <NCollapse :default-expanded-names="data.notes.length === 1 ? [data.notes[0].id] : []">
                <NCollapseItem v-for="n in data.notes" :key="n.id" :name="n.id">
                  <template #header><span>{{ n.title || n.filename || '笔记' }}</span></template>
                  <template #header-extra><span class="muted small">v{{ n.version }} · {{ fmtDateTime(n.updated_at) }}</span></template>
                  <div class="row" style="margin-top: 6px">
                    <NButton size="tiny" @click="openNotePage(n)">展开阅读</NButton>
                    <NButton size="tiny" @click="openNotePage(n, 'edit')">编辑</NButton>
                    <span v-if="n.no_llm" class="muted small">🔒 不发送给外部模型</span>
                    <span class="grow" />
                    <NPopconfirm @positive-click="delNote(n)"><template #trigger><NButton size="tiny" quaternary type="error">删除</NButton></template>删除这篇笔记？</NPopconfirm>
                  </div>
                  <Md :src="n.content" />
                </NCollapseItem>
              </NCollapse>
            </NTabPane>

            <!-- 关联 -->
            <NTabPane name="links" tab="关联">
              <b>Idea</b>
              <div v-if="!data.ideas.length" class="muted small">还没有关联 Idea</div>
              <div v-for="i in data.ideas" :key="i.id" class="small" style="margin: 4px 0">
                💡 <RouterLink :to="`/ideas/${i.id}`" @click="store.paperId = null">{{ i.title }}</RouterLink> <span class="muted">· {{ i.relation || '相关' }} · {{ STATUS.idea[i.status] }}</span>
              </div>
              <div class="row" style="margin-top: 6px"><ItemPicker v-model="linkIdea" type="idea" size="small" style="flex: 1" /><NButton size="small" @click="addIdea">关联</NButton></div>
              <div style="height: 16px" />
              <b>项目 / 探索主题</b>
              <div v-if="!data.projects.length" class="muted small">还没有关联项目</div>
              <div v-for="p in data.projects" :key="p.id" class="row small" style="margin: 4px 0">
                <RouterLink :to="`/projects/${p.id}`" @click="store.paperId = null">{{ p.name }}</RouterLink>
              </div>
              <p class="muted small">在项目页面关联这篇论文所属的论文组，项目资料会随分组自动更新。</p>
            </NTabPane>

            <!-- 溯源 -->
            <NTabPane name="trace" :tab="`溯源（${data.recommendations.length}）`">
              <b>推荐与导入记录</b>
              <div class="muted small" style="margin-bottom: 6px">每次被推荐或导入都保留一条，不会互相覆盖。保存的是实际传入平台的片段，不代表完整对话。</div>
              <NTimeline>
                <NTimelineItem v-for="r in data.recommendations" :key="r.id" :type="r.undone_at ? 'default' : 'success'"
                  :title="`${r.kind || STATUS.source[r.source_kind] || '来源'}${r.recommender ? ' · ' + r.recommender : ''}`" :time="fmtDateTime(r.created_at)">
                  <div class="small">{{ STATUS.source[r.source_kind] || r.source_kind }}{{ r.source_name ? '：' + r.source_name : '' }}{{ r.source_channel ? ' · ' + r.source_channel : '' }}
                    <span class="muted">（{{ ({ created: '首次入库', merged: '合并到已有', duplicate_candidate: '疑似重复候选' })[r.action] || r.action }}{{ r.undone_at ? '，已撤销' : '' }}）</span></div>
                  <div v-if="r.reason" class="small">推荐理由：{{ r.reason }}</div>
                  <NCollapse v-if="r.raw"><NCollapseItem title="原始片段" :name="r.id"><pre class="raw">{{ r.raw }}</pre></NCollapseItem></NCollapse>
                </NTimelineItem>
              </NTimeline>
              <div style="height: 10px" />
              <b>修改历史</b>
              <div class="muted small" style="margin-bottom: 6px">谁在什么时候把哪个字段改成了什么；「材料来源」是这条信息本身的出处。</div>
              <div v-for="c in data.changes" :key="c.id" class="change small">
                <span class="muted">{{ fmtDateTime(c.created_at) }}</span>
                <template v-if="c.op === 'create'"> 创建</template>
                <template v-else-if="c.op === 'delete'"> 删除</template>
                <template v-else> {{ FIELD_LABEL[c.field] || c.field }}：<s v-if="c.old" class="muted">{{ String(c.old).slice(0, 60) }}</s> → {{ String(c.new ?? '（清空）').slice(0, 80) }}</template>
                <span class="muted"> · {{ ({ web: '网页', mcp: 'MCP', api: 'API', script: '脚本' })[c.actor] || c.actor }}{{ c.origin ? ' · 材料来源：' + c.origin : '' }}</span>
              </div>
            </NTabPane>
          </NTabs>
        </template>
      </NSpin>
    </NDrawerContent>
  </NDrawer>

  <!-- 阅读计划编辑 -->
  <NModal v-model:show="planForm.open" preset="card" :title="planForm.id ? '编辑阅读计划' : '新建阅读计划'" style="width: min(560px, 95vw)">
    <div class="form">
      <label>阅读原因</label><NInput v-model:value="planForm.purpose" type="textarea" :autosize="{ minRows: 2 }" placeholder="为什么和当前工作相关？例如：核对它是否真的降低了共同失效" />
      <label>目标深度</label><NSelect v-model:value="planForm.depth" :options="opt('depths')" clearable tag />
      <label>优先级</label><NSelect v-model:value="planForm.priority" :options="opt('priorities')" clearable />
      <label>重点章节</label><NInput v-model:value="planForm.focus_sections" placeholder="例如 §3 方法、§5 局限" />
      <label>完成标准</label><NInput v-model:value="planForm.criteria" type="textarea" :autosize="{ minRows: 1 }" placeholder="读到什么程度算完成？例如：能讲清楚它的威胁模型" />
      <label>截止日期</label><NDatePicker v-model:value="planForm.due_date" type="date" clearable />
      <label>服务于 Idea</label><ItemPicker v-model="planForm.idea_id" type="idea" />
      <label>项目</label><ItemPicker v-model="planForm.project_id" type="project" />
    </div>
    <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="planForm.open = false">取消</NButton><NButton type="primary" @click="savePlan">保存</NButton></div></template>
  </NModal>

  <!-- 阅读记录编辑 -->
  <NModal v-model:show="logForm.open" preset="card" title="阅读记录" style="width: min(560px, 95vw)">
    <div class="form">
      <label>日期</label><NDatePicker v-model:value="logForm.date" type="date" />
      <label>属于计划</label><NSelect v-model:value="logForm.plan_id" :options="planOptions" clearable />
      <label>读了哪些</label><NInput v-model:value="logForm.sections" placeholder="例如 摘要、§2、实验表 3" />
      <label>收获</label><NInput v-model:value="logForm.content" type="textarea" :autosize="{ minRows: 2 }" />
      <label>疑问</label><NInput v-model:value="logForm.questions" type="textarea" :autosize="{ minRows: 1 }" />
      <label>时长（分钟）</label><NInput :value="logForm.minutes == null ? '' : String(logForm.minutes)" placeholder="有计时记录时可以不填" @update:value="(v) => (logForm.minutes = v ? Number(v) || null : null)" />
    </div>
    <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="logForm.open = false">取消</NButton><NButton type="primary" @click="saveLog">保存</NButton></div></template>
  </NModal>


</template>

<style scoped>
.verification { overflow-wrap: anywhere; }
.head .title { font-size: 17px; font-weight: 600; margin-top: 4px; line-height: 1.4; }
.form { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.form > label { font-size: 13px; color: var(--ink-2); text-align: right; }
.actions { margin-top: 14px; position: sticky; bottom: -40px; background: var(--card); padding: 10px 0; }
.plan { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; background: var(--card); }
.plan.done { background: var(--honey-mist); }
.plan.dropped { opacity: 0.65; }
.plan-body { font-size: 13.5px; margin: 6px 0; line-height: 1.6; }
.change { padding: 4px 0; border-bottom: 1px dashed var(--line-soft); }
.raw { white-space: pre-wrap; word-break: break-all; font-size: 12px; max-height: 240px; overflow: auto; background: var(--surface-warm); padding: 6px 8px; border-radius: 8px; }
@media (max-width: 640px) { .form { grid-template-columns: 1fr; } .form > label { text-align: left; } }
</style>

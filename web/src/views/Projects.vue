<script setup>
import ProjectSubmission from '../components/ProjectSubmission.vue';
// 项目 / 探索主题：跨周、跨月存在，周目标、论文、Idea、笔记都可以挂在它下面
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NInput, NSelect, NModal } from 'naive-ui';
import { api } from '../lib/api';
import { store, changed, openPaper } from '../lib/store';
import { fail, toast, confirm } from '../lib/ui';
import { STATUS, IDEA_TONE, fmtMin, fmtDate, fmtDateTime } from '../lib/format';
import PaperGroups from '../components/PaperGroups.vue';
import ItemPicker from '../components/ItemPicker.vue';
import Empty from '../components/Empty.vue';

const route = useRoute();
const router = useRouter();
const list = ref([]), expanded = ref({});
const activity=p=>Math.max(0,...[p.updated_at,p.created_at,...(p.notes||[]).map(n=>n.updated_at),...(p.ideas||[]).map(i=>i.updated_at)].map(d=>Date.parse(d)||0));
const orderedProjects=computed(()=>[...list.value].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||activity(b)-activity(a)||b.id-a.id));
const isOpen=p=>!!p.pinned||!!expanded.value[p.id];
function toggle(p){if(!p.pinned)expanded.value[p.id]=!expanded.value[p.id];}
const cur = ref(null);
const form = reactive({ name: '', kind: 'explore', question: '', status: 'active', next_step: '', description: '' });
const creating = reactive({ open: false, name: '', kind: 'explore', question: '', next_step: '' });
const link = reactive({ paper_group: null, idea: null });
const manageGroups = ref(false), pinBusy = ref({});
async function pin(p){if(pinBusy.value[p.id])return;pinBusy.value[p.id]=true;try{await api.patch(`/projects/${p.id}`,{pinned:!p.pinned});delete expanded.value[p.id];await loadList();}catch(e){fail(e)}finally{pinBusy.value[p.id]=false}}

async function loadList() {
  list.value = (await api.get('/projects')).projects;
}
async function loadDetail(id) {
  if (!id) return (cur.value = null);
  try {
    cur.value = await api.get(`/projects/${id}`);
    Object.assign(form, cur.value.project);
  } catch (e) {
    fail(e);
  }
}
watch(() => route.params.id, (id) => loadDetail(id ? Number(id) : null), { immediate: true });
watch(() => store.version, () => { loadList(); if (cur.value) loadDetail(cur.value.project.id); });
loadList();

const kindOpts = Object.entries(STATUS.projectKind).map(([value, label]) => ({ value, label }));
const statusOpts = Object.entries(STATUS.project).map(([value, label]) => ({ value, label }));

async function create() {
  if (!creating.name.trim()) return;
  try {
    const p = await api.post('/projects', creating);
    creating.open = false;
    Object.assign(creating, { name: '', question: '', next_step: '' });
    changed();
    router.push(`/projects/${p.id}`);
  } catch (e) {
    fail(e);
  }
}
async function save() {
  try {
    await api.patch(`/projects/${cur.value.project.id}`, { name: form.name, kind: form.kind, question: form.question, status: form.status, next_step: form.next_step, description: form.description });
    toast('已保存');
    changed();
  } catch (e) {
    fail(e);
  }
}
async function addLink(type) {
  const id = link[type];
  if (!id) return;
  await api.post(`/projects/${cur.value.project.id}/links`, { item_type: type, item_id: id });
  link[type] = null;
  changed();
}
async function createdGroup(g) {
  link.paper_group = g.id;
  try { await addLink('paper_group'); manageGroups.value = false; } catch(e) { fail(e); }
}
async function unlink(type, id) {
  await api.del(`/projects/${cur.value.project.id}/links?item_type=${type}&item_id=${id}`);
  changed();
}
async function remove() {
  if (!(await confirm('删除这个项目？', '关联的论文、Idea、目标都会保留，只是解除关联。也可以改成「归档」。', '删除'))) return;
  await api.del(`/projects/${cur.value.project.id}`);
  router.push('/projects');
  changed();
}
const planText = (s) => {
  if (!s) return '未计划';
  const arr = s.split(',');
  if (arr.includes('reading')) return '在读';
  if (arr.includes('planned')) return arr.includes('done') ? '已读 · 有新计划' : '待读';
  if (arr.includes('done')) return '已读';
  return '放弃';
};
</script>

<template>
  <div class="page">
    <template v-if="!cur">
      <div class="page-head">
        <h1>项目 / 探索主题</h1>
        <span class="muted small grow">广泛探索也是合法项目，不必先有假设或投稿目标</span>
        <NButton type="primary" @click="creating.open = true">＋ 新项目</NButton>
      </div>
      <Empty v-if="!list.length" text="还没有项目。比如「检索增强生成的失败分析」这样连续几周在想的方向，就可以建一个。" mood="happy" />
      <div class="project-board">
        <article v-for="p in orderedProjects" :key="p.id" class="card project-card" :class="[p.status,{pinned:p.pinned,expanded:isOpen(p)}]" :data-testid="`project-card-${p.id}`">
          <header class="project-card-header">
            <component :is="p.pinned?'div':'button'" :type="p.pinned?undefined:'button'" class="project-summary" :aria-expanded="p.pinned?undefined:isOpen(p)" :aria-controls="p.pinned?undefined:`project-details-${p.id}`" :aria-label="p.pinned?undefined:`${isOpen(p)?'收起':'展开'} ${p.name}`" :data-testid="`project-summary-${p.id}`" @click="toggle(p)">
              <span class="project-identity"><span class="project-eyebrow">{{ STATUS.projectKind[p.kind] }}<span v-if="p.pinned"> · 已置顶</span></span><span class="project-name" role="heading" aria-level="2">{{ p.name }}</span></span>
              <span class="project-preview"><span v-if="p.next_step" class="project-next-preview">下一步 · {{ p.next_step }}</span><small>{{ p.note_count }} 篇笔记 · {{ p.idea_count }} 个 Idea · {{ fmtDateTime(activity(p)) }} 更新</small></span>
              <span v-if="!p.pinned" class="row-chevron" :class="{open:isOpen(p)}" aria-hidden="true">⌄</span>
            </component>
            <div class="project-card-tools"><span class="pill" :class="{leaf:p.status==='active'}">{{ STATUS.project[p.status] }}</span><NButton size="small" quaternary :loading="pinBusy[p.id]" :aria-label="`${p.pinned?'取消置顶':'置顶'} ${p.name}`" @click="pin(p)">{{ p.pinned?'取消置顶':'置顶' }}</NButton></div>
          </header>
          <div v-if="isOpen(p)" class="project-details" :id="`project-details-${p.id}`" :data-testid="`project-details-${p.id}`">
          <p v-if="p.question" class="project-question">{{ p.question }}</p>
          <div v-if="p.next_step" class="project-next"><span>下一步</span>{{ p.next_step }}</div>
          <div class="project-meta">{{ p.group_count }} 个论文组 · {{ p.paper_count }} 篇论文 · {{ p.open_goals }} 个周目标 · 近 30 天 {{ fmtMin(p.minutes_30d) }}</div>
          <ProjectSubmission :project-id="p.id" />
          <div class="project-resources">
            <section><div class="resource-heading"><h3>笔记与讨论记录 <span>{{ p.note_count }}</span></h3><RouterLink :to="{path:'/notes/new',query:{project_id:p.id}}" class="small">＋ 新建</RouterLink></div><div v-if="!p.notes.length" class="resource-empty">把讨论结果或阶段结论记在这里。</div><RouterLink v-for="n in p.notes" :key="n.id" :to="{path:`/notes/${n.id}`,query:{from:'project'}}" class="resource-link"><span>{{ n.title||n.filename||'未命名笔记' }}</span><small>{{ fmtDateTime(n.updated_at) }}</small></RouterLink><RouterLink v-if="p.note_count>p.notes.length" :to="`/projects/${p.id}`" class="resource-more">查看全部 {{ p.note_count }} 篇 ›</RouterLink></section>
            <section><div class="resource-heading"><h3>Idea <span>{{ p.idea_count }}</span></h3></div><div v-if="!p.ideas.length" class="resource-empty">关联到项目的 Idea 会出现在这里。</div><RouterLink v-for="i in p.ideas" :key="i.id" :to="`/ideas/${i.id}`" class="resource-link"><span>{{ i.title }}</span><small>{{ STATUS.idea[i.status]||i.status }}</small></RouterLink><RouterLink v-if="p.idea_count>p.ideas.length" :to="`/projects/${p.id}`" class="resource-more">查看全部 {{ p.idea_count }} 项 ›</RouterLink></section>
          </div>
          <footer class="project-card-footer"><RouterLink :to="`/projects/${p.id}`">项目详情与关联资料 ›</RouterLink></footer>
          </div>
        </article>
      </div>
    </template>

    <template v-else>
      <div class="page-head"><RouterLink to="/projects">‹ 所有项目</RouterLink></div>
      <div class="grid-2">
        <div>
          <div class="card">
            <NInput v-model:value="form.name" size="large" class="title-input" />
            <div class="form" style="margin-top: 10px">
              <label>类型</label><NSelect v-model:value="form.kind" :options="kindOpts" />
              <label>状态</label><NSelect v-model:value="form.status" :options="statusOpts" />
              <label>当前核心问题</label><NInput v-model:value="form.question" type="textarea" :autosize="{ minRows: 2 }" placeholder="我目前究竟想弄清楚什么？" />
              <label>下一步</label><NInput v-model:value="form.next_step" type="textarea" :autosize="{ minRows: 1 }" placeholder="下一次需要得到什么判断或产物？" />
              <label>说明</label><NInput v-model:value="form.description" type="textarea" :autosize="{ minRows: 2 }" />
            </div>
            <div class="row" style="margin-top: 10px"><NButton type="primary" @click="save">保存</NButton><span class="grow" /><NButton quaternary type="error" size="small" @click="remove">删除</NButton></div>
          </div>

          <div class="card">
            <div class="card-title"><h3>论文组（{{ cur.paper_groups.length }}）</h3><NButton size="small" @click="manageGroups = true">新建 / 管理</NButton></div>
            <p class="small muted">关联整组后，组内论文会自动同步。这里新建的组会直接关联到当前项目。</p>
            <div v-for="g in cur.paper_groups" :key="g.id" class="row line">
              <RouterLink class="grow" :to="{ path: '/papers', query: { group: g.name } }">{{ g.name }}</RouterLink>
              <span class="small muted">{{ g.paper_count }} 篇</span>
              <NButton size="tiny" quaternary @click="unlink('paper_group', g.id).catch(fail)">解除关联</NButton>
            </div>
            <div class="row" style="margin-top:8px"><NSelect v-model:value="link.paper_group" :options="store.paperGroups.filter(g => !cur.paper_groups.some(x => x.id === g.id)).map(g => ({ label: g.name, value: g.id }))" placeholder="选择论文组" filterable clearable style="flex:1;min-width:140px" /><NButton :disabled="!link.paper_group" @click="addLink('paper_group').catch(fail)">关联论文组</NButton></div>
            <details v-if="cur.papers.length" style="margin-top:16px"><summary>查看项目论文 · {{ cur.papers.length }} 篇</summary>
              <div v-for="p in cur.papers" :key="p.id" class="row line"><a class="grow" href="javascript:void 0" @click="openPaper(p.id)">{{ p.title }}</a><span class="small muted">{{ p.collection || '未分组' }}</span><span class="pill">{{ planText(p.plan_statuses) }}</span></div>
            </details>
          </div>

          <div class="card">
            <div class="card-title"><h3>💡 Idea（{{ cur.ideas.length }}）</h3></div>
            <div v-for="i in cur.ideas" :key="i.id" class="row line">
              <RouterLink class="grow" :to="`/ideas/${i.id}`">{{ i.title }}</RouterLink>
              <span class="pill" :class="IDEA_TONE[i.status]">{{ STATUS.idea[i.status] }}</span>
              <NButton size="tiny" quaternary @click="unlink('idea', i.id)">移除</NButton>
            </div>
            <div class="row" style="margin-top: 8px"><ItemPicker v-model="link.idea" type="idea" size="small" style="flex: 1" /><NButton size="small" @click="addLink('idea')">关联</NButton></div>
          </div>

          <div class="card">
            <div class="card-title"><h3>🗒 笔记与讨论记录</h3><NButton size="small" @click="router.push({ path: '/notes/new', query: { project_id: cur.project.id } })">＋ 新建</NButton></div>
            <div v-if="!cur.notes.length" class="muted small">和导师、合作者的讨论，阶段结论，都可以记在这里。</div>
            <div v-for="n in cur.notes" :key="n.id" class="row line">
              <RouterLink class="grow" :to="{ path: `/notes/${n.id}`, query: { from: 'project' } }">{{ n.title || n.filename || '笔记' }}</RouterLink>
              <RouterLink class="small" :to="{ path: `/notes/${n.id}`, query: { from: 'project', mode: 'edit' } }">编辑</RouterLink>
              <span class="muted small">{{ fmtDateTime(n.updated_at) }}</span>
            </div>
          </div>
        </div>

        <div>
          <div class="card"><ProjectSubmission :project-id="cur.project.id" editable /></div>
          <div class="card">
            <div class="card-title"><h3>投入</h3></div>
            <div>累计记录工时 <b>{{ fmtMin(cur.minutes) }}</b></div>
          </div>
          <div class="card">
            <div class="card-title"><h3>相关周目标</h3></div>
            <div v-if="!cur.goals.length" class="muted small">在周计划里给目标选上这个项目，就会出现在这里。</div>
            <div v-for="g in cur.goals" :key="g.id" class="small line">
              <span class="muted">{{ fmtDate(g.week_id, false) }} 周</span> {{ g.title }}
              <span class="pill" :class="{ leaf: g.status === 'done', berry: g.status === 'dropped' }">{{ STATUS.goal[g.status] }}</span>
            </div>
          </div>
          <div class="card">
            <div class="card-title"><h3>最近任务</h3></div>
            <div v-for="t in cur.tasks.slice(0, 20)" :key="t.id" class="small line">
              <span class="muted">{{ fmtDate(t.date, false) }}</span> {{ t.title }} <span class="muted">· {{ STATUS.task[t.status] }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <PaperGroups v-model:show="manageGroups" @created="createdGroup" />
    <NModal v-model:show="creating.open" preset="card" title="新项目 / 探索主题" style="width: min(520px, 95vw)">
      <div class="form">
        <label>名称</label><NInput v-model:value="creating.name" placeholder="例如 检索增强生成的失败分析" />
        <label>类型</label><NSelect v-model:value="creating.kind" :options="kindOpts" />
        <label>核心问题</label><NInput v-model:value="creating.question" type="textarea" :autosize="{ minRows: 2 }" placeholder="我目前究竟想弄清楚什么？" />
        <label>下一步</label><NInput v-model:value="creating.next_step" placeholder="下一次需要得到什么判断或产物？" />
      </div>
      <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="creating.open = false">取消</NButton><NButton type="primary" @click="create">创建</NButton></div></template>
    </NModal>


  </div>
</template>

<style scoped>
.project-board{display:flex;flex-direction:column;gap:12px}.project-card{margin:0;min-width:0;padding:0;overflow:hidden}.project-card.pinned{border-left:3px solid var(--accent)}.project-card-header{display:flex;gap:20px;align-items:center;padding:20px 24px}.project-summary{display:flex;gap:30px;align-items:center;flex:1;min-width:0;padding:0;background:none;border:0;text-align:left;font:inherit;color:var(--ink)}button.project-summary{cursor:pointer}button.project-summary:hover .project-name{color:var(--accent-deep)}button.project-summary:focus-visible{outline:2px solid var(--accent);outline-offset:6px;border-radius:3px}.project-identity{display:grid;gap:5px;flex:0 1 380px;min-width:0}.project-eyebrow{font-size:11px;color:var(--ink-2)}.project-name{font-size:18px;font-weight:600;line-height:1.5;overflow-wrap:anywhere}.project-card-tools{display:flex;align-items:center;gap:12px;flex:none}.project-preview{display:grid;gap:5px;flex:1;min-width:0}.project-next-preview{font-size:13px;line-height:1.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.project-preview small{font-size:11px;color:var(--ink-2);line-height:1.7}.row-chevron{font-size:20px;color:var(--ink-3);flex:none;transition:transform .15s}.row-chevron.open{transform:rotate(180deg)}.project-details{padding:0 24px 24px}.project-question{font-size:13px;line-height:1.85;margin:0 0 12px;padding-top:16px;border-top:1px solid var(--line-soft);overflow-wrap:anywhere}.project-next{display:flex;gap:8px;font-size:12px;line-height:1.7;color:var(--ink-2);margin:12px 0}.project-next>span{color:var(--accent-deep);flex:none}.project-meta{font-size:12px;line-height:1.8;color:var(--ink-3);margin-top:14px}.project-resources{display:flex;flex-direction:column;gap:22px;margin-top:22px;border-top:1px solid var(--line);padding-top:18px}.resource-heading{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px}.resource-heading h3{font-size:13px;margin:0}.resource-heading h3 span{font-size:11px;color:var(--ink-3);margin-left:5px}.resource-heading a{white-space:nowrap}.resource-link{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--line-soft);color:var(--ink);text-decoration:none;overflow-wrap:anywhere}.resource-link:hover{color:var(--accent-deep)}.resource-link>span{font-size:13px;line-height:1.65;min-width:0}.resource-link small{flex:none;white-space:nowrap}.resource-link small,.resource-empty{font-size:11px;line-height:1.7;color:var(--ink-3)}.resource-empty{padding:12px 0}.resource-more{font-size:12px;display:block;margin-top:10px}.project-card-footer{padding-top:18px;font-size:12px}.project-card.archived{background:var(--surface-warm)}
@media(max-width:1100px){.project-summary{gap:18px}.project-identity{flex-basis:280px}.project-card-tools{gap:6px}}
@media(max-width:650px){.project-card-header{align-items:flex-start;padding:16px;gap:10px}.project-summary{display:grid;grid-template-columns:minmax(0,1fr) 16px;gap:8px}.project-identity{grid-column:1}.project-preview{grid-column:1}.project-card-tools{align-items:flex-end;flex-direction:column;gap:8px}.row-chevron{grid-row:1;grid-column:2;align-self:center}.project-details{padding:0 16px 18px}.project-name{font-size:17px}.resource-link{display:grid;gap:5px}.project-preview small{font-size:11px}}

.title-input :deep(input) { font-family: var(--font-cute); font-size: 20px; }
.form { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.form > label { font-size: 13px; color: var(--ink-2); text-align: right; }
.line { padding: 6px 0; border-bottom: 1px dashed var(--line-soft); }
.line a { color: var(--ink); }
</style>

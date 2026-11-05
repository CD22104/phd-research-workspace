<script setup>
// 定时任务与信息流：任务执行、结果保存、你是否读过、是否整理完，分开记录
import { computed, reactive, ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NInput, NSelect, NModal, NCheckbox, NRadioGroup, NRadioButton, NInputNumber, NUpload, NDatePicker, NTimeline, NTimelineItem } from 'naive-ui';
import { api } from '../lib/api';
import { store, changed } from '../lib/store';
import { fail, toast } from '../lib/ui';
import { STATUS, fmtDate, fmtDateTime, readFileText } from '../lib/format';
import FeedReportDrawer from '../components/FeedReportDrawer.vue';
import Empty from '../components/Empty.vue';

const route = useRoute();
const tasks = ref([]);
const items = ref([]);
const filter = ref('untriaged');
const taskFilter = ref(null);
const selectedItem = ref(null);
const taskForm = reactive({ open: false, id: null, name: '', runner: 'codex', schedule: '', cadence_days: 3.5, sources: '', description: '', bridge_key: '' });
const upload = reactive({ open: false, task_id: null, title: '', date: null, url: '', content: '' });
const runs = ref(null);
const uploadGuide = ref(null);
const uploadInstruction = computed(() => uploadGuide.value ? `完成本次资料整理后，把最终内容保存成 UTF-8 Markdown 文件，保留标题、日期、来源链接和正文。然后在项目根目录执行：
python3 scripts/honey.py feed-upload /实际路径/本期报告.md --task-id ${uploadGuide.value.id}
将文件路径替换为真实路径。任务编号 ${uploadGuide.value.id} 对应「${uploadGuide.value.name}」。上传脚本自动读取网站凭证，不要读取或输出密钥。不要调用任何模型 API，不要启动新的模型进程重新总结。脚本返回 ok: true 才算上传成功；如果网络失败，保留同一文件和日期重试，并报告失败。跨日重试时用 --date 指定原日期。` : '');
async function copyUploadInstruction() { try { await navigator.clipboard.writeText(uploadInstruction.value); toast('已复制，粘贴到 Codex 定时任务的末尾即可'); } catch { toast('请手动选择下方文字复制', 'warning'); } }

let poll,seq=0;
const refresh=()=>{if(!document.hidden)load();};
onMounted(()=>{window.addEventListener('feed-updated',refresh);window.addEventListener('focus',refresh);poll=setInterval(refresh,30000);});
onUnmounted(()=>{seq++;clearInterval(poll);window.removeEventListener('feed-updated',refresh);window.removeEventListener('focus',refresh);});

async function load() {
  const n=++seq;
  try {
    const [t, i] = await Promise.all([api.get('/feeds'), api.get(`/feeds/items?filter=${filter.value}${taskFilter.value ? '&task_id=' + taskFilter.value : ''}`)]);
    if(n!==seq)return;
    tasks.value = t.tasks;
    items.value = i.items;
  } catch (e) {
    fail(e);
  }
}
watch([filter, taskFilter], load);
watch(() => store.version, load);
load();
if (route.query.item) openItem(Number(route.query.item));

function openItem(id){selectedItem.value=id;}
async function complete(it,value){try{await api.patch(`/feeds/items/${it.id}`,{review_completed:value});window.dispatchEvent(new Event('feed-updated'));}catch(e){fail(e);}}
function editTask(t = null) {
  Object.assign(taskForm, { open: true, id: t?.id ?? null, name: t?.name || '', runner: t?.runner || 'codex', schedule: t?.schedule || '', cadence_days: t?.cadence_days ?? 3.5, sources: t?.sources || '', description: t?.description || '', bridge_key: t?.bridge_key || '' });
}
async function saveTask() {
  const b = { ...taskForm };
  delete b.open;
  delete b.id;
  try {
    if (taskForm.id) await api.patch(`/feeds/tasks/${taskForm.id}`, b);
    else await api.post('/feeds/tasks', b);
    taskForm.open = false;
    load();
  } catch (e) {
    fail(e);
  }
}
async function toggleTask(t) {
  await api.patch(`/feeds/tasks/${t.id}`, { status: t.status === 'paused' ? 'active' : 'paused' });
  load();
}
function openUpload(t = null) {
  Object.assign(upload, { open: true, task_id: t?.id ?? null, title: t ? `${t.name} ${store.today}` : '', date: Date.parse(store.today), url: '', content: '' });
}
async function onFile({ file }) {
  upload.content = await readFileText(file.file);
  if (!upload.title) upload.title = file.name.replace(/\.(md|markdown|txt)$/i, '');
  return false;
}
async function saveUpload() {
  if (!upload.title || !upload.content) return fail(new Error('标题和内容都要有'));
  try {
    await api.post('/feeds/items', { task_id: upload.task_id, title: upload.title, date: new Date(upload.date).toISOString().slice(0, 10), url: upload.url || null, content: upload.content });
    upload.open = false;
    toast('已保存这期动态（不会自动产生待办）');
    changed();
  } catch (e) {
    fail(e);
  }
}
async function showRuns(t) {
  runs.value = { task: t, list: (await api.get(`/feeds/runs?task_id=${t.id}`)).runs };
}
const RUN_LABEL = { pending: '等待', running: '运行中', success: '成功', partial: '部分成功', failed: '失败', unknown: '未知' };
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>信息流</h1>
      <span class="muted small grow">定时任务的结果保存在这里；提取出的论文只进候选区，由你决定是否阅读</span>
      <NButton @click="openUpload()">📎 上传一期</NButton>
      <NButton type="primary" @click="editTask()">＋ 定时任务</NButton>
    </div>

    <div class="grid-cards">
      <div v-for="t in tasks" :key="t.id" class="card task">
        <div class="row"><h3 class="grow">{{ t.name }}</h3><span class="pill" :class="t.status==='active'?'leaf':'eeyore'">{{ t.status==='active'?'启用中':'已暂停' }}</span></div>
        <div class="small muted">{{ STATUS.runner[t.runner] }}{{ t.schedule ? ' · ' + t.schedule : '' }}<span v-if="t.bridge_key"> · ChatGPT 归档编号 {{ t.bridge_key }}</span></div>
        <div v-if="t.sources" class="small" style="margin-top: 4px">跟踪：{{ t.sources }}</div>
        <div class="small" style="margin-top: 6px">
          最近一次：{{ t.last_run_at ? fmtDateTime(t.last_run_at) : '还没有收到' }}
        </div>
        <div class="small muted">共 {{ t.item_count }} 期 · {{ t.unread_count }} 期未读</div>
        <div class="row" style="margin-top: 8px">
          <NButton size="tiny" secondary @click="openUpload(t)">上传一期</NButton>
          <NButton size="tiny" quaternary @click="taskFilter = t.id">只看这个</NButton>
          <NButton size="tiny" quaternary @click="uploadGuide = t">自动上传</NButton>
          <NButton size="tiny" quaternary @click="showRuns(t)">运行记录</NButton>
          <NButton size="tiny" quaternary @click="editTask(t)">编辑</NButton>
          <NButton size="tiny" quaternary @click="toggleTask(t)">{{ t.status === 'paused' ? '恢复' : '暂停' }}</NButton>
        </div>
      </div>
    </div>
    <Empty v-if="!tasks.length" text="还没有定时任务。比如「领域周报跟踪」：Codex 定时任务整理好后上传到这里，或者直接回传。" mood="happy" />

    <div class="card" style="margin-top: 16px">
      <div class="row" style="margin-bottom: 10px">
        <NRadioGroup v-model:value="filter" size="small">
          <NRadioButton value="untriaged">未整理</NRadioButton><NRadioButton value="unread">未读</NRadioButton>
          <NRadioButton value="active">全部</NRadioButton><NRadioButton value="archived">已归档</NRadioButton>
        </NRadioGroup>
        <NSelect v-model:value="taskFilter" :options="tasks.map((t) => ({ label: t.name, value: t.id }))" clearable placeholder="所有任务" size="small" style="width: 200px" />
      </div>
      <Empty v-if="!items.length" text="这里没有动态" />
      <div v-for="it in items" :key="it.id" class="item" @click="openItem(it.id)">
        <NCheckbox :checked="!!it.reviewed_at" :aria-label="'完成阅读：'+it.title" @click.stop @update:checked="v=>complete(it,v)" />
        <span class="dot" :class="{ unread: it.read_state === 'unread' }" />
        <div class="grow">
          <div><b>{{ it.title }}</b> <span v-if="it.reviewed_at" class="small muted">已完成</span></div>
          <div class="small muted">{{ fmtDate(it.date) }} · {{ it.task_name || '手动上传' }} · {{ it.saved_kind === 'raw' ? '原始材料' : '摘要' }}{{ it.extracted ? ` · 已提取 ${it.extracted} 篇论文` : '' }}</div>
        </div>
        <span class="pill" :class="{ leaf: it.triage === 'done', tigger: it.triage === 'partial' }">{{ STATUS.triage[it.triage] }}</span>
      </div>
    </div>

    <FeedReportDrawer :id="selectedItem" @close="selectedItem=null" />

    <NModal :show="!!uploadGuide" preset="card" title="连接 Codex 定时任务" style="width:min(720px,95vw)" @update:show="v => !v && (uploadGuide = null)">
      <p>把下方说明加到现有 Codex 定时任务末尾。上传只传送已经生成的结果，不会调用收费的模型 API。</p>
      <p class="small muted">适用于能访问这台电脑文件的本地任务；电脑与应用需保持运行，任务需能连接本站。Codex 的生成过程使用当前登录方式对应的额度。</p>
      <NInput :value="uploadInstruction" type="textarea" readonly :autosize="{minRows:9,maxRows:16}" />
      <template #footer><NButton type="primary" @click="copyUploadInstruction">复制任务说明</NButton></template>
    </NModal>
    <NModal v-model:show="taskForm.open" preset="card" :title="taskForm.id ? '编辑定时任务' : '新定时任务'" style="width: min(560px, 95vw)">
      <div class="form">
        <label>名称</label><NInput v-model:value="taskForm.name" placeholder="例如 领域周报跟踪" />
        <label>在哪运行</label><NSelect v-model:value="taskForm.runner" :options="Object.entries(STATUS.runner).map(([value, label]) => ({ value, label }))" />
        <label>频率</label><NInput v-model:value="taskForm.schedule" placeholder="例如 每周一、四 9:00" />
        <label>期望间隔</label><NInputNumber v-model:value="taskForm.cadence_days" :min="0.5" :step="0.5"><template #suffix>天</template></NInputNumber>
        <label>跟踪什么</label><NInput v-model:value="taskForm.sources" placeholder="例如 arXiv cs.CL、某个 Newsletter" />
        <label>说明</label><NInput v-model:value="taskForm.description" type="textarea" :autosize="{ minRows: 2 }" />
        <label>ChatGPT 归档</label><NInput v-model:value="taskForm.bridge_key" placeholder="归档编号，可空，例如 daily_news" />
      </div>
      <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="taskForm.open = false">取消</NButton><NButton type="primary" @click="saveTask">保存</NButton></div></template>
    </NModal>

    <NModal v-model:show="upload.open" preset="card" title="上传一期动态" style="width: min(760px, 96vw)">
      <div class="form">
        <label>属于任务</label><NSelect v-model:value="upload.task_id" :options="tasks.map((t) => ({ label: t.name, value: t.id }))" clearable placeholder="（不属于任何任务）" />
        <label>标题</label><NInput v-model:value="upload.title" />
        <label>日期</label><NDatePicker v-model:value="upload.date" type="date" />
        <label>原文链接</label><NInput v-model:value="upload.url" placeholder="可空" />
        <label>内容</label>
        <div>
          <NUpload :show-file-list="false" accept=".md,.markdown,.txt" :custom-request="() => {}" @before-upload="onFile"><NButton size="small">📎 选择 .md 文件</NButton></NUpload>
          <NInput v-model:value="upload.content" type="textarea" :autosize="{ minRows: 8, maxRows: 18 }" placeholder="或者直接粘贴" style="margin-top: 6px" />
        </div>
      </div>
      <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="upload.open = false">取消</NButton><NButton type="primary" @click="saveUpload">保存</NButton></div></template>
    </NModal>

    <NModal :show="!!runs" preset="card" :title="`运行记录：${runs?.task.name || ''}`" style="width: min(560px, 95vw)" @update:show="(v) => !v && (runs = null)">
      <div v-if="!runs?.list.length" class="muted">还没有运行记录</div>
      <NTimeline>
        <NTimelineItem v-for="r in runs?.list || []" :key="r.id" :type="r.status === 'success' ? 'success' : r.status === 'failed' ? 'error' : 'warning'"
          :title="`${RUN_LABEL[r.status]} · ${r.item_count ?? 0} 条`" :time="fmtDateTime(r.finished_at || r.created_at)">
          <div v-if="r.message" class="small">{{ r.message }}</div>
          <div v-if="r.run_key" class="small muted mono">{{ r.run_key }}</div>
        </NTimelineItem>
      </NTimeline>
    </NModal>
  </div>
</template>

<style scoped>
.item { display: flex; align-items: center; gap: 10px; padding: 10px 6px; border-bottom: 1px dashed var(--line-soft); cursor: pointer; border-radius: 8px; }
.item:hover { background: var(--honey-mist); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; flex: none; }
.dot.unread { background: var(--honey-deep); }
.form { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.form > label { font-size: 13px; color: var(--ink-2); text-align: right; }
</style>

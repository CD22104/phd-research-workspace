<script setup>
// 计时记录：查看、补录、修改（同一段时间不能重复计）
import { computed, reactive, ref, watch, onMounted, onUnmounted } from 'vue';
import { NButton, NDatePicker, NModal, NInput, NPopconfirm, NAlert } from 'naive-ui';
import { api } from '../lib/api';
import { store, changed } from '../lib/store';
import { fail, toast } from '../lib/ui';
import { addDays, fmtDate, fmtMin, fmtTime } from '../lib/format';
import ItemPicker from '../components/ItemPicker.vue';
import Empty from '../components/Empty.vue';

const rangeVal = ref([Date.parse(addDays(store.today, -6)), Date.parse(store.today)]);
const list = ref([]);
const loading=ref(false),loadError=ref('');let seq=0,poll;
const edit = reactive({ open: false, id: null, start: null, end: null, label: '', note: '', task_id: null, paper_id: null, idea_id: null, project_id: null, overlaps: [] });
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const local = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

async function load() {
  if(!rangeVal.value)return;
  const n=++seq;loading.value=true;
  try {
    const [a, b] = rangeVal.value,query=`?from=${local(a)}&to=${local(b)}`;
    const [focus,background]=await Promise.all([api.get('/sessions'+query),api.get('/background-sessions'+query)]);
    if(n!==seq)return;
    list.value=[...focus.segments.map(x=>({...x,kind:'focus'})),...background.segments.map(x=>({...x,kind:'background'}))].sort((a,b)=>b.segment_start.localeCompare(a.segment_start));loadError.value='';
  } catch (e) {
    if(n===seq)loadError.value=e.message;
  }finally{if(n===seq)loading.value=false;}
}
const refresh=()=>{if(!document.hidden)load();};
onMounted(()=>{poll=setInterval(refresh,30000);window.addEventListener('focus',refresh);});
onUnmounted(()=>{seq++;clearInterval(poll);window.removeEventListener('focus',refresh);});
watch(rangeVal, load);
watch(() => store.version, load);
load();

const groups = computed(() => {
  const m = new Map();
  for (const x of list.value) {
    const d = x.date;
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(x);
  }
  return [...m.entries()].map(([date, items]) => ({ date, items, total: items.filter(x=>x.kind==='focus').reduce((a,x)=>a+dur(x),0), background:items.filter(x=>x.kind==='background').reduce((a,x)=>a+dur(x),0) }));
});
const dur = (x) => x.minutes;
const totals=computed(()=>({focus:list.value.filter(x=>x.kind==='focus').reduce((n,x)=>n+dur(x),0),background:list.value.filter(x=>x.kind==='background').reduce((n,x)=>n+dur(x),0)}));

function open(x = null) {
  const now = Date.now();
  Object.assign(edit, {
    open: true, id: x?.id ?? null, start: x ? Date.parse(x.start_at) : now - 3600_000, end: x?.end_at ? Date.parse(x.end_at) : x ? null : now,
    label: x?.label || '', note: x?.note || '', task_id: x?.task_id ?? null, paper_id: x?.paper_id ?? null, idea_id: x?.idea_id ?? null, project_id: x?.project_id ?? null, overlaps: [],
    paper_title: x?.paper_title, idea_title: x?.idea_title,
  });
}
async function save() {
  const b = { start_at: new Date(edit.start).toISOString(), end_at: edit.end ? new Date(edit.end).toISOString() : null, label: edit.label, note: edit.note, paper_id: edit.paper_id, idea_id: edit.idea_id, project_id: edit.project_id };
  try {
    if (edit.id) await api.patch(`/sessions/${edit.id}`, b);
    else await api.post('/sessions', b);
    edit.open = false;
    toast('已保存');
    changed();
  } catch (e) {
    if (e.status === 409 && e.data?.overlaps) edit.overlaps = e.data.overlaps;
    else fail(e);
  }
}
async function remove(x) {
  await api.del(`/sessions/${x.id}`);
  changed();
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>计时记录</h1>
      <NDatePicker v-model:value="rangeVal" type="daterange" style="width: 280px" />
      <span class="grow" />
      <NButton type="primary" @click="open()">＋ 补录</NButton>
    </div>
    <div class="muted small" style="margin-bottom: 10px">工作量只累计专注时长；后台任务独立留档，不计入工时或评分。暂停间隔不计时，跨零点按网站时区分摊。</div>
    <div class="session-totals"><span>专注工时 <b>{{ fmtMin(totals.focus) }}</b></span><span class="muted">后台累计 {{ fmtMin(totals.background) }} · 不计入工时</span></div>
    <p v-if="loadError" role="alert">记录读取失败：{{ loadError }} <NButton text @click="load">重试</NButton></p>
    <Empty v-if="!list.length&&!loading&&!loadError" text="这段时间没有计时记录" />
    <div v-for="g in groups" :key="g.date" class="card">
      <div class="card-title"><h3>{{ fmtDate(g.date) }}</h3><span class="small muted">专注 {{ fmtMin(g.total) }} · 后台 {{ fmtMin(g.background) }}</span></div>
      <div v-for="x in g.items" :key="x.kind+':'+x.id" class="row sess" :data-session-kind="x.kind">
        <span class="mono muted t">{{ fmtTime(x.segment_start) }}–{{ x.segment_active ? '进行中' : fmtTime(x.segment_end) }}</span>
        <div class="grow">
          <div>{{ x.kind==='background' ? x.label : (x.task_title || x.label || '未命名') }}</div>
          <div class="row small"><span class="pill" :class="x.kind==='focus'?'leaf':'eeyore'">{{ x.kind==='focus'?'专注':'后台 · 不计入工时' }}</span><span v-if="x.kind==='background'&&x.task_title" class="muted">日计划 · {{ x.task_title }}</span>
            <span v-if="x.project_name" class="pill eeyore">{{ x.project_name }}</span>
            <span v-if="x.paper_title" class="pill sky">📄 {{ x.paper_title.slice(0, 40) }}</span>
            <span v-if="x.idea_title" class="pill piglet">💡 {{ x.idea_title }}</span>
            <span v-if="x.source === 'manual'" class="pill">补录</span>
            <span v-if="x.note" class="muted">{{ x.note }}</span>
          </div>
        </div>
        <span class="muted small">{{ fmtMin(dur(x)) }}</span>
        <NButton v-if="x.kind==='focus'" size="tiny" quaternary @click="open(x)">编辑</NButton>
        <NPopconfirm v-if="x.kind==='focus'" @positive-click="remove(x)"><template #trigger><NButton size="tiny" quaternary type="error">删除</NButton></template>删除这条计时？</NPopconfirm>
      </div>
    </div>

    <NModal v-model:show="edit.open" preset="card" :title="edit.id ? '修改计时' : '补录计时'" style="width: min(520px, 95vw)">
      <NAlert v-if="edit.overlaps.length" type="warning" style="margin-bottom: 10px">
        和这些记录重叠了（同一段时间只能算一次）：
        <div v-for="o in edit.overlaps" :key="o.id" class="small">{{ fmtTime(o.start_at) }}–{{ o.end_at ? fmtTime(o.end_at) : '进行中' }} {{ o.label }}</div>
      </NAlert>
      <div class="form">
        <label>开始</label><NDatePicker v-model:value="edit.start" type="datetime" />
        <label>结束</label><NDatePicker v-model:value="edit.end" type="datetime" :clearable="!edit.id" />
        <label>内容</label><NInput v-model:value="edit.label" placeholder="做了什么" />
        <label>项目</label><ItemPicker v-model="edit.project_id" type="project" />
        <label>论文</label><ItemPicker v-model="edit.paper_id" type="paper" :label="edit.paper_title" />
        <label>Idea</label><ItemPicker v-model="edit.idea_id" type="idea" :label="edit.idea_title" />
        <label>备注</label><NInput v-model:value="edit.note" />
      </div>
      <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="edit.open = false">取消</NButton><NButton type="primary" @click="save">保存</NButton></div></template>
    </NModal>
  </div>
</template>

<style scoped>
.session-totals{display:flex;gap:12px 24px;flex-wrap:wrap;margin:16px 0 24px}.card-title{flex-wrap:wrap;gap:10px}.sess>.grow{min-width:120px;overflow-wrap:anywhere}.sess { padding: 8px 0; border-bottom: 1px dashed var(--line-soft); align-items: flex-start; }
.t { width: 110px; padding-top: 2px; }
.form { display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.form > label { font-size: 13px; color: var(--ink-2); text-align: right; }
@media(max-width:600px){.sess{flex-wrap:wrap}.sess>.grow{flex-basis:calc(100% - 130px)}.page-head{flex-wrap:wrap}}
</style>

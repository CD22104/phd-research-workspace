<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { NButton, NInput, NSelect, NRadioGroup, NRadioButton } from 'naive-ui';
import { api } from '../lib/api';
import { store, changed } from '../lib/store';
import { fmtClock, fmtMin } from '../lib/format';
import { fail } from '../lib/ui';
const props=defineProps({date:{type:String,required:true},tasks:{type:Array,default:()=>[]}});
const mode=ref('custom'),taskId=ref(null);
const options=computed(()=>props.tasks.filter(t=>t.planned && t.status==='todo' && t.goal_task_status!=='done').map(t=>({value:t.id,label:t.title,disabled:active.value.some(r=>r.task_id===t.id)})));
const canStart=computed(()=>mode.value==='custom'?!!label.value.trim():options.value.some(t=>t.value===taskId.value&&!t.disabled));
const rows=ref([]),label=ref(''),busy=ref(false),stopping=ref(null),now=ref(Date.now()),synced=ref(Date.now()),error=ref('');let tick,poll,seq=0;
async function load(){const n=++seq;try{const r=await api.get('/background-sessions?date='+props.date);if(n!==seq)return;rows.value=r.sessions;synced.value=Date.parse(r.now);error.value='';}catch(e){if(n===seq)error.value=e.message;}}
const active=computed(()=>rows.value.filter(r=>!r.end_at));
const finished=computed(()=>rows.value.filter(r=>r.end_at));
const dayElapsed=r=>r.day_elapsed_ms+(!r.end_at&&props.date===store.today?Math.max(0,now.value-synced.value):0);
const total=computed(()=>rows.value.reduce((n,r)=>n+dayElapsed(r),0)/60000);
async function start(){if(busy.value||!canStart.value)return;busy.value=true;try{await api.post('/background-timer/start',mode.value==='custom'?{label:label.value.trim()}:{task_id:taskId.value});label.value='';taskId.value=null;changed();}catch(e){fail(e);}finally{busy.value=false;}}
async function stop(r){if(stopping.value)return;stopping.value=r.id;try{await api.post('/background-timer/stop',{session_id:r.id});changed();}catch(e){fail(e);}finally{stopping.value=null;}}
watch(()=>[props.date,store.version],load);onMounted(()=>{load();tick=setInterval(()=>now.value=Date.now(),1000);poll=setInterval(load,30000);});onUnmounted(()=>{clearInterval(tick);clearInterval(poll);seq++;});
</script>
<template>
 <section class="card background-card" data-testid="background-timers">
  <div class="card-title"><h3>后台任务</h3><RouterLink to="/sessions" class="small">记录 ›</RouterLink></div>
  <p class="small muted intro">例如 Codex 写代码、运行实验。可与专注计时同时进行，时长单独记录。</p>
  <p v-if="error" class="small">{{ error }} <NButton text size="small" @click="load">重试</NButton></p>
  <div v-for="r in active" :key="r.id" class="background-row" :data-background-id="r.id"><div class="grow"><div class="bg-title">{{ r.label }}</div><span class="mono muted">{{ fmtClock(now-Date.parse(r.start_at)) }}</span><span v-if="r.task_id" class="pill small">日计划任务</span></div><NButton size="small" secondary :loading="stopping===r.id" @click="stop(r)">结束</NButton></div>
  <div v-if="date===store.today" class="background-controls">
   <NRadioGroup v-model:value="mode" size="small"><NRadioButton value="custom">自定义</NRadioButton><NRadioButton value="planned">从日计划选择</NRadioButton></NRadioGroup>
   <div class="background-add"><NSelect v-if="mode==='planned'" v-model:value="taskId" :options="options" filterable placeholder="选择日计划任务" data-testid="background-task-select"/><NInput v-else v-model:value="label" placeholder="后台在做什么？" maxlength="200" data-testid="background-label"/><NButton type="primary" secondary :disabled="!canStart" :loading="busy" data-testid="background-start" @click="start">开始</NButton></div><p v-if="mode==='planned'&&!options.length" class="small muted">当天没有未完成的日计划任务。</p></div>
  <div class="small muted total">后台累计 {{ fmtMin(total) }} · 不计入专注工时</div>
  <details v-if="finished.length" class="finished"><summary class="small muted">已结束 {{ finished.length }} 项</summary><div v-for="r in finished" :key="r.id" class="background-row small"><span class="grow bg-title">{{ r.label }}</span><span class="muted">{{ fmtMin(r.day_elapsed_ms/60000) }}</span></div></details>
 </section>
</template>
<style scoped>
.background-card{background:var(--surface-soft)}.intro{margin:-6px 0 14px;line-height:1.7}.background-row{display:flex;align-items:center;gap:12px;padding:12px 0}.bg-title{overflow-wrap:anywhere;line-height:1.6}.background-add{display:flex;gap:10px;margin-top:14px}.background-controls{margin-top:14px}.background-row .pill{margin-left:8px}.background-add .n-input,.background-add .n-select{flex:1;min-width:0}.total{margin-top:16px;line-height:1.7}.finished{margin-top:12px}.finished summary{cursor:pointer}
</style>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { NButton, NCheckbox } from 'naive-ui';
import { api } from '../lib/api';
import { store } from '../lib/store';
import { fail } from '../lib/ui';
import FeedReportDrawer from './FeedReportDrawer.vue';
const props=defineProps({date:{type:String,required:true}});
const data=ref(null),error=ref(''),selected=ref(null),busy=ref(new Set());let seq=0,poll;
async function load(){const n=++seq;try{const result=await api.get('/feeds/day?date='+props.date);if(n===seq){data.value=result;error.value='';}}catch(e){if(n===seq)error.value=e.message;}}
const refresh=()=>{if(!document.hidden)load();};
watch(()=>[props.date,store.version],()=>{data.value=null;load();});
onMounted(()=>{load();poll=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('feed-updated',refresh);});
onUnmounted(()=>{seq++;clearInterval(poll);window.removeEventListener('focus',refresh);window.removeEventListener('feed-updated',refresh);});
async function complete(report,value){if(busy.value.has(report.id))return;busy.value.add(report.id);try{await api.patch('/feeds/items/'+report.id,{review_completed:value});window.dispatchEvent(new Event('feed-updated'));}catch(e){fail(e);}finally{busy.value.delete(report.id);}}
const reportTasks=computed(()=>(data.value?.tasks || []).filter(task=>task.reports.length));
</script>
<template>
<section class="card daily-feeds" data-testid="daily-feeds">
 <div class="card-title"><h3>{{ date===store.today ? '今日日报' : '当日日报' }} <span v-if="data" class="small muted">{{ data.completed_count }}/{{ data.report_count }} 已完成</span></h3><RouterLink to="/feeds" class="small">信息流 ›</RouterLink></div>
 <p class="small muted intro">阅读或处理后手动勾选；新修订会再次显示为待完成。</p>
 <p v-if="error" role="alert" class="small">日报状态读取失败：{{ error }} <NButton text @click="load">重试</NButton></p>
 <p v-else-if="!data" class="small muted">正在读取日报…</p>
 <p v-else-if="!reportTasks.length" class="small muted">当天暂无日报。</p>
 <div v-for="task in reportTasks" :key="task.id || 'manual'" class="feed-task" :data-feed-task="task.id">
  <div class="feed-heading"><b>{{ task.display_name || task.name }}</b><span class="small muted">{{ task.reports.length }} 份</span></div>
  <div v-for="report in task.reports" :key="report.id" class="feed-report" :class="{completed:report.reviewed_at}" :data-report-id="report.id">
   <NCheckbox :checked="!!report.reviewed_at" :disabled="busy.has(report.id)" :aria-label="'完成阅读：'+report.title" @update:checked="v=>complete(report,v)" />
   <button class="report-title" @click="selected=report.id">{{ report.title }}<span class="small muted">{{ report.reviewed_at ? '已完成' : '阅读全文' }}<template v-if="report.version>1"> · 第 {{ report.version }} 版</template></span></button>
  </div>
 </div>
 <FeedReportDrawer :id="selected" @close="selected=null" />
</section>
</template>
<style scoped>
.card-title{gap:12px;flex-wrap:wrap}.card-title h3 span{margin-left:8px;font-weight:400}.intro{margin:-4px 0 16px;line-height:1.7}.feed-task+.feed-task{border-top:1px solid var(--line-soft);margin-top:16px;padding-top:16px}.feed-heading{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap}.feed-report{display:flex;align-items:center;gap:12px;padding:10px 12px;margin-top:10px;border:1px solid var(--line-soft);border-radius:10px}.feed-report.completed{background:var(--done-bg);border-color:var(--done-line)}.report-title{appearance:none;border:0;background:none;text-align:left;font:inherit;color:var(--ink);cursor:pointer;padding:0;flex:1;min-width:0;overflow-wrap:anywhere;line-height:1.6}.report-title span{display:block;margin-top:3px}.report-title:hover{color:var(--leaf-deep)}
</style>

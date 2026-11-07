<script setup>
import { computed,ref } from 'vue';
import { NButton,NSelect } from 'naive-ui';
import { store } from '../lib/store';
import { updateConference,useDeadlineClock } from '../lib/conferences';
import { upcomingDeadlines,countdown,conferenceState } from '../lib/deadlines';
import { fail } from '../lib/ui';
const props=defineProps({projectId:Number,editable:Boolean});
const selected=ref(null),busy=ref(false),now=useDeadlineClock();
const linked=computed(()=>store.conferences.filter(c=>c.project_id===props.projectId&&c.planned));
const options=computed(()=>store.conferences.filter(c=>!c.project_id||(c.project_id===props.projectId&&!c.planned)).map(c=>({label:c.name,value:c.key})));
const next=c=>upcomingDeadlines([c],now.value,store.timezone)[0];
async function link(){if(!selected.value)return;busy.value=true;try{await updateConference(store.conferences.find(c=>c.key===selected.value),{project_id:props.projectId,planned:true});selected.value=null;}catch(e){fail(e)}finally{busy.value=false}}
async function unlink(c){busy.value=true;try{await updateConference(c,{project_id:null})}catch(e){fail(e)}finally{busy.value=false}}
</script>
<template><section v-if="editable||linked.length" class="project-submission" data-testid="project-submission"><div class="project-submission-heading"><h3>投稿目标</h3><RouterLink to="/submissions" class="small">全部会议 ›</RouterLink></div><div v-for="c in linked" :key="c.key" class="target-line"><RouterLink :to="{name:'submissions',hash:'#'+c.key}"><strong>{{ c.name }}</strong><span v-if="next(c)">{{ next(c).label }} · {{ countdown(next(c).at,now).label }}</span><span v-else>{{ conferenceState(c,now) }}</span></RouterLink><NButton v-if="editable" size="tiny" quaternary :disabled="busy" @click="unlink(c)">解除</NButton></div><div v-if="editable" class="target-link"><NSelect v-model:value="selected" :options="options" filterable clearable placeholder="选择计划投稿的会议" size="small" :disabled="busy"/><NButton size="small" :disabled="!selected||busy" @click="link">确认投稿计划</NButton></div></section></template>
<style scoped>
.project-submission{margin-top:14px;padding:16px;background:var(--surface-warm);border-radius:10px}.project-submission-heading{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px}.project-submission-heading h3{font-size:13px;margin:0}.target-line{display:flex;align-items:center;gap:8px;padding:6px 0}.target-line a{flex:1;display:grid;gap:4px;font-size:12px;color:var(--ink);text-decoration:none}.target-line a span,.target-line small{color:var(--ink-2)}.target-link{display:flex;gap:8px;margin-top:10px}.target-link>:first-child{min-width:0;flex:1}
</style>

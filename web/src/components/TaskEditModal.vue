<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { NModal,NInput,NSelect,NButton,NSwitch } from 'naive-ui';
import ItemPicker from './ItemPicker.vue';
import PaperSchedulePicker from './PaperSchedulePicker.vue';
import { api } from '../lib/api';
import { fail } from '../lib/ui';
const props=defineProps({task:{type:Object,default:null},goals:{type:Array,default:()=>[]}});
const emit=defineEmits(['close','saved']);
const f=reactive({}),saving=ref(false);
const planRemoved=computed(()=>!!props.task?.plan_id && props.task.plan_paper_id!=null && !(f.paper_ids||[]).includes(Number(props.task.plan_paper_id)));
const POINTS=[1,2,3,5].map(value=>({label:`${value} 点`,value}));
watch(()=>props.task,t=>{if(!t)return;Object.assign(f,{title:t.title,goal_id:t.goal_id??null,project_id:t.project_id??null,paper_ids:[...(t.paper_ids || (t.paper_id?[t.paper_id]:[]))],idea_id:t.idea_id??null,points:t.points||1,criteria:t.criteria||'',note:t.note||'',date:t.date,planned:!!t.planned});},{immediate:true});
async function save(){if(saving.value || !f.title?.trim() || !f.date)return;saving.value=true;try{const payload={...f,title:f.title.trim()};if(planRemoved.value)payload.plan_id=null;if(props.task.goal_task_id){delete payload.date;delete payload.goal_id;}await api.patch(`/tasks/${props.task.id}`,payload);emit('saved');}catch(e){fail(e);}finally{saving.value=false;}}
</script>
<template>
  <NModal :show="!!task" preset="card" title="编辑日任务" style="width:min(600px,95vw)" @update:show="v => !v && !saving && emit('close')">
    <div v-if="task" class="form">
      <label>任务</label><NInput v-model:value="f.title" />
      <label>日期</label><input v-model="f.date" type="date" :disabled="!!task.goal_task_id" />
      <label>周计划</label><NSelect v-model:value="f.goal_id" :disabled="!!task.goal_task_id" :options="goals.map(g=>({label:g.title,value:g.id}))" clearable placeholder="可关联一条周计划" />
      <label>工作量</label><NSelect v-model:value="f.points" :options="POINTS" />
      <label>论文</label><PaperSchedulePicker v-model="f.paper_ids" :papers="task.papers || (task.paper_id?[{id:task.paper_id,title:task.paper_title}]:[])" />
      <label>完成标准</label><NInput v-model:value="f.criteria" placeholder="可选" />
      <label>项目</label><ItemPicker v-model="f.project_id" type="project" />
      <label>Idea</label><ItemPicker v-model="f.idea_id" type="idea" :label="task.idea_title" />
      <label>备注</label><NInput v-model:value="f.note" type="textarea" :autosize="{minRows:1}" />
      <label>计入计划</label><div class="row"><NSwitch v-model:value="f.planned" size="small" /><span class="muted small">计入当天计划完成率</span></div>
    </div>
    <p v-if="planRemoved" class="small muted">原论文已移除，保存时也会解除它的阅读计划关联。</p>
    <p v-if="task?.goal_task_id" class="small muted">这里修改当天的安排。若要修改周任务或安排到其他日期，请到周计划操作。</p>
    <template #footer><div class="row" style="justify-content:flex-end"><NButton :disabled="saving" @click="emit('close')">取消</NButton><NButton type="primary" :loading="saving" :disabled="!f.title?.trim() || !f.date" @click="save">保存</NButton></div></template>
  </NModal>
</template>
<style scoped>
.form{display:grid;grid-template-columns:76px minmax(0,1fr);gap:10px;align-items:center}.form>label{font-size:13px;color:var(--ink-2);text-align:right}.form>input{border:1px solid var(--line);border-radius:7px;padding:8px;font:inherit;background:var(--card);color:var(--ink)}@media(max-width:450px){.form{grid-template-columns:60px minmax(0,1fr)}}
</style>

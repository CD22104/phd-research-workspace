<script setup>
import { ref, watch } from 'vue';
import { NDrawer, NDrawerContent, NButton, NCheckbox } from 'naive-ui';
import { api } from '../lib/api';
import { openPaper, openImport } from '../lib/store';
import { fail } from '../lib/ui';
import { STATUS, fmtDate } from '../lib/format';
import Md from './Md.vue';
const props=defineProps({id:Number});
const emit=defineEmits(['close','updated']);
const detail=ref(null),saving=ref(false);
const drawerWidth=Math.min(960,window.innerWidth);
let seq=0;
const notify=()=>{window.dispatchEvent(new Event('feed-updated'));emit('updated');};
async function load(id){const n=++seq;detail.value=null;if(!id)return;try{
  const data=await api.get(`/feeds/items/${id}`);if(n!==seq)return;detail.value=data;
  if(data.item.read_state==='unread'){await api.patch(`/feeds/items/${id}`,{read_state:'read'});if(n!==seq)return;detail.value.item.read_state='read';notify();}
}catch(e){fail(e);emit('close');}}
watch(()=>props.id,load,{immediate:true});
async function patchItem(b){if(saving.value||!detail.value)return;saving.value=true;const id=props.id;try{
 await api.patch(`/feeds/items/${id}`,b);const data=await api.get(`/feeds/items/${id}`);if(props.id===id)detail.value=data;notify();
}catch(e){fail(e);}finally{saving.value=false;}}
function extract(){const it=detail.value.item;openImport({text:it.content,source:{kind:'feed',name:it.title,feed_item_id:it.id},defaults:{stage:'candidate',rec_kind:'Newsletter'}});}
</script>
<template>
    <NDrawer :show="!!detail" :width="drawerWidth" @update:show="(v) => !v && emit('close')">
      <NDrawerContent v-if="detail" :title="detail.item.title" closable :native-scrollbar="false">
        <div class="small muted" style="margin-bottom: 8px">
          {{ fmtDate(detail.item.date) }} · {{ detail.item.task_name || '手动上传' }}
          <a v-if="detail.item.url" :href="detail.item.url" target="_blank" rel="noopener"> · 原文 ↗</a>
        </div>
        <div class="row" style="margin-bottom: 12px">
          <NButton type="primary" size="small" @click="extract">提取论文到候选区</NButton>
          <NButton size="small" :type="detail.item.triage === 'done' ? 'success' : 'default'" @click="patchItem({ triage: detail.item.triage === 'done' ? 'partial' : 'done' })">{{ detail.item.triage === 'done' ? '✓ 已整理' : '标记整理完' }}</NButton>
          <NButton size="small" @click="patchItem({ read_state: detail.item.read_state === 'read' ? 'unread' : 'read' })">标为{{ detail.item.read_state === 'read' ? '未读' : '已读' }}</NButton>
          <NButton size="small" quaternary @click="patchItem({ archived: !detail.item.archived })">{{ detail.item.archived ? '取消归档' : '归档' }}</NButton>
        </div>
        <div v-if="detail.papers.length" class="card" style="margin-bottom: 12px">
          <b>从这期提取的论文</b>
          <div v-for="p in detail.papers" :key="p.id" class="small" style="margin-top: 4px">
            <a href="javascript:void 0" @click="openPaper(p.id)">{{ p.title }}</a> <span class="muted">· {{ STATUS.stage[p.stage] }}</span>
          </div>
        </div>
        <Md :src="detail.item.content" />
        <template #footer><div class="reader-footer"><NCheckbox :checked="!!detail.item.reviewed_at" :disabled="saving" @update:checked="v=>patchItem({review_completed:v})">我已阅读 / 处理完成</NCheckbox><span class="small muted">仅打开正文不会自动完成</span></div></template>
      </NDrawerContent>
    </NDrawer>

</template>
<style scoped>
.reader-footer{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;width:100%}
</style>

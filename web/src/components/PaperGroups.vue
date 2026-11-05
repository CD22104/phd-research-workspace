<script setup>
import { ref, watch } from 'vue';
import { NModal, NButton, NInput } from 'naive-ui';
import { api } from '../lib/api';
import { changed } from '../lib/store';
import { fail, confirm, toast } from '../lib/ui';
const props = defineProps({ show: Boolean });
const emit = defineEmits(['update:show', 'created']);
const groups = ref([]), name = ref(''), busy = ref(false);
async function load() { try { groups.value = (await api.get('/paper-groups')).groups.map(g => ({ ...g, draft: g.name })); } catch(e) { fail(e); } }
watch(() => props.show, v => { if (v) load(); });
async function create() {
  if (!name.value.trim() || busy.value) return;
  busy.value = true;
  try { const g = await api.post('/paper-groups', { name: name.value }); name.value = ''; changed(); await load(); emit('created', g); toast('论文组已创建'); }
  catch(e) { fail(e); } finally { busy.value = false; }
}
async function rename(g) {
  busy.value = true;
  try { await api.patch(`/paper-groups/${g.id}`, { name: g.draft }); changed(); await load(); toast('组名已更新'); }
  catch(e) { fail(e); } finally { busy.value = false; }
}
async function remove(g) {
  if (!await confirm('删除论文组？', `删除「${g.name}」后，${g.paper_count} 篇论文移到未分组，${g.project_count} 个项目解除与此组的关联。论文、笔记和阅读记录都会保留。`, '删除')) return;
  busy.value = true;
  try { await api.del(`/paper-groups/${g.id}`); changed(); await load(); }
  catch(e) { fail(e); } finally { busy.value = false; }
}
</script>
<template>
  <NModal :show="show" @update:show="v => emit('update:show', v)" preset="card" title="管理论文组" style="width:min(660px,95vw)">
    <div class="row"><NInput v-model:value="name" placeholder="新论文组名称" maxlength="200" style="flex:1" /><NButton type="primary" :disabled="busy || !name.trim()" @click="create">新建论文组</NButton></div>
    <p class="muted small">在论文详情中选择所属组。项目关联整组后，组内新增或移出的论文会自动同步。</p>
    <div v-for="g in groups" :key="g.id" class="group-edit">
      <NInput v-model:value="g.draft" :aria-label="`重命名 ${g.name}`" maxlength="200" />
      <span class="small muted">{{ g.paper_count }} 篇 · {{ g.project_count }} 个项目</span>
      <NButton size="small" :disabled="busy || !g.draft.trim() || g.draft === g.name" @click="rename(g)">保存名称</NButton>
      <NButton size="small" quaternary type="error" :disabled="busy" @click="remove(g)">删除</NButton>
    </div>
    <p v-if="!groups.length" class="muted small">还没有论文组，可以先创建一个。</p>
  </NModal>
</template>
<style scoped>
.group-edit { display:grid; grid-template-columns:minmax(100px,1fr) auto auto auto; gap:8px; align-items:center; padding:12px 0; border-bottom:1px solid var(--line); }
@media(max-width:600px) { .group-edit { grid-template-columns:1fr auto auto; }.group-edit > :first-child { grid-column:1 / -1; } }
</style>

<script setup>
import { computed, ref } from 'vue';
import { NButton, NCheckbox, NInput, NModal, NTag, NSelect } from 'naive-ui';
import { api } from '../lib/api';
import { openPaper, store } from '../lib/store';
import { hasRead, paperReadLabel } from '../lib/format';
import { fail } from '../lib/ui';
const props = defineProps({ modelValue: { type: Array, default: () => [] }, papers: { type: Array, default: () => [] }, disabled: Boolean, label: { type: String, default: '选择论文' } });
const emit = defineEmits(['update:modelValue', 'selected']);
const opened = ref(false), loading = ref(false), loaded = ref(false), query = ref(''), all = ref([]), selected = ref([]), error = ref('');
const known = computed(() => new Map([...props.papers, ...all.value].map(p => [Number(p.id), p])));
const group = ref(null);
const groupOptions = computed(() => [...new Set([...store.paperGroups.map(g => g.name), ...all.value.map(p => p.collection).filter(Boolean)])].map(name => ({ label: name, value: name })).concat([{ label: '未分组', value: '' }]));
const matches = computed(() => {
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return all.value.filter(p => (group.value === null || (p.collection || '') === group.value) && terms.every(q => [p.title, p.short_name, p.collection, p.summary, ...(p.tags || [])].join(' ').toLowerCase().includes(q)));
});
async function fetchPapers() {
  if (loading.value) return;
  loading.value = true; error.value = '';
  try { all.value = (await api.get('/papers?stage=library')).papers || []; loaded.value = true; }
  catch (e) { error.value = e.message; fail(e); }
  finally { loading.value = false; }
}
function open() { selected.value = [...props.modelValue]; opened.value = true; fetchPapers(); }
function toggle(id, checked) { selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter(x => x !== id); }
function save() {
  emit('update:modelValue', [...selected.value]);
  emit('selected', selected.value.map(id => known.value.get(Number(id)) || { id, title: `论文 #${id}` }));
  opened.value = false;
}
function remove(id) { const next = props.modelValue.filter(x => x !== id); emit('update:modelValue', next); emit('selected', next.map(x => known.value.get(Number(x)) || { id:x, title:`论文 #${x}` })); }
</script>
<template>
  <div class="paper-picker">
    <NButton size="small" secondary data-testid="open-paper-picker" :disabled="disabled" @click="open">📄 {{ label }}<template v-if="modelValue.length"> · {{ modelValue.length }} 篇</template></NButton>
    <div v-if="modelValue.length" class="selected-papers">
      <NTag v-for="id in modelValue" :key="id" size="small" :closable="!disabled" @close="remove(id)"><span :title="known.get(Number(id))?.title" @click="openPaper(id)">{{ known.get(Number(id))?.short_name || known.get(Number(id))?.title || `论文 #${id}` }}</span></NTag>
    </div>
  </div>
  <NModal v-model:show="opened" preset="card" title="从论文库选择" style="width: min(780px, 95vw)">
    <NSelect v-model:value="group" :options="groupOptions" filterable clearable placeholder="先按论文组筛选（全部）" style="margin-bottom:10px" />
    <NInput v-model:value="query" clearable placeholder="搜索标题、主题、标签或分组" />
    <div class="small muted picker-count">{{ loading ? '加载论文库…' : `共 ${matches.length} 篇 · 已选 ${selected.length} 篇` }}</div>
    <div v-if="error" class="row"><span class="small">{{ error }}</span><NButton size="small" @click="fetchPapers">重试</NButton></div>
    <div class="paper-list">
      <div v-for="p in matches" :key="p.id" class="paper-option" :class="{ 'paper-read': hasRead(p) }">
        <NCheckbox :checked="selected.includes(p.id)" :data-testid="`select-paper-${p.id}`" :aria-label="`选择 ${p.title}`" @update:checked="v => toggle(p.id, v)" />
        <label class="paper-info" @click="toggle(p.id, !selected.includes(p.id))"><span>{{ p.title }}</span><span v-if="hasRead(p)" class="small read-label">{{ paperReadLabel(p) }}</span><span class="small muted">{{ [p.collection, p.side, ...(p.tags || []).slice(0, 3)].filter(Boolean).join(' · ') }}</span></label>
        <NButton size="tiny" quaternary @click="openPaper(p.id)">查看</NButton>
      </div>
      <p v-if="!loading && !error && !matches.length" class="muted small">没有找到匹配的论文，试试主题或分组。</p>
    </div>
    <template #footer><div class="row" style="justify-content: flex-end"><NButton @click="opened = false">取消</NButton><NButton type="primary" data-testid="confirm-paper-picker" :disabled="loading" @click="save">确认选择（{{ selected.length }}）</NButton></div></template>
  </NModal>
</template>
<style scoped>
.paper-option.paper-read { background:var(--read-bg); border-radius:8px; padding-left:10px; padding-right:10px; }
.read-label { color:var(--read-ink); }
.paper-picker { min-width: 0; }.selected-papers { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }.selected-papers :deep(.n-tag) { max-width:100%; }.selected-papers :deep(.n-tag__content) { overflow:hidden; min-width:0; }.selected-papers span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }.picker-count { margin:10px 0; }.paper-list { max-height:52vh; overflow:auto; }.paper-option { display:flex; gap:10px; padding:12px 2px; border-bottom:1px dashed var(--line-soft); align-items:center; }.paper-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; cursor:pointer; overflow-wrap:anywhere; }
</style>

<script setup>
// 搜索并选择论文 / Idea / 项目
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { NSelect } from 'naive-ui';
import { api } from '../lib/api';
import { fail } from '../lib/ui';
import { store } from '../lib/store';

const props = defineProps({
  type: { type: String, default: 'paper' },
  modelValue: { type: [Number, null], default: null },
  label: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  size: { type: String, default: 'medium' },
});
const emit = defineEmits(['update:modelValue', 'pick']);
const loading = ref(false);
const papers = ref([]), group = ref(null), paperQuery = ref('');
const groupOptions = computed(() => [...new Set([...store.paperGroups.map(g => g.name), ...papers.value.map(p => p.collection).filter(Boolean)])].map(name => ({ label: name, value: name })).concat([{ label: '未分组', value: '' }]));
async function loadPapers(show = true) {
  if (!show || props.type !== 'paper') return;
  loading.value = true;
  try { papers.value = (await api.get('/papers?stage=library')).papers; }
  catch(e) { fail(e); } finally { loading.value = false; }
}

const opts = ref([]);
const key = { paper: 'papers', idea: 'ideas', project: 'projects' };

const options = computed(() => {
  if (props.type === 'project' && !opts.value.length) return store.projects.map((p) => ({ label: p.name, value: p.id }));
  const q = paperQuery.value.trim().toLowerCase();
  const list = props.type === 'paper' ? papers.value.filter(p => (group.value === null || (p.collection || '') === group.value) && (!q || [p.title, p.short_name, p.authors, p.collection, ...(p.tags || [])].join(' ').toLowerCase().includes(q))).map(p => ({label:p.title,value:p.id,raw:p})) : [...opts.value];
  if (props.modelValue && !list.some((o) => o.value === props.modelValue)) list.unshift({ label: props.label || `#${props.modelValue}`, value: props.modelValue });
  return list;
});

let timer;
function search(q) {
  clearTimeout(timer);
  if (props.type === 'paper') { paperQuery.value = q; return; }
  if (!q) { opts.value = []; return; }
  timer = setTimeout(async () => {
    loading.value = true;
    try {
      const r = await api.get('/search?q=' + encodeURIComponent(q));
      opts.value = (r[key[props.type]] || []).map((x) => ({ label: x.title || x.name, value: x.id, raw: x }));
    } catch(e) { fail(e); } finally {
      loading.value = false;
    }
  }, 250);
}
onBeforeUnmount(() => clearTimeout(timer));
watch(() => props.type, () => (opts.value = []));
function onUpdate(v, option) {
  emit('update:modelValue', v);
  emit('pick', option);
}
</script>

<template>
  <div class="item-picker">
  <NSelect v-if="type === 'paper'" v-model:value="group" :options="groupOptions" :size="size" placeholder="按论文组筛选（全部）" filterable clearable style="margin-bottom:6px" @update:show="loadPapers" />
  <NSelect
    :value="modelValue" :options="options" :loading="loading" filterable remote clearable :size="size"
    :placeholder="placeholder || ({ paper: '搜索论文…', idea: '搜索 Idea…', project: '选择项目…' })[type]"
    :filter="type === 'project' ? undefined : () => true"
    @search="search" @update:show="loadPapers" @update:value="onUpdate"
  />
  </div>
</template>
<style scoped>.item-picker { min-width:0; }</style>

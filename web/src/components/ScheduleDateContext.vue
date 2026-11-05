<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../lib/api';
import { store } from '../lib/store';
import PlanningDayAgenda from './PlanningDayAgenda.vue';
const props = defineProps({ date: String });
const state = ref(null), error = ref(''), loading = ref(false);
let requestId = 0;
const valid = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(props.date || '') && !Number.isNaN(Date.parse(props.date)) && new Date(props.date+'T00:00:00Z').toISOString().slice(0,10)===props.date);
async function load() {
  const id = ++requestId;
  state.value = null; error.value = ''; loading.value = false;
  if (!valid.value) return;
  loading.value = true;
  try { const data = await api.get(`/calendar?from=${props.date}&to=${props.date}`); if(id===requestId)state.value=data; }
  catch(e) { if(id===requestId)error.value=e.message; }
  finally { if(id===requestId)loading.value=false; }
}
watch([()=>props.date,()=>store.version],load,{immediate:true});
</script>
<template><PlanningDayAgenda v-if="valid" :date="date" :events="state?.events || []" :kind="state?.days?.[0]?.kind" :loading="loading" :error="error" @retry="load" /><p v-else class="small muted">先选择有效日期，即可查看当天日程。</p></template>

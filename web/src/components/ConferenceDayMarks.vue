<script setup>
import { computed } from 'vue';
import { store } from '../lib/store';
import { deadlinesOn } from '../lib/deadlines';
const props=defineProps({date:String});
const deadlines=computed(()=>deadlinesOn(store.conferences,props.date,store.timezone));
</script>
<template><div v-if="deadlines.length" class="conference-day-marks" :data-testid="`conference-day-${date}`"><RouterLink v-for="m in deadlines" :key="m.conference.key+m.id" :to="{name:'submissions',hash:'#'+m.conference.key}" class="deadline-mark" :class="{done:m.conference.completed[m.id],announce:!m.at}" :data-testid="`deadline-mark-${m.conference.key}-${m.id}`"><span class="deadline-mark-time">{{ m.at?m.local.time+' 截止':'公布日' }} <span v-if="m.conference.completed[m.id]">· 已完成</span></span><strong>{{ m.conference.name }}</strong><span>{{ m.cycle?m.cycle+' · ':'' }}{{ m.label }}</span><small v-if="m.at">{{ m.date }} AOE<span v-if="m.requires&&!m.conference.completed[m.requires]"> · 仅适用于已投稿论文</span></small><small v-else>你已投稿 · 具体时刻以官方通知为准</small></RouterLink></div></template>
<style scoped>
.conference-day-marks{display:grid;gap:6px;margin:10px 0}.deadline-mark{display:grid;gap:3px;background:var(--surface-sand);border:1px solid var(--sand-line);border-left:3px solid var(--sand-deep);border-radius:8px;padding:10px;color:var(--ink);text-decoration:none;overflow-wrap:anywhere;font-size:12px}.deadline-mark strong{font-size:13px}.deadline-mark-time,.deadline-mark small{color:var(--sand-deep);font-size:10px}.deadline-mark.done{background:var(--honey-mist);border-color:var(--line);border-left-color:var(--accent)}.deadline-mark.announce{background:var(--surface-warm);border-color:var(--line-soft);border-left-color:var(--accent)}.deadline-mark.announce .deadline-mark-time,.deadline-mark.announce small{color:var(--accent-deep)}
</style>

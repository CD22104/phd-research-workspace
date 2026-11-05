<script setup>
import { openPaper } from '../lib/store';
import { hasRead, paperReadLabel } from '../lib/format';
defineProps({ paper: { type: Object, required: true } });
</script>
<template>
  <button class="task-paper-link" :class="{ 'paper-read': hasRead(paper) }" :data-paper-id="paper.id" :title="paper.title" :aria-label="[paper.title, paperReadLabel(paper)].filter(Boolean).join(' · ')" @click.stop="openPaper(paper.id)">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9.5 2Z M9 2v4h4 M5.5 9h5 M5.5 11.5H9"/></svg>
    <span class="paper-title">{{ paper.title }}</span>
    <span v-if="hasRead(paper)" class="read-label">{{ paperReadLabel(paper) }}</span>
  </button>
</template>
<style scoped>
.task-paper-link { display:flex; align-items:center; gap:8px; width:100%; min-width:0; max-width:100%; padding:7px 9px; border:0; border-radius:7px; background:transparent; color:var(--ink-2); text-align:left; font:inherit; font-size:12px; line-height:1.6; cursor:pointer; }
.paper-title { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
svg { width:13px; height:13px; flex:none; fill:none; stroke:currentColor; stroke-width:1.2; stroke-linecap:round; stroke-linejoin:round; }
.task-paper-link:hover { background:var(--surface-sand); color:var(--accent-deep); }
.task-paper-link.paper-read { background:var(--read-bg); color:var(--read-ink); }
.task-paper-link.paper-read:hover { background:var(--read-hover); }
.read-label { flex:none; font-size:11px; }
@media (max-width:450px) { .task-paper-link { flex-wrap:wrap; column-gap:6px; padding:7px; } .read-label { max-width:100%; } }
</style>

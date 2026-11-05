<script setup>
import { computed } from 'vue';
import { NButton } from 'naive-ui';
import { store,refreshConferences } from '../lib/store';
import { upcomingDeadlines,countdown,deadlineLocal,conferenceState,conferenceSummary,sortConferences } from '../lib/deadlines';
import { useDeadlineClock } from '../lib/conferences';
const props=defineProps({compact:Boolean,projectId:Number});
const now=useDeadlineClock();
const targets=computed(()=>sortConferences(store.conferences.filter(c=>c.planned&&(!props.projectId||c.project_id===props.projectId)),now.value).map(c=>({
 conference:c,
 nodes:upcomingDeadlines([c],now.value).slice(0,c.pinned?2:1),
 summary:conferenceSummary(c,now.value),
})));
const when=m=>deadlineLocal(m.at,store.timezone);
const emptyLabel=target=>target.summary.kind==='complete'?'暂无待办截止节点':conferenceState(target.conference,now.value);
</script>
<template>
 <section v-if="targets.length||store.conferenceSyncError" class="card submission-countdown" :class="{compact}" data-testid="submission-countdown">
  <div class="countdown-head">
   <h3>{{ projectId?'项目投稿目标':'投稿倒计时' }}<span v-if="targets.length>1" class="target-count">{{ targets.length }} 个会议</span></h3>
   <div class="countdown-actions"><NButton text size="tiny" :loading="store.conferenceSyncing" @click="refreshConferences({force:true})" aria-label="刷新投稿倒计时">刷新</NButton><RouterLink :to="{name:'submissions'}" class="small">管理投稿 ›</RouterLink></div>
  </div>
  <p v-if="store.conferenceSyncError" class="sync-error small" role="status">投稿计划暂未同步，正在显示上次加载的内容。<NButton text size="tiny" @click="refreshConferences({force:true})">重试</NButton></p>
  <article v-for="target in targets" :key="target.conference.key" class="countdown-target" :data-testid="`countdown-target-${target.conference.key}`">
   <div class="target-heading"><RouterLink :to="{name:'submissions',hash:'#'+target.conference.key}">{{ target.conference.name }}</RouterLink><span v-if="target.conference.pinned" class="small muted">已置顶</span></div>
   <div v-if="target.nodes.length" class="countdown-nodes" :class="{multiple:target.nodes.length>1}">
    <RouterLink v-for="m in target.nodes" :key="m.id" :to="{name:'calendar',query:{date:when(m).date}}" class="countdown-node" :class="countdown(m.at,now).tone"><span>{{ m.cycle?m.cycle+' · ':'' }}{{ m.label }}</span><strong>{{ countdown(m.at,now).label }}</strong><small>{{ when(m).date }} {{ when(m).time }} · {{ store.timezone==='Asia/Singapore'?'新加坡':store.timezone }}</small></RouterLink>
   </div>
   <p v-else class="target-status small">{{ emptyLabel(target) }}<RouterLink :to="{name:'submissions',hash:'#'+target.conference.key}">查看时间线 ›</RouterLink></p>
  </article>
 </section>
</template>
<style scoped>
.submission-countdown{background:var(--surface-warm);border-left:3px solid var(--accent);margin-top:0}
.countdown-head{display:flex;gap:12px;align-items:baseline;justify-content:space-between;flex-wrap:wrap;margin-bottom:18px}
.countdown-head h3{margin:0;font-size:15px}.target-count{margin-left:10px;font-size:12px;font-weight:400;color:var(--ink-2)}
.countdown-actions{display:flex;gap:14px;align-items:center}.countdown-actions a{color:var(--accent-deep);text-decoration:none}
.countdown-target+.countdown-target{border-top:1px solid var(--line);padding-top:18px;margin-top:18px}
.target-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}.target-heading>a{color:var(--accent-deep);font-size:15px;font-weight:600;text-decoration:none}
.countdown-nodes{display:grid;gap:10px}.countdown-node{display:grid;gap:5px;color:var(--ink);text-decoration:none;padding:12px 14px;background:var(--surface);border-radius:9px;border:1px solid var(--line-soft)}
.countdown-node>span{font-size:12px;color:var(--ink-2)}.countdown-node strong{font-size:21px;font-weight:600;font-variant-numeric:tabular-nums}.countdown-node small{font-size:11px;color:var(--ink-2)}.countdown-node.soon strong{color:var(--sand-deep)}.countdown-node.urgent strong{color:var(--danger)}
.target-status{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0;padding:8px 0;color:var(--ink-2)}.target-status a{color:var(--accent-deep)}.sync-error{color:var(--sand-deep);line-height:1.8}.sync-error button{margin-left:8px}
.compact .countdown-nodes.multiple{grid-template-columns:repeat(2,minmax(0,1fr))}.compact{padding:18px 22px;margin-bottom:28px}.compact .countdown-node strong{font-size:20px}
@media(max-width:520px){.compact .countdown-nodes.multiple{grid-template-columns:1fr}.compact{padding:18px;margin-bottom:24px}.countdown-node strong{font-size:20px}}
</style>

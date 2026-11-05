<script setup>
// 原创小熊（蜂蜜色），mood：happy / sleepy / wow
defineProps({ size: { type: Number, default: 44 }, mood: { type: String, default: 'happy' } });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 120 120" class="bear" aria-hidden="true">
    <circle cx="30" cy="36" r="15" fill="#F2B340" stroke="#8A5A1F" stroke-width="3" />
    <circle cx="30" cy="36" r="7" fill="#E08E2B" />
    <circle cx="90" cy="36" r="15" fill="#F2B340" stroke="#8A5A1F" stroke-width="3" />
    <circle cx="90" cy="36" r="7" fill="#E08E2B" />
    <circle cx="60" cy="66" r="38" fill="#F6BE4A" stroke="#8A5A1F" stroke-width="3" />
    <ellipse cx="60" cy="81" rx="19" ry="14" fill="#FFE6AD" />
    <ellipse cx="60" cy="74" rx="7" ry="5" fill="#4A2E14" />
    <template v-if="mood === 'sleepy'">
      <path d="M39 61 q6 4 12 0" fill="none" stroke="#4A2E14" stroke-width="3" stroke-linecap="round" />
      <path d="M69 61 q6 4 12 0" fill="none" stroke="#4A2E14" stroke-width="3" stroke-linecap="round" />
      <ellipse cx="60" cy="87" rx="3.5" ry="3" fill="#4A2E14" />
    </template>
    <template v-else-if="mood === 'wow'">
      <circle cx="45" cy="60" r="5" fill="#4A2E14" /><circle cx="75" cy="60" r="5" fill="#4A2E14" />
      <circle cx="46.5" cy="58.5" r="1.6" fill="#fff" /><circle cx="76.5" cy="58.5" r="1.6" fill="#fff" />
      <ellipse cx="60" cy="87" rx="4.5" ry="5" fill="#4A2E14" />
    </template>
    <template v-else>
      <circle cx="45" cy="61" r="4.2" fill="#4A2E14" /><circle cx="75" cy="61" r="4.2" fill="#4A2E14" />
      <circle cx="46.3" cy="59.6" r="1.3" fill="#fff" /><circle cx="76.3" cy="59.6" r="1.3" fill="#fff" />
      <path d="M53 84 Q60 90 67 84" fill="none" stroke="#4A2E14" stroke-width="2.6" stroke-linecap="round" />
    </template>
    <ellipse cx="36" cy="77" rx="6" ry="4" fill="#F59DAE" opacity=".65" />
    <ellipse cx="84" cy="77" rx="6" ry="4" fill="#F59DAE" opacity=".65" />
    <path d="M60 28 q6 -9 12 -2 q-2 7 -12 2z" fill="#E08E2B" opacity=".9" />
  </svg>
</template>

<style scoped>
.bear { flex: none; display: block; }
</style>

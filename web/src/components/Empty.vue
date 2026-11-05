<script setup>
defineProps({ text: { type: String, default: '暂无内容' }, mood: { type: String, default: 'sleepy' } });
</script>

<template>
  <div class="empty">
    <p>{{ text }}</p>
    <div style="margin-top: 10px"><slot /></div>
  </div>
</template>

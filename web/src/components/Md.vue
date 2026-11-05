<script setup>
import { computed } from 'vue';
import { renderMd } from '../lib/md';
const props = defineProps({ src: { type: String, default: '' } });
const html = computed(() => renderMd(props.src));
</script>
<template><div class="md" v-html="html" /></template>

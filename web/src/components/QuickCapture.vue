<script setup>
// 随手记：想法、链接、待整理的东西，先扔进收件箱
import { ref, watch, nextTick } from 'vue';
import { NModal, NInput, NButton } from 'naive-ui';
import { api, uuid } from '../lib/api';
import { store, changed } from '../lib/store';
import { fail, toast } from '../lib/ui';

const text = ref('');
const saving = ref(false);
const inputRef = ref(null);
let key = uuid();
watch(() => store.captureOpen, (v) => { if (v) { key = uuid(); nextTick(() => inputRef.value?.focus()); } });
async function save() {
  if (!text.value.trim()) return;
  saving.value = true;
  try {
    await api.post('/captures', { content: text.value }, { idempotencyKey: key });
    text.value = '';
    store.captureOpen = false;
    toast('已放进收件箱 📥');
    changed();
  } catch (e) {
    fail(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <NModal v-model:show="store.captureOpen" preset="card" title="随手记" style="width: min(560px, 94vw)" :bordered="false">
    <NInput ref="inputRef" v-model:value="text" type="textarea" :autosize="{ minRows: 4, maxRows: 12 }" placeholder="一个想法、一个链接、一件待办……之后在收件箱里整理（Ctrl + Enter 保存）" @keydown.ctrl.enter="save" @keydown.meta.enter="save" />
    <template #footer>
      <div class="row"><span class="muted small grow">不会自动变成任务或论文，整理时再决定</span><NButton type="primary" :loading="saving" @click="save">放进收件箱</NButton></div>
    </template>
  </NModal>
</template>

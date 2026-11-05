<script setup>
// Markdown 编辑器：编辑 / 预览 / 分栏，支持公式；拖入 .md 文件直接读取
import { ref, watch } from 'vue';
import { NInput, NRadioGroup, NRadioButton } from 'naive-ui';
import Md from './Md.vue';
import { readFileText } from '../lib/format';

const props = defineProps({ modelValue: { type: String, default: '' }, minRows: { type: Number, default: 14 }, bounded: { type: Boolean, default: false }, placeholder: { type: String, default: '支持 Markdown 和公式：$E=mc^2$' } });
const emit = defineEmits(['update:modelValue']);
const mode = ref(window.innerWidth > 1100 ? 'split' : 'edit');
const text = ref(props.modelValue);
watch(() => props.modelValue, (v) => { if (v !== text.value) text.value = v; });
watch(text, (v) => emit('update:modelValue', v));
async function onDrop(e) {
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.(md|markdown|txt)$/i.test(f.name)) {
    e.preventDefault();
    text.value = (text.value ? text.value + '\n\n' : '') + (await readFileText(f));
  }
}
</script>

<template>
  <div class="mde" :class="{ bounded }">
    <div class="row" style="margin-bottom: 6px">
      <NRadioGroup v-model:value="mode" size="small">
        <NRadioButton value="edit">编辑</NRadioButton>
        <NRadioButton value="split">分栏</NRadioButton>
        <NRadioButton value="preview">预览</NRadioButton>
      </NRadioGroup>
      <span class="muted small">可以把 .md 文件拖进来</span>
    </div>
    <div class="panes" :class="mode">
      <div v-if="mode !== 'preview'" class="pane" @drop="onDrop" @dragover.prevent>
        <NInput v-model:value="text" type="textarea" :autosize="bounded ? false : { minRows }" :input-props="{ 'aria-label': 'Markdown 正文' }" :placeholder="placeholder" class="mono-input" />
      </div>
      <div v-if="mode !== 'edit'" class="pane preview"><Md :src="text" /><div v-if="!text" class="muted small">（预览）</div></div>
    </div>
  </div>
</template>

<style scoped>
.pane { min-width: 0; }
.bounded .pane { height: max(360px, calc(100dvh - 290px)); }
.bounded .mono-input { height: 100%; }
.bounded :deep(.mono-input .n-input-wrapper), .bounded :deep(.mono-input .n-input__textarea), .bounded :deep(.mono-input textarea) { height: 100%; }
.bounded :deep(.mono-input textarea) { overflow-y: auto !important; }
.bounded .panes .preview { max-height: none; overflow: auto; }
.panes.split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.preview { border: 1px dashed var(--line); border-radius: 10px; padding: 6px 14px; background: var(--card); overflow: auto; }
.panes.split .preview { max-height: 70vh; }
:deep(.mono-input textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px; line-height: 1.6; }
@media (max-width: 800px) { .panes.split { grid-template-columns: 1fr; } }
</style>

<script setup>
// 附件：挂在 Idea / 论文 / 笔记下的文件。上传后可以下载、复制下载链接（贴进正文）、删除。
import { ref, watch } from 'vue';
import { NButton, NPopconfirm, NTooltip } from 'naive-ui';
import { api, uuid } from '../lib/api';
import { fail, toast } from '../lib/ui';
import { fmtDateTime } from '../lib/format';

const props = defineProps({
  ownerType: { type: String, required: true }, // idea | paper | note
  ownerId: { type: Number, required: true },
  title: { type: String, default: '附件' },
});
const emit = defineEmits(['changed']);
const MAX = 10 * 1024 * 1024;
const list = ref([]);
const loading = ref(false);
const uploading = ref('');
const dragging = ref(false);
const input = ref(null);

const size = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const href = (a) => `/api/attachments/${a.id}/download`;
const ext = (name) => (name.includes('.') ? name.split('.').pop().toUpperCase().slice(0, 4) : 'FILE');

async function load() {
  if (!props.ownerId) return;
  loading.value = true;
  try {
    list.value = (await api.get(`/attachments?owner_type=${props.ownerType}&owner_id=${props.ownerId}`)).attachments;
  } catch (e) {
    fail(e);
  } finally {
    loading.value = false;
  }
}
watch(() => [props.ownerType, props.ownerId], load, { immediate: true });

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error(`读取「${file.name}」失败`));
    r.readAsDataURL(file);
  });
}

async function upload(files) {
  const picked = [...(files || [])];
  if (!picked.length) return;
  let added = 0;
  for (const f of picked) {
    if (f.size > MAX) {
      fail(new Error(`「${f.name}」${size(f.size)}，超过单个附件上限 10 MB`));
      continue;
    }
    if (!f.size) {
      fail(new Error(`「${f.name}」是空文件`));
      continue;
    }
    uploading.value = f.name;
    try {
      const data_base64 = await readBase64(f);
      const r = await api.post('/attachments', { owner_type: props.ownerType, owner_id: props.ownerId, filename: f.name, content_type: f.type, data_base64 }, { idempotencyKey: uuid() });
      if (!r.duplicate) added++;
      else toast(`「${f.name}」已经在附件里了`, 'info');
    } catch (e) {
      fail(e);
    }
  }
  uploading.value = '';
  if (input.value) input.value.value = '';
  if (added) toast(`已上传 ${added} 个附件`);
  await load();
  emit('changed');
}

function onDrop(e) {
  dragging.value = false;
  upload(e.dataTransfer?.files);
}

async function copyLink(a) {
  const md = `[${a.filename}](${href(a)})`;
  try {
    await navigator.clipboard.writeText(md);
    toast('已复制下载链接（Markdown），可以粘贴到正文里');
  } catch {
    window.prompt('复制这段下载链接：', md);
  }
}

async function remove(a) {
  try {
    await api.del(`/attachments/${a.id}`);
    toast(`已删除「${a.filename}」`);
    await load();
    emit('changed');
  } catch (e) {
    fail(e);
  }
}
defineExpose({ load });
</script>

<template>
  <div class="att" :class="{ dragging }" data-testid="attachments" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onDrop">
    <div class="att-head">
      <h3>{{ title }}<span v-if="list.length" class="muted small">（{{ list.length }}）</span></h3>
      <span class="grow" />
      <input ref="input" type="file" multiple hidden data-testid="attachment-input" @change="upload($event.target.files)" />
      <NButton size="small" :loading="!!uploading" @click="input?.click()">{{ uploading ? `正在上传 ${uploading}` : '＋ 上传附件' }}</NButton>
    </div>
    <div v-if="list.length" class="att-list">
      <div v-for="a in list" :key="a.id" class="att-row" data-testid="attachment-row">
        <span class="att-ext" aria-hidden="true">{{ ext(a.filename) }}</span>
        <div class="att-main">
          <a :href="href(a)" :download="a.filename" class="att-name">{{ a.filename }}</a>
          <div class="muted small">{{ size(a.size) }} · {{ fmtDateTime(a.created_at) }}<template v-if="a.actor !== 'web'"> · 由 {{ a.actor === 'mcp' ? 'Claude' : a.actor === 'script' ? '脚本' : '接口' }} 上传</template></div>
        </div>
        <NTooltip><template #trigger><NButton size="tiny" quaternary @click="copyLink(a)">复制链接</NButton></template>复制 Markdown 下载链接，可以贴进正文</NTooltip>
        <NPopconfirm @positive-click="remove(a)">
          <template #trigger><NButton size="tiny" quaternary type="error">删除</NButton></template>
          删除附件「{{ a.filename }}」？删除后无法恢复。
        </NPopconfirm>
      </div>
    </div>
    <p v-else-if="!loading" class="muted small att-empty">还没有附件。点「上传附件」或把文件拖到这里，单个文件不超过 10 MB（Excel、PDF、Word、图片等）。</p>
  </div>
</template>

<style scoped>
.att { border: 1px dashed transparent; border-radius: 12px; transition: border-color .15s, background .15s; }
.att.dragging { border-color: var(--accent); background: var(--surface-muted); }
.att-head { display: flex; align-items: center; gap: 8px; }
.att-head h3 { margin: 0; font-size: 15px; }
.att-list { display: grid; gap: 2px; margin-top: 8px; }
.att-row { display: flex; align-items: center; gap: 10px; padding: 7px 4px; border-bottom: 1px dashed var(--line-soft); }
.att-row:last-child { border-bottom: 0; }
.att-ext { flex: none; width: 40px; height: 28px; display: grid; place-items: center; border-radius: 6px; background: var(--surface-muted); color: var(--ink-2); font-size: 10.5px; font-weight: 700; letter-spacing: .03em; }
.att-main { flex: 1; min-width: 0; }
.att-name { color: var(--ink); font-weight: 500; overflow-wrap: anywhere; }
.att-empty { margin: 8px 0 0; }
</style>

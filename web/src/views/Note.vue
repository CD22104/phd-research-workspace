<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { NAlert, NButton, NDropdown, NInput, NSpin, NSwitch } from 'naive-ui';
import { api } from '../lib/api';
import { changed, openPaper, store } from '../lib/store';
import { confirm, fail, toast } from '../lib/ui';
import { download, fmtDateTime } from '../lib/format';
import Md from '../components/Md.vue';
import MdEditor from '../components/MdEditor.vue';

const route = useRoute();
const router = useRouter();
const note = ref(null);
const form = reactive({ title: '', content: '', no_llm: true });
const original = ref('');
const editing = ref(false);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const snapshot = () => ({ title: form.title, content: form.content, no_llm: form.no_llm });
const dirty = computed(() => !loading.value && JSON.stringify(snapshot()) !== original.value);
const validId = (v) => /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const isNew = computed(() => !note.value?.id);
const canSave = computed(() => !loading.value && !error.value && !saving.value && (dirty.value || isNew.value && !!form.content.trim()));
const parent = computed(() => {
  const n = note.value;
  if (!n) return { path: '/projects', label: '返回项目' };
  if (n.paper_id && (route.query.from === 'paper' || !n.project_id && !n.idea_id)) return { path: '/papers', paper: n.paper_id, label: '返回论文', name: n.paper_title };
  if (n.project_id) return { path: `/projects/${n.project_id}`, label: '返回项目', name: n.project_name };
  if (n.idea_id) return { path: `/ideas/${n.idea_id}`, label: '返回 Idea', name: n.idea_title };
  return { path: '/projects', label: '返回项目' };
});
const saveLabel = computed(() => saving.value ? '正在保存…' : dirty.value ? '有未保存修改' : isNew.value ? '尚未保存' : `已保存 · ${fmtDateTime(note.value.updated_at)}`);
const menuOptions = computed(() => [
  { key: 'download', label: '下载 Markdown' },
  { key: 'version', label: '保存并存为版本', disabled: saving.value || loading.value || !!error.value || isNew.value && !form.content.trim() },
]);
let loadNumber = 0;
async function load() {
  // Creation replaces /new with the saved URL without discarding typing during the request.
  if (note.value?.id && String(note.value.id) === route.params.id) return;
  const attempt = ++loadNumber;
  loading.value = true; error.value = '';
  try {
    let n;
    if (route.params.id === 'new') {
      const projectId = validId(route.query.project_id), paperId = validId(route.query.paper_id);
      if (!projectId && !paperId) throw new Error('请从项目或论文的「新建笔记」进入。');
      const project = projectId ? store.projects.find(p => p.id === projectId) : null;
      if (projectId && !project) throw new Error('关联的项目不存在，请返回项目重新选择。');
      const paper = paperId ? (await api.get(`/papers/${paperId}`)).paper : null;
      n = { id: null, title: paperId ? '阅读笔记' : `讨论记录 ${store.today}`, content: '', no_llm: 1, project_id: projectId, project_name: project?.name, paper_id: paperId, paper_title: paper?.title };
    } else {
      if (!validId(route.params.id)) throw new Error('笔记地址不正确。');
      n = await api.get(`/notes/${route.params.id}`);
    }
    if (attempt !== loadNumber) return;
    note.value = n;
    Object.assign(form, { title: n.title || n.filename || '', content: n.content || '', no_llm: !!n.no_llm });
    original.value = JSON.stringify(snapshot());
    editing.value = !n.id || route.query.mode === 'edit';
    window.scrollTo(0, 0);
  } catch (e) { if (attempt === loadNumber) { note.value = null; error.value = e.message; } }
  finally { if (attempt === loadNumber) loading.value = false; }
}
watch(() => route.params.id, load, { immediate: true });

async function save(asVersion = false) {
  if (saving.value || loading.value || error.value || !note.value) return;
  if (isNew.value && !form.content.trim()) { toast('先写一点笔记内容', 'info'); return; }
  saving.value = true;
  const submitted = snapshot();
  let saved = note.value, firstSave = !saved.id, savedContent = false;
  try {
    if (dirty.value || firstSave) {
      saved = firstSave
        ? await api.post('/notes', { ...submitted, project_id: note.value.project_id, paper_id: note.value.paper_id })
        : await api.patch(`/notes/${saved.id}`, { ...submitted, base_version: saved.version });
      note.value = { ...note.value, ...saved };
      original.value = JSON.stringify(submitted);
      savedContent = true;
      changed();
    }
    if (firstSave) await router.replace({ path: `/notes/${saved.id}`, query: { ...route.query, mode: 'edit' } });
    if (asVersion) await api.post('/versions', { entity: 'note', entity_id: saved.id, label: '正式版本' });
    toast(asVersion ? '已保存并存为正式版本' : dirty.value ? '已保存，后续输入还未保存' : '已保存');
  } catch (e) {
    if (e.status === 409 && e.data?.current) {
      // Keep this draft intact until the user explicitly resolves the conflict.
      const overwrite = await confirm('笔记在其他地方更新过', '你现在的内容仍保留在页面中。「覆盖保存」会替换另一处的修改；取消后可先从「更多」下载当前 Markdown，再对比处理。', '覆盖保存');
      if (overwrite) {
        note.value.version = e.data.current.version;
        saving.value = false;
        return save(asVersion);
      }
    } else fail(savedContent && asVersion ? new Error('正文已保存，但正式版本留档失败。可从「更多」重试。') : e);
  } finally { saving.value = false; }
}
async function back() {
  const destination = parent.value;
  const failure = await router.push(destination.path);
  if (!failure && destination.paper) openPaper(destination.paper);
}
function toggleEditing() { editing.value = !editing.value; window.scrollTo(0, 0); }
function more(key) {
  if (key === 'version') save(true);
  else if (key === 'download') download(`${(form.title || '笔记').replace(/[\\/:*?"<>|]/g, '_')}.md`, form.content, 'text/markdown;charset=utf-8');
}
async function allowLeave() {
  if (saving.value) { toast('正在保存，请稍候', 'info'); return false; }
  return !dirty.value || await confirm('离开这篇笔记？', '还有未保存的修改，离开会丢失这些修改。可以取消后使用顶部「保存」或 ⌘S / Ctrl+S。', '放弃修改并离开');
}
onBeforeRouteLeave(allowLeave);
onBeforeRouteUpdate(async (to) => {
  if (to.params.id === String(note.value?.id)) {
    if (to.query.mode === 'edit') editing.value = true;
    return true;
  }
  return allowLeave();
});
function beforeUnload(e) { if (dirty.value || saving.value) { e.preventDefault(); e.returnValue = ''; } }
function shortcut(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && !e.altKey) {
    e.preventDefault();
    if (!saving.value && !loading.value && !error.value) save();
  }
}
window.addEventListener('beforeunload', beforeUnload);
window.addEventListener('keydown', shortcut);
onBeforeUnmount(() => { loadNumber++; window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', shortcut); });
</script>

<template>
  <div class="page note-page" :class="{ 'is-editing': editing }">
    <header class="note-toolbar" data-testid="note-toolbar">
      <NButton quaternary @click="back">‹ {{ parent.label }}</NButton>
      <span class="save-status muted small" role="status" :class="{ unsaved: dirty }">{{ loading ? '正在加载…' : error ? '' : saveLabel }}</span>
      <div v-if="!loading && !error" class="note-actions">
        <NButton @click="toggleEditing">{{ editing ? '阅读预览' : '编辑笔记' }}</NButton>
        <NDropdown :options="menuOptions" @select="more"><NButton aria-label="更多笔记操作">更多</NButton></NDropdown>
        <NButton type="primary" :loading="saving" :disabled="!canSave" title="保存（⌘S / Ctrl+S）" data-testid="note-save" @click="save(false)">保存</NButton>
      </div>
    </header>
    <NSpin v-if="loading" class="note-loading" />
    <NAlert v-else-if="error" type="error" title="无法打开笔记" style="margin-top:24px">{{ error }} <NButton size="small" @click="load">重试</NButton></NAlert>
    <template v-else>
      <section class="note-heading">
        <p v-if="parent.name" class="muted small note-parent">{{ parent.name }}</p>
        <NInput v-if="editing" v-model:value="form.title" placeholder="笔记标题" size="large" class="note-title-input" :input-props="{ 'aria-label': '笔记标题' }" />
        <h1 v-else>{{ form.title || '未命名笔记' }}</h1>
        <div class="note-meta muted small">
          <span>{{ form.content.length.toLocaleString() }} 字符</span>
          <template v-if="editing"><NSwitch v-model:value="form.no_llm" size="small" aria-label="不发送给外部模型" /><span>不发送给外部模型</span><span class="keyboard-hint">⌘S / Ctrl+S 保存</span></template>
          <span v-else-if="form.no_llm">不发送给外部模型</span>
        </div>
      </section>
      <MdEditor v-if="editing" v-model="form.content" bounded :min-rows="18" />
      <article v-else class="note-reader" data-testid="note-reader">
        <Md :src="form.content" />
        <p v-if="!form.content" class="muted">这篇笔记还没有正文，点击顶部「编辑笔记」开始写。</p>
      </article>
    </template>
  </div>
</template>

<style scoped>
.note-page { max-width: 1440px; padding-top: 0; }
.note-toolbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-height: 76px; padding: 12px 0; background: var(--surface-warm); border-bottom: 1px solid var(--line); }
.save-status { flex: 1; min-width: 110px; }
.save-status.unsaved { color: var(--accent); }
.note-actions { display: flex; gap: 8px; }
.note-heading { margin: 28px auto 22px; max-width: 900px; }
.note-parent { margin: 0 0 12px; overflow-wrap: anywhere; }
.note-heading h1 { line-height: 1.45; overflow-wrap: anywhere; }
.note-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 14px; }
.note-reader { margin: 0 auto; padding: 4px 0 56px; max-width: 900px; }
.note-reader :deep(.md) { font-size: 17px; line-height: 1.9; }
.note-reader :deep(.md > :first-child) { margin-top: 0; }
.note-reader :deep(.md pre) { font-size: 14px; }
.is-editing .note-heading { max-width: none; }
.note-loading { display: block; margin: 60px auto; }
@media (max-width: 800px) {
  .note-toolbar { gap: 8px; min-height: 100px; }
  .save-status { text-align: right; font-size: 12px; }
  .note-actions { width: 100%; justify-content: flex-end; }
  .note-heading { margin-top: 22px; }
  .note-reader :deep(.md) { font-size: 16px; }
  .keyboard-hint { display: none; }
}
</style>

<script setup>
// 导入论文：粘贴 / 上传 → 预览（查重、合并计划、冲突）→ 确认提交 → 可撤销
import { computed, h, reactive, ref, watch } from 'vue';
import { NModal, NButton, NInput, NSelect, NCheckbox, NRadioGroup, NRadio, NSwitch, NDataTable, NUpload, NAlert, NSpace, NTag, NTooltip, NCollapse, NCollapseItem } from 'naive-ui';
import { api, uuid } from '../lib/api';
import { store, changed, openPaper } from '../lib/store';
import { fail, toast, confirm } from '../lib/ui';
import { readFileText } from '../lib/format';
import ItemPicker from './ItemPicker.vue';

const SOURCE_KINDS = [
  { label: 'Claude 对话', value: 'claude', rec: 'Claude' },
  { label: 'GPT 对话', value: 'chatgpt', rec: 'GPT' },
  { label: '飞书表格', value: 'feishu', rec: '飞书迁移' },
  { label: 'Newsletter / 信息流', value: 'feed', rec: 'Newsletter' },
  { label: '导师 / 合作者推荐', value: 'manual', rec: '导师' },
  { label: '其他粘贴', value: 'paste', rec: '' },
];
const FIELD_LABEL = {
  title: '标题', authors: '作者', venue: '发表地', published_date: '发布日期', url: '链接', pdf_url: 'PDF', code_url: '代码', arxiv_id: 'arXiv',
  doi: 'DOI', abstract: '摘要', summary: '简介', collection: '集合', side: '侧重', direction: '研究问题', tags: '标签', team: '团队', short_name: '简称',
};
const PROMPT = `请把你推荐的论文整理成 JSON，放在一个 \`\`\`json 代码块里。没有的信息留空，不要编造链接、arXiv 号或作者：
{"papers": [{
  "title": "论文原标题",
  "authors": "",
  "venue": "发表地（会议/期刊/arXiv）",
  "year": "",
  "url": "",
  "arxiv_id": "",
  "summary": "一句话简介",
  "rec_reason": "为什么推荐给我、和我当前工作的关系",
  "tags": ["主题标签"],
  "priority": "P0/P1/P2/P3，可空",
  "depth": "速览/机制理解/精读验证/复现，可空",
  "focus_sections": "建议重点读的章节"
}]}`;

const step = ref('input');
const busy = ref(false);
const text = ref('');
const fileName = ref('');
const source = reactive({ kind: 'claude', name: '', channel: '', feed_item_id: null });
const opts = reactive({ enrich: true, use_llm: false });
const defaults = reactive({ collection: null, rec_kind: 'Claude', recommender: '', priority: null, depth: null, purpose: '', stage: 'library', create_plan: true, project_id: null, idea_id: null });
const preview = ref(null);
const items = ref([]);
const result = ref(null);
let importKey = uuid();

const optionList = (k) => (k === 'collections' ? store.paperGroups.map(g => g.name) : store.settings?.options?.[k] || []).map((v) => ({ label: v, value: v }));

function reset() {
  step.value = 'input';
  preview.value = null;
  items.value = [];
  result.value = null;
  importKey = uuid();
}

watch(() => store.importOpen, (open) => {
  if (!open) return;
  reset();
  const p = store.importPreset;
  if (p) {
    text.value = p.text || '';
    Object.assign(source, { kind: 'claude', name: '', channel: '', feed_item_id: null }, p.source || {});
    Object.assign(defaults, { rec_kind: SOURCE_KINDS.find((k) => k.value === source.kind)?.rec || '' }, p.defaults || {});
  }
});

watch(() => source.kind, (k) => {
  const rec = SOURCE_KINDS.find((x) => x.value === k)?.rec;
  if (rec !== undefined) defaults.rec_kind = rec || null;
});

async function onFile({ file }) {
  const f = file.file;
  if (/\.xlsx?$/i.test(f.name)) {
    fail(new Error('请在飞书里导出为 CSV 再上传（Excel 文件暂不支持）'));
    return false;
  }
  text.value = await readFileText(f);
  fileName.value = f.name;
  if (/\.csv$/i.test(f.name) && text.value.includes('论文名称') && text.value.includes('Topic Tags')) source.kind = 'feishu';
  if (!source.name) source.name = f.name;
  return false;
}

async function doPreview() {
  if (!text.value.trim()) return fail(new Error('先粘贴内容或上传文件'));
  busy.value = true;
  try {
    const r = await api.post('/import/preview', { text: text.value, enrich: opts.enrich, use_llm: opts.use_llm, defaults: { ...defaults } });
    preview.value = r;
    items.value = r.items.map((it) => ({ ...it, target_id: it.match?.id ?? null, resolve: {}, new_plan: false }));
    step.value = 'preview';
    if (!r.items.length) fail(new Error('没有识别出论文。可以试试「用大模型解析」，或让对话按下面的 JSON 格式输出'));
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}

const unresolved = computed(() => items.value.filter((i) => i.action === 'review').length);
const counts = computed(() => {
  const c = { create: 0, candidate: 0, merge: 0, skip: 0, review: 0 };
  for (const i of items.value) c[i.action] = (c[i.action] || 0) + 1;
  return c;
});

function actionOptions(it) {
  const o = [];
  if (!it.match?.certain) o.push({ label: '新建（正式清单）', value: 'create' }, { label: '新建（候选区）', value: 'candidate' });
  if (it.match && !it.match.batch) o.push({ label: `合并到 #${it.match.id}`, value: 'merge' });
  o.push({ label: '跳过', value: 'skip' });
  if (it.action === 'review') o.unshift({ label: '⚠️ 请选择', value: 'review', disabled: true });
  return o;
}

const columns = [
  { title: '#', key: 'idx', width: 44, render: (r) => r.idx + 1 },
  {
    title: '处理', key: 'action', width: 170,
    render: (r) => h(NSelect, { size: 'small', value: r.action, options: actionOptions(r), status: r.action === 'review' ? 'warning' : undefined, 'onUpdate:value': (v) => (r.action = v) }),
  },
  {
    title: '论文', key: 'title', minWidth: 280,
    render: (r) => h('div', [
      h(NInput, { size: 'small', value: r.draft.title, 'onUpdate:value': (v) => (r.draft.title = v) }),
      h('div', { class: 'muted small', style: 'margin-top:3px' }, [
        [r.draft.venue, r.draft.published_date, r.draft.arxiv_id && 'arXiv ' + r.draft.arxiv_id, r.draft.rec_kind && '来自 ' + r.draft.rec_kind].filter(Boolean).join(' · '),
        Object.keys(r.origins || {}).length ? h(NTag, { size: 'tiny', type: 'info', style: 'margin-left:6px', bordered: false }, () => 'arXiv 补全：' + Object.keys(r.origins).map((k) => FIELD_LABEL[k] || k).join('、')) : null,
      ]),
      r.draft.rec_reason ? h('div', { class: 'small', style: 'margin-top:3px;color:var(--ink-2)' }, '推荐理由：' + r.draft.rec_reason) : null,
    ]),
  },
  {
    title: '查重 / 合并', key: 'match', minWidth: 260,
    render: (r) => {
      if (r.note && !r.match) return h('span', { class: 'muted small' }, r.note);
      if (!r.match) return h('span', { class: 'pill leaf' }, '新论文');
      const m = r.match;
      const parts = [
        h('div', { class: 'small' }, [h('span', { class: 'pill ' + (m.certain ? 'sky' : 'tigger') }, m.certain ? '已存在' : '疑似重复'), ' ', h('a', { href: 'javascript:void 0', onClick: () => openPaper(m.id) }, `#${m.id} ${m.title.slice(0, 50)}`)]),
        h('div', { class: 'muted small' }, m.why + (r.note ? ' · ' + r.note : '')),
      ];
      if (r.action === 'merge' && r.merge) {
        const fill = Object.keys(r.merge.fill);
        if (fill.length) parts.push(h('div', { class: 'small' }, '补空字段：' + fill.map((k) => FIELD_LABEL[k] || k).join('、')));
        if (r.merge.links?.length) parts.push(h('div', { class: 'small' }, `保留 ${r.merge.links.length} 个其他版本链接`));
        for (const c of r.merge.conflicts || []) {
          parts.push(h('div', { class: 'small conflict' }, [
            h('div', `⚠️ ${FIELD_LABEL[c.field] || c.field}不一致`),
            h(NRadioGroup, { size: 'small', value: r.resolve[c.field] || 'keep', 'onUpdate:value': (v) => (r.resolve[c.field] = v) }, () => [
              h(NRadio, { value: 'keep' }, () => `保留：${String(c.old).slice(0, 40)}`),
              h(NRadio, { value: 'new' }, () => `改为：${String(c.new).slice(0, 40)}`),
            ]),
          ]));
        }
        parts.push(h(NCheckbox, { size: 'small', checked: r.new_plan, 'onUpdate:checked': (v) => (r.new_plan = v) }, () => '为这次推荐另建一轮阅读计划'));
      }
      return h('div', parts);
    },
  },
];

async function commit() {
  if (unresolved.value) return fail(new Error(`还有 ${unresolved.value} 条疑似重复需要你决定：合并、新建还是跳过`));
  busy.value = true;
  try {
    const payload = {
      import_key: importKey,
      source: { kind: source.kind, name: source.name || fileName.value || undefined, channel: source.channel || undefined, raw: text.value, feed_item_id: source.feed_item_id || undefined },
      items: items.value.map((i) => ({ draft: i.draft, raw: i.raw, origins: i.origins, action: i.action, target_id: i.action === 'merge' ? i.target_id : undefined, resolve: i.resolve, new_plan: i.new_plan })),
      defaults: { ...defaults },
    };
    result.value = await api.post('/import/commit', payload);
    step.value = 'done';
    toast('导入完成');
    changed();
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}

async function undo() {
  if (!result.value) return;
  if (!(await confirm('撤销这次导入？', '本次新建且之后没被你改动过的论文会被删除；补进已有论文的字段会改回原值。'))) return;
  try {
    const r = await api.post(`/sources/${result.value.source_id}/undo`, {});
    toast(`已撤销：删除 ${r.deleted.length} 篇，改回 ${r.reverted.length} 个字段${r.kept.length ? `，保留 ${r.kept.length} 篇（已被改动）` : ''}`);
    store.importOpen = false;
    changed();
  } catch (e) {
    fail(e);
  }
}

function copyPrompt() {
  navigator.clipboard?.writeText(PROMPT).then(() => toast('提示词已复制'));
}
</script>

<template>
  <NModal v-model:show="store.importOpen" preset="card" :title="step === 'done' ? '导入完成' : '导入论文'" style="width: min(1180px, 97vw)" :bordered="false" :mask-closable="false">
    <!-- 第一步：内容与默认值 -->
    <div v-if="step === 'input'" class="grid">
      <div>
        <div class="row" style="margin-bottom: 8px">
          <NSelect v-model:value="source.kind" :options="SOURCE_KINDS" style="width: 190px" />
          <NInput v-model:value="source.name" placeholder="来源名称，例如「Claude：检索增强相关工作」" style="flex: 1; min-width: 200px" />
        </div>
        <NInput v-model:value="text" type="textarea" :autosize="{ minRows: 12, maxRows: 22 }"
          placeholder="粘贴对话里的推荐（最好是 JSON）、Markdown 表格、BibTeX、链接列表，或飞书导出的 CSV……" />
        <div class="row" style="margin-top: 8px">
          <NUpload :show-file-list="false" accept=".csv,.tsv,.bib,.json,.md,.txt,.xlsx" :custom-request="() => {}" @before-upload="onFile">
            <NButton size="small">📎 上传文件</NButton>
          </NUpload>
          <span v-if="fileName" class="small muted">{{ fileName }}</span>
          <span class="grow" />
          <NCheckbox v-model:checked="opts.enrich">从 arXiv 补全元数据</NCheckbox>
          <NTooltip :disabled="store.llm.available">
            <template #trigger><NCheckbox v-model:checked="opts.use_llm" :disabled="!store.llm.available">用大模型解析自由文本</NCheckbox></template>
            服务器还没配置大模型；结构化内容（JSON / 表格 / BibTeX / 链接）不需要大模型。
          </NTooltip>
        </div>
        <NCollapse style="margin-top: 10px">
          <NCollapseItem title="让 Claude / GPT 按这个格式输出，导入最准确" name="p">
            <pre class="prompt">{{ PROMPT }}</pre>
            <NButton size="small" @click="copyPrompt">复制提示词</NButton>
          </NCollapseItem>
        </NCollapse>
      </div>
      <div class="defaults">
        <h3 style="margin-bottom: 8px">默认值 <span class="muted small">（条目里没写时使用）</span></h3>
        <div class="field-label">进入</div>
        <NRadioGroup v-model:value="defaults.stage" size="small">
          <NRadio value="library">正式清单</NRadio><NRadio value="candidate">候选区（之后再筛）</NRadio>
        </NRadioGroup>
        <div class="field-label" style="margin-top: 10px">推荐来源</div>
        <NSelect v-model:value="defaults.rec_kind" :options="optionList('rec_kinds')" clearable tag filterable size="small" />
        <div class="field-label" style="margin-top: 10px">推荐人</div>
        <NInput v-model:value="defaults.recommender" size="small" placeholder="例如导师姓名（可空）" />
        <div class="field-label" style="margin-top: 10px">论文组</div>
        <NSelect v-model:value="defaults.collection" :options="optionList('collections')" clearable tag filterable size="small" />
        <template v-if="defaults.stage === 'library'">
          <div class="row" style="margin-top: 12px"><NSwitch v-model:value="defaults.create_plan" size="small" /><span class="small">同时建立阅读计划</span></div>
          <template v-if="defaults.create_plan">
            <div class="field-label" style="margin-top: 8px">阅读原因</div>
            <NInput v-model:value="defaults.purpose" size="small" placeholder="为什么和当前工作相关" />
            <div class="row" style="margin-top: 8px">
              <NSelect v-model:value="defaults.priority" :options="optionList('priorities')" clearable placeholder="优先级" size="small" style="flex: 1" />
              <NSelect v-model:value="defaults.depth" :options="optionList('depths')" clearable placeholder="目标深度" size="small" style="flex: 1" />
            </div>
          </template>
        </template>
        <div class="field-label" style="margin-top: 10px">关联 Idea</div>
        <ItemPicker v-model="defaults.idea_id" type="idea" size="small" style="margin-top: 6px" />
      </div>
    </div>

    <!-- 第二步：预览 -->
    <div v-else-if="step === 'preview'">
      <NAlert v-for="w in preview?.warnings || []" :key="w" type="warning" style="margin-bottom: 8px">{{ w }}</NAlert>
      <div class="row" style="margin-bottom: 8px">
        <span>识别格式：<b>{{ ({ feishu: '飞书表格', json: 'JSON', csv: 'CSV', bibtex: 'BibTeX', markdown: 'Markdown 表格', lines: '链接列表', llm: '大模型解析', items: '结构化条目' })[preview?.format] || preview?.format }}</b></span>
        <span class="pill leaf">新建 {{ counts.create }}</span>
        <span class="pill sky">候选 {{ counts.candidate }}</span>
        <span class="pill">合并 {{ counts.merge }}</span>
        <span class="pill eeyore">跳过 {{ counts.skip }}</span>
        <span v-if="counts.review" class="pill tigger">待你决定 {{ counts.review }}</span>
      </div>
      <NDataTable :columns="columns" :data="items" :row-key="(r) => r.idx" size="small" :max-height="'58vh'" :scroll-x="820" />
      <div class="muted small" style="margin-top: 8px">规则：有 arXiv / DOI / 链接相同的视为同一篇，只补空字段并新增推荐记录；你的备注、阅读状态和笔记不会被覆盖；标题相似但没有标识符的，需要你决定。</div>
    </div>

    <!-- 第三步：结果 -->
    <div v-else-if="step === 'done' && result" class="done">
      <p>新建 <b>{{ result.created.length }}</b> 篇，进入候选区 <b>{{ result.candidates.length }}</b> 篇，合并到已有 <b>{{ result.merged.length }}</b> 篇，跳过 {{ result.skipped }} 条。</p>
      <p v-if="result.replayed" class="muted">这批内容之前已经导入过，没有重复写入。</p>
      <NAlert v-if="result.conflicts?.length" type="warning">有 {{ result.conflicts.length }} 处发表信息不一致，保留了原值。可以在论文详情的「溯源」里查看。</NAlert>
      <p class="muted small">来源记录 #{{ result.source_id }} 已保存原文，可在「设置 → 导入记录」里查看或撤销。</p>
    </div>

    <template #footer>
      <NSpace justify="end">
        <template v-if="step === 'input'">
          <NButton @click="store.importOpen = false">取消</NButton>
          <NButton type="primary" :loading="busy" @click="doPreview">预览</NButton>
        </template>
        <template v-else-if="step === 'preview'">
          <NButton @click="step = 'input'">返回修改</NButton>
          <NButton type="primary" :loading="busy" :disabled="!items.length" @click="commit">确认导入</NButton>
        </template>
        <template v-else>
          <NButton @click="undo">撤销这次导入</NButton>
          <NButton type="primary" @click="store.importOpen = false">完成</NButton>
        </template>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 18px; }
.defaults { background: var(--honey-mist); border-radius: 14px; padding: 12px 14px; }
.prompt { white-space: pre-wrap; font-size: 12px; background: var(--surface-warm); border: 1px dashed var(--line); padding: 8px 10px; border-radius: 8px; }
:deep(.conflict) { background: var(--surface-sand); border-radius: 8px; padding: 4px 8px; margin: 4px 0; }
.done p { font-size: 15px; }
@media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
</style>

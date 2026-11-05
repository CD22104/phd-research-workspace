<script setup>
import { reactive, ref, watch } from 'vue';
import { NButton, NInput, NInputNumber, NCheckboxGroup, NCheckbox, NSwitch, NDynamicTags, NSelect, NTabs, NTabPane, NDataTable, NModal, NTag } from 'naive-ui';
import { h } from 'vue';
import { api } from '../lib/api';
import { store, bootstrap, changed } from '../lib/store';
import { fail, toast, confirm } from '../lib/ui';
import { STATUS, download, fmtDateTime } from '../lib/format';
import { THEMES, theme, applyTheme } from '../lib/theme';

const s = reactive({});
const scoring = reactive({ day: { plan: 70, hours: 30 }, period: { goals: 70, hours: 20, checkin: 10 } });
const sources = ref([]);
const sourceView = ref(null);

function fill() {
  const st = store.settings;
  if (!st) return;
  Object.assign(s, {
    app_name: st.app_name, workdays: [...st.workdays], daily_hours: st.daily_target_minutes / 60,
    weekly_hours: st.weekly_target_minutes != null ? st.weekly_target_minutes / 60 : null, hours_in_score: st.hours_in_score, show_grades: st.show_grades,
    llm_provider: st.llm_provider, options: JSON.parse(JSON.stringify(st.options)),
  });
  const last = st.scoring_versions[st.scoring_versions.length - 1];
  Object.assign(scoring.day, last.day);
  Object.assign(scoring.period, last.period);
}
watch(() => store.settings, fill, { immediate: true });

async function save(extra = {}) {
  try {
    await api.put('/settings', {
      app_name: s.app_name, workdays: s.workdays, daily_target_minutes: Math.round((s.daily_hours || 0) * 60),
      weekly_target_minutes: s.weekly_hours != null ? Math.round(s.weekly_hours * 60) : null, hours_in_score: s.hours_in_score, show_grades: s.show_grades,
      llm_provider: s.llm_provider, options: s.options, ...extra,
    });
    toast('设置已保存');
    await bootstrap();
  } catch (e) {
    fail(e);
  }
}
// 换皮肤：立即生效，并保存到设置里（电脑和手机同步）
const themeSaving = ref('');
async function pickTheme(id) {
  if (id === theme.id || themeSaving.value) return;
  const prev = theme.id;
  applyTheme(id);
  themeSaving.value = id;
  try {
    await api.put('/settings', { theme: id });
    if (store.settings) store.settings.theme = id;
  } catch (e) {
    applyTheme(prev);
    fail(e);
  } finally {
    themeSaving.value = '';
  }
}

async function saveScoring() {
  if (!(await confirm('生成新的评分公式？', '新权重从今天起生效，之前的日子仍按原公式计算，历史分数不会变。'))) return;
  save({ scoring: { day: { ...scoring.day }, period: { ...scoring.period } } });
}

async function loadSources() {
  sources.value = (await api.get('/sources')).sources;
}
loadSources();
watch(() => store.version, loadSources);
async function viewSource(id) {
  sourceView.value = await api.get(`/sources/${id}`);
}
async function undo(src) {
  if (!(await confirm('撤销这次导入？', '本次新建且之后没被你改动过的论文会被删除；补进已有论文的字段会改回原值；被你改过的会保留。'))) return;
  try {
    const r = await api.post(`/sources/${src.id}/undo`, {});
    toast(`已撤销：删除 ${r.deleted.length} 篇，改回 ${r.reverted.length} 个字段${r.kept.length ? `，保留 ${r.kept.length} 篇` : ''}`);
    changed();
  } catch (e) {
    fail(e);
  }
}
const srcCols = [
  { title: '时间', key: 'created_at', width: 130, render: (r) => fmtDateTime(r.created_at) },
  { title: '类型', key: 'kind', width: 100, render: (r) => STATUS.source[r.kind] || r.kind },
  { title: '名称', key: 'name', ellipsis: { tooltip: true } },
  { title: '经由', key: 'actor', width: 70, render: (r) => ({ web: '网页', mcp: 'MCP', api: 'API', script: '脚本' })[r.actor] || r.actor },
  { title: '论文', key: 'rec_count', width: 110, render: (r) => `${r.rec_count} 条（新建 ${r.created_count}）` },
  {
    title: '', key: 'ops', width: 150,
    render: (r) => h('div', { class: 'row' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => viewSource(r.id) }, () => '查看原文'),
      r.undone_at ? h(NTag, { size: 'tiny', bordered: false }, () => '已撤销') : r.rec_count ? h(NButton, { size: 'tiny', quaternary: true, type: 'warning', onClick: () => undo(r) }, () => '撤销') : null,
    ]),
  },
];

async function exportAll() {
  try {
    const data = await api.get('/export');
    download(`research-workspace-backup-${store.today}.json`, JSON.stringify(data, null, 1));
  } catch (e) {
    fail(e);
  }
}
const WD = ['一', '二', '三', '四', '五', '六', '日'];
const OPTION_LABELS = { sides: '侧重', depths: '目标深度', priorities: '优先级', rec_kinds: '推荐来源', relations: 'Idea 与论文的关系' };
</script>

<template>
  <div class="page">
    <div class="page-head"><h1>⚙️ 设置</h1></div>
    <NTabs type="line" animated :default-value="$route.query.tab || 'basic'">
      <NTabPane name="basic" tab="基本">
        <div class="card form">
          <label>名字</label><NInput v-model:value="s.app_name" style="max-width: 260px" />
          <label>工作日</label>
          <NCheckboxGroup v-model:value="s.workdays"><NCheckbox v-for="(w, i) in WD" :key="i" :value="i + 1" :label="'周' + w" /></NCheckboxGroup>
          <label>每日计划工时</label><NInputNumber v-model:value="s.daily_hours" :min="0" :max="16" :step="0.5" style="width: 160px"><template #suffix>小时</template></NInputNumber>
          <label>每周计划工时</label><NInputNumber v-model:value="s.weekly_hours" :min="0" :step="1" clearable placeholder="留空 = 每日 × 工作日" style="width: 220px"><template #suffix>小时</template></NInputNumber>
          <label>工时计入评分</label><div class="row"><NSwitch v-model:value="s.hours_in_score" /><span class="muted small">达到计划值后封顶，不奖励加班</span></div>
          <label>显示执行等级</label><div class="row"><NSwitch v-model:value="s.show_grades" /><span class="muted small">S/A/B/C/D 只反映计划执行情况</span></div>
          <span /><NButton type="primary" style="width: 100px" @click="save()">保存</NButton>
        </div>
      </NTabPane>

      <NTabPane name="theme" tab="皮肤">
        <div class="card">
          <p class="muted small" style="margin-top: 0">点一下立即换肤；选择保存在设置里，电脑和手机同步。</p>
          <div class="theme-grid">
            <button v-for="t in THEMES" :key="t.id" class="theme-card" :class="{ on: theme.id === t.id }" :aria-pressed="theme.id === t.id"
              :data-testid="`theme-${t.id}`" :disabled="!!themeSaving" @click="pickTheme(t.id)">
              <span class="theme-preview" :style="{ background: t.swatch[2] }">
                <span class="tp-side" :style="{ background: t.swatch[0] }"><i :style="{ background: t.swatch[1] }" /></span>
                <span class="tp-main"><b :style="{ background: t.swatch[3] }" /><b :style="{ background: t.swatch[1] }" /><b class="tp-card" :style="{ background: t.dark ? '#1f2228' : '#ffffff' }" /></span>
              </span>
              <span class="theme-name">{{ t.name }}<span v-if="theme.id === t.id" class="pill leaf">使用中</span></span>
              <span class="muted small">{{ t.desc }}</span>
            </button>
          </div>
        </div>
      </NTabPane>

      <NTabPane name="mac" tab="Mac 菜单栏">
        <div class="card">
          <h3>把计时放到 Mac 菜单栏</h3>
          <p>显示专注时长，支持暂停、继续和多个后台任务。使用网站邮箱登录，无需模型 API Key。</p>
          <a href="/downloads/research-timer-macos.zip?v=1.1.0" download>下载 Mac 安装包 · v1.1.0</a>
          <ol style="padding-left:22px;line-height:1.9">
            <li>在 Mac 解压下载的文件。</li>
            <li>打开终端，输入 <code>bash </code>（末尾留一个空格），将「安装.command」拖入终端，按回车。</li>
            <li>按照终端提示安装；更新会替换旧版本，首次使用时在小工具窗口登录网站。</li>
          </ol>
          <p class="muted small">需要 macOS 12 或以上及 Apple Command Line Tools；缺少时脚本会提示安装。当前提供源码包，安装时在本机编译。新版的菜单栏显示仍待 Mac 实机确认。</p>
          <p class="small">顶部没有显示计时时，在小工具窗口点击「重新显示菜单栏」；菜单栏拥挤时可勾选「仅图标」。仍不显示可点击「复制诊断」帮助排查。更新小工具需要重新安装，刷新网站不会更新 Mac 程序。</p>
          <p class="muted small">每 30 秒同步一次。关闭窗口不退出计时；合盖或退出小工具也不会自动停止，请手动暂停或结束。</p>
        </div>
      </NTabPane>

      <NTabPane name="scoring" tab="评分公式">
        <div class="card">
          <p class="small">当前权重（修改后会生成新版本，从今天起生效，历史分数保持不变）：</p>
          <div class="form">
            <label>日评分</label>
            <div class="row">计划完成 <NInputNumber v-model:value="scoring.day.plan" :min="0" size="small" style="width: 90px" /> 工时达成 <NInputNumber v-model:value="scoring.day.hours" :min="0" size="small" style="width: 90px" /></div>
            <label>周 / 月评分</label>
            <div class="row">目标完成 <NInputNumber v-model:value="scoring.period.goals" :min="0" size="small" style="width: 90px" /> 工时达成 <NInputNumber v-model:value="scoring.period.hours" :min="0" size="small" style="width: 90px" /> 打卡 <NInputNumber v-model:value="scoring.period.checkin" :min="0" size="small" style="width: 90px" /></div>
            <span /><NButton type="primary" style="width: 160px" @click="saveScoring">保存为新版本</NButton>
          </div>
          <div class="rules small">
            <b>规则</b>
            <ul>
              <li>日评分：计划任务按工作量点数算完成率；打卡后临时加的任务单独显示，不计入完成率；没有计划任务时暂不评分。</li>
              <li>周 / 月评分：直接按本周期的目标（权重 × 进度）计算，不混入日评分平均；休息、请假日不计入应打卡天数。</li>
              <li>周期进行中显示「当前累计」和「截至今天应完成的目标」，周期结束后才是最终评分。</li>
              <li>放弃任务或目标算「计划调整」：不计入分母，但会在评分说明里列出来。顺延的任务算原来那天未完成。</li>
              <li>心情、精力只用于自我观察，不参与评分。</li>
            </ul>
            <b>历史版本</b>
            <div v-for="v in store.settings?.scoring_versions || []" :key="v.version" class="muted">v{{ v.version }}（{{ v.effective_from === '2000-01-01' ? '初始' : v.effective_from + ' 起' }}）：日 {{ v.day.plan }}/{{ v.day.hours }}，周月 {{ v.period.goals }}/{{ v.period.hours }}/{{ v.period.checkin }}</div>
          </div>
        </div>
      </NTabPane>

      <NTabPane name="options" tab="选项">
        <div class="card form">
          <template v-for="(label, k) in OPTION_LABELS" :key="k"><label>{{ label }}</label><NDynamicTags v-model:value="s.options[k]" /></template>
          <span /><NButton type="primary" style="width: 100px" @click="save()">保存</NButton>
        </div>
      </NTabPane>

      <NTabPane name="llm" tab="大模型">
        <div class="card form">
          <label>解析用模型</label>
          <NSelect v-model:value="s.llm_provider" :options="[{ label: '不使用', value: 'off' }, { label: 'DeepSeek', value: 'deepseek' }, { label: 'Claude', value: 'anthropic' }]" style="width: 200px" />
          <label>状态</label><span class="small">{{ store.llm.available ? '✅ 服务器已配置密钥' : '⚠️ 服务器还没有配置这个模型的密钥' }}</span>
          <span /><NButton type="primary" style="width: 100px" @click="save()">保存</NButton>
        </div>
        <div class="card small">
          <p>大模型只在你导入时勾选「用大模型解析」才会被调用，只用来从粘贴的文字里抽取论文条目；传入内容当作数据处理，模型不能修改或删除任何记录。</p>
          <p>Idea 和笔记默认标记为「不发送给外部模型」。主数据存放在你的 Cloudflare 账号里；经你允许的内容会发送给所选的模型服务。</p>
        </div>
      </NTabPane>

      <NTabPane name="sources" tab="导入记录">
        <div class="card">
          <p class="muted small">每次导入、对话写入、动态回传都是一条来源记录，保存实际传入的原文；可以整批撤销。</p>
          <NDataTable :columns="srcCols" :data="sources" size="small" :max-height="560" />
        </div>
      </NTabPane>

      <NTabPane name="data" tab="数据与备份">
        <div class="card">
          <p class="small">完整导出所有表（JSON），包括来源、变更记录和笔记正文。</p>
          <NButton type="primary" @click="exportAll">⬇️ 下载完整备份</NButton>
          <p class="muted small" style="margin-top: 12px">服务器端还有两层备份：Cloudflare D1 自带任意时间点恢复（免费版 7 天、付费版 30 天）；另外用 scripts/backup.sh 定期导出一致的数据库快照和 Markdown 到私有仓库（恢复方法见项目里的「交接文档.md」第 9 节）。</p>
        </div>
      </NTabPane>
    </NTabs>

    <NModal :show="!!sourceView" preset="card" :title="`来源 #${sourceView?.source.id}：${sourceView?.source.name || STATUS.source[sourceView?.source.kind] || ''}`" style="width: min(900px, 96vw)" @update:show="(v) => !v && (sourceView = null)">
      <template v-if="sourceView">
        <div class="small muted">{{ fmtDateTime(sourceView.source.created_at) }} · {{ STATUS.source[sourceView.source.kind] }} · 涉及 {{ sourceView.recommendations.length }} 篇论文 · {{ sourceView.changes.length }} 条字段修改</div>
        <div class="small" style="margin: 8px 0">
          <div v-for="r in sourceView.recommendations.slice(0, 30)" :key="r.id">· {{ r.title }} <span class="muted">（{{ ({ created: '新建', merged: '合并', duplicate_candidate: '疑似重复候选' })[r.action] }}）</span></div>
        </div>
        <b class="small">原文</b>
        <pre class="raw">{{ sourceView.source.raw || '（没有原文）' }}</pre>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.form { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px 14px; align-items: center; }
.form > label { font-size: 13px; color: var(--ink-2); text-align: right; }
.rules { margin-top: 16px; background: var(--honey-mist); border-radius: 12px; padding: 10px 14px; }
.rules ul { margin: 6px 0 10px; padding-left: 18px; line-height: 1.7; }
.raw { white-space: pre-wrap; word-break: break-all; font-size: 12px; max-height: 50vh; overflow: auto; background: var(--surface-soft); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line-soft); }
@media (max-width: 640px) { .form { grid-template-columns: 1fr; } .form > label { text-align: left; } }
.theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
.theme-card { display: grid; gap: 6px; text-align: left; padding: 10px; border: 1px solid var(--line-card); border-radius: 12px; background: var(--card); color: var(--ink); font: inherit; cursor: pointer; }
.theme-card:hover { border-color: var(--accent); }
.theme-card.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.theme-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.theme-preview { display: flex; height: 76px; border-radius: 8px; overflow: hidden; border: 1px solid var(--line-soft); }
.tp-side { width: 30%; display: flex; align-items: flex-start; justify-content: center; padding-top: 10px; }
.tp-side i { width: 60%; height: 8px; border-radius: 4px; }
.tp-main { flex: 1; display: grid; grid-template-rows: 12px 8px 1fr; gap: 6px; padding: 10px; }
.tp-main b { border-radius: 4px; }
.tp-main b:nth-child(2) { width: 55%; }
.tp-card { border: 1px solid rgba(127, 127, 127, 0.18); }
.theme-name { display: flex; align-items: center; gap: 8px; font-weight: 600; }
</style>

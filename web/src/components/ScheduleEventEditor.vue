<script setup>
import { store } from '../lib/store';
import { computed, reactive, ref, watch } from 'vue';
import { NButton, NInput, NModal, NSelect, NSwitch, NCheckbox, NCheckboxGroup } from 'naive-ui';
import { api, uuid } from '../lib/api';
import { addDays } from '../lib/format';
import { changed } from '../lib/store';
import { confirm, fail, toast } from '../lib/ui';

const props = defineProps({ show: Boolean, event: Object, date: String, kind: { type: String, default: 'meeting' } });
const emit = defineEmits(['update:show', 'saved']);
const busy = ref(false);
const error = ref('');
const frequency = ref('none'), until = ref(''), weekdays = ref([]), scope = ref('single');
const weekOptions = ['一','二','三','四','五','六','日'].map((label,i) => ({label:'周'+label,value:i+1}));
const repeatOptions = [{label:'不重复',value:'none'},{label:'每天',value:'daily'},{label:'每周',value:'weekly'},{label:'每两周',value:'biweekly'}];
const seriesRule = computed(() => { try { return JSON.parse(props.event?.recurrence || 'null'); } catch { return null; } });

const form = reactive({ title: '', date: '', kind: 'meeting', all_day: false, start_time: '', end_time: '', location: '', note: '', client_key: '' });
const kinds = [{ value: 'meeting', label: '会议' }, { value: 'course', label: '课程' }, { value: 'checkin', label: '打卡' }, { value: 'break', label: '休息活动' }, { value: 'other', label: '其他安排' }];
watch(() => props.show, (show) => {
  if (!show) return;
  const event = props.event || {};
  Object.assign(form, { title: event.title || '', date: event.date || props.date, kind: event.kind || props.kind, all_day: !!event.all_day,
    start_time: event.start_time || '', end_time: event.end_time || '', location: event.location || '', note: event.note || '', client_key: uuid() });
  frequency.value = 'none'; until.value = addDays(form.date, 84); weekdays.value = [new Date(form.date + 'T00:00:00Z').getUTCDay() || 7]; scope.value = 'single';
  error.value = '';
});
watch(() => form.date, (date, old) => {
  if (!props.event?.id && old && weekdays.value.length === 1 && weekdays.value[0] === (new Date(old + 'T00:00:00Z').getUTCDay() || 7)) weekdays.value = [new Date(date + 'T00:00:00Z').getUTCDay() || 7];
});
function close() { if (!busy.value) emit('update:show', false); }
async function save() {
  error.value = '';
  if (!form.title.trim()) { error.value = '请填写日程名称'; return; }
  if (!form.date) { error.value = '请选择日期'; return; }
  if (!form.all_day && (!form.start_time || !form.end_time || form.end_time <= form.start_time)) {
    error.value = '结束时间应晚于开始时间；跨天安排请分成两天。'; return;
  }
  busy.value = true;
  try {
    const payload = { ...form, start_time: form.all_day ? null : form.start_time, end_time: form.all_day ? null : form.end_time };
    if (props.event?.id) { delete payload.client_key; payload.scope = scope.value; }
    else if (frequency.value !== 'none') payload.recurrence = { frequency: frequency.value === 'daily' ? 'daily' : 'weekly', interval: frequency.value === 'biweekly' ? 2 : 1, weekdays: weekdays.value, until: until.value };
    const result = props.event?.id ? await api.patch(`/calendar/events/${props.event.id}`, payload) : await api.post('/calendar/events', payload);
    emit('update:show', false);
    emit('saved', result);
    changed();
    toast('日程已保存');
  } catch (e) { error.value = e.message || '保存失败，可以重试'; }
  finally { busy.value = false; }
}
async function remove() {
  if (!await confirm('删除日程', `删除「${props.event.title}」${scope.value === 'following' ? '的本次及以后所有安排' : '的本次安排'}？`, '删除')) return;
  busy.value = true;
  try {
    await api.del(`/calendar/events/${props.event.id}?scope=${scope.value}`);
    emit('update:show', false); emit('saved'); changed(); toast('日程已删除');
  } catch (e) { fail(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <NModal :show="show" preset="card" :title="event?.id ? '编辑日程' : '添加日程'" style="width: min(540px, 95vw)" :mask-closable="!busy" :close-on-esc="!busy" @update:show="close">
    <div class="event-form">
      <label>名称<NInput :input-props="{ 'data-testid': 'event-title' }" v-model:value="form.title" maxlength="200" placeholder="例如组会、机器学习课程、散步" :disabled="busy" /></label>
      <div class="event-fields">
        <label>日期<input data-testid="event-date" v-model="form.date" type="date" :disabled="busy || scope === 'following'" /></label>
        <label>类型<NSelect data-testid="event-kind" v-model:value="form.kind" :options="kinds" :disabled="busy" /></label>
      </div>
      <template v-if="!event?.id">
        <label>重复<NSelect v-model:value="frequency" :options="repeatOptions" :disabled="busy" data-testid="event-repeat" /></label>
        <template v-if="frequency !== 'none'">
          <label v-if="frequency !== 'daily'">每逢<NCheckboxGroup v-model:value="weekdays" :disabled="busy"><div class="repeat-weekdays"><NCheckbox v-for="day in weekOptions" :key="day.value" :value="day.value" :label="day.label" /></div></NCheckboxGroup></label>
          <label>截止日期（包含当天）<input v-model="until" type="date" :min="form.date" :disabled="busy" data-testid="event-repeat-until" /></label>
          <span class="small muted">首次日期需属于所选星期。按截止日期生成安排，一次最多 366 次。</span>
        </template>
      </template>
      <template v-if="event?.series_id">
        <div class="small muted">重复安排 · {{ seriesRule?.frequency === 'daily' ? '每天' : seriesRule?.interval === 2 ? '每两周' : '每周' }} · 截至 {{ seriesRule?.until }}</div>
        <label>修改 / 删除范围<NSelect v-model:value="scope" :options="[{label:'仅本次',value:'single'},{label:'本次及以后',value:'following'}]" :disabled="busy" data-testid="event-scope" /></label>
        <div v-if="scope === 'following'" class="small muted">批量修改保留各次日期。更换重复规则时，请先删除本次及以后，再新建安排。</div>
      </template>
      <label class="event-switch"><NSwitch data-testid="event-all-day" v-model:value="form.all_day" :disabled="busy" /> 全天安排</label>
      <div v-if="!form.all_day" class="event-fields">
        <label>开始<input data-testid="event-start" v-model="form.start_time" type="time" step="60" :disabled="busy" /></label>
        <label>结束<input data-testid="event-end" v-model="form.end_time" type="time" step="60" :disabled="busy" /></label>
      </div>
      <div class="small muted">时间按网站时区（{{ store.timezone }}）。休息活动按这里安排的时段保留；整天休息可在日程表设置。</div>
      <label>地点 / 会议链接<NInput v-model:value="form.location" maxlength="300" placeholder="可留空" :disabled="busy" /></label>
      <label>备注<NInput v-model:value="form.note" type="textarea" maxlength="5000" :autosize="{ minRows: 2, maxRows: 6 }" :disabled="busy" /></label>
      <div v-if="error" class="event-error" role="alert">{{ error }}</div>
    </div>
    <template #footer>
      <div class="event-actions">
        <NButton v-if="event?.id" data-testid="event-delete" quaternary type="error" :disabled="busy" @click="remove">删除</NButton>
        <span class="grow" />
        <NButton :disabled="busy" @click="close">取消</NButton>
        <NButton data-testid="event-save" type="primary" :loading="busy" @click="save">保存</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.repeat-weekdays { display:flex;flex-wrap:wrap;gap:8px; }
.event-form { display: grid; gap: 12px; }
.event-form label { display: grid; gap: 5px; font-size: 13px; color: var(--ink-2); min-width: 0; }
.event-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.event-form .event-switch { display: flex; align-items: center; gap: 9px; }
.event-form input { box-sizing: border-box; min-width: 0; width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); font: inherit; color: var(--ink); }
.event-form input:focus { outline: 2px solid var(--honey); outline-offset: 1px; }
.event-actions { display: flex; align-items: center; gap: 8px; }
.event-error { color: var(--danger); font-size: 13px; }
</style>

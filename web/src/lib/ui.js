// 让非组件代码也能弹提示 / 确认框（由 App.vue 里的 UiBridge 注入）
export const ui = { message: null, dialog: null, notification: null };

export function toast(msg, type = 'success') {
  ui.message?.[type]?.(msg);
}

export function fail(e) {
  ui.message?.error(e?.message || String(e), { duration: 5000 });
}

export function confirm(title, content, positiveText = '确定') {
  return new Promise((resolve) => {
    ui.dialog.warning({
      title, content, positiveText, negativeText: '取消',
      onPositiveClick: () => resolve(true), onNegativeClick: () => resolve(false), onClose: () => resolve(false), onMaskClick: () => resolve(false),
    });
  });
}

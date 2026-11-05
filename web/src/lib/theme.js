// 皮肤：颜色都定义在 style.css（默认）和 themes.css（其他皮肤）的 CSS 变量里。
// Naive UI 和 ECharts 需要具体颜色值，这里在切换皮肤后从 CSS 变量读出来。
import { reactive } from 'vue';

export const THEMES = [
  { id: 'matcha', name: '抹茶橄榄', desc: '橄榄绿侧栏、白色卡片、沙金点缀（默认）', dark: false, swatch: ['#486432', '#c2af89', '#f6f5f0', '#424242'] },
  { id: 'honey', name: '蜂蜜小熊', desc: '暖黄侧栏、奶油底色和小熊吉祥物', dark: false, mascot: true, swatch: ['#f6c452', '#a8620c', '#fff8ea', '#5b3d22'] },
  { id: 'blackgold', name: '黑金', desc: '暖黑侧栏、香槟金点缀', dark: false, swatch: ['#242321', '#cfbb90', '#f6f4ef', '#3d362b'] },
  { id: 'seasalt', name: '海盐蓝', desc: '深海蓝侧栏、白底和雾蓝点缀', dark: false, swatch: ['#24476a', '#9fd0e6', '#f3f7fa', '#2d6a8f'] },
  { id: 'night', name: '夜间深色', desc: '整页深色，夜里不刺眼', dark: true, swatch: ['#111316', '#8fbf73', '#1f2228', '#d8c48f'] },
];
export const DEFAULT_THEME = 'matcha';
const KEY = 'workspace-theme';

export const theme = reactive({ id: DEFAULT_THEME, dark: false, mascot: false, tokens: {}, version: 0 });

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue('--' + name).trim();
  const names = ['accent', 'accent-hover', 'accent-deep', 'on-accent', 'ink', 'ink-2', 'ink-3', 'placeholder', 'line', 'line-soft', 'line-card',
    'card', 'table-head', 'hover', 'danger', 'warning', 'info', 'track', 'menu-active-bg', 'menu-active-hover', 'sidebar-ink', 'sidebar-hover',
    'sidebar-hover-ink', 'sidebar-active-bg', 'sidebar-active-ink', 'chart-grid', 'chart-zero', 'chart-ramp-1', 'chart-ramp-2', 'chart-ramp-3',
    'chart-ramp-4', 'chart-ramp-5', 'shadow-ink', 'surface-muted', 'sand', 'font'];
  return Object.fromEntries(names.map((n) => [n, v(n)]));
}

let fontLoaded = false;
function ensureCuteFont() {
  if (fontLoaded) return;
  fontLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap';
  document.head.appendChild(link);
}

/** 切换皮肤：改 <html data-theme>，记住在本机（下次打开不闪），并重新读取颜色 */
export function applyTheme(id) {
  const t = themeById(id);
  if (t.id === DEFAULT_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t.id;
  if (t.mascot) ensureCuteFont();
  try {
    localStorage.setItem(KEY, t.id);
  } catch {
    /* 隐私模式下没有本地存储也没关系 */
  }
  Object.assign(theme, { id: t.id, dark: t.dark, mascot: !!t.mascot, tokens: readTokens() });
  theme.version++;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--sidebar-bg').trim() || '#486432');
}

/** 页面加载时先用本机记住的皮肤，避免先闪一下默认配色 */
export function applySavedTheme() {
  let id = DEFAULT_THEME;
  try {
    id = localStorage.getItem(KEY) || DEFAULT_THEME;
  } catch {
    /* 忽略 */
  }
  applyTheme(id);
}

export function naiveOverrides(t) {
  return {
    common: {
      primaryColor: t.accent, primaryColorHover: t['accent-hover'], primaryColorPressed: t['accent-deep'], primaryColorSuppl: t.accent,
      infoColor: t.info, infoColorHover: t.ink, successColor: t.accent, successColorHover: t['accent-hover'],
      warningColor: t.warning, warningColorHover: t.warning, errorColor: t.danger, errorColorHover: t.danger,
      textColorBase: t.ink, textColor1: t.ink, textColor2: t['ink-2'], textColor3: t['ink-3'], placeholderColor: t.placeholder,
      borderColor: t.line, dividerColor: t['line-soft'], bodyColor: t.card, cardColor: t.card, modalColor: t.card, popoverColor: t.card,
      tableColor: t.card, tableHeaderColor: t['table-head'], hoverColor: t.hover, borderRadius: '8px', borderRadiusSmall: '6px',
      fontFamily: t.font || "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif",
    },
    Button: {
      borderRadiusMedium: '8px', borderRadiusSmall: '7px', borderRadiusLarge: '10px', fontWeight: '500',
      textColorPrimary: t['on-accent'], textColorHoverPrimary: t['on-accent'], textColorPressedPrimary: t['on-accent'], textColorFocusPrimary: t['on-accent'],
      textColorSuccess: t['on-accent'], textColorHoverSuccess: t['on-accent'], textColorPressedSuccess: t['on-accent'], textColorFocusSuccess: t['on-accent'],
    },
    Card: { borderRadius: '14px', borderColor: t['line-card'] },
    Tag: { borderRadius: '6px' },
    Input: { borderRadius: '8px' },
    DataTable: { thColor: t['table-head'], thTextColor: t['ink-2'], tdColor: t.card, tdColorHover: t.hover, borderColor: t['line-soft'], thFontWeight: '600' },
    Menu: {
      itemColorActive: t['menu-active-bg'], itemColorActiveHover: t['menu-active-hover'], itemTextColorActive: t['accent-deep'], itemIconColorActive: t['accent-deep'],
      itemColorHover: t.hover, itemTextColorHover: t.ink, itemTextColor: t['ink-2'], borderRadius: '9px', itemHeight: '44px',
    },
    Progress: { fillColor: t.accent, railColor: t.track },
    Drawer: { color: t.card },
    Slider: { fillColor: t.accent, fillColorHover: t['accent-hover'], railColor: t.track },
  };
}

export function sidebarMenuOverrides(t) {
  return {
    itemColorActive: t['sidebar-active-bg'], itemColorActiveHover: t['sidebar-active-bg'], itemTextColorActive: t['sidebar-active-ink'],
    itemIconColorActive: t['sidebar-active-ink'], itemTextColorActiveHover: t['sidebar-active-ink'], itemIconColorActiveHover: t['sidebar-active-ink'],
    itemColorHover: t['sidebar-hover'], itemTextColorHover: t['sidebar-hover-ink'], itemIconColorHover: t['sidebar-hover-ink'],
    itemTextColor: t['sidebar-ink'], itemIconColor: t['sidebar-ink'], borderRadius: '9px', itemHeight: '44px',
  };
}

/** 统计图用的颜色 */
export function chartColors(t) {
  return {
    series: t.accent, ramp: [1, 2, 3, 4, 5].map((i) => t['chart-ramp-' + i]), zero: t['chart-zero'], ink: t['ink-2'], muted: t['ink-3'],
    grid: t['chart-grid'], tipBg: t.card, tipBorder: t.line, tipInk: t.ink, ring: t.card, shadow: t['shadow-ink'],
  };
}

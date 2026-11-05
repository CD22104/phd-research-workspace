<script setup>
// 蜂蜜罐：分数越高罐子越满；没有分数时显示空罐
import { computed } from 'vue';
const props = defineProps({ score: { type: Number, default: null }, grade: { type: String, default: null }, size: { type: Number, default: 86 }, showGrade: { type: Boolean, default: true } });
const level = computed(() => (props.score == null ? 0 : Math.max(0, Math.min(100, props.score))));
const fillY = computed(() => 104 - (level.value / 100) * 62);
const id = 'jar' + Math.random().toString(36).slice(2, 8);
</script>

<template>
  <div class="jar" :style="{ width: size + 'px' }">
    <svg :width="size" :height="size * 1.12" viewBox="0 0 100 112" aria-hidden="true">
      <defs>
        <clipPath :id="id"><path d="M22 40 Q14 44 14 60 L16 96 Q18 106 30 106 L70 106 Q82 106 84 96 L86 60 Q86 44 78 40 Z" /></clipPath>
        <linearGradient :id="id + 'g'" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FFC94D" /><stop offset="1" stop-color="#E9951F" /></linearGradient>
      </defs>
      <path d="M22 40 Q14 44 14 60 L16 96 Q18 106 30 106 L70 106 Q82 106 84 96 L86 60 Q86 44 78 40 Z" fill="#FFF7E6" stroke="#8A5A1F" stroke-width="3" />
      <g :clip-path="`url(#${id})`">
        <rect x="0" :y="fillY" width="100" height="120" :fill="`url(#${id}g)`" class="honey" />
        <path :d="`M0 ${fillY} q12 -5 25 0 t25 0 t25 0 t25 0 v6 h-100z`" fill="#FFD66B" class="honey" />
      </g>
      <rect x="20" y="26" width="60" height="14" rx="6" fill="#C98A3B" stroke="#8A5A1F" stroke-width="3" />
      <path d="M28 26 Q30 14 50 14 Q70 14 72 26" fill="#E9A64A" stroke="#8A5A1F" stroke-width="3" />
      <rect x="30" y="56" width="40" height="18" rx="4" fill="#FFFDF6" stroke="#8A5A1F" stroke-width="2" opacity=".92" />
      <text x="50" y="69.5" text-anchor="middle" font-size="11" font-weight="700" fill="#8A5A1F" font-family="ZCOOL KuaiLe, sans-serif">HUNNY</text>
    </svg>
    <div class="label">
      <template v-if="score != null">
        <b>{{ score }}</b><span v-if="showGrade && grade" class="grade">{{ grade }}</span>
      </template>
      <span v-else class="muted small">暂不评分</span>
    </div>
  </div>
</template>

<style scoped>
.jar { display: flex; flex-direction: column; align-items: center; }
.honey { transition: y 0.8s ease, d 0.8s ease; }
.label { margin-top: -2px; display: flex; align-items: baseline; gap: 5px; font-family: var(--font-cute); }
.label b { font-size: 24px; color: var(--ink); font-weight: normal; }
.grade { font-size: 14px; color: #fff; background: var(--honey-deep); border-radius: 999px; padding: 0 8px; line-height: 20px; }
</style>

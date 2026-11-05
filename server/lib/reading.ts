const PRIO_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** 由阅读计划推出论文的阅读状态（界面仍是一张表） */
export function readingState(plans: any[]) {
  const open = plans.filter((p) => p.status === 'planned' || p.status === 'reading');
  const done = plans.filter((p) => p.status === 'done').sort((a, b) => String(a.done_at || a.updated_at).localeCompare(String(b.done_at || b.updated_at)));
  const lastDone = done[done.length - 1];
  let state = 'none';
  if (open.some((p) => p.status === 'reading')) state = 'reading';
  else if (open.length && done.length) state = 'done_more';
  else if (open.length) state = 'planned';
  else if (done.length) state = 'done';
  else if (plans.length) state = 'dropped';
  const prio = open.map((p) => p.priority).filter(Boolean).sort((a, b) => (PRIO_ORDER[a] ?? 9) - (PRIO_ORDER[b] ?? 9))[0] ?? null;
  const target = open[0]?.depth ?? null;
  return { state, open: open.length, done: done.length, done_depth: lastDone?.depth ?? null, done_at: lastDone?.done_at ?? null, target_depth: target, priority: prio, target_focus: open[0]?.focus_sections ?? null, target_purpose: open[0]?.purpose ?? null };
}


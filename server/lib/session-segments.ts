import { addDays, localMidnightMs, splitByLocalDay } from './time';
// Keep original timestamps for editing; display and sum only the selected local-day slice.
export function sessionSegments(rows: any[], from: string, to: string, tz: string, now=Date.now()) {
  const lower=localMidnightMs(from,tz),upper=localMidnightMs(addDays(to,1),tz);
  return rows.flatMap(row=>{
    const start=Math.max(Date.parse(row.start_at),lower),end=Math.min(Date.parse(row.end_at || new Date(now).toISOString()),upper);
    return Object.entries(splitByLocalDay(start,end,tz)).map(([date,minutes])=>({...row,date,minutes,
      segment_start:new Date(Math.max(start,localMidnightMs(date,tz))).toISOString(),
      segment_end:new Date(Math.min(end,localMidnightMs(addDays(date,1),tz))).toISOString(),
      segment_active:!row.end_at && end===now && Math.min(end,localMidnightMs(addDays(date,1),tz))===now}));
  }).sort((a,b)=>b.segment_start.localeCompare(a.segment_start));
}

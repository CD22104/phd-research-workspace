import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSchedule, sortedSchedule } from '../web/src/lib/calendar-summary.js';
const event = (start, end, extra = {}) => ({ start_time: start, end_time: end, all_day: false, ...extra });
test('overlapping, nested and adjacent events count each minute once', () => {
 const events = [event('10:00','11:00'),event('10:30','12:00'),event('10:40','10:50'),event('12:00','13:00'),event('16:00','16:30')];
 assert.deepEqual(summarizeSchedule(events), { minutes: 210, allDay: 0, overlap: true });
 assert.deepEqual(summarizeSchedule([event('10:00','11:00'),event('11:00','12:00')]), { minutes: 120, allDay: 0, overlap: false });
});
test('all-day entries remain separate instead of treating a day as 24 available hours', () => {
 assert.deepEqual(summarizeSchedule([event(null,null,{all_day:1}),event('14:00','15:30')]), { minutes:90,allDay:1,overlap:false });
 assert.deepEqual(summarizeSchedule([{all_day:1}]), { minutes:0,allDay:1,overlap:false });
 assert.deepEqual(summarizeSchedule([]), { minutes:0,allDay:0,overlap:false });
});
test('local times include breaks and check-ins, and are independent of browser timezone', () => {
 const events=[event('00:00','00:30',{kind:'checkin'}),event('20:00','21:00',{kind:'break'}),event('23:00','23:59')];
 assert.equal(summarizeSchedule(events).minutes,149);
 assert.equal(summarizeSchedule([event('invalid','11:00'),event(null,null),event('18:00','09:00'),event('12:00','12:00')]).minutes,0);
});
test('display sorting preserves the original data and puts all-day first', () => {
 const events=[event('14:00','15:00',{id:1}),event('09:00','10:00',{id:2}),event(null,null,{id:3,all_day:1})];
 assert.deepEqual(sortedSchedule(events).map(e=>e.id),[3,2,1]);
 assert.deepEqual(events.map(e=>e.id),[1,2,3]);
});

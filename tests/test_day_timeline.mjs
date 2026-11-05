import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutTimeline,plannedMinutes,moveSlot,nextFreeMinute,minuteOf,timeLabel} from '../web/src/lib/day-timeline.js';
test('Overlaps use separate lanes and count occupied clock time once',()=>{
 const items=[{key:'a',start:540,end:630},{key:'b',start:600,end:660},{key:'c',start:630,end:690},{key:'d',start:690,end:750}];
 const rows=layoutTimeline(items);
 assert.deepEqual(rows.map(x=>[x.lane,x.lanes]),[[0,2],[1,2],[0,2],[0,1]]);
 assert.equal(plannedMinutes(rows),210);
 assert(!('lane' in items[0]));
 for(const a of rows)for(const b of rows)if(a.key!==b.key&&a.start<b.end&&a.end>b.start)assert.notEqual(a.lane,b.lane);
});
test('Dragging keeps duration at midnight boundaries and snaps to quarters',()=>{
 assert.deepEqual(moveSlot(30,90,-90),{start:0,end:60});
 assert.deepEqual(moveSlot(1380,1440,100),{start:1380,end:1440});
 assert.deepEqual(moveSlot(540,600,22),{start:555,end:615});
 assert.equal(timeLabel(1440),'24:00');assert.equal(minuteOf('23:59'),1439);assert.equal(minuteOf('24:00'),null);
});
test('New slots find a gap among calendar events and planned tasks',()=>{
 assert.equal(nextFreeMinute([{start:540,end:630},{start:600,end:660},{start:720,end:780}]),660);
 assert.equal(nextFreeMinute([{start:0,end:1440}]),1380);
 assert.deepEqual(layoutTimeline([{key:'bad',start:null,end:600}]),[]);
});

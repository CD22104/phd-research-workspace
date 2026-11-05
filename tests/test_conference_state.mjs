import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConferences } from '../web/src/lib/conference-state.js';
test('late bootstrap cannot undo confirmation or cancellation',()=>{
 const saved={key:'naacl-2027',version:4,planned:true};
 const old={...saved,version:3,planned:false};
 assert.deepEqual(mergeConferences([saved],[old]),[saved]);
 const cancelled={...saved,version:5,planned:false};
 assert.deepEqual(mergeConferences([cancelled],[saved]),[cancelled]);
 assert.deepEqual(mergeConferences([saved],[cancelled]),[cancelled]);
});
test('catalog updates and independently saved targets survive snapshot merge',()=>{
 const cvpr={key:'cvpr-2027',version:2,planned:true,name:'CVPR'};
 const naacl={key:'naacl-2027',version:1,planned:false};
 const fresh={...cvpr,milestones:[{id:'registration'}]};
 const newest={...naacl,planned:true,version:2};
 assert.deepEqual(mergeConferences([cvpr,newest],[fresh,naacl,{key:'acl-2027',version:0}]),[fresh,newest,{key:'acl-2027',version:0}]);
});

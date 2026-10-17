const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DAY,active,canRead,imageBytes}=require('../policy');
const now=1700000000000;
const story={state:'ready',owner:'alice',createdAt:now,expiresAt:now+DAY};
test('expires at exactly 24 hours, without depending on R2 cleanup',()=>{
 assert.equal(active(story,now+DAY-1),true);
 assert.equal(active(story,now+DAY),false);
 assert.equal(canRead(story,'alice',true,now+DAY+1),false);
});
test('owner and mutual unblocked friends only',()=>{
 assert.equal(canRead(story,'alice',false,now),true);
 assert.equal(canRead(story,'bob',true,now),true);
 for(const relation of [false,undefined,null,'true'])assert.equal(canRead(story,'stranger',relation,now),false);
});
test('pending, deleted and malformed stories never leak media',()=>{
 for(const state of ['pending','deleted',undefined])assert.equal(canRead({...story,state},'alice',true,now),false);
 assert.equal(active({...story,expiresAt:NaN},now),false);
 assert.equal(active(undefined,now),false);
});
test('rejects SVG, arbitrary payloads and oversized images',()=>{
 for(const data of ['data:image/svg+xml;base64,PHN2Zz4=',{},'https://example.com/photo.jpg','data:image/jpeg;base64,????'])assert.throws(()=>imageBytes(data),e=>e.status===400);
 assert.throws(()=>imageBytes('x'.repeat(6*1024*1024+1)),e=>e.status===413);
 assert.throws(()=>imageBytes('data:image/jpeg;base64,PHN2Zz4='),e=>e.status===400);
 assert.deepEqual(imageBytes('data:image/jpeg;base64,/9j/'),Buffer.from([255,216,255]));
});

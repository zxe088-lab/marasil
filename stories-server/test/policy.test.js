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
test('sound: only allowed audio types with a matching signature and size',()=>{
 const {audioBytes}=require('../policy');
 const mp4='data:audio/mp4;base64,'+Buffer.from([0,0,0,24,102,116,121,112,77,52,65,32]).toString('base64');
 assert.equal(audioBytes(mp4).type,'audio/mp4');
 for(const data of [{},'data:audio/mp4;base64,????','data:video/mp4;base64,AAAA','data:audio/svg;base64,AAAA','data:audio/mp4;base64,'+Buffer.from('not audio at all').toString('base64')])assert.throws(()=>audioBytes(data),e=>e.status===400);
 assert.throws(()=>audioBytes('data:audio/mp4;base64,'+'A'.repeat(4.4*1024*1024)),e=>e.status===413);
});
test('story video: MP4/MOV only, signature checked, size bounded',()=>{
 const {videoBytes}=require('../policy');
 const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(64)]);
 const ok=videoBytes('data:video/mp4;base64,'+mp4.toString('base64'));
 assert.equal(ok.type,'video/mp4');assert.equal(ok.bytes.length,mp4.length);
 assert.equal(videoBytes('data:video/quicktime;base64,'+mp4.toString('base64')).type,'video/quicktime');
 assert.throws(()=>videoBytes('data:video/webm;base64,'+mp4.toString('base64')));
 assert.throws(()=>videoBytes('data:video/mp4;base64,'+Buffer.from('not a video at all').toString('base64')));
 assert.throws(()=>videoBytes(42));
});

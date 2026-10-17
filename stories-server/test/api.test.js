const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
function harness(){
 const docs=new Map(),writes=[],objects=[];let handler;let current='bob';
 const snap=(id)=>({exists:docs.has(id),data:()=>docs.get(id),id:id.split('/').at(-1),ref:ref(id)});
 function ref(id){return {id:id.split('/').at(-1),get:async()=>snap(id),set:async d=>{docs.set(id,d);},update:async d=>{docs.set(id,{...docs.get(id),...d});},collection:p=>collection(id+'/'+p)};}
 function collection(id){return {doc:key=>ref(id+'/'+(key||'message1')),where:()=>collection(id),limit:()=>collection(id),get:async()=>({docs:[],empty:true}),add:async d=>writes.push(d)};}
 const db={doc:ref,collection,getAll:async(...refs)=>refs.map(r=>snap([...docs.keys()].find(k=>k.endsWith('/'+r.id)&&false))),recursiveDelete:async r=>writes.push({delete:r.id}),runTransaction:async fn=>fn({get:async r=>r.get(),set:(r,d)=>writes.push({id:r.id,data:d}),create:(r,d)=>writes.push({id:r.id,data:d})})};
 // Preserve full document paths in getAll for bilateral contacts and blocks.
 const originalRef=ref;
 db.doc=id=>({...originalRef(id),fullPath:id});
 db.getAll=async(...refs)=>refs.map(r=>snap(r.fullPath));
 const Command=class{constructor(input){this.input=input;}};
 const mocks={
 'node:http':{createServer:fn=>{handler=fn;return {listen:()=>{},};}},
 'firebase-admin/app':{initializeApp:()=>{},cert:x=>x},
 'firebase-admin/auth':{getAuth:()=>({verifyIdToken:async token=>{if(token!=='valid')throw Error('invalid');return {uid:current};}})},
 'firebase-admin/firestore':{getFirestore:()=>db,Timestamp:{fromMillis:n=>n,now:()=>Date.now()}},
 '@aws-sdk/client-s3':{S3Client:class{async send(c){objects.push(c.input);return {Body:{transformToByteArray:async()=>new Uint8Array([1,2])}};}},PutObjectCommand:Command,GetObjectCommand:Command,DeleteObjectCommand:Command,ListObjectsV2Command:Command},
 'sharp':()=>({rotate(){return this;},resize(){return this;},jpeg(){return this;},toBuffer:async()=>Buffer.from('jpeg')}),
 './policy':require('../policy')
 };
 const context={require:name=>name.endsWith('firebase-admin.json')?{}:mocks[name]||require(name),process:{env:{R2_ACCOUNT_ID:'test',R2_ACCESS_KEY_ID:'test',R2_SECRET_ACCESS_KEY:'test',R2_BUCKET:'test'},argv:[]},Buffer,URL,console,setInterval:()=>({unref(){}})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),context);
 for(const id of ['users/alice','users/bob','users/alice/contacts/bob','users/bob/contacts/alice'])docs.set(id,{});
 docs.set('stories/story1',{owner:'alice',state:'ready',key:'private.jpg',createdAt:Date.now(),expiresAt:Date.now()+86400000});
 async function call(method,url,body,token='valid'){
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url,headers:{authorization:token?'Bearer '+token:undefined}});
  const res={headers:{},statusCode:200,headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(c){this.statusCode=c;},end(data){this.body=data;this.headersSent=true;}};
  await handler(req,res);return res;
 }
 return {docs,objects,writes,call,setUser:u=>current=u};
}
test('anonymous and invalid tokens never access R2',async()=>{const h=harness();assert.equal((await h.call('GET','/api/stories/story1/media',null,null)).statusCode,401);assert.equal((await h.call('GET','/api/stories/story1/media',null,'invalid')).statusCode,401);assert.equal(h.objects.length,0);});
test('mutual friends can read; either block and one-way friendship deny',async()=>{
 const h=harness();assert.equal((await h.call('GET','/api/stories/story1/media')).statusCode,200);
 for(const block of ['users/alice/blocked/bob','users/bob/blocked/alice']){h.docs.set(block,{});assert.equal((await h.call('GET','/api/stories/story1/media')).statusCode,403);h.docs.delete(block);}
 h.docs.delete('users/alice/contacts/bob');assert.equal((await h.call('GET','/api/stories/story1/media')).statusCode,403);assert.equal(h.objects.length,1);
});
test('expired and deleted media deny even while object exists',async()=>{const h=harness();h.docs.get('stories/story1').expiresAt=Date.now()-1;assert.equal((await h.call('GET','/api/stories/story1/media')).statusCode,410);h.docs.get('stories/story1').expiresAt=Date.now()+9999;h.docs.get('stories/story1').state='deleted';assert.equal((await h.call('GET','/api/stories/story1/media')).statusCode,410);assert.equal(h.objects.length,0);});
test('only owner can delete or list viewers',async()=>{const h=harness();assert.equal((await h.call('DELETE','/api/stories/story1')).statusCode,403);assert.equal((await h.call('GET','/api/stories/story1/views')).statusCode,403);h.setUser('alice');assert.equal((await h.call('DELETE','/api/stories/story1')).statusCode,200);assert.equal(h.docs.get('stories/story1').state,'deleted');});
test('reply uses authenticated sender and story owner; quote has no image',async()=>{const h=harness();const res=await h.call('POST','/api/stories/story1/reply',{text:'hello',owner:'attacker',from:'attacker'});assert.equal(res.statusCode,200);const m=h.writes.find(w=>w.id==='message1').data;assert.equal(m.from,'bob');assert.equal(m.story.owner,'alice');assert.equal(m.story.image,undefined);assert.equal(m.ts<m.expiresAt,true);assert.equal(JSON.parse(res.body).chatId,'alice_bob');});
test('expired story cannot receive reply',async()=>{const h=harness();h.docs.get('stories/story1').expiresAt=Date.now()-1;assert.equal((await h.call('POST','/api/stories/story1/reply',{text:'late'})).statusCode,410);assert.equal(h.writes.length,0);});
test('photo replies store their own image rather than a story object URL',async()=>{
 const h=harness();const res=await h.call('POST','/api/stories/story1/reply',{image:'data:image/jpeg;base64,/9j/'});
 assert.equal(res.statusCode,200);const m=h.writes.find(w=>w.id==='message1').data;
 assert.equal(m.image,'data:image/jpeg;base64,anBlZw==');assert.equal(h.objects.length,0);
 assert.equal(Object.hasOwn(m.story,'key'),false);
});
test('removed owner profile prevents friends reading a previously published story',async()=>{const h=harness();h.docs.delete('users/alice');assert.equal((await h.call('GET','/api/stories/story1/media')).statusCode,403);assert.equal(h.objects.length,0);});

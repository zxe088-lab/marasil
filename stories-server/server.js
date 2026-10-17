'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const {initializeApp, cert} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const {S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command} = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const {DAY, fail, active, canRead, imageBytes, audioBytes} = require('./policy');
for (const key of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET']) if (!process.env[key]) throw new Error('Missing '+key);
const serviceAccount = require(path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS || './firebase-admin.json'));
initializeApp({credential:cert(serviceAccount)});
const db = getFirestore(), auth = getAuth();
const r2 = new S3Client({region:'auto', endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
const Bucket = process.env.R2_BUCKET;
const origins = new Set((process.env.STORIES_ORIGINS || 'capacitor://localhost,http://localhost,https://localhost').split(',').map(s=>s.trim()));
const storyRef = id => db.collection('stories').doc(id);
const validId = id => /^[A-Za-z0-9_-]{1,128}$/.test(id);
async function friends(a,b) {
  if (a===b) return true;
  const docs = await db.getAll(...[`users/${a}`,`users/${b}`,`users/${a}/contacts/${b}`,`users/${b}/contacts/${a}`,`users/${a}/blocked/${b}`,`users/${b}/blocked/${a}`].map(p=>db.doc(p)));
  return docs.slice(0,4).every(d=>d.exists) && !docs[4].exists && !docs[5].exists;
}
async function loadStory(id,uid) {
  if (!validId(id)) fail(400,'طلب غير صالح');
  const doc=await storyRef(id).get(), story=doc.data();
  if (!active(story)) fail(410,'انتهت اليومية');
  if (!canRead(story,uid,await friends(uid,story.owner))) fail(403,'اليومية للأصدقاء فقط');
  return {id:doc.id,...story};
}
// Persistent daily limits also bound concurrent uploads and survive restarts.
async function quota(uid, kind, maximum) {
  const ref=db.doc(`storyLimits/${uid}_${kind}_${Math.floor(Date.now()/DAY)}`);
  await db.runTransaction(async tx=>{
    const doc=await tx.get(ref), count=doc.data()?.count||0;
    if(count>=maximum) fail(429,'وصلت للحد اليومي، حاول غدًا');
    tx.set(ref,{count:count+1,expiresAt:Timestamp.fromMillis(Date.now()+2*DAY)});
  });
}
async function normalize(data, reply=false) {
  const bytes=imageBytes(data);
  try {
    const out=await sharp(bytes,{limitInputPixels:25000000,animated:false}).rotate().resize({width:reply?1000:1920,height:reply?1000:1920,fit:'inside',withoutEnlargement:true}).jpeg({quality:reply?72:85}).toBuffer();
    if(out.length>(reply?500000:3*1024*1024)) fail(413,'الصورة كبيرة، اختر صورة أصغر');
    return out;
  } catch(e) { if(e.status)throw e;fail(400,'تعذّر قراءة الصورة'); }
}
async function jsonBody(req, limit=6*1024*1024) {
  let size=0; const chunks=[];
  for await(const chunk of req) { size+=chunk.length;if(size>limit)fail(413,'الملف كبير');chunks.push(chunk); }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'طلب غير صالح');}
}
const summary=s=>({id:s.id,owner:s.owner,createdAt:s.createdAt,expiresAt:s.expiresAt,...(s.audioKey?{audio:true,audioDur:s.audioDur||0}:{})});
const dropObjects=async story=>{for(const Key of [story.key,story.audioKey])if(Key)await r2.send(new DeleteObjectCommand({Bucket,Key}));};
async function route(req,res,uid,pathname) {
  if(pathname==='/api/stories' && req.method==='GET') {
    const contacts=await db.collection(`users/${uid}/contacts`).limit(300).get();
    const owners=[uid,...contacts.docs.map(d=>d.id)]; const result=[];
    // Sequential batches avoid unbounded fan-out; only metadata crosses the API.
    for(let i=0;i<owners.length;i+=30) {
      const batch=await db.collection('stories').where('owner','in',owners.slice(i,i+30)).where('expiresAt','>',Date.now()).get();
      const allowed=new Map();
      for(const doc of batch.docs){const s={id:doc.id,...doc.data()};if(!active(s))continue;if(!allowed.has(s.owner))allowed.set(s.owner,await friends(uid,s.owner));if(allowed.get(s.owner))result.push(summary(s));}
    }
    return {stories:result.sort((a,b)=>a.createdAt-b.createdAt),serverNow:Date.now()};
  }
  if(pathname==='/api/stories' && req.method==='POST') {
    await quota(uid,'publish',20);
    const body=await jsonBody(req,11*1024*1024), image=await normalize(body.image), audio=body.audio==null?null:audioBytes(body.audio);
    const id=crypto.randomUUID(), now=Date.now(), key=`stories/${uid}/${id}.jpg`, audioKey=audio?`stories/${uid}/${id}.audio`:null, audioDur=Math.min(120,Math.max(0,Math.round(Number(body.audioDur)||0)));
    // A pending record lets cleanup recover orphaned objects if the process dies.
    await storyRef(id).set({owner:uid,key,...(audio?{audioKey,audioType:audio.type,audioDur}:{}),state:'pending',createdAt:now,expiresAt:now+DAY,cleanupAt:now+10*60000});
    await r2.send(new PutObjectCommand({Bucket,Key:key,Body:image,ContentType:'image/jpeg',CacheControl:'private, no-store'}));
    if(audio)await r2.send(new PutObjectCommand({Bucket,Key:audioKey,Body:audio.bytes,ContentType:audio.type,CacheControl:'private, no-store'}));
    await storyRef(id).update({state:'ready',cleanupAt:now+DAY});
    return {story:summary({id,owner:uid,createdAt:now,expiresAt:now+DAY,audioKey,audioDur})};
  }
  const match=/^\/api\/stories\/([A-Za-z0-9_-]+)(?:\/(media|audio|views|reply|report))?$/.exec(pathname);
  if(!match)fail(404,'غير موجود');
  const [,id,action]=match;
  if(!action && req.method==='DELETE'){
    const ref=storyRef(id),doc=await ref.get();
    if(!doc.exists)return {ok:true};
    if(doc.data().owner!==uid)fail(403,'غير مسموح');
    // Hide first; failed object deletion is retried by cleanup.
    await ref.update({state:'deleted',cleanupAt:Date.now()});
    await dropObjects(doc.data());
    await db.recursiveDelete(ref);return {ok:true};
  }
  const story=await loadStory(id,uid);
  if(action==='media' && req.method==='GET') {
    const object=await r2.send(new GetObjectCommand({Bucket,Key:story.key}));
    const bytes=await object.Body.transformToByteArray();
    if(!active(story))fail(410,'انتهت اليومية');
    res.setHeader('Content-Type','image/jpeg');res.end(Buffer.from(bytes));return null;
  }
  if(action==='audio' && req.method==='GET') {
    if(!story.audioKey)fail(404,'لا يوجد صوت');
    const object=await r2.send(new GetObjectCommand({Bucket,Key:story.audioKey}));
    const bytes=await object.Body.transformToByteArray();
    if(!active(story))fail(410,'انتهت اليومية');
    res.setHeader('Content-Type',story.audioType||'audio/mp4');res.end(Buffer.from(bytes));return null;
  }
  if(action==='views' && req.method==='POST') {
    if(uid!==story.owner)await storyRef(id).collection('views').doc(uid).set({uid,seenAt:Date.now()});
    return {ok:true};
  }
  if(action==='views' && req.method==='GET') {
    if(uid!==story.owner)fail(403,'غير مسموح');
    const docs=await storyRef(id).collection('views').limit(300).get();
    return {viewers:docs.docs.map(d=>({uid:d.id,seenAt:d.data().seenAt}))};
  }
  if(action==='report' && req.method==='POST') {
    await quota(uid,'report',10);const b=await jsonBody(req);
    await db.collection('reports').add({from:uid,about:story.owner,storyId:id,reason:String(b.reason||'يومية مخالفة').slice(0,500),ts:Date.now()});return {ok:true};
  }
  if(action==='reply' && req.method==='POST') {
    if(uid===story.owner)fail(400,'لا يمكنك الرد على يوميتك');
    await quota(uid,'reply',100);const body=await jsonBody(req);
    const text=typeof body.text==='string'?body.text.trim():'';
    if(text.length>2000)fail(400,'الرد طويل');
    const image=body.image ? 'data:image/jpeg;base64,'+(await normalize(body.image,true)).toString('base64'):null;
    if(!text&&!image)fail(400,'اكتب ردًا أو اختر صورة');
    // Recheck after upload processing; client clocks and supplied owners are never trusted.
    await loadStory(id,uid);
    const members=[uid,story.owner].sort(),cid=members.join('_'),now=Date.now();
    const chat=db.doc('chats/'+cid),message=chat.collection('messages').doc();
    const quote={id,owner:story.owner,expiresAt:story.expiresAt};
    await db.runTransaction(async tx=>{
      const existing=await tx.get(chat);
      if(existing.exists && (existing.data().isGroup || JSON.stringify([...(existing.data().members||[])].sort())!==JSON.stringify(members)))fail(409,'محادثة غير صالحة');
      tx.set(chat,{members,lastMsg:image?'رد بصورة على اليومية':text.slice(0,80),lastTs:now,lastFrom:uid,lastKind:'story-reply'},{merge:true});
      tx.create(message,{from:uid,kind:'story-reply',text,story:quote,...(image?{image}:{}),ts:now,expiresAt:Timestamp.fromMillis(now+DAY)});
    });return {ok:true,chatId:cid,peer:story.owner};
  }
  fail(405,'غير مسموح');
}
let cleaning=false;
async function cleanup(){
  if(cleaning)return;cleaning=true;
  try {
    const expired=await db.collection('stories').where('cleanupAt','<=',Date.now()).limit(100).get();
    for(const doc of expired.docs){await dropObjects(doc.data());await db.recursiveDelete(doc.ref);}
    const limits=await db.collection('storyLimits').where('expiresAt','<=',Timestamp.now()).limit(100).get();
    if(!limits.empty){const batch=db.batch();limits.docs.forEach(d=>batch.delete(d.ref));await batch.commit();}
  }catch(e){console.error('cleanup failed',e.code||e.name);}finally{cleaning=false;}
}
const rates=new Map();
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const origin=req.headers.origin;
  if(origin&&!origins.has(origin)){res.writeHead(403);return res.end();}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/health'&&req.method==='GET'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true}));}
    const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];if(!token)fail(401,'سجل الدخول');
    let decoded;try{decoded=await auth.verifyIdToken(token,true);}catch{fail(401,'أعد تسجيل الدخول');}
    if(!validId(decoded.uid))fail(403,'حساب غير مدعوم');
    const now=Date.now(), rate=rates.get(decoded.uid)||{count:0,until:now+60000};
    if(rate.until<=now){rate.count=0;rate.until=now+60000;}if(++rate.count>180)fail(429,'انتظر قليلًا');rates.set(decoded.uid,rate);
    const profile=await db.doc('users/'+decoded.uid).get();if(!profile.exists)fail(403,'الحساب غير موجود');
    const result=await route(req,res,decoded.uid,pathname);
    if(result!==null){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}
  }catch(e){if(!res.headersSent){res.statusCode=e.status||500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.status?e.message:'تعذّر الاتصال بخدمة اليوميات'}));}else res.end();if(!e.status)console.error('request failed',e.code||e.name);}
});
server.requestTimeout=30000;server.headersTimeout=15000;
if(process.argv.includes('--check')){
  Promise.all([r2.send(new ListObjectsV2Command({Bucket,MaxKeys:1})),db.collection('users').limit(1).get()]).then(()=>console.log('R2 AND FIREBASE OK')).catch(e=>{console.error('CHECK FAILED',e.code||e.name);process.exitCode=1;}).finally(()=>{r2.destroy();db.terminate();});
}else{
  server.listen(Number(process.env.STORIES_PORT||8788),'127.0.0.1',()=>console.log('Stories listening on loopback'));
  cleanup();setInterval(cleanup,60000).unref();setInterval(()=>{for(const[k,v]of rates)if(v.until<Date.now())rates.delete(k);},60000).unref();
}

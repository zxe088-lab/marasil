'use strict';
const DAY = 86400000;
function fail(status, message) { throw Object.assign(new Error(message), {status}); }
function active(story, now = Date.now()) { return !!story && story.state === 'ready' && Number.isFinite(story.expiresAt) && story.expiresAt > now; }
function canRead(story, uid, friendship, now = Date.now()) {
  return active(story, now) && (story.owner === uid || friendship === true);
}
function imageBytes(data) {
  if (typeof data !== 'string') fail(400, 'اختر صورة صالحة');
  if (data.length > 6 * 1024 * 1024) fail(413, 'الصورة أكبر من الحد المسموح');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) fail(400, 'اختر صورة JPEG أو PNG أو WebP');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) fail(413, 'الصورة أكبر من الحد المسموح');
  const jpeg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp=bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP';
  if (!(jpeg || png || webp)) fail(400, 'محتوى الصورة غير صالح');
  return bytes;
}
module.exports = {DAY, fail, active, canRead, imageBytes};

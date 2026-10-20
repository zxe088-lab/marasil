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
const AUDIO_TYPES = new Set(['audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/mpeg','audio/mp3','audio/webm','audio/ogg','audio/wav','audio/x-wav']);
// Optional sound for a story: validated by declared type, size and file signature.
function audioBytes(data) {
  if (typeof data !== 'string') fail(400, 'ملف الصوت غير صالح');
  if (data.length > 4.3 * 1024 * 1024) fail(413, 'ملف الصوت أكبر من الحد المسموح');
  const match = /^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || !AUDIO_TYPES.has(match[1])) fail(400, 'نوع الصوت غير مدعوم');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) fail(413, 'ملف الصوت أكبر من الحد المسموح');
  const mp4 = bytes.subarray(4, 8).toString() === 'ftyp';
  const mp3 = bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  const webm = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const ogg = bytes.subarray(0, 4).toString() === 'OggS';
  const wav = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE';
  if (!(mp4 || mp3 || webm || ogg || wav)) fail(400, 'محتوى الصوت غير صالح');
  return {bytes, type: match[1]};
}
const VIDEO_TYPES = new Set(['video/mp4','video/quicktime','video/x-m4v']);
// Story video up to 30 seconds: validated by declared type, size and MP4/QuickTime signature.
function videoBytes(data) {
  if (typeof data !== 'string') fail(400, 'ملف الفيديو غير صالح');
  if (data.length > 41 * 1024 * 1024) fail(413, 'الفيديو أكبر من الحد المسموح');
  const match = /^data:(video\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || !VIDEO_TYPES.has(match[1])) fail(400, 'نوع الفيديو غير مدعوم، استخدم MP4 أو MOV');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) fail(413, 'الفيديو أكبر من الحد المسموح');
  if (bytes.subarray(4, 8).toString() !== 'ftyp') fail(400, 'محتوى الفيديو غير صالح');
  return {bytes, type: match[1]};
}
module.exports = {DAY, fail, active, canRead, imageBytes, audioBytes, videoBytes};

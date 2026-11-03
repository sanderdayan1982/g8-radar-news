import { createHash } from 'node:crypto';
export const RELEASE = '3.0.0';
export const endpointHash = endpoint => createHash('sha256').update(String(endpoint || '')).digest('hex');
export function sourceHealth(source, now = Date.now()) {
  const date=Date.parse(source.last_news_published_at);
  const age=Number.isFinite(date) ? Math.max(0,(now-date)/1000) : null;
  // This is a review threshold, not a claim that a quiet official feed failed.
  const reviewAfter = source.type==='oficial' ? 180*86400 : 5*86400;
  return {...source,content_age_sec:age,freshness:age==null?'unknown':age>reviewAfter?'review':'recent'};
}
export function validPushSubscription(sub) {
  try {
    const u=new URL(sub.endpoint);
    const allowed=u.hostname==='web.push.apple.com' || u.hostname==='fcm.googleapis.com' || u.hostname==='updates.push.services.mozilla.com' || u.hostname.endsWith('.push.services.mozilla.com');
    return u.protocol==='https:' && !u.username && !u.password && (!u.port || u.port==='443') && allowed && /^[\w-]{87}$/.test(sub.keys?.p256dh || '') && /^[\w-]{22}$/.test(sub.keys?.auth || '');
  } catch { return false; }
}
export function sameOriginMutation(req,res,next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const origin=req.get('origin');
  const expected=process.env.RADARNEWS_URL;
  const isCrossSite=req.get('sec-fetch-site')==='cross-site';
  let valid=true;
  if (origin) {
    try {valid=expected ? new URL(origin).origin===new URL(expected).origin : new URL(origin).host===req.get('host');} catch {valid=false;}
  }
  if (isCrossSite || !valid) return res.status(403).json({error:'Origen no autorizado'});
  if (!req.is('application/json')) return res.status(415).json({error:'Se requiere application/json'});
  next();
}

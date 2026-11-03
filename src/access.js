import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
const hash=value=>createHash('sha256').update(String(value)).digest();
export function createAccess(directory,{secure=true,code:providedCode,key:providedKey}={}) {
  function persistent(name,encoding) {
    const path=join(directory,name);
    if(!existsSync(path))writeFileSync(path,randomBytes(32).toString(encoding),{mode:0o600,flag:'wx'});
    chmodSync(path,0o600);return readFileSync(path,'utf8').trim();
  }
  if(!providedCode || !providedKey)mkdirSync(directory,{recursive:true,mode:0o700});
  const code=providedCode || persistent('access-code.txt','base64url');
  const key=providedKey || persistent('session-key.txt','hex');
  if(code.length<32 || key.length<32)throw new Error('Configuración de acceso inválida; restaura las claves existentes.');
  const sign=value=>createHmac('sha256',key).update(value).digest('base64url');
  const attempts=new Map();
  const lifetime=90*86400;
  const cookieName='radar_session';
  function sessionValid(req) {
    const token=(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';
    const [expiry,nonce,signature]=token.split('.');
    return Number(expiry)>Date.now() && Number(expiry)<Date.now()+lifetime*1000+60_000 && nonce?.length===22 && !!signature && timingSafeEqual(hash(signature),hash(sign(expiry+'.'+nonce)));
  }
  function guard(req,res,next) {
    if(sessionValid(req))return next();
    if(req.path.startsWith('/api/'))return res.status(401).json({error:'Inicia sesión en RadarNews'});
    return res.redirect('/login');
  }
  function login(req,res) {
    const now=Date.now();const ip=req.socket.remoteAddress || 'unknown';
    if(attempts.size>1000)for(const [k,v] of attempts)if(now-v.start>15*60_000)attempts.delete(k);
    const record=attempts.get(ip);const state=record && now-record.start<15*60_000?record:{start:now,count:0};
    if(++state.count>30)return res.status(429).json({error:'Demasiados intentos. Espera 15 minutos.'});
    attempts.set(ip,state);
    if(!timingSafeEqual(hash(req.body?.code || ''),hash(code)))return res.status(401).json({error:'Clave de acceso incorrecta'});
    attempts.delete(ip);
    const payload=(now+lifetime*1000)+'.'+randomBytes(16).toString('base64url');
    res.cookie(cookieName,payload+'.'+sign(payload),{httpOnly:true,secure,sameSite:'strict',maxAge:lifetime*1000,path:'/'});
    return res.json({ok:true});
  }
  function logout(req,res) {res.clearCookie(cookieName,{httpOnly:true,secure,sameSite:'strict',path:'/'});res.json({ok:true});}
  function ackToken(queueId,deviceId){return sign('push-ack:'+queueId+':'+deviceId);}
  function ackValid(body){return !!body?.queueId && !!body?.deviceId && typeof body?.token==='string' && timingSafeEqual(hash(body.token),hash(ackToken(body.queueId,body.deviceId)));}
  return {guard,login,logout,sessionValid,ackToken,ackValid};
}

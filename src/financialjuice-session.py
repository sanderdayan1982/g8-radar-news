#!/usr/bin/env python3
"""Private session broker. Stdout is sensitive: consume in-process, never log."""
import http.cookiejar,json,re,sys,urllib.request,urllib.parse
from pathlib import Path
class BoundRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  if urllib.parse.urlsplit(newurl).scheme!='https' or urllib.parse.urlsplit(newurl).hostname!=urllib.parse.urlsplit(req.full_url).hostname: raise RuntimeError('redirect_blocked')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
def bootstrap(path,snapshot=False):
 jar=http.cookiejar.LWPCookieJar(str(path));jar.load(ignore_discard=True,ignore_expires=False)
 client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),BoundRedirect())
 client.addheaders=[('User-Agent','Mozilla/5.0 RadarNews/3.0')]
 def get(url,token=None):
  req=urllib.request.Request(url,headers=({'Authorization':'Bearer '+token} if token else {}) | ({'Content-Type':'application/json; charset=utf-8','Accept':'application/json'} if '/FJService.asmx/' in url else {}))
  with client.open(req,timeout=20) as r:
   data=r.read(3000001)
   if len(data)>3000000:raise RuntimeError('response_too_large')
   return data.decode()
 html=get('https://www.financialjuice.com/home')
 if not re.search(r'UserLoggedIn\s*=\s*true',html):raise RuntimeError('session_expired')
 if snapshot:
  info=re.search(r"var info\s*=\s*'([^']+)'",html)
  if not info:raise RuntimeError('snapshot_context_missing')
  args={'info':json.dumps(info.group(1)),'TimeOffset':0,'tabID':0,'oldID':0,'TickerID':0,'FeedCompanyID':0,'strSearch':'','extraNID':0}
  data=json.loads(get('https://live.financialjuice.com/FJService.asmx/Startup?'+urllib.parse.urlencode(args)))
  data=data.get('d',data)
  if isinstance(data,str):data=json.loads(data)
  return data
 token=re.search(r"var centrifugoToken\s*=\s*'([^']+)'",html)
 endpoint=re.search(r"var centrifugoUrl\s*=\s*'([^']+)'",html)
 if token and endpoint:
  if endpoint.group(1)!='wss://rt.financialjuice.com/connection/websocket':raise RuntimeError('unexpected_live_host')
  return {'url':endpoint.group(1),'token':token.group(1),'transport':'centrifugo'}
 token=re.search(r"var feedtoken\s*=\s*'([^']+)'",html)
 if not token:raise RuntimeError('live_token_missing')
 connection=json.dumps([{'name':'newshub'}],separators=(',',':'))
 args={'clientProtocol':'2.1','connectionData':connection,'ftoken':token.group(1)}
 query=urllib.parse.urlencode(args)
 first=json.loads(get('https://www.financialjuice.com/signalr/negotiate?'+query))
 dest=urllib.parse.urlsplit(first['RedirectUrl'])
 if dest.scheme!='https' or not dest.hostname.endswith('.service.signalr.net') or dest.port not in (None,443):raise RuntimeError('unexpected_live_host')
 base=urllib.parse.urlunsplit((dest.scheme,dest.netloc,dest.path.rstrip('/'),'',''))
 args.update({k:v for k,v in urllib.parse.parse_qsl(dest.query) if k in ('asrs_request_id','asrs.op')})
 query=urllib.parse.urlencode(args)
 second=json.loads(get(base+'/negotiate?'+query,first['AccessToken']))
 args.update({'transport':'webSockets','connectionToken':second['ConnectionToken'],'access_token':first['AccessToken']})
 query=urllib.parse.urlencode(args)
 return {'transport':'signalr','url':base.replace('https://','wss://',1)+'/connect?'+query,'start':base+'/start?'+query}

if __name__=='__main__':
 try:print(json.dumps(bootstrap(Path(sys.argv[1]),'--snapshot' in sys.argv)))
 except Exception as e:
  # Do not emit exception URLs (they may contain access tokens).
  print(json.dumps({'error':str(e) if type(e) is RuntimeError else type(e).__name__}));sys.exit(1)

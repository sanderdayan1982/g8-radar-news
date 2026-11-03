document.getElementById('login-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.target.querySelector('button');const error=document.getElementById('login-error');button.disabled=true;error.textContent='';
 try {const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value.trim()}),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw new Error(data.error);location.replace('/');}
 catch(e){error.textContent=e.name==='TimeoutError'?'No responde el servidor. Inténtalo de nuevo.':e.message;}finally{button.disabled=false;}
});

'use strict';
// No external dependencies. Sessions are held in memory only; no financial data,
// passwords or access/refresh tokens are written to localStorage or sessionStorage.
window.Cloud=(()=>{
  const c=window.HOUSEHOLD_CONFIG||{}, url=String(c.supabaseUrl||'').replace(/\/$/,''), key=String(c.publishableKey||'');
  let session=null, refreshPromise=null, generation=0;
  const configured=()=>/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)&&!url.includes('YOUR-')&&/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key)&&!key.includes('REPLACE_ME');
  async function request(path,{method='GET',body,token,prefer}={}){
    if(!configured())throw Error('config');
    const headers={'apikey':key,'Accept':'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(token)headers.Authorization='Bearer '+token;
    if(prefer)headers.Prefer=prefer;
    const res=await fetch(url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
    let data=null;try{data=await res.json()}catch(e){}
    return {ok:res.ok,status:res.status,data};
  }
  function setSession(d){if(!d?.access_token||!d?.refresh_token||!d?.user?.id)throw Error('session');session={access:d.access_token,refresh:d.refresh_token,user:d.user.id,expires:Date.now()+Math.max(1,Number(d.expires_in)||3600)*1000};}
  async function signIn(email,password){
    const g=++generation;session=null;refreshPromise=null;
    const r=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
    if(g!==generation||!r.ok)throw Error('credentials');setSession(r.data);
  }
  async function access(force=false){
    if(!session)throw Error('session');
    if(!force&&session.expires>Date.now()+60000)return session.access;
    if(!refreshPromise){const g=generation, old=session;
      const p=(async()=>{const r=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:old.refresh}});if(g!==generation)throw Error('session');if(!r.ok){session=null;throw Error('session');}setSession(r.data);return session.access;})();
      refreshPromise=p;p.finally(()=>{if(refreshPromise===p)refreshPromise=null}).catch(()=>{});
    }
    return refreshPromise;
  }
  async function dataRequest(path,options={}){
    const g=generation;let token=await access(),r=await request(path,{...options,token});
    if(g!==generation)throw Error('session');
    if(r.status===401){token=await access(true);r=await request(path,{...options,token});}
    if(g!==generation)throw Error('session');
    if(r.status===401)throw Error('session');
    if(!r.ok)throw Error('database');
    return r.data;
  }
  async function read(){const rows=await dataRequest('/rest/v1/hf_state?id=eq.1&select=revision,data');if(!Array.isArray(rows))throw Error('database');const row=rows[0];if(!row)return null;if(!Number.isSafeInteger(row.revision))throw Error('database');return row;}
  async function write(revision,data){if(!Number.isSafeInteger(revision)||revision<0)throw Error('revision');const rows=await dataRequest('/rest/v1/hf_state?id=eq.1&revision=eq.'+revision+'&select=revision',{method:'PATCH',body:{data,revision:revision+1},prefer:'return=representation'});if(!Array.isArray(rows))throw Error('database');if(rows.length===0)return null;if(rows.length!==1||rows[0].revision!==revision+1)throw Error('database');return rows[0].revision;}
  async function logout(){const old=session;session=null;refreshPromise=null;generation++;if(old){try{await request('/auth/v1/logout?scope=local',{method:'POST',token:old.access})}catch(e){}}}
  return Object.freeze({configured,signIn,read,write,logout,userId:()=>session?.user||null});
})();

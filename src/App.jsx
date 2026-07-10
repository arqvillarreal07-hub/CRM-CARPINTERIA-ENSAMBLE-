import { useState, useEffect, useRef, useMemo } from "react";

const GFONT_LINK = document.createElement('link');
GFONT_LINK.rel = 'stylesheet';
GFONT_LINK.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap';
if(typeof document!=='undefined' && !document.querySelector('link[href*="DM+Sans"]')) document.head.appendChild(GFONT_LINK);

/* ═══════════════════════════════════════════════════════════
   ENSAMBLE VILLARREAL — CRM v6.0 NUBE + MULTIUSUARIO
   ═══════════════════════════════════════════════════════════ */

// ═══ CONFIGURACIÓN NUBE (Supabase) ═══
// Pega aquí tu URL y Key de Supabase (ver instrucciones)
const SUPA_URL='https://zzxabnvjooosgqviucct.supabase.co';
const SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6eGFibnZqb29vc2dxdml1Y2N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1Njg4NzIsImV4cCI6MjA4ODE0NDg3Mn0.um2zAO9liOBuQ-YbBxL4CR9S1eKw7t34F3MLERaUdpc';
const CLOUD=SUPA_URL!=='___TU_URL___';
let _syncOk=false;
// ═══ AUTH (Supabase) — login real con correo+contraseña ═══
// El token de sesión reemplaza a la anon key en las peticiones, para poder cerrar el acceso público.
const AUTH={
  _s:null, // {access_token, refresh_token, expires_at, email}
  load(){try{const r=localStorage.getItem('ev_auth');if(r)this._s=JSON.parse(r);}catch{}return this._s;},
  save(){try{this._s?localStorage.setItem('ev_auth',JSON.stringify(this._s)):localStorage.removeItem('ev_auth');}catch{}},
  token(){return (this._s&&this._s.access_token)?this._s.access_token:SUPA_KEY;},
  isAuthed(){return !!(this._s&&this._s.access_token);},
  email(){return this._s?this._s.email:"";},
  async signIn(email,password){
    const r=await fetch(SUPA_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'apikey':SUPA_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:String(email||"").trim().toLowerCase(),password})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.access_token)throw new Error(j.error_description||j.msg||j.error||'Correo o contraseña incorrectos');
    this._s={access_token:j.access_token,refresh_token:j.refresh_token,expires_at:Date.now()+((j.expires_in||3600)*1000),email:(j.user&&j.user.email)||email};
    this.save();return this._s;
  },
  async refresh(){
    if(!this._s||!this._s.refresh_token)return false;
    try{
      const r=await fetch(SUPA_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'apikey':SUPA_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:this._s.refresh_token})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.access_token){return false;}
      this._s={access_token:j.access_token,refresh_token:j.refresh_token||this._s.refresh_token,expires_at:Date.now()+((j.expires_in||3600)*1000),email:(j.user&&j.user.email)||this._s.email};
      this.save();return true;
    }catch{return false;}
  },
  async ensureFresh(){
    if(!this._s)return false;
    if(Date.now()>(this._s.expires_at||0)-120000)return await this.refresh();
    return true;
  },
  signOut(){this._s=null;this.save();}
};
AUTH.load();
const _bearer=()=>'Bearer '+AUTH.token();
// Listener global para que la UI muestre estado de guardado
const _saveListeners=new Set();
const _notifySave=(status,key,err)=>{_saveListeners.forEach(fn=>{try{fn({status,key,err});}catch{}});};
const _hash=v=>{try{const s=JSON.stringify(v);let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return h;}catch{return 0;}};

// === COLA DE PENDIENTES (persistente en localStorage) ===
const _getPendientes=()=>{try{return JSON.parse(localStorage.getItem("ev_pendientes")||"{}");}catch{return{};}};
const _setPendientes=(p)=>{try{localStorage.setItem("ev_pendientes",JSON.stringify(p));}catch{}};
const _addPendiente=(k,v)=>{const p=_getPendientes();p[k]={value:v,ts:Date.now(),tries:0};_setPendientes(p);_notifySave('pending',k);};
const _removePendiente=(k)=>{const p=_getPendientes();delete p[k];_setPendientes(p);};
const _getPendienteCount=()=>Object.keys(_getPendientes()).length;

const DB={
  // Push HIPER ROBUSTO: PATCH primero (actualiza existente), si no existe → POST inicial.
  // En caso de fallo persistente, guarda en cola de pendientes.
  push:async(k,v,maxRetries=4)=>{
    if(!CLOUD)return true;
    await AUTH.ensureFresh();
    const headers={'apikey':SUPA_KEY,'Authorization':_bearer(),'Content-Type':'application/json'};
    // Stamp con timestamp del lado del cliente para resolver conflictos
    const payload={key:k,value:v,updated_at:new Date().toISOString()};
    let lastErr=null;
    for(let attempt=0;attempt<maxRetries;attempt++){
      try{
        // 1° intento: PATCH (UPDATE) — actualiza fila existente con key=X
        const patchH={...headers,'Prefer':'return=minimal'};
        const patchBody=JSON.stringify({value:v,updated_at:payload.updated_at});
        const rPatch=await fetch(SUPA_URL+'/rest/v1/ev_data?key=eq.'+encodeURIComponent(k),{method:'PATCH',headers:patchH,body:patchBody});
        if(rPatch.ok){
          // PATCH OK pero quizás no había fila — verificar leyendo
          const rCheck=await fetch(SUPA_URL+'/rest/v1/ev_data?key=eq.'+encodeURIComponent(k)+'&select=key',{headers});
          if(rCheck.ok){
            const j=await rCheck.json();
            if(Array.isArray(j)&&j.length>0){
              // Si hay duplicados, dejar solo el más reciente
              if(j.length>1){
                // Borra duplicados (deja solo 1, idealmente el más nuevo) — no podemos saber cuál sin id, así que borramos TODOS y reinsertamos
                await fetch(SUPA_URL+'/rest/v1/ev_data?key=eq.'+encodeURIComponent(k),{method:'DELETE',headers}).catch(()=>{});
                // Reinsertar limpio
                const rIns=await fetch(SUPA_URL+'/rest/v1/ev_data',{method:'POST',headers:{...headers,'Prefer':'return=minimal'},body:JSON.stringify(payload)});
                if(rIns.ok){_syncOk=true;_notifySave('saved',k);_removePendiente(k);return true;}
                lastErr="No se pudo limpiar duplicados ("+rIns.status+")";continue;
              }
              _syncOk=true;_notifySave('saved',k);_removePendiente(k);return true;
            }
          }
          // No existía: hacer INSERT
          const rIns=await fetch(SUPA_URL+'/rest/v1/ev_data',{method:'POST',headers:{...headers,'Prefer':'return=minimal'},body:JSON.stringify(payload)});
          if(rIns.ok){_syncOk=true;_notifySave('saved',k);_removePendiente(k);return true;}
          lastErr='INSERT HTTP '+rIns.status+': '+await rIns.text().catch(()=>'(sin detalle)');
        }else{
          lastErr='PATCH HTTP '+rPatch.status+': '+await rPatch.text().catch(()=>'(sin detalle)');
        }
      }catch(e){lastErr=String(e.message||e);}
      if(attempt<maxRetries-1)await new Promise(res=>setTimeout(res,1000*Math.pow(2,attempt))); // 1s, 2s, 4s, 8s
    }
    console.warn('DB.push FALLÓ para',k,':',lastErr,'— guardado en cola de pendientes');
    _addPendiente(k,v);
    _notifySave('error',k,lastErr);
    return false;
  },
  // Reintenta TODOS los pendientes (llamado al cargar app y cada N min)
  reintentarPendientes:async()=>{
    const p=_getPendientes();const keys=Object.keys(p);
    if(keys.length===0)return 0;
    let ok=0;
    for(const k of keys){
      const success=await DB.push(k,p[k].value);
      if(success)ok++;
    }
    return ok;
  },
  get:async(k,def)=>{
    let cloudVal=null,localVal=null;
    if(CLOUD){
      await AUTH.ensureFresh();
      try{
        // Leer TODAS las filas con esta key, ordenadas por updated_at desc para tomar la más reciente
        const r=await fetch(SUPA_URL+'/rest/v1/ev_data?key=eq.'+k+'&select=value,updated_at&order=updated_at.desc.nullslast',{headers:{'apikey':SUPA_KEY,'Authorization':_bearer()}});
        if(r.ok){
          const j=await r.json();
          if(Array.isArray(j)&&j.length>0){
            cloudVal=j[0].value;
            _syncOk=true;
            // Si hay duplicados en Supabase, limpiar (deja solo el más reciente)
            if(j.length>1){
              console.warn('DB.get: '+k+' tiene '+j.length+' filas duplicadas en Supabase. Limpiando...');
              const headers={'apikey':SUPA_KEY,'Authorization':_bearer(),'Content-Type':'application/json'};
              await fetch(SUPA_URL+'/rest/v1/ev_data?key=eq.'+encodeURIComponent(k),{method:'DELETE',headers}).catch(()=>{});
              await fetch(SUPA_URL+'/rest/v1/ev_data',{method:'POST',headers:{...headers,'Prefer':'return=minimal'},body:JSON.stringify({key:k,value:cloudVal,updated_at:new Date().toISOString()})}).catch(()=>{});
            }
          }
        }
      }catch(e){console.warn('DB nube:',e);}
    }
    try{const v=localStorage.getItem('ev_'+k);if(v)localVal=JSON.parse(v);}catch{}
    // Si hay pendientes para esta key, el local es la verdad absoluta — NUNCA sobrescribir
    const pend=_getPendientes();
    if(pend[k]){console.log('DB.get: usando local porque hay pendiente para',k);return pend[k].value;}
    const cLen=Array.isArray(cloudVal)?cloudVal.length:(cloudVal?1:0);
    const lLen=Array.isArray(localVal)?localVal.length:(localVal?1:0);
    if(cLen>0&&lLen>0){
      if(cLen===lLen){const cH=_hash(cloudVal),lH=_hash(localVal);if(cH===lH){return cloudVal;}
        // Mismo número, contenido distinto — preferir JSON más largo (más datos)
        const cLenStr=JSON.stringify(cloudVal).length,lLenStr=JSON.stringify(localVal).length;
        if(cLenStr>=lLenStr){try{localStorage.setItem('ev_'+k,JSON.stringify(cloudVal));}catch{};return cloudVal;}
        else{DB.push(k,localVal);return localVal;}
      }
      if(cLen>=lLen){try{localStorage.setItem('ev_'+k,JSON.stringify(cloudVal));}catch{};return cloudVal;}
      else{DB.push(k,localVal);return localVal;}
    }
    if(cLen>0){const lite=k==='caja'&&Array.isArray(cloudVal)?cloudVal.map(c=>c.ticket&&c.ticket.length>500?{...c,ticket:'[nube]'}:c):cloudVal;try{localStorage.setItem('ev_'+k,JSON.stringify(lite));}catch{};return cloudVal;}
    if(lLen>0){if(CLOUD)DB.push(k,localVal);return localVal;}
    return def;
  },
  set:(k,v)=>{
    const lite=k==='caja'&&Array.isArray(v)?v.map(c=>{if(c.ticket&&c.ticket.length>500)return{...c,ticket:'[nube]'};return c;}):v;
    try{localStorage.setItem('ev_'+k,JSON.stringify(lite));}catch(e){console.warn('localStorage full for '+k);try{localStorage.removeItem('ev_'+k);localStorage.setItem('ev_'+k,JSON.stringify(lite));}catch{}}
    if(CLOUD){_notifySave('saving',k);DB.push(k,v);}
    return v;
  }
};

const LOGO_IMG='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAC0ALQDASIAAhEBAxEB/8QAGwABAAMBAQEBAAAAAAAAAAAAAAEEBQMCBgf/xAA9EAABBAEDAgMEBgcJAQEAAAABAAIDBBEFEiEGMRNBUSIyYXEUFiNCgdEHFVJVkZSxJDM2U2JkdJKhsuH/xAAVAQEBAAAAAAAAAAAAAAAAAAAAAf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/APydERAREQEREBERAREQEREBERAREQEREBEUIJREQEREBERAREQEREBERAREQEREBERAREQEREBQpRAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERB7hhlsTNhgjfLI84axjS5zj6ADurv1f1r9z3/wCVf+SvdDf440cetpv9CvoL2p6l1Kyza0fUrtbU6pd9J0+Ky8NmY0keLEM98D2m/iEHyP1f1r9z3/5V/wCSfV/Wv3Pf/lX/AJL19ZNd/feofzT/AM1I6l15pyNb1AEf7p/5oPH6g1rHGj3/AOWf+S5WdJ1KnCZrWnWoIwQN8sDmtyfiQvptN6+vWIhp+v3bb6zuG3a8hZYrn9rLcbx6gq1qsOq1Oj9cq6nqEt8NuU3153yue2SN24hzcnsf6hB8IiIgIiICIiAiIgIiICIiAiIgIiICIiDe6F/xzo3/ACm/0KzHWZ6WryWqsz4ZorDnxyMOC0hx5C0+hf8AHOjf8pv9Csq5BN9NsfYyf3z/ALh/aKDfs1oOr60mo6dCyHWYml9ylGMNsgd5Yh6/tN/EL5dWKzrtOzHZrCeGaJwdHIxrg5pHmCvo7VJvVlWXUaNX6PrETS+5TZGWtsgd5Yh+1+0z8Qg+UX2keovufoitVZDl1K/FGwnvscS4D8CXL4tfZw6e+p+iO5akGDd1CJ7AfNjctB/E7v4IMLpXS6+t9TUdNtOe2Gw8teYzhwG0ng/gtTVdF0mG9QqV9M1umZ7jYnvv7Q17NwB2cd+crL6W1WDROpaWp2WPfDXeXObGAXH2SOMkeq1NV1zR57lC1Vua5afXttmey/I17Wszk7ADweAg1J/0e1a/WcWnmaaXSrDJjHMx43tfG0kxuOMZBHpyCqmg9K6ZZ6Yi1i7X1S940z43jTQ0/RQ37zm8lxPfHorGm/pCgpdTatZkhml0y/M+aOMtHiRPIwHAZxyODys7pvXNA0qCtNOzVqt6s8ue+jONloZyA8E8enHkoKvS+h0NV1S27UZ5odKpRmSaYYa/BdtYPPBJPb4FXNG6Rgm67s9PanJKyKuJSXxuDSQ0Za7JB4IIK6O64hhpX3VtMrvt6pfdYtMswiSER/caBnkg8kkdyV3Z1rp0uv1dbs1Zm2TpslW42JgDXPLS1jm89sHnPbHmgdPfo+dc6i1Gjqj5I61A7PEjIaZXO5ZtJB4LfaUaB0npd/pyrqFmnq9uaxcfXLaG0iMA8OcCOAvGlfpDsR2NHZqcZdW01jg90PMk58MsaXZOOAcKNF6o0it01W0y7NrFeWC3JY36e9rN4d2aST2QVXdMUoX9VR/Snz/qVgNeRhADzv2+1/8AnmFX6O0Snrmo24brbL469R84ZVID3lpHAyDnOVpxdW6Pb1TqKbUqlqGrrMbI2sqhpewNPck8ZOAueja505oWt2JqX62FOxRfA5ztnjNkc4ctwQAABwfVBj9RVKFK1DFRoapSzHuezUQA8nPBGAOO6yFr9RXNOvWYZaFrVbOIy2R+pPDnjngNI8u6yFQREQEREBERBvdDc9caMP8AdN/oV1s9cdUstzsZrtxrWyOAAcOACfgs/pvUodH6joalYa90VaYSOawAuIAPbK05HdDyyvkdJr4L3FxwyHuTlBw+vXVX7+uf9h+S0NG/SJrNe06PVtQt2qczdjy14EsP+uM44cPTsVU29Df5nUH/AEhUbehv8zqD/pCguWumq1a0/Wtb1iOzpU7jJBLXOZr/AJ4a37h8nE9uV0taxLrfRuu2nxshjbbpxQQR+7DG0PDWD5evmcr3R1ro2nptnTHjW7VKzyYZmRYjf5SMIOWu/r5rPuap09X6YuaVpA1J0lueGVzrbYwBsz22n4qDE0uOrLqdeK8S2vI8Me4HBZngO/AkH8F3saaKGmSOttItm26Bjc8AR/3hx5+0WgfIrMPIIPmr2qatZ1eaKW1s3RRCMbG4zju4/wCok5J8yqLmo6XWq/rrwg/+xXY4YsuzhpMmc+p9kKlHVjdok9sg+LHajiac8bXMeTx82hd/13JJJedYqV7AvTNmkY/eA1wLiMbXA/eK5xaoyKGxAdOrSQTStl8JzpMMc0EDBDs9nHuSg79P6dUuTTTaj4gpwhrHGM4O97trfwHtOPwbjzXbTNGJsarXs0XWrNFoAhEpjy7xAwnI+GVTZrVyvWdWpSOpRvmMrhXke0kkAAE5yQBnHzKizrFm2626Zsbn3Io45nYOX7CCHd/eO0ZPnyg1GaLU+sU1JtZ8nh0nzOqGfmOYMyYy8d8H8j2XoaLTOvaXTlrPrvssc6zTNjcYzhxb7fcbgAcHsPmsl+sWZLMllzIzLLVNaR2PfBbtLjz72Mc/BTBrNiCzRseFFJJRYY2FwPts5w12DzgOIHbj5IPVqk6e9Vp1qMdaacta1sdrxw4uOBzk4+StappVKHUaJo+KaNqQQ5efaLmvDH8/EEOHoHfBUodU+iWo7NGlBUljY5rTG55wSMbhucfaGePipdrl+WCOGxO+z4U7Z43Tvc9zHN8gSex4yPgEFa9EyvqFmGPOyKZ7G5OeA4gf0XBXL9+O898goV68j5DI98TnkkkknhziO5VNAREQEREBERB2p1nXLsNZrg0yvDdxGcfFXtP0iLVrghoTzOj8Muc58HLXZDWjDSeC4t5zxk57LMY90b2vY4tc0gtc04II7EKxPqN2zkTWZHg44zgcEkcD4kn8UF1mibtKZdfM6Nznhha5owD4mzb3zngntjg8r3a0COC0+CO5vLCA4Fo3AmUR84cR55HOVmuvW3Oc51iQud7xJ7+1v/8Arn5ry2xO173tleHyODnEHlxzuyfxGUGo7QWRX69ea04x2ZnxxSxRghwGMOwSODk5HkQQuDdMgkoQWm2H/wBomMcbXBgIG5oyRuye/kCPiqn0219n/aJT4LnPj9r3C45JHpkoy7ajriuyZzYmu3NZxwcg5HmOQP4INK7obKL7LBI6Z7IN7WuADgTKIx7pIOe45+aq6tpM2lXGVnbpC9gLTsLcnJa4YPo4EZ8+D5rg2/caQW2ZAW9ju7e1v/8Ar2vmvAsztMeJngwuL4+fccSCSPxA/gg2fqvKzUzSfJKfsBI0tiAc47wxzQHEDhxPOeQB6qqNIh4i+mF80oldBsj+zc2MuGSScjOw44OOM91QFqwI/D8eTZzxu9SCf/WtP4Bd2atqEccrGXJQ2bd4gyDu3e9/Hz9UFhmjb7RgFjtJAzds/wAxhdnv5YwlTS61sUQ2zK11oSF26NoDNgJOCXfDzx8VUOo3XRwsNqTbAQYxn3SBgfwHAz2C5w2rFd0ToZnMdDnwyPu574+aC2+hUjgMstqRokkfHBtja/JaASXEOxjLgPZz6rozTKjmV5fpE2x1d1mYGMZa1ri0huHckkeeODlVWanejEoZae0SnL9uBk4xntwccZGFzit2IXxPimex0LS2Mg+6DnI+RyePig1G6A234ktWfDXeE+GIsO5zJN2R3PLQw8ZOQOFwOlQwxvnsWXiFjSXGOMFxPiujAGSB9wnJPwVU6hdM/jG1KJd7X7g7BDm+6fhjy9FEWoXIZPEjsva4NLfUYJ3EYPBGTn5oLTdHkk0u1qET3vigk2t+yI3tBAc7Pljc3j4n0Wauzrtp7tzrMrnYc3JdnIdnd/HJz81xQEREBERAREQSzaHDeCW+YBwVYrOqi/Wc8PihbI0yFztxwDk4wB5KsiDcfqGnWYD9N3TziR8m8g4Ifk7W+fBDcE8e07Hx9staHHOLEA8F8W7YNjzn38H5+58sn0WAiDXgm0tl200OMVV0XhRkBxLxuB588kAA/jhI5tGZZtOkgEsZDRCAHN7MOT34y7H/AL6LIRBvP+rpc/a8Na55c37KQ7Rl3Hyxt4+Hfk48WLekS2pZXxCTxfaLy12Q5zxuOOBhrc4Hnx8liIg1JHaS2y8xta+Nlf7MYeGvl3fe8+3yzgdl0sy6K6ImvE1j28AOa8hwzgnv3wMj5n0WOoQbsj+n2TB0bfEYZRuBY8AM3uJwPXG0Bc3WtIbCXMrRuJbu8Isd7/hAAbs9t5cTzzgeqx0Qa0x0dt2EREPrsa8vOxwLjk7Rz3PY+Q7j4r3u0xluCentc2Fj5ZdzCBuDBtGHd8uGfmVjIg23WdDE2TAZgZW7nP3E+HlxJ78uI2gn1J9F7bL09I+JxhEOzG5u2RwfwzPn8H4+fyWCiD2x0Ph/aRyF/q14A/hhc1KICIiAEREBERARQpQEREBFCIJUIiCURQglFCIJRQiCUUIgIiICIiCUREBERAREQEREBERAREQFClQglQpRAREQEREEIpUIJRFCCUREBERAREQEREBERAREQFCKUBERBClEQEREBEUIJUKUQEREBERAREQEREAIiIChEQSiIgIiICIiCFKIgIiICIiAiIg//9k=';

const T={bg:"#0b0b0b",card:"#141414",border:"#1e1e1e",gold:"#c9956b",green:"#4CAF50",red:"#ef5350",blue:"#42A5F5",orange:"#FF9800",purple:"#AB47BC",teal:"#26A69A",yellow:"#FFD54F",text:"#e8e0d8",muted:"#777",dim:"#444"};
const Logo=({size=32})=> <img src={LOGO_IMG} width={size} height={size} style={{borderRadius:4,objectFit:"contain"}} alt="EV"/>;
const BrandFull=({color=T.gold,sub="",size="normal"})=> <div style={{display:"flex",alignItems:"center",gap:size==="small"?8:10}}>{typeof LOGO_IMG!=="undefined"?<img src={LOGO_IMG} style={{width:size==="small"?26:size==="big"?50:32,height:size==="small"?26:size==="big"?50:32,borderRadius:size==="big"?14:8,objectFit:"cover"}} alt=""/>:<Logo size={size==="small"?26:size==="big"?44:32} color={color}/>}<div><div style={{fontSize:size==="small"?12:size==="big"?20:15,fontWeight:800,color,lineHeight:1.15}}><span style={{fontWeight:800}}>ENSAMBLE</span>{size!=="small"&&<br/>}{size==="small"?" ":""}<span style={{fontWeight:400,opacity:.75}}>VILLARREAL</span></div>{sub&&<div style={{fontSize:size==="big"?10:8,color:T.dim,textTransform:"uppercase",letterSpacing:size==="big"?2.5:1,marginTop:1}}>{sub}</div>}</div></div>;
const ROLES={admin:{nombre:"Administrador",icon:"👑",color:T.gold,permisos:["dash","cot","obras","money","inv","caja","cont","clis","provs","cal","anal","auth","recibos","usuarios","docs","extras"]},cajachica:{nombre:"Caja Chica",icon:"🧾",color:T.green,permisos:["caja","recibos","inv"]},taller:{nombre:"Taller",icon:"🔨",color:T.orange,permisos:["cot","money","caja","inv","docs"]},supervisor:{nombre:"Supervisión",icon:"👁",color:T.purple,permisos:["dash","cot","obras","money","caja","provs","anal","auth","docs","recibos"]},cliente:{nombre:"Portal Cliente",icon:"🏠",color:T.teal,permisos:["portal"]}};
const USERS_SEED=[{id:1,nombre:"Miguel Villarreal",user:"miguel",rol:"admin",avatar:"MV",tel:"4491814651"}];
const PROVS_INIT=[{id:"P01",nombre:"Carp. La Sierra",contacto:"Sr. Rivera",tel:"449-100-0001",material:"Mano de obra",credito:0,total:106332,calif:5},{id:"P02",nombre:"Maderería Los Bosques",contacto:"Ing. López",tel:"449-100-0002",material:"Madera, triplay",credito:30,total:85876,calif:4},{id:"P03",nombre:"Tlapantli",contacto:"Lic. García",tel:"449-100-0003",material:"Tableros MDF",credito:30,total:82817,calif:4},{id:"P04",nombre:"Maderrajes",contacto:"Sra. Pérez",tel:"449-100-0004",material:"Herrajes",credito:15,total:45960,calif:5},{id:"P05",nombre:"Kimura",contacto:"Kimura S.",tel:"449-100-0007",material:"Herrajes especiales",credito:15,total:12679,calif:4},{id:"P06",nombre:"Ferretería Varias",contacto:"",tel:"",material:"Ferretería gral",credito:0,total:59935,calif:3}];
const INV_INIT=[{id:"I01",nombre:"Triplay 18mm",cat:"Madera",unidad:"Hoja",stock:24,minimo:10,precio:890,prov:"Los Bosques"},{id:"I02",nombre:"MDF 15mm blanco",cat:"Tableros",unidad:"Hoja",stock:18,minimo:8,precio:720,prov:"Tlapantli"},{id:"I03",nombre:"MDF 15mm maple",cat:"Tableros",unidad:"Hoja",stock:6,minimo:8,precio:780,prov:"Tlapantli"},{id:"I04",nombre:"Bisagra soft-close",cat:"Herrajes",unidad:"Par",stock:45,minimo:20,precio:185,prov:"Maderrajes"},{id:"I05",nombre:"Corredera 45cm",cat:"Herrajes",unidad:"Par",stock:30,minimo:15,precio:220,prov:"Maderrajes"},{id:"I06",nombre:"Jaladera 128mm",cat:"Herrajes",unidad:"Pza",stock:52,minimo:20,precio:95,prov:"Kimura"},{id:"I07",nombre:"Tornillo 2in",cat:"Ferretería",unidad:"Caja",stock:8,minimo:5,precio:120,prov:"Ferretería"},{id:"I08",nombre:"Pegamento 19L",cat:"Adhesivos",unidad:"Cubeta",stock:3,minimo:2,precio:650,prov:"Ferretería"},{id:"I09",nombre:"Lija 220",cat:"Abrasivos",unidad:"Pza",stock:40,minimo:30,precio:18,prov:"Ferretería"},{id:"I10",nombre:"Barniz mate 4L",cat:"Acabados",unidad:"Galón",stock:5,minimo:3,precio:480,prov:"Ferretería"},{id:"I11",nombre:"Melamina blanca",cat:"Tableros",unidad:"Hoja",stock:12,minimo:6,precio:620,prov:"Tlapantli"},{id:"I12",nombre:"Riel push-open",cat:"Herrajes",unidad:"Par",stock:8,minimo:10,precio:350,prov:"Kimura"}];
const CATALOGO_INIT=[{id:"M-01",cat:"Muebles",desc:"Centro entretenimiento",precio:29800},{id:"M-02",cat:"Muebles",desc:"Mueble auxiliar sala",precio:21180},{id:"M-03",cat:"Muebles",desc:"Mesa de centro",precio:12500},{id:"M-05",cat:"Muebles",desc:"Isla de cocina",precio:30900},{id:"M-06",cat:"Muebles",desc:"Mueble bar",precio:11400},{id:"M-07",cat:"Muebles",desc:"Escritorio ejecutivo",precio:28800},{id:"M-10",cat:"Muebles",desc:"Cabecera king",precio:11860},{id:"M-12",cat:"Muebles",desc:"Vestidor walk-in",precio:24680},{id:"LB01",cat:"Libreros",desc:"Librero piso a techo",precio:84200},{id:"LB02",cat:"Libreros",desc:"Librero empotrado",precio:18500},{id:"CL01",cat:"Closets",desc:"Closet principal 3m",precio:64200},{id:"CL02",cat:"Closets",desc:"Closet secundario",precio:41100},{id:"CL03",cat:"Closets",desc:"Closet infantil",precio:45200},{id:"PT01",cat:"Puertas",desc:"Puerta principal maciza",precio:92000},{id:"PT02",cat:"Puertas",desc:"Puerta interior",precio:8800},{id:"CO01",cat:"Cocinas",desc:"Cocina integral 3m",precio:85000},{id:"CO02",cat:"Cocinas",desc:"Cocina integral 4m+",precio:115000},{id:"ES01",cat:"Escaleras",desc:"Escalera c/herrería",precio:115500},{id:"MB03",cat:"Baño",desc:"Mueble baño doble",precio:7800}];
const ALL_CATS=["Muebles","Libreros","Closets","Puertas","Cocinas","Escaleras","Baño","Vestidores","Escritorios","Lavado","Otros"];
// === PRECIOS UNITARIOS (base que la IA usa para cotizar) ===
// Valores iniciales típicos Aguascalientes — Miguel ajusta a su realidad en el sistema
const PRECIOS_INIT=[
  {id:"PU01",cat:"Cocinas",desc:"Cocina integral MDF/melamina (acabado estándar)",unidad:"ml",precio:3500,notas:"Bajo + alto + cubierta laminada"},
  {id:"PU02",cat:"Cocinas",desc:"Cocina integral madera sólida o premium",unidad:"ml",precio:5500,notas:"Encino, nogal, herrajes premium"},
  {id:"PU03",cat:"Cocinas",desc:"Isla de cocina",unidad:"ml",precio:4500,notas:""},
  {id:"PU04",cat:"Cocinas",desc:"Cubierta de Corian",unidad:"m2",precio:9500,notas:"Solo cubierta"},
  {id:"PU05",cat:"Cocinas",desc:"Cubierta de cuarzo",unidad:"m2",precio:7500,notas:""},
  {id:"PU06",cat:"Closets",desc:"Closet melamina con herrajes estándar",unidad:"ml",precio:4500,notas:"Cajones + tubos + entrepaños"},
  {id:"PU07",cat:"Closets",desc:"Closet melamina con herrajes premium (push-open, soft-close)",unidad:"ml",precio:6500,notas:""},
  {id:"PU08",cat:"Closets",desc:"Closet madera sólida o lacado",unidad:"ml",precio:8500,notas:""},
  {id:"PU09",cat:"Vestidores",desc:"Vestidor walk-in melamina",unidad:"ml",precio:5500,notas:""},
  {id:"PU10",cat:"Vestidores",desc:"Vestidor walk-in premium",unidad:"ml",precio:8500,notas:""},
  {id:"PU11",cat:"Puertas",desc:"Puerta interior MDF",unidad:"pza",precio:8500,notas:"Incluye marco y batiente"},
  {id:"PU12",cat:"Puertas",desc:"Puerta interior madera sólida",unidad:"pza",precio:11000,notas:""},
  {id:"PU13",cat:"Puertas",desc:"Puerta principal madera maciza",unidad:"pza",precio:55000,notas:"Tamaño y diseño estándar"},
  {id:"PU14",cat:"Puertas",desc:"Puerta principal premium",unidad:"pza",precio:90000,notas:"Diseño exclusivo"},
  {id:"PU15",cat:"Baño",desc:"Mueble de baño sencillo (con espejo)",unidad:"pza",precio:6500,notas:""},
  {id:"PU16",cat:"Baño",desc:"Mueble de baño doble lavabo",unidad:"pza",precio:11000,notas:""},
  {id:"PU17",cat:"Muebles",desc:"Centro de entretenimiento",unidad:"pza",precio:28000,notas:""},
  {id:"PU18",cat:"Muebles",desc:"Cabecera king integral",unidad:"pza",precio:11500,notas:""},
  {id:"PU19",cat:"Muebles",desc:"Mesa de centro",unidad:"pza",precio:9500,notas:""},
  {id:"PU20",cat:"Libreros",desc:"Librero piso a techo",unidad:"ml",precio:4500,notas:"Estándar"},
  {id:"PU21",cat:"Libreros",desc:"Librero empotrado",unidad:"ml",precio:5500,notas:""},
  {id:"PU22",cat:"Escaleras",desc:"Escalera de madera con herrería",unidad:"pza",precio:110000,notas:"Promedio según diseño"},
  {id:"PU23",cat:"Escritorios",desc:"Escritorio ejecutivo",unidad:"pza",precio:25000,notas:""},
  {id:"PU24",cat:"Lavado",desc:"Mueble cuarto de lavado",unidad:"ml",precio:4000,notas:""},
  {id:"PU25",cat:"Otros",desc:"Pretiles, lambrines decorativos",unidad:"m2",precio:3500,notas:""}
];
const $=n=>n==null?"$0":"$"+Math.round(n).toLocaleString("es-MX");
const fixDateGlobal=f=>{if(!f)return"";f=String(f).trim();if(/^\d{4}-\d{2}-\d{2}/.test(f))return f.slice(0,10);if(/^\d{2}\/\d{2}\/\d{4}$/.test(f)){const[d,mm,y]=f.split("/");return y+"-"+mm+"-"+d;}if(/^\d{2}-\d{2}-\d{4}$/.test(f)){const[d,mm,y]=f.split("-");return y+"-"+mm+"-"+d;}return f;};
const fd=d=>{if(!d)return "—";try{const ds=fixDateGlobal(d);const dt=new Date(ds+"T12:00:00");if(isNaN(dt.getTime()))return d;return dt.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"2-digit"});}catch{return d;}};
const pc=(a,b)=>b?Math.round((a/b)*100):0;
const td=()=>new Date().toISOString().slice(0,10);
// Siguiente ID numérico libre = (máximo id existente)+1. Evita colisiones tras borrar registros.
const _nextNumId=arr=>(Array.isArray(arr)?arr:[]).reduce((mx,x)=>{const n=Number(x&&x.id);return Number.isFinite(n)&&n>mx?n:mx;},0)+1;
// Sufijo aleatorio corto para IDs con prefijo (clientes, documentos) — evita colisiones por mismo milisegundo.
const _rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
// Reasigna SOLO los IDs numéricos repetidos (no borra nada). Devuelve {out, changed}.
const _dedupNumIds=arr=>{if(!Array.isArray(arr))return{out:arr,changed:false};const seen=new Set();let mx=arr.reduce((m,x)=>{const n=Number(x&&x.id);return Number.isFinite(n)&&n>m?n:m;},0);let changed=false;const out=arr.map(x=>{if(x&&x.id!=null&&!seen.has(x.id)){seen.add(x.id);return x;}changed=true;mx+=1;seen.add(mx);return{...x,id:mx};});return{out,changed};};
// === Helpers globales para matching robusto ===
const normName=s=>{if(!s)return"";return s.toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();};
const sameObra=(a,b)=>{const na=(a||"").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");const nb=(b||"").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");return na===nb;};
// Cargar pdf.js dinámicamente desde CDN cuando se necesite
let _pdfjsLoaded=false;
const loadPdfJs=()=>new Promise((resolve,reject)=>{
  if(_pdfjsLoaded&&window.pdfjsLib){resolve(window.pdfjsLib);return;}
  const script=document.createElement('script');
  script.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  script.onload=()=>{
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    _pdfjsLoaded=true;
    resolve(window.pdfjsLib);
  };
  script.onerror=()=>reject(new Error("No se pudo cargar pdf.js"));
  document.head.appendChild(script);
});
// Convertir cada página de un PDF a JPEG comprimido
const pdfToImages=async(file,onProgress)=>{
  const pdfjs=await loadPdfJs();
  const arrayBuffer=await file.arrayBuffer();
  const pdf=await pdfjs.getDocument({data:arrayBuffer}).promise;
  const images=[];
  const maxPages=Math.min(pdf.numPages,15); // máximo 15 páginas para no saturar API
  for(let i=1;i<=maxPages;i++){
    if(onProgress)onProgress(i,maxPages);
    const page=await pdf.getPage(i);
    const viewport=page.getViewport({scale:2});
    const targetW=Math.min(viewport.width,1800);
    const scale=targetW/viewport.width*2;
    const v2=page.getViewport({scale});
    const canvas=document.createElement('canvas');
    canvas.width=v2.width;canvas.height=v2.height;
    const ctx=canvas.getContext('2d');
    await page.render({canvasContext:ctx,viewport:v2}).promise;
    const blob=await new Promise(res=>canvas.toBlob(res,'image/jpeg',0.8));
    if(blob)images.push(new File([blob],"pagina-"+i+".jpg",{type:'image/jpeg'}));
  }
  return images;
};
// Helper inteligente: comprime imágenes y maneja PDFs grandes
const compressImage=(file,opts={})=>new Promise(async(resolve,reject)=>{
  try{
    if(file.type==='application/pdf'){
      if(file.size<=32*1024*1024){resolve(file);return;}
      // PDF grande: convertir a imágenes
      if(opts.onProgress)opts.onProgress("Convirtiendo PDF a imágenes...");
      const images=await pdfToImages(file,(p,t)=>{if(opts.onProgress)opts.onProgress("Procesando página "+p+" de "+t);});
      if(images.length===0){reject(new Error("PDF sin páginas legibles"));return;}
      resolve({multiplePages:true,images});
      return;
    }
    if(file.size<=5*1024*1024){resolve(file);return;}
    const reader=new FileReader();
    reader.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;const MAX=2000;
        if(w>MAX||h>MAX){if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;}}
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);
        canvas.toBlob(blob=>{
          if(!blob){reject(new Error("Error al comprimir"));return;}
          if(blob.size>5*1024*1024){
            canvas.toBlob(b2=>{if(!b2||b2.size>5*1024*1024){reject(new Error("Imagen muy grande tras comprimir"));return;}resolve(new File([b2],file.name.replace(/\.[^.]+$/,'.jpg'),{type:'image/jpeg'}));},'image/jpeg',0.7);
          }else{resolve(new File([blob],file.name.replace(/\.[^.]+$/,'.jpg'),{type:'image/jpeg'}));}
        },'image/jpeg',0.85);
      };
      img.onerror=()=>reject(new Error("No se pudo leer la imagen"));
      img.src=ev.target.result;
    };
    reader.onerror=()=>reject(new Error("Error leyendo archivo"));
    reader.readAsDataURL(file);
  }catch(err){reject(err);}
});
const DOC_IC={plano:"📐",render:"🖼️",contrato:"📄",avance:"📸",otro:"📎"};
const FASES={cotizacion:"Cotización",autorizada:"Autorizada",anticipo:"Anticipo Recibido",diseno:"Diseño",produccion:"Producción",instalacion:"Instalación",entregado:"Entregado",cancelado:"Cancelado"};
const FCC={cotizacion:"#FFB74D",autorizada:"#5dade2",anticipo:"#26A69A",diseno:"#AB47BC",produccion:"#FF9800",instalacion:"#66BB6A",entregado:"#78909C",cancelado:"#ef5350"};
const FASE_ORD=["cotizacion","autorizada","anticipo","diseno","produccion","instalacion","entregado"];
const Badge=({s})=>{const m={cotizado:["Cotizado","#332200","#FFB74D"],en_proceso:["En Proceso","#0a2e0a","#66BB6A"],completado:["Completado","#0a1a33","#64B5F6"],pendiente:["Pendiente","#332b00","#FFD54F"],aprobado:["Aprobado","#0a2e0a","#66BB6A"],aprobada:["Aprobada","#0a2e0a","#66BB6A"],rechazada:["Rechazada","#330a0a","#ef5350"],rechazado:["Rechazado","#330a0a","#ef5350"],cancelado:["Cancelado","#330a0a","#ef5350"],autorizada:["Autorizada","#0a1a33","#5dade2"],vigente:["Vigente","#0a2e0a","#66BB6A"]};const[l,bg,c]=m[s]||[s,"#222","#999"];return <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,background:bg,color:c}}>{l}</span>;};
const Bar=({v,mx,c=T.gold,h=5})=> <div style={{background:"#222",borderRadius:3,height:h,width:"100%"}}><div style={{width:Math.min(100,pc(v,mx||1))+"%",height:"100%",background:c,borderRadius:3,transition:"width .3s"}}/></div>;
const Card=({children,style,onClick})=> <div onClick={onClick} style={{background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.06)",backdropFilter:"blur(4px)",borderRadius:12,padding:14,marginBottom:8,cursor:onClick?"pointer":"default",...style}}>{children}</div>;
const Stat=({label,value,color,small})=> <div><div style={{fontSize:small?8:9,color:T.muted,textTransform:"uppercase",letterSpacing:.5}}>{label}</div><div style={{fontSize:small?14:18,fontWeight:800,color:color||T.text}}>{value}</div></div>;
// === Helper de búsqueda con normalización (sin acentos) ===
const normSearch=s=>(s||"").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim();
// Tokens "significativos" para fuzzy match: quita números, #, símbolos. Devuelve palabras de 4+ letras
const obraTokens=s=>{const n=normSearch(s).replace(/[#\d]+/g," ").replace(/[^a-z\s]/g," ").replace(/\s+/g," ").trim();return n.split(" ").filter(t=>t.length>=4);};
// Devuelve los NÚMEROS que aparecen en el nombre (ej: "CORAL #39" → ["39"], "TAMARINDOS 225 #1" → ["225","1"])
const obraNumeros=s=>{const m=normSearch(s||"").match(/\d+/g);return m||[];};
// Decide si dos obras DEBEN considerarse iguales (tokens compartidos + números compatibles)
const sonObrasSimilares=(o1,o2)=>{
  const t1=obraTokens(o1);
  const t2=obraTokens(o2);
  if(t1.length===0||t2.length===0)return false;
  // Si NO comparten ningún token significativo, no son similares
  if(!t1.some(t=>t2.includes(t)))return false;
  // Comparar números: si AMBAS tienen números Y son distintos, son DIFERENTES obras (ej: "CORAL #39" vs "CORAL #40")
  const n1=obraNumeros(o1);
  const n2=obraNumeros(o2);
  if(n1.length>0&&n2.length>0){
    // Si tienen al menos 1 número en común, son la misma obra
    if(n1.some(n=>n2.includes(n)))return true;
    // Si NO comparten ningún número, son obras DISTINTAS aunque compartan el nombre base
    return false;
  }
  // Una tiene números y la otra no, o ninguna tiene números → considerar similares por tokens
  return true;
};
// Cargar exclusiones manuales: pares de obras que el usuario marcó como "NO duplicadas"
const obtenerExclusionesObras=()=>{try{return JSON.parse(localStorage.getItem("ev_exclusionesDup")||"[]");}catch{return [];}};
const guardarExclusionesObras=(arr)=>{try{localStorage.setItem("ev_exclusionesDup",JSON.stringify(arr));}catch{}};
const esExclusionManual=(o1,o2)=>{
  const exclusiones=obtenerExclusionesObras();
  const k1=normSearch(o1);const k2=normSearch(o2);
  return exclusiones.some(ex=>(ex[0]===k1&&ex[1]===k2)||(ex[0]===k2&&ex[1]===k1));
};
// Helper: obras válidas como DESTINO de fusión/reasignación (en proceso, autorizada, etc.) — NO cotizaciones, NO canceladas, NO entregadas
const obrasDestinoValidas=(obras,excludeId)=>{
  return obras.filter(o=>{
    if(excludeId&&o.id===excludeId)return false;
    if(!o.fase)return false;
    if(o.fase==="cotizacion"||o.fase==="cancelado"||o.fase==="entregado")return false;
    return true;
  });
};
// Devuelve obras similares — usa sonObrasSimilares (compara tokens + números) + respeta exclusiones manuales
const findSimilarObras=(nombre,obras,excludeId)=>{
  const tgtNorm=normSearch(nombre);
  return obras.filter(o=>{
    if(excludeId&&o.id===excludeId)return false;
    if(normSearch(o.nombre)===tgtNorm)return false;
    if(esExclusionManual(nombre,o.nombre))return false;
    return sonObrasSimilares(nombre,o.nombre);
  });
};
// Agrupa lista de obras por similitud (respeta números distintos y exclusiones manuales)
const agruparObrasSimilares=(obras)=>{
  const grupos=[];const usados=new Set();
  obras.forEach(o=>{
    if(usados.has(o.id))return;
    const tok=obraTokens(o.nombre);
    if(tok.length===0){grupos.push([o]);usados.add(o.id);return;}
    const grupo=[o];usados.add(o.id);
    obras.forEach(o2=>{
      if(usados.has(o2.id))return;
      // Verificar contra TODAS las obras del grupo (no solo la primera) y respetar exclusiones manuales
      const compatible=grupo.every(gObj=>sonObrasSimilares(gObj.nombre,o2.nombre)&&!esExclusionManual(gObj.nombre,o2.nombre));
      if(compatible){grupo.push(o2);usados.add(o2.id);}
    });
    grupos.push(grupo);
  });
  // Solo regresar grupos con 2+ elementos (los duplicados sospechosos)
  return grupos.filter(g=>g.length>=2);
};
// === DASHBOARD VIZ HELPERS ===
const Sparkline=({data,color="#c9956b",width=110,height=32,fill=true})=>{
  if(!data||data.length<2)return <svg width={width} height={height}/>;
  const max=Math.max(...data,1),min=Math.min(...data,0);const range=(max-min)||1;
  const stepX=width/(data.length-1);
  const pts=data.map((v,i)=>[i*stepX,height-2-((v-min)/range)*(height-4)]);
  const path=pts.map((p,i)=>(i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  const area=path+" L"+width+","+height+" L0,"+height+" Z";
  const lastPt=pts[pts.length-1];
  return <svg width={width} height={height} style={{display:"block"}}>
    {fill&&<path d={area} fill={color} opacity={0.18}/>}
    <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={lastPt[0]} cy={lastPt[1]} r={2.5} fill={color}/>
  </svg>;
};
const Donut=({data,size=160,thickness=20,centerLabel,centerSub})=>{
  const total=data.reduce((s,d)=>s+(d.value||0),0)||1;
  const r=(size-thickness)/2;const cx=size/2,cy=size/2;
  let cum=-Math.PI/2;
  const arcs=data.filter(d=>d.value>0).map((d,i)=>{
    const ang=(d.value/total)*Math.PI*2;
    const adj=Math.min(ang,Math.PI*2-0.0001);
    const x1=cx+r*Math.cos(cum),y1=cy+r*Math.sin(cum);
    const x2=cx+r*Math.cos(cum+adj),y2=cy+r*Math.sin(cum+adj);
    const large=adj>Math.PI?1:0;
    const path="M "+x1.toFixed(2)+" "+y1.toFixed(2)+" A "+r+" "+r+" 0 "+large+" 1 "+x2.toFixed(2)+" "+y2.toFixed(2);
    cum+=ang;
    return {key:i,path,color:d.color,label:d.label,value:d.value,pct:(d.value/total)*100};
  });
  return <svg width={size} height={size} style={{display:"block"}}>
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1a1a" strokeWidth={thickness}/>
    {arcs.map(a=><path key={a.key} d={a.path} fill="none" stroke={a.color} strokeWidth={thickness} strokeLinecap="butt"/>)}
    {centerLabel&&<text x={cx} y={cy-2} textAnchor="middle" fill="#e8e0d8" fontSize={size/8} fontWeight="800">{centerLabel}</text>}
    {centerSub&&<text x={cx} y={cy+size/9} textAnchor="middle" fill="#777" fontSize={size/14}>{centerSub}</text>}
  </svg>;
};
const MonthlyBars=({data,height=170})=>{
  if(!data||data.length===0)return null;
  const max=Math.max(...data.map(d=>Math.max(d.ing||0,d.egr||0)),1);
  const w=(data.length*44);const bot=22;
  return <svg width="100%" height={height} viewBox={"0 0 "+w+" "+height} preserveAspectRatio="none" style={{display:"block",overflow:"visible"}}>
    {[0.25,0.5,0.75].map(g=><line key={g} x1={0} y1={(height-bot)*(1-g)} x2={w} y2={(height-bot)*(1-g)} stroke="#1a1a1a" strokeWidth={0.5}/>)}
    {data.map((d,i)=>{
      const x=i*44+6;
      const ingH=((d.ing||0)/max)*(height-bot-4);
      const egrH=((d.egr||0)/max)*(height-bot-4);
      const ingY=height-bot-ingH;
      const egrY=height-bot-egrH;
      return <g key={i}>
        <rect x={x} y={ingY} width={14} height={ingH} fill="#4CAF50" rx={2.5} opacity={0.92}/>
        <rect x={x+18} y={egrY} width={14} height={egrH} fill="#e91e63" rx={2.5} opacity={0.92}/>
        <text x={x+16} y={height-7} textAnchor="middle" fill="#777" fontSize={10} fontWeight={600}>{d.label}</text>
      </g>;
    })}
  </svg>;
};
const RingProgress=({pct,color="#c9956b",size=58,thickness=5,inner})=>{
  const r=(size-thickness)/2;const cx=size/2,cy=size/2;const circ=2*Math.PI*r;
  const fillLen=Math.min(Math.max(pct,0),100)/100*circ;
  return <div style={{position:"relative",width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <svg width={size} height={size} style={{position:"absolute",transform:"rotate(-90deg)"}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1a1a" strokeWidth={thickness}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeDasharray={fillLen+" "+circ} strokeLinecap="round"/>
    </svg>
    <div style={{position:"relative",fontSize:size/4.2,fontWeight:800,color}}>{inner!==undefined?inner:Math.round(pct)+"%"}</div>
  </div>;
};
const sI={width:"100%",padding:"11px 12px",borderRadius:8,border:"1px solid "+T.border,background:"#1a1a1a",color:"#ddd",fontSize:14,outline:"none",boxSizing:"border-box"};
const sB={padding:"13px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#c9956b,#a07850)",color:"#fff",fontWeight:800,fontSize:14,cursor:"pointer",width:"100%",marginTop:8};
function ModalW({title,onClose,children}){return <div style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.7)"}} onClick={onClose}><div onClick={e=>e.stopPropagation()} style={{background:"#151515",borderRadius:14,width:"100%",maxWidth:540,maxHeight:"88vh",overflow:"auto",paddingBottom:24,margin:16}}><div style={{width:36,height:4,background:"#444",borderRadius:2,margin:"8px auto 0"}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px 6px"}}><span style={{fontWeight:700,color:T.gold,fontSize:15}}>{title}</span><button onClick={onClose} style={{background:"#222",border:"none",color:"#888",cursor:"pointer",fontSize:14,borderRadius:20,width:28,height:28}}>✕</button></div><div style={{padding:"4px 16px 0"}}>{children}</div></div></div>;}
function Fl({l,children}){return <div style={{marginBottom:10}}><label style={{display:"block",fontSize:10,color:T.muted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{l}</label>{children}</div>;}
function ReciboView({data}){return <div style={{background:"#fefcf9",color:"#222",borderRadius:8,padding:20,fontFamily:"Georgia,serif"}}><div style={{display:"flex",justifyContent:"space-between",borderBottom:"3px solid #1B5E20",paddingBottom:12,marginBottom:14}}><div style={{display:"flex",alignItems:"center",gap:10}}><img src={LOGO_IMG} style={{width:40,height:40,borderRadius:8,objectFit:"cover"}} alt=""/><div><div style={{fontSize:16,fontWeight:800,color:"#1B5E20"}}>ENSAMBLE VILLARREAL</div><div style={{fontSize:9,color:"#888"}}>CARPINTERÍA ARQUITECTÓNICA</div><div style={{fontSize:9,color:"#bbb"}}>Circuito Los Sauces 136 · 449 181 4651</div></div></div><div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:700,color:"#1B5E20"}}>RECIBO</div><div style={{fontSize:16,fontWeight:800,color:"#1B5E20"}}>{data.recibo||data.id}</div></div></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,marginBottom:14}}><div><span style={{color:"#999",fontSize:10}}>FECHA</span><div style={{fontWeight:600}}>{fd(data.fecha)}</div></div><div><span style={{color:"#999",fontSize:10}}>CLIENTE</span><div style={{fontWeight:600}}>{data.cliente||"—"}</div></div><div><span style={{color:"#999",fontSize:10}}>CONCEPTO</span><div style={{fontWeight:600}}>{data.concepto||"—"}</div></div><div><span style={{color:"#999",fontSize:10}}>OBRA</span><div style={{fontWeight:600}}>{data.obra||"—"}</div></div></div><div style={{background:"#E8F5E9",borderRadius:8,padding:"14px 18px",textAlign:"center"}}><div style={{fontSize:10,color:"#2E7D32",textTransform:"uppercase"}}>Monto Recibido</div><div style={{fontSize:28,fontWeight:800,color:"#1B5E20"}}>{$(data.monto||data.ing||0)}</div></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginTop:20,paddingTop:14,borderTop:"1px dashed #ccc"}}><div style={{textAlign:"center",borderTop:"1px solid #999",paddingTop:6,fontSize:10,color:"#999"}}>Firma cliente</div><div style={{textAlign:"center",borderTop:"1px solid #999",paddingTop:6,fontSize:10,color:"#999"}}>Ensamble Villarreal</div></div><div style={{textAlign:"center",marginTop:16,fontSize:8,color:"#ccc",fontStyle:"italic"}}>— Donde la madera encuentra su forma —</div></div>;}
function ObraForm({onSave,clientes,onNewCli}){const[f,sf]=useState({nombre:"",cliente:"",cotizado:"",inicio:td(),entrega:"",fase:"cotizacion",simple:false});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><Fl l="Cliente"><input list="cli-ob-list" style={sI} value={f.cliente} onChange={e=>sf({...f,cliente:e.target.value})} placeholder="Seleccionar o escribir nuevo"/><datalist id="cli-ob-list">{clientes.map(c=><option key={c.id} value={c.nombre}/>)}</datalist>{f.cliente&&!clientes.some(c=>c.nombre.toLowerCase()===f.cliente.toLowerCase())&&<div style={{fontSize:10,color:"#FF9800",marginTop:3}}>⚡ Se creará como nuevo cliente</div>}</Fl><Fl l="Monto"><input type="number" style={sI} value={f.cotizado} onChange={e=>sf({...f,cotizado:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Inicio"><input type="date" style={sI} value={f.inicio} onChange={e=>sf({...f,inicio:e.target.value})}/></Fl><Fl l="Entrega"><input type="date" style={sI} value={f.entrega} onChange={e=>sf({...f,entrega:e.target.value})}/></Fl></div>
  <div style={{padding:10,background:f.simple?"rgba(76,175,80,.06)":"rgba(255,255,255,.02)",border:"1px solid "+(f.simple?T.green+"33":T.border),borderRadius:8,marginBottom:8,cursor:"pointer"}} onClick={()=>sf({...f,simple:!f.simple})}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <input type="checkbox" checked={f.simple} onChange={()=>{}} style={{accentColor:T.green,cursor:"pointer"}}/>
      <div style={{flex:1}}>
        <div style={{fontSize:12,fontWeight:700,color:f.simple?T.green:T.text}}>⚡ Obra rápida (3 fases)</div>
        <div style={{fontSize:10,color:T.muted,marginTop:1}}>Para puertas, muebles sueltos o trabajos pequeños. Solo: <b>Cotizada → En proceso → Entregada</b>. {!f.simple&&" Sin marcar: usa las 7 fases completas (anticipo, diseño, producción, instalación...)."}</div>
      </div>
    </div>
  </div>
  <button style={sB} onClick={()=>f.nombre&&(()=>{if(f.cliente&&!clientes.some(c=>c.nombre.toLowerCase()===f.cliente.toLowerCase())&&onNewCli)onNewCli(f.cliente);onSave({...f,cotizado:Number(f.cotizado)||0,status:'cotizado',avance:0});})()}>Guardar</button></div>;}
// Helper: filtra obras activas y las agrupa por fase para usar en <select>
function ObrasSelect({value,onChange,obras,allowGeneral,placeholder}){
  // Activas = no cotización, no entregada, no cancelada (las que puedes asignar movs)
  const activas=obras.filter(o=>o.fase&&o.fase!=="cotizacion"&&o.fase!=="entregado"&&o.fase!=="cancelado");
  const cotizaciones=obras.filter(o=>o.fase==="cotizacion");
  const entregadas=obras.filter(o=>o.fase==="entregado");
  // Agrupar activas por fase
  const fasesActivas=["autorizada","anticipo","diseno","produccion","instalacion"];
  // Detectar potenciales duplicadas (advertencia)
  const grupos=agruparObrasSimilares(activas);
  return <div>
    <select style={sI} value={value} onChange={onChange}>
      <option value="">{placeholder||"Seleccionar obra"}</option>
      {allowGeneral&&<option value="General">📂 General (sin obra)</option>}
      {fasesActivas.map(fk=>{const list=activas.filter(o=>o.fase===fk);if(!list.length)return null;return <optgroup key={fk} label={"● "+FASES[fk]+" ("+list.length+")"}>
        {list.map(o=><option key={o.id} value={o.nombre}>{o.nombre}{o.cliente?" — "+o.cliente:""}</option>)}
      </optgroup>;})}
      {cotizaciones.length>0&&<optgroup label={"📝 COTIZACIONES ("+cotizaciones.length+") - aún no autorizadas"}>
        {cotizaciones.map(o=><option key={o.id} value={o.nombre}>{o.nombre}{o.cliente?" — "+o.cliente:""}</option>)}
      </optgroup>}
      {entregadas.length>0&&<optgroup label={"✓ ENTREGADAS ("+entregadas.length+")"}>
        {entregadas.map(o=><option key={o.id} value={o.nombre}>{o.nombre}{o.cliente?" — "+o.cliente:""}</option>)}
      </optgroup>}
    </select>
    {grupos.length>0&&<div style={{marginTop:6,padding:"6px 10px",background:"rgba(255,213,79,.08)",border:"1px solid "+T.yellow+"33",borderRadius:6,fontSize:10,color:T.muted}}>⚠️ Detecté {grupos.length} grupo{grupos.length!==1?"s":""} de obras parecidas. Antes de registrar, considera ir a <b style={{color:T.yellow}}>Obras → 🔗 Detectar duplicadas</b> para fusionarlas.</div>}
  </div>;
}
function IngForm({obras,movs,clis,onSave}){const[f,sf]=useState({fecha:td(),prov:"",desc:"",ing:"",obra:""});const ob=obras.find(o=>o.nombre===f.obra);const pagado=ob?movs.filter(m=>m.ing>0&&sameObra(m.obra,ob.nombre)).reduce((s,m)=>s+m.ing,0):0;const a1=ob?Math.round(ob.cotizado*.6):0;const a2=ob?Math.round(ob.cotizado*.2):0;const a3=ob?Math.round(ob.cotizado*.2):0;const sugerido=ob?(pagado<a1?a1-pagado:pagado<a1+a2?a1+a2-pagado:pagado<ob.cotizado?ob.cotizado-pagado:0):0;const etapa=ob?(pagado<a1?"Anticipo 60%":pagado<a1+a2?"Avance 20%":"Entrega 20%"):"";return <div><Fl l="Obra"><ObrasSelect value={f.obra} obras={obras} onChange={e=>{const selOb=obras.find(o=>o.nombre===e.target.value);sf({...f,obra:e.target.value,desc:"",prov:selOb&&selOb.cliente?selOb.cliente:f.prov});}} placeholder="Seleccionar obra"/></Fl>{ob&&<div style={{background:"rgba(201,149,107,.08)",border:"1px solid rgba(201,149,107,.15)",borderRadius:10,padding:12,marginBottom:12,marginTop:8}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}><div style={{textAlign:"center"}}><div style={{fontSize:9,color:T.muted}}>COTIZADO</div><div style={{fontWeight:700,color:T.gold}}>{$(ob.cotizado)}</div></div><div style={{textAlign:"center"}}><div style={{fontSize:9,color:T.muted}}>PAGADO</div><div style={{fontWeight:700,color:T.green}}>{$(pagado)}</div></div><div style={{textAlign:"center"}}><div style={{fontSize:9,color:T.muted}}>RESTA</div><div style={{fontWeight:700,color:ob.cotizado-pagado>0?T.yellow:T.green}}>{$(ob.cotizado-pagado)}</div></div></div>{sugerido>0&&<div><div style={{fontSize:10,color:T.gold,fontWeight:700,marginBottom:4}}>Siguiente pago: {etapa}</div><div style={{display:"flex",gap:6}}>{[{l:etapa,v:sugerido},{l:"Total restante",v:ob.cotizado-pagado}].filter((x,i,a)=>i===0||x.v!==a[0].v).map(x=><button key={x.l} onClick={()=>sf({...f,ing:String(x.v),desc:x.l+" - "+ob.nombre,prov:ob.cliente||f.prov})} style={{flex:1,padding:"8px 6px",borderRadius:8,border:"1px solid "+T.gold+"33",background:Number(f.ing)===x.v?T.gold+"22":"transparent",color:Number(f.ing)===x.v?T.gold:T.muted,fontSize:11,fontWeight:700,cursor:"pointer"}}>{x.l}: {$(x.v)}</button>)}</div></div>}</div>}<Fl l="Recibido de"><input list="ing-cli-list" style={sI} value={f.prov} onChange={e=>sf({...f,prov:e.target.value})} placeholder="Nombre del cliente"/><datalist id="ing-cli-list">{(clis||[]).map(c=><option key={c.id} value={c.nombre}/>)}</datalist></Fl><Fl l="Concepto"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})} placeholder="Ej: Anticipo 60%"/></Fl><Fl l="Monto"><input type="number" style={{...sI,fontSize:20,fontWeight:800,textAlign:"center"}} value={f.ing} onChange={e=>sf({...f,ing:e.target.value})} placeholder="$0"/></Fl><button style={{...sB,background:T.green,opacity:Number(f.ing)>0?1:.5}} onClick={()=>{const m=Number(f.ing);if(m>0){const desc=f.desc||f.prov||("Ingreso "+f.obra);onSave({...f,desc,ing:m,egr:0});}}}>💰 Registrar + Generar Recibo</button></div>;}
function EgrForm({obras,provs,onSave,onNewProv}){const[f,sf]=useState({fecha:td(),prov:"",desc:"",egr:"",obra:"",cat:"Material"});const exists=provs.some(p=>p.nombre.toLowerCase()===f.prov.toLowerCase());return <div><Fl l="Proveedor"><input list="prov-list" style={sI} value={f.prov} onChange={e=>sf({...f,prov:e.target.value})} placeholder="Seleccionar o escribir nuevo"/><datalist id="prov-list">{provs.map(p=> <option key={p.id} value={p.nombre}/>)}</datalist>{f.prov&&!exists&&<div style={{fontSize:10,color:T.orange,marginTop:3}}>⚡ Nuevo proveedor — se creará automáticamente</div>}</Fl><Fl l="Descripción"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.egr} onChange={e=>sf({...f,egr:e.target.value})}/></Fl><Fl l="Obra"><ObrasSelect value={f.obra} obras={obras} allowGeneral onChange={e=>sf({...f,obra:e.target.value})} placeholder="Seleccionar obra"/></Fl>{(()=>{const so=f.obra&&f.obra!=="General"?obras.find(o=>sameObra(o.nombre,f.obra)):null;return so&&so.cliente?<div style={{fontSize:11,color:T.teal,margin:"-2px 0 8px",padding:"6px 10px",background:"rgba(38,166,154,.06)",border:"1px solid "+T.teal+"22",borderRadius:6}}>👤 Cliente de esta obra: <b style={{color:T.teal}}>{so.cliente}</b></div>:null;})()}<button style={{...sB,background:T.red,color:"#fff",marginTop:12}} onClick={()=>{const m=Number(f.egr);if(f.desc&&m>0){if(f.prov&&!exists&&onNewProv)onNewProv(f.prov);onSave({...f,egr:m,ing:0});}}}>Registrar Egreso</button></div>;}
const getApiKey=()=>localStorage.getItem('ev_apikey')||"";
const callAI=async(messages,max_tokens=1000,system)=>{const key=getApiKey();if(!key)throw new Error("NO_KEY");const body={model:"claude-sonnet-4-5",max_tokens,messages};if(system)body.system=system;const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify(body)});if(!r.ok){const t=await r.text().catch(()=>"");throw new Error("API "+r.status+": "+t.slice(0,200));}return r.json();};
function CajaForm({onSave,users,obras}){const[f,sf]=useState({fecha:td(),concepto:"",monto:"",resp:"Taller",obra:"",ticket:""});const[scanning,setScanning]=useState(false);const scanTicket=async(file)=>{setScanning(true);try{const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej("err");r.readAsDataURL(file);});sf(prev=>({...prev,ticket:"data:"+(file.type||"image/jpeg")+";base64,"+b64}));const data=await callAI([{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:b64}},{type:"text",text:'Este es un ticket/recibo de compra. Extrae: concepto (qué se compró, resumido), monto total. Responde SOLO JSON sin markdown: {"concepto":"x","monto":0}'}]}],500);const text=data.content?.map(i=>i.text||"").join("")||"{}";const info=JSON.parse(text.replace(/```json|```/g,"").trim());if(info.concepto)sf(prev=>({...prev,concepto:info.concepto,monto:String(info.monto||"")}));}catch(e){if(e.message==="NO_KEY")alert("Configura tu API Key en ⚙️ Más → API Key Claude");else console.warn("Scan error:",e);}setScanning(false);};return <div><div style={{marginBottom:12}}><label style={{display:"block",padding:16,border:"2px dashed "+(scanning?T.blue:f.ticket?T.green:T.border),borderRadius:10,textAlign:"center",cursor:scanning?"wait":"pointer",background:scanning?"#0a1a33":f.ticket?"#0a1a0a":"#111"}}><input type="file" accept="image/*,.pdf,application/pdf" style={{display:"none"}} onChange={async e=>{const raw=e.target.files[0];if(!raw)return;try{const f=await compressImage(raw);scanTicket(f);}catch(err){alert(err.message);}}}/>{scanning?<div style={{color:T.blue,fontWeight:700}}>🔄 Leyendo ticket...</div>:f.ticket?<div><img src={f.ticket} style={{maxHeight:120,borderRadius:8,marginBottom:6}} alt=""/><div style={{fontSize:10,color:T.green,fontWeight:700}}>✅ Ticket cargado</div></div>:<div><div style={{fontSize:24}}>🧾</div><div style={{color:T.gold,fontWeight:700,fontSize:12}}>Escanear Ticket</div><div style={{fontSize:10,color:T.muted}}>📷 Cámara · 🖼️ Galería · 📄 PDF</div></div>}</label></div><Fl l="Concepto"><input style={sI} value={f.concepto} onChange={e=>sf({...f,concepto:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.monto} onChange={e=>sf({...f,monto:e.target.value})}/></Fl><Fl l="Responsable"><select style={sI} value={f.resp} onChange={e=>sf({...f,resp:e.target.value})}>{users.map(u=> <option key={u.id} value={u.nombre}>{u.nombre}</option>)}</select></Fl><Fl l="Obra"><ObrasSelect value={f.obra} obras={obras||[]} allowGeneral onChange={e=>sf({...f,obra:e.target.value})} placeholder="Seleccionar obra"/></Fl>{(()=>{const so=f.obra&&f.obra!=="General"?(obras||[]).find(o=>sameObra(o.nombre,f.obra)):null;return so&&so.cliente?<div style={{fontSize:11,color:T.teal,margin:"-2px 0 8px",padding:"6px 10px",background:"rgba(38,166,154,.06)",border:"1px solid "+T.teal+"22",borderRadius:6}}>👤 Cliente de esta obra: <b style={{color:T.teal}}>{so.cliente}</b></div>:null;})()}<button style={{...sB,marginTop:12}} onClick={()=>{if(f.concepto&&Number(f.monto)>0&&f.obra)onSave({...f,monto:Number(f.monto)});else if(!f.obra)alert("Selecciona una obra");}}>Guardar</button></div>;}
function ExtraForm({onSave}){const[f,sf]=useState({desc:"",monto:""});return <div><Fl l="Descripción"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.monto} onChange={e=>sf({...f,monto:e.target.value})}/></Fl><button style={{...sB,background:T.orange}} onClick={()=>{const m=Number(f.monto);if(f.desc&&m>0)onSave({desc:f.desc,monto:m});}}>Enviar</button></div>;}
function ClienteForm({onSave}){const[f,sf]=useState({nombre:"",tel:"",email:"",dir:""});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Teléfono"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl><Fl l="Email"><input style={sI} value={f.email} onChange={e=>sf({...f,email:e.target.value})}/></Fl></div><Fl l="Dirección"><input style={sI} value={f.dir} onChange={e=>sf({...f,dir:e.target.value})}/></Fl><button style={sB} onClick={()=>f.nombre&&onSave(f)}>Guardar</button></div>;}
function DocForm({onSave}){const[f,sf]=useState({nombre:"",tipo:"plano",ext:"PDF"});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><Fl l="Tipo"><select style={sI} value={f.tipo} onChange={e=>sf({...f,tipo:e.target.value})}><option value="plano">Plano</option><option value="render">Render</option><option value="contrato">Contrato</option><option value="avance">Avance</option></select></Fl><button style={sB} onClick={()=>f.nombre&&onSave(f)}>Subir</button></div>;}
function BitacoraForm({onSave}){const[n,sN]=useState("");return <div style={{marginTop:8}}><Fl l="Nota"><textarea style={{...sI,minHeight:60}} value={n} onChange={e=>sN(e.target.value)} placeholder="Escribe una nota..."/></Fl><button style={{...sB,opacity:n.trim()?1:.5}} onClick={()=>{if(n.trim()){onSave(n);sN("");}}}>{n.trim()?"📝 Agregar Nota":"Escribe algo arriba..."}</button></div>;}
function InvForm({onSave}){const[f,sf]=useState({nombre:"",cat:"Madera",unidad:"Hoja",stock:"",minimo:"",precio:""});return <div><Fl l="Material"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}><Fl l="Stock"><input type="number" style={sI} value={f.stock} onChange={e=>sf({...f,stock:e.target.value})}/></Fl><Fl l="Mín"><input type="number" style={sI} value={f.minimo} onChange={e=>sf({...f,minimo:e.target.value})}/></Fl><Fl l="Precio"><input type="number" style={sI} value={f.precio} onChange={e=>sf({...f,precio:e.target.value})}/></Fl></div><button style={sB} onClick={()=>{if(f.nombre)onSave({...f,stock:Number(f.stock)||0,minimo:Number(f.minimo)||0,precio:Number(f.precio)||0});}}>Guardar</button></div>;}
function ProvForm({onSave}){const[f,sf]=useState({nombre:"",contacto:"",tel:"",material:"",credito:"",calif:3});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Contacto"><input style={sI} value={f.contacto} onChange={e=>sf({...f,contacto:e.target.value})}/></Fl><Fl l="Tel"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl></div><Fl l="Material"><input style={sI} value={f.material} onChange={e=>sf({...f,material:e.target.value})}/></Fl><button style={sB} onClick={()=>f.nombre&&onSave({...f,credito:Number(f.credito)||0,total:0})}>Guardar</button></div>;}
function UserForm({onSave,obras}){const[f,sf]=useState({nombre:"",rol:"taller",tel:"",proyectoId:"",pin:""});const av=f.nombre?f.nombre.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2):"??";return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><Fl l="Rol"><select style={sI} value={f.rol} onChange={e=>sf({...f,rol:e.target.value})}>{Object.entries(ROLES).map(([k,r])=> <option key={k} value={k}>{r.icon} {r.nombre}</option>)}</select></Fl>{f.rol==="cliente"&&<Fl l="Proyecto"><select style={sI} value={f.proyectoId} onChange={e=>sf({...f,proyectoId:e.target.value})}><option value="">Seleccionar</option>{obras.map(o=> <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></Fl>}<Fl l="PIN (4 dígitos)"><input type="number" style={{...sI,letterSpacing:8,textAlign:"center",fontSize:20,fontWeight:800}} value={f.pin} onChange={e=>{const v=e.target.value.slice(0,4);sf({...f,pin:v});}} placeholder="••••" maxLength={4}/></Fl><Fl l="Tel"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl><div style={{display:"flex",alignItems:"center",gap:10,margin:"10px 0"}}><div style={{width:44,height:44,borderRadius:22,background:ROLES[f.rol].color+"22",color:ROLES[f.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:15}}>{av}</div><div><div style={{fontWeight:700}}>{f.nombre||"Nombre"}</div><div style={{fontSize:10,color:ROLES[f.rol].color}}>{ROLES[f.rol].icon} {ROLES[f.rol].nombre}</div></div></div><button style={sB} onClick={()=>{if(f.nombre&&f.pin.length===4)onSave({...f,avatar:av,user:f.nombre.toLowerCase().split(" ")[0]});else if(!f.nombre)alert("Pon un nombre");else alert("El PIN debe ser de 4 dígitos");}}> + Agregar</button></div>;}
function CustomItemForm({onAdd,existingCats}){const[d,sD]=useState("");const[p,sP]=useState("");const[cat,sCat]=useState("Muebles");return <div><div style={{fontSize:11,color:T.gold,fontWeight:700,marginBottom:6}}>MUEBLE PERSONALIZADO</div><Fl l="Categoría"><select style={sI} value={cat} onChange={e=>sCat(e.target.value)}>{(existingCats||ALL_CATS).map(c=><option key={c} value={c}>{c}</option>)}</select></Fl><Fl l="Descripción"><input style={sI} value={d} onChange={e=>sD(e.target.value)} placeholder="Ej: Mueble TV 2.4m"/></Fl><Fl l="Precio"><input type="number" style={sI} value={p} onChange={e=>sP(e.target.value)}/></Fl><button style={{...sB,background:"#1a2a1a",color:T.green,border:"1px solid #2a4a2a33"}} onClick={()=>{const pr=Number(p);if(d&&pr>0){onAdd({id:"C-"+Date.now(),cat,desc:d,precio:pr,cant:1});sD("");sP("");}}}> + Agregar al catálogo y cotización</button></div>;}
function HistorialImportacionesView({movs,onDeshacer,onBorrarDuplicados}){
  const [mostrandoDuplicadosKey,setMostrandoDuplicadosKey]=useState(null);
  // Agrupar movimientos por lote (si tienen loteImport) o por importadoEl+user (si no)
  const importados=movs.filter(m=>m.importadoEl||m.loteImport||m.importadoViernes);
  const grupos={};
  importados.forEach(m=>{
    const key=m.loteImport||("legacy-"+(m.importadoEl||"sin-fecha")+"-"+(m.user||"sin-user"));
    if(!grupos[key])grupos[key]={key,fechaImport:m.importadoEl||"(antiguo)",user:m.user||"?",tipo:m.importadoViernes?"📅 Viernes Taller":m.ing>0?"📈 Ingresos":"📉 Gastos",movs:[],totIng:0,totEgr:0,loteId:m.loteImport};
    grupos[key].movs.push(m);
    grupos[key].totIng+=Number(m.ing)||0;
    grupos[key].totEgr+=Number(m.egr)||0;
  });
  const lista=Object.values(grupos).sort((a,b)=>(b.fechaImport||"").localeCompare(a.fechaImport||""));
  if(lista.length===0)return <div style={{textAlign:"center",padding:40,color:T.muted}}>
    <div style={{fontSize:40,marginBottom:8}}>📦</div>
    <div>Sin importaciones registradas</div>
  </div>;
  return <div>
    <div style={{background:"rgba(255,213,79,.06)",border:"1px solid "+T.yellow+"33",borderRadius:8,padding:10,marginBottom:12,fontSize:11,color:T.muted}}>
      <div style={{color:T.yellow,fontWeight:700,marginBottom:3}}>⚠️ Lista de movimientos importados (no creados manualmente)</div>
      <div>Cada grupo es una sesión de importación. Si te equivocaste, dale "⬅️ Deshacer este lote" y los movs van a la Papelera (recuperables 30 días).</div>
    </div>
    <div style={{display:"grid",gap:8}}>
      {lista.map(g=>{const balance=g.totIng-g.totEgr;return <div key={g.key} style={{padding:12,background:"rgba(255,255,255,.02)",border:"1px solid "+T.border,borderRadius:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:T.gold}}>{g.tipo} · {g.movs.length} movimientos</div>
            <div style={{fontSize:11,color:T.muted,marginTop:2}}>📅 Importado el {g.fechaImport!=="(antiguo)"?fd(g.fechaImport):"(fecha desconocida)"} por <b>{g.user}</b></div>
          </div>
          <div style={{textAlign:"right"}}>
            {g.totIng>0&&<div style={{fontSize:12,color:T.green,fontWeight:700}}>+{$(g.totIng)}</div>}
            {g.totEgr>0&&<div style={{fontSize:12,color:T.red,fontWeight:700}}>-{$(g.totEgr)}</div>}
          </div>
        </div>
        {/* Vista mini de hasta 3 movs */}
        <div style={{display:"grid",gap:3,marginBottom:8}}>
          {g.movs.slice(0,3).map((m,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:10,color:T.muted,padding:"3px 6px",background:"rgba(255,255,255,.02)",borderRadius:4}}>
            <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.desc} · {m.obra||"sin obra"}</span>
            <span style={{color:m.ing>0?T.green:T.red,fontWeight:700,marginLeft:8}}>{m.ing>0?"+"+$(m.ing):"-"+$(m.egr)}</span>
          </div>)}
          {g.movs.length>3&&<div style={{fontSize:9,color:T.dim,textAlign:"center",padding:2}}>... y {g.movs.length-3} más</div>}
        </div>
        {/* Detectar duplicados: comparar este lote contra TODOS los demás movs del sistema */}
        {(()=>{const idsLote=new Set(g.movs.map(m=>m.id));
          const otros=movs.filter(m=>!idsLote.has(m.id));
          const duplicados=[];
          g.movs.forEach(m=>{
            const f=(m.fecha||"").trim();
            const d=normSearch(m.desc||"");
            const monto=(m.ing>0?m.ing:m.egr)||0;
            const match=otros.find(o=>(o.fecha||"")===f&&normSearch(o.desc||"")===d&&Math.abs(((o.ing>0?o.ing:o.egr)||0)-monto)<0.5);
            if(match)duplicados.push({importado:m,original:match});
          });
          const mostrar=mostrandoDuplicadosKey===g.key;
          return <>
            {duplicados.length>0&&<div style={{padding:"8px 10px",background:"rgba(255,213,79,.08)",border:"1px solid "+T.yellow+"55",borderRadius:6,marginBottom:8,fontSize:11}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
                <span style={{color:T.yellow,fontWeight:700}}>⚠️ Detecté {duplicados.length} movs de este lote que YA EXISTÍAN en el sistema antes</span>
                <button onClick={()=>setMostrandoDuplicadosKey(mostrar?null:g.key)} style={{padding:"3px 10px",borderRadius:5,border:"1px solid "+T.yellow+"55",background:"rgba(255,213,79,.1)",color:T.yellow,fontSize:10,fontWeight:700,cursor:"pointer"}}>{mostrar?"Ocultar":"Ver duplicados"}</button>
              </div>
              {mostrar&&<div style={{marginTop:8}}>
                <div style={{fontSize:10,color:T.muted,marginBottom:6}}>Para cada duplicado: el original ya estaba antes · el importado se agregó hoy. Borra los importados (los nuevos):</div>
                <div style={{display:"grid",gap:4,maxHeight:240,overflowY:"auto"}}>
                  {duplicados.map((d,i)=><div key={i} style={{padding:"5px 8px",background:"rgba(255,255,255,.02)",borderRadius:4,fontSize:10}}>
                    <div style={{display:"flex",justifyContent:"space-between"}}>
                      <span style={{flex:1}}>📌 {d.importado.desc} · {d.importado.fecha} · {d.importado.obra||"sin obra"}</span>
                      <span style={{color:d.importado.ing>0?T.green:T.red,fontWeight:700}}>{d.importado.ing>0?"+"+$(d.importado.ing):"-"+$(d.importado.egr)}</span>
                    </div>
                    <div style={{fontSize:9,color:T.muted,marginTop:1}}>Original ya estaba con id "{d.original.id}" desde antes</div>
                  </div>)}
                </div>
                <button onClick={()=>{if(!confirm("¿Borrar los "+duplicados.length+" movimientos IMPORTADOS que son duplicados?\n\nSe conservan los originales que ya estaban en el sistema. Los importados van a la Papelera.")) return;onBorrarDuplicados(duplicados.map(d=>d.importado));setMostrandoDuplicadosKey(null);}} style={{marginTop:8,padding:"6px 12px",borderRadius:5,border:"1px solid "+T.red+"55",background:"rgba(231,76,60,.1)",color:T.red,fontSize:11,fontWeight:700,cursor:"pointer",width:"100%"}}>🗑 Borrar los {duplicados.length} duplicados importados</button>
              </div>}
            </div>}
            {duplicados.length===0&&<div style={{padding:"6px 10px",background:"rgba(76,175,80,.06)",border:"1px solid "+T.green+"33",borderRadius:5,marginBottom:8,fontSize:11,color:T.green,fontWeight:600}}>✓ Sin duplicados — todos los movs de este lote son únicos</div>}
          </>;
        })()}
        <button onClick={()=>{if(!confirm("¿Deshacer este lote de "+g.movs.length+" movimientos?\n\nIrán a la Papelera, puedes recuperarlos por 30 días."))return;onDeshacer(g.movs);}} style={{padding:"7px 14px",borderRadius:6,border:"1px solid "+T.red+"55",background:"rgba(231,76,60,.08)",color:T.red,fontSize:11,fontWeight:700,cursor:"pointer",width:"100%"}}>⬅️ Deshacer este lote completo ({g.movs.length} movs)</button>
      </div>;})}
    </div>
  </div>;
}
function ImportadorViernesForm({obras,movs,onImport}){
  // 3 entradas: ingresos, gastos, nómina
  const [pegIng,setPegIng]=useState("");
  const [pegEgr,setPegEgr]=useState("");
  const [pegNom,setPegNom]=useState("");
  const [items,setItems]=useState([]); // array unificado de movs a importar
  const [escaneando,setEscaneando]=useState({});
  const [fechaSem,setFechaSem]=useState(td()); // fecha de referencia (viernes)
  // Helpers compartidos
  const parseDate=(s)=>{
    if(!s||!String(s).trim())return "";
    s=String(s).trim();
    // ISO ya formateado
    if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
    // DD/MM/AAAA o DD/MM/AA
    let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if(m){const d=m[1].padStart(2,"0");const mo=m[2].padStart(2,"0");let y=m[3];if(y.length===2)y="20"+y;return y+"-"+mo+"-"+d;}
    // DD-MM-AAAA o DD-MM-AA
    m=s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
    if(m){const d=m[1].padStart(2,"0");const mo=m[2].padStart(2,"0");let y=m[3];if(y.length===2)y="20"+y;return y+"-"+mo+"-"+d;}
    // DD.MM.AAAA
    m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if(m){const d=m[1].padStart(2,"0");const mo=m[2].padStart(2,"0");let y=m[3];if(y.length===2)y="20"+y;return y+"-"+mo+"-"+d;}
    // Texto tipo "29 mayo 2026" o "29 de mayo de 2026"
    const meses={"enero":"01","febrero":"02","marzo":"03","abril":"04","mayo":"05","junio":"06","julio":"07","agosto":"08","septiembre":"09","octubre":"10","noviembre":"11","diciembre":"12"};
    const ml=s.toLowerCase();
    for(const[nm,mn]of Object.entries(meses)){
      const reM=new RegExp("(\\d{1,2})\\s+(?:de\\s+)?"+nm+"(?:\\s+(?:de\\s+)?(\\d{4}))?");
      const mm=ml.match(reM);
      if(mm){const d=mm[1].padStart(2,"0");const y=mm[2]||String(new Date().getFullYear());return y+"-"+mn+"-"+d;}
    }
    return ""; // No se pudo parsear → vacío (NO td())
  };
  const parseMonto=(s)=>{if(!s)return 0;return Number(String(s).replace(/[^0-9.-]/g,""))||0;};
  const matchObra=(nombre)=>{if(!nombre)return "";const n=normSearch(nombre);const exact=obras.find(o=>normSearch(o.nombre)===n);if(exact)return exact.nombre;const part=obras.find(o=>normSearch(o.nombre).includes(n)||n.includes(normSearch(o.nombre)));return part?part.nombre:nombre;};
  // Parser ingresos/gastos (formato: fecha mes descripcion obra total)
  // Devuelve {items: [...], celdasParsed: [[]], headers: [], colDesc: idx, colObra: idx, colMonto: idx, omitidas: [...]}
  const parsearMovs=(txt,tipo)=>{
    if(!txt.trim())return {items:[],celdasParsed:[],headers:[],colDesc:-1,colObra:-1,colMonto:-1,omitidas:[]};
    const lineas=txt.split("\n").filter(l=>l.trim());
    const sep=lineas[0].includes("\t")?"\t":",";
    const primera=lineas[0].split(sep).map(c=>c.trim().toLowerCase());
    const haySSHeader=primera.some(c=>["fecha","mes","descripcion","descripción","obra","total","monto"].includes(c));
    const startIdx=haySSHeader?1:0;
    const headers=haySSHeader?lineas[0].split(sep).map(c=>c.trim().replace(/^"|"$/g,"")):["fecha","mes","descripción","obra","total"];
    const findCol=(opts)=>{for(const o of opts){const i=headers.findIndex(h=>h.toLowerCase().includes(o));if(i>=0)return i;}return -1;};
    const colFecha=findCol(["fecha"]);
    const colDesc=findCol(["descripcion","descripción","desc"]);
    const colObra=findCol(["obra","proyecto"]);
    const colMonto=findCol(["total","monto","ingreso","egreso"]);
    const result=[];
    const celdasParsed=[];
    const omitidas=[];
    for(let i=startIdx;i<lineas.length;i++){
      const celdas=lineas[i].split(sep).map(c=>c.trim().replace(/^"|"$/g,""));
      if(celdas.every(c=>!c))continue;
      celdasParsed.push(celdas);
      // Si hay columna fecha y se puede parsear → usarla. Si no, usar fechaSem (viernes), NO td()
      const fechaParsed=colFecha>=0?parseDate(celdas[colFecha]):"";
      const fecha=fechaParsed||fechaSem;
      const desc=colDesc>=0?(celdas[colDesc]||""):"";
      const obraStr=colObra>=0?(celdas[colObra]||""):"";
      const obra=matchObra(obraStr);
      const monto=colMonto>=0?parseMonto(celdas[colMonto]):parseMonto(celdas[celdas.length-1]);
      // FIX: Si hay monto pero NO descripción NI obra → es la celda de TOTAL de la tabla, no un movimiento
      const descLow=desc.toLowerCase().trim();
      const esTotal=descLow.includes("total")||descLow.includes("suma")||descLow.includes("subtotal");
      if(monto>0&&(!desc||!desc.trim())&&(!obraStr||!obraStr.trim())){
        omitidas.push({linea:i+1,razon:"Total de tabla (sin descripción ni obra)",celdas});
        continue;
      }
      if(monto>0&&esTotal){
        omitidas.push({linea:i+1,razon:"Fila de total (descripción dice 'total')",celdas});
        continue;
      }
      if(monto>0&&desc&&desc.trim()){
        result.push({
          tipo,fecha,desc,obra,monto,
          obraOrig:obraStr,
          obraMatch:obraStr&&obra===obraStr?"exacto":obraStr&&obras.find(o=>normSearch(o.nombre).includes(normSearch(obraStr))||normSearch(obraStr).includes(normSearch(o.nombre)))?"fuzzy":obraStr?"sin-match":"",
          fuente:tipo==="ing"?"📈 Ingresos":"📉 Gastos"
        });
      }
    }
    return {items:result,celdasParsed,headers,colDesc,colObra,colMonto,omitidas,sep};
  };
  // Parser NÓMINA — soporta DOS formatos:
  //   FORMATO NUEVO (recomendado): columnas fecha, empleado, puesto, obra, dias, monto — una fila = un (empleado, obra)
  //   FORMATO VIEJO: columnas nombre, puesto, sueldo, extras, "dias y obra" (con desglose), total
  const parsearNomina=(txt)=>{
    if(!txt.trim())return [];
    const lineas=txt.split("\n").filter(l=>l.trim());
    const sep=lineas[0].includes("\t")?"\t":",";
    const primera=lineas[0].split(sep).map(c=>c.trim().toLowerCase());
    const haySSHeader=primera.some(c=>["nombre","empleado","cargo","puesto","sueldo","dias y obra","extras","total","obra","dias","monto"].includes(c));
    const startIdx=haySSHeader?1:0;
    const headers=haySSHeader?primera:["nombre","cargo","sueldo","extras","dias","total"];
    const findCol=(opts)=>{for(const o of opts){const i=headers.findIndex(h=>h===o||h.includes(o));if(i>=0)return i;}return -1;};
    const colFecha=findCol(["fecha"]);
    const colNombre=findCol(["empleado","nombre"]);
    const colCargo=findCol(["cargo","puesto"]);
    const colObraSola=findCol(["obra"]);
    const colDiasSola=findCol(["dias","días"]);
    const colMontoSola=findCol(["monto"]);
    const colTotal=findCol(["total"]);
    const colDiasObra=findCol(["dias y obra","obra dias","dias obra"]);
    const colExtras=findCol(["extras"]);
    // Detectar formato: si hay obra+dias como columnas separadas (Y no hay dias-y-obra), es formato nuevo
    const esFormatoNuevo=colObraSola>=0&&colDiasSola>=0&&(colMontoSola>=0||colTotal>=0)&&colDiasObra<0;
    const result=[];
    const reDiasObra=/(\d+)\s*d[ií]as?\s+([^()$]+?)\s*\(\$?\s*([\d,]+(?:\.\d+)?)\s*\)/gi;
    for(let i=startIdx;i<lineas.length;i++){
      const celdas=lineas[i].split(sep).map(c=>c.trim().replace(/^"|"$/g,""));
      if(celdas.every(c=>!c))continue;
      const nombre=colNombre>=0?celdas[colNombre]:celdas[0];
      const cargo=colCargo>=0?celdas[colCargo]:"";
      if(!nombre)continue;
      if(esFormatoNuevo){
        // ═══ FORMATO NUEVO ═══ una fila = un (empleado, obra)
        const fechaCell=colFecha>=0?parseDate(celdas[colFecha]):"";
        const obraStr=colObraSola>=0?celdas[colObraSola]:"";
        const dias=colDiasSola>=0?Number(celdas[colDiasSola])||0:0;
        const montoStr=colMontoSola>=0?celdas[colMontoSola]:(colTotal>=0?celdas[colTotal]:"");
        const monto=parseMonto(montoStr);
        if(monto<=0)continue;
        const obraMatcheada=matchObra(obraStr);
        result.push({
          tipo:"egr",
          fecha:fechaCell||fechaSem,
          desc:"Nómina "+nombre.trim()+(dias>0?" — "+dias+" día"+(dias!==1?"s":""):"")+(cargo?" ("+cargo+")":""),
          obra:obraMatcheada,
          monto,
          obraOrig:obraStr,
          obraMatch:obraStr&&obraMatcheada===obraStr?"exacto":obraStr&&obras.find(o=>normSearch(o.nombre).includes(normSearch(obraStr))||normSearch(obraStr).includes(normSearch(o.nombre)))?"fuzzy":obraStr?"sin-match":"",
          cat:"Nómina",
          fuente:"💼 Nómina "+nombre
        });
      }else{
        // ═══ FORMATO VIEJO ═══ desglose en una celda
        const total=colTotal>=0?parseMonto(celdas[colTotal]):0;
        const extras=colExtras>=0?parseMonto(celdas[colExtras]):0;
        const diasObraStr=colDiasObra>=0?celdas[colDiasObra]:"";
        if(total===0)continue;
        const partes=[];let m;reDiasObra.lastIndex=0;
        while((m=reDiasObra.exec(diasObraStr))!==null){
          partes.push({dias:Number(m[1]),obra:m[2].trim(),monto:parseMonto(m[3])});
        }
        if(partes.length===0){
          result.push({tipo:"egr",fecha:fechaSem,desc:"Nómina "+nombre+(cargo?" ("+cargo+")":""),obra:"",monto:total,obraOrig:"",obraMatch:"",cat:"Nómina",fuente:"💼 Nómina"});
        }else{
          partes.forEach(p=>{
            const obraMatcheada=matchObra(p.obra);
            result.push({tipo:"egr",fecha:fechaSem,desc:"Nómina "+nombre+" — "+p.dias+" día"+(p.dias!==1?"s":""),obra:obraMatcheada,monto:p.monto,obraOrig:p.obra,obraMatch:p.obra&&obraMatcheada===p.obra?"exacto":p.obra&&obras.find(o=>normSearch(o.nombre).includes(normSearch(p.obra))||normSearch(p.obra).includes(normSearch(o.nombre)))?"fuzzy":p.obra?"sin-match":"",cat:"Nómina",fuente:"💼 Nómina "+nombre});
          });
          if(extras>0){
            result.push({tipo:"egr",fecha:fechaSem,desc:"Extras nómina "+nombre,obra:"",monto:extras,obraOrig:"",obraMatch:"",cat:"Nómina",fuente:"💼 Extras "+nombre});
          }
        }
      }
    }
    return result;
  };
  const [parseInfoIng,setParseInfoIng]=useState(null);
  const [parseInfoEgr,setParseInfoEgr]=useState(null);
  // Re-parsea todo al pegar
  const recalcular=(ing,egr,nom)=>{
    const resIng=parsearMovs(ing!==null&&ing!==undefined?ing:pegIng,"ing");
    const resEgr=parsearMovs(egr!==null&&egr!==undefined?egr:pegEgr,"egr");
    setParseInfoIng(resIng);
    setParseInfoEgr(resEgr);
    const arr=[...resIng.items,...resEgr.items,...parsearNomina(nom!==null&&nom!==undefined?nom:pegNom)];
    arr.forEach(it=>{
      const norm=normSearch(it.desc);
      const dup=movs.find(m=>(m.fecha||"")===it.fecha&&normSearch(m.desc||"")===norm&&Math.abs((m.ing||m.egr||0)-it.monto)<0.5);
      it.duplicado=!!dup;
    });
    setItems(arr);
  };
  // Escaneo con IA por tipo
  const escanearConIA=async(file,tipo)=>{
    setEscaneando(prev=>({...prev,[tipo]:true}));
    try{
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej("err");r.readAsDataURL(file);});
      const tipoTexto={ing:"tabla de INGRESOS (cliente paga)",egr:"tabla de GASTOS/EGRESOS",nom:"tabla de NÓMINA con columnas nombre, cargo, sueldo base, extras, dias y obra (formato 'X dias OBRA ($Y), N dias OBRA2 ($Z)'), total"}[tipo];
      const prompt='Esta es una '+tipoTexto+'. Extrae TODOS los renglones y devuélvelos como TSV (tab-separated values) con encabezados en la primera línea. Para fechas como "29/5/26" déjalas tal cual. Responde SOLO el TSV sin markdown ni explicaciones.';
      const data=await callAI([{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:b64}},{type:"text",text:prompt}]}],4000);
      const text=data.content?.map(i=>i.text||"").join("")||"";
      const cleaned=text.replace(/```[a-z]*|```/g,"").trim();
      if(tipo==="ing"){setPegIng(cleaned);recalcular(cleaned,null,null);}
      else if(tipo==="egr"){setPegEgr(cleaned);recalcular(null,cleaned,null);}
      else{setPegNom(cleaned);recalcular(null,null,cleaned);}
    }catch(e){if(e.message==="NO_KEY")alert("⚠️ Configura tu API Key en Más → 🔑 API Key IA");else alert("Error: "+e.message.slice(0,100));}
    setEscaneando(prev=>({...prev,[tipo]:false}));
  };
  const updateItem=(idx,key,val)=>setItems(prev=>prev.map((it,i)=>i===idx?{...it,[key]:val}:it));
  const removeItem=(idx)=>setItems(prev=>prev.filter((_,i)=>i!==idx));
  const itemsValid=items.filter(it=>!it.duplicado);
  const totIng=itemsValid.filter(it=>it.tipo==="ing").reduce((s,it)=>s+Number(it.monto),0);
  const totEgr=itemsValid.filter(it=>it.tipo==="egr").reduce((s,it)=>s+Number(it.monto),0);
  const nDup=items.filter(it=>it.duplicado).length;
  const limpiarCaja=(tipo)=>{
    if(tipo==="ing"){setPegIng("");recalcular("",null,null);}
    else if(tipo==="egr"){setPegEgr("");recalcular(null,"",null);}
    else if(tipo==="nom"){setPegNom("");recalcular(null,null,"");}
  };
  const Caja=({titulo,color,icono,texto,setter,tipo,parseInfo})=>{
    return <div style={{padding:10,border:"1px solid "+T.border,borderRadius:8,background:"rgba(255,255,255,.015)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{fontSize:11,color,fontWeight:800}}>{icono} {titulo}</div>
        {texto&&texto.trim()&&<button onClick={()=>{if(confirm("¿Limpiar el contenido de '"+titulo.split("(")[0].trim()+"'?"))limpiarCaja(tipo);}} style={{padding:"3px 10px",borderRadius:5,border:"1px solid "+T.red+"55",background:"rgba(231,76,60,.08)",color:T.red,fontSize:10,fontWeight:700,cursor:"pointer"}} title="Borrar lo pegado">🗑 Limpiar</button>}
      </div>
      <textarea value={texto} onChange={e=>{setter(e.target.value);if(tipo==="ing")recalcular(e.target.value,null,null);else if(tipo==="egr")recalcular(null,e.target.value,null);else recalcular(null,null,e.target.value);}} placeholder="Pega aquí desde Excel/Sheets..." style={{...sI,minHeight:60,fontSize:10,fontFamily:"monospace"}}/>
      <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"6px 10px",border:"1px dashed "+T.border,borderRadius:6,marginTop:6,cursor:"pointer",fontSize:10,color:T.muted,background:escaneando[tipo]?"rgba(66,165,245,.08)":"transparent"}}>
        <input type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{const raw=e.target.files[0];if(!raw)return;try{const f=await compressImage(raw);escanearConIA(f,tipo);}catch(err){alert(err.message);}}}/>
        {escaneando[tipo]?<span style={{color:T.blue,fontWeight:700}}>🤖 Procesando...</span>:<span>📷 o sube foto (IA lee)</span>}
      </label>
      {/* === VISTA TABLA EXCEL EN VIVO === */}
      {parseInfo&&parseInfo.celdasParsed.length>0&&<div style={{marginTop:8,borderRadius:6,border:"1px solid #333",overflow:"hidden"}}>
        <div style={{fontSize:9,color:T.gold,fontWeight:700,padding:"4px 8px",background:"#1a1a1a",textTransform:"uppercase",letterSpacing:.5}}>📊 Vista tabla ({parseInfo.celdasParsed.length} filas detectadas{parseInfo.omitidas.length>0?" · "+parseInfo.omitidas.length+" omitidas":""})</div>
        <div style={{overflowX:"auto",maxHeight:180,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead style={{position:"sticky",top:0,background:"#1a1a1a"}}>
              <tr>
                {parseInfo.headers.map((h,i)=>{const isKey=i===parseInfo.colDesc||i===parseInfo.colObra||i===parseInfo.colMonto;return <th key={i} style={{padding:"5px 8px",textAlign:"left",fontSize:9,fontWeight:700,color:isKey?color:T.muted,borderRight:"1px solid #2a2a2a",borderBottom:"2px solid #444",background:isKey?color+"15":"transparent",whiteSpace:"nowrap"}}>{h}{i===parseInfo.colDesc&&" 📝"}{i===parseInfo.colObra&&" 🏗"}{i===parseInfo.colMonto&&" 💰"}</th>;})}
              </tr>
            </thead>
            <tbody>
              {parseInfo.celdasParsed.map((celdas,idx)=>{const isOmit=parseInfo.omitidas.some(o=>o.celdas===celdas||JSON.stringify(o.celdas)===JSON.stringify(celdas));return <tr key={idx} style={{borderBottom:"1px solid #2a2a2a",background:isOmit?"rgba(255,213,79,.08)":idx%2===0?"rgba(255,255,255,.01)":"transparent",opacity:isOmit?.5:1}} title={isOmit?"⚠️ Esta fila se omite (es un total de la tabla)":""}>
                {celdas.map((c,i)=><td key={i} style={{padding:"4px 8px",borderRight:"1px solid #2a2a2a",color:c?T.text:T.dim,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c||"—"}{isOmit&&i===celdas.length-1&&<span style={{color:T.yellow,marginLeft:6,fontSize:9}}>⚠️ omitida</span>}</td>)}
              </tr>;})}
            </tbody>
          </table>
        </div>
        {parseInfo.omitidas.length>0&&<div style={{padding:"5px 8px",background:"rgba(255,213,79,.06)",fontSize:9,color:T.yellow,borderTop:"1px solid #2a2a2a"}}>⚠️ {parseInfo.omitidas.length} fila(s) omitidas porque son totales de la tabla (sin descripción ni obra).</div>}
      </div>}
    </div>;
  };
  return <div>
    <div style={{background:"rgba(201,149,107,.06)",border:"1px solid "+T.gold+"33",borderRadius:8,padding:10,marginBottom:12,fontSize:11,color:T.muted}}>
      <div style={{color:T.gold,fontWeight:700,marginBottom:3}}>📅 Sube las 3 tablas que te manda el taller cada viernes</div>
      <div>Pega o sube foto de Ingresos · Gastos · Nómina. El sistema parsea, detecta obras, separa la nómina por persona/obra, y revisa duplicados con lo que ya tienes.</div>
    </div>
    <div style={{marginBottom:10,display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
      <Fl l="Fecha de la semana (viernes)"><input type="date" style={sI} value={fechaSem} onChange={e=>setFechaSem(e.target.value)}/></Fl>
      {(pegIng||pegEgr||pegNom)&&<button onClick={()=>{if(confirm("⚠️ ¿Limpiar TODO el contenido pegado?\n\nSe borra Ingresos + Gastos + Nómina + Preview para empezar de cero. No afecta nada en el sistema."))
{setPegIng("");setPegEgr("");setPegNom("");setItems([]);setParseInfoIng(null);setParseInfoEgr(null);}}} style={{padding:"10px 16px",borderRadius:8,border:"1px solid "+T.red+"55",background:"rgba(231,76,60,.1)",color:T.red,fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",height:42}}>🗑 Limpiar TODO y empezar de nuevo</button>}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr",gap:8,marginBottom:12}}>
      <Caja titulo="📈 INGRESOS" color={T.green} icono="📈" texto={pegIng} setter={setPegIng} tipo="ing" parseInfo={parseInfoIng}/>
      <Caja titulo="📉 GASTOS" color={T.red} icono="📉" texto={pegEgr} setter={setPegEgr} tipo="egr" parseInfo={parseInfoEgr}/>
      <Caja titulo="💼 NÓMINA (se separa automáticamente por persona/obra)" color={T.purple} icono="💼" texto={pegNom} setter={setPegNom} tipo="nom" parseInfo={null}/>
    </div>
    {items.length>0&&(()=>{
      // ===== VALIDACIONES =====
      const validaciones={errores:[],warnings:[],ok:[]};
      // 1. Filas sin descripción
      const sinDesc=items.filter(it=>!it.duplicado&&(!it.desc||!it.desc.trim()));
      if(sinDesc.length>0)validaciones.errores.push({msg:sinDesc.length+" mov(s) sin descripción",detalle:"Estos NO se importarán. Edita la descripción o elimínalos.",tipo:"error"});
      else validaciones.ok.push("Todas las filas tienen descripción");
      // 2. Filas sin obra (warning, no error)
      const sinObra=items.filter(it=>!it.duplicado&&(!it.obra||!it.obra.trim()));
      if(sinObra.length>0)validaciones.warnings.push({msg:sinObra.length+" mov(s) sin obra asignada",detalle:"Quedarán como 'General'. Si deberían tener obra, asígnala antes de importar."});
      // 3. Obras desconocidas (no existen en sistema)
      const obrasUnknown=items.filter(it=>!it.duplicado&&it.obraMatch==="sin-match");
      if(obrasUnknown.length>0)validaciones.errores.push({msg:obrasUnknown.length+" mov(s) con obra que NO existe",detalle:"Obras: "+[...new Set(obrasUnknown.map(it=>it.obraOrig))].slice(0,3).join(", ")+(obrasUnknown.length>3?"...":"")+". Crea la obra primero o cambia el destino.",tipo:"error"});
      // 4. Obras fuzzy match (warning)
      const obrasFuzzy=items.filter(it=>!it.duplicado&&it.obraMatch==="fuzzy");
      if(obrasFuzzy.length>0)validaciones.warnings.push({msg:obrasFuzzy.length+" mov(s) con obra MATCH APROXIMADO",detalle:"El sistema mapeó nombres parecidos a obras reales. Verifica las marcadas en amarillo."});
      // 5. Duplicados detectados
      if(nDup>0)validaciones.warnings.push({msg:nDup+" mov(s) duplicados detectados",detalle:"Ya existen en el sistema con misma fecha+descripción+monto. Se omitirán."});
      // 6. Fechas vacías o iguales a hoy (sospechoso si la tabla es de otra semana)
      const sinFecha=items.filter(it=>!it.duplicado&&(!it.fecha||it.fecha===td()));
      if(sinFecha.length>0&&fechaSem!==td())validaciones.warnings.push({msg:sinFecha.length+" mov(s) con fecha = hoy",detalle:"Sospechoso si el documento es de otro día. Verifica."});
      else if(sinFecha.length===0)validaciones.ok.push("Todas las fechas vienen del documento");
      // 7. Montos sospechosos (muy altos o muy bajos)
      const promedio=items.reduce((s,it)=>s+Number(it.monto||0),0)/items.length;
      const sospechosos=items.filter(it=>!it.duplicado&&(Number(it.monto)>promedio*20||(Number(it.monto)>0&&Number(it.monto)<10)));
      if(sospechosos.length>0)validaciones.warnings.push({msg:sospechosos.length+" mov(s) con monto sospechoso",detalle:"Montos muy altos o muy bajos comparados con el promedio ($"+Math.round(promedio).toLocaleString()+"). Revísalos."});
      // 8. Totales de la tabla
      if(parseInfoIng&&parseInfoIng.omitidas.length>0||parseInfoEgr&&parseInfoEgr.omitidas.length>0){
        const total=(parseInfoIng?.omitidas.length||0)+(parseInfoEgr?.omitidas.length||0);
        validaciones.ok.push(total+" fila(s) de totales omitidas automáticamente");
      }
      // Score de confianza
      const total=items.length||1;
      const erroresCount=sinDesc.length+obrasUnknown.length;
      const warningsCount=sinObra.length+obrasFuzzy.length+nDup+sospechosos.length;
      const score=Math.max(0,Math.round(100-(erroresCount/total)*100-(warningsCount/total)*30));
      const colorScore=score>=90?T.green:score>=70?T.yellow:T.red;
      const labelScore=score>=90?"✅ Excelente":score>=70?"⚠️ Revisar":score>=40?"⚠️ Problemas detectados":"🔴 NO importar sin revisar";
      const bloquearImport=validaciones.errores.length>0;
      return <div>
      {/* === PANEL DE VALIDACIÓN === */}
      <div style={{background:"linear-gradient(135deg,"+colorScore+"15,"+colorScore+"05)",border:"1px solid "+colorScore+"55",borderRadius:10,padding:14,marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontSize:11,color:T.muted,textTransform:"uppercase",letterSpacing:1,fontWeight:700}}>Score de Confianza</div>
            <div style={{fontSize:24,fontWeight:800,color:colorScore,marginTop:2}}>{score}% · <span style={{fontSize:13}}>{labelScore}</span></div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:T.muted}}>Resumen detectado:</div>
            <div style={{fontSize:11,fontWeight:700}}>
              <span style={{color:T.green}}>✓ {validaciones.ok.length}</span> ·
              <span style={{color:T.yellow,marginLeft:6}}>⚠ {validaciones.warnings.length}</span> ·
              <span style={{color:T.red,marginLeft:6}}>🔴 {validaciones.errores.length}</span>
            </div>
          </div>
        </div>
        {validaciones.errores.length>0&&<div style={{marginTop:8}}>
          <div style={{fontSize:10,color:T.red,fontWeight:800,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>🔴 ERRORES — corrige antes de importar</div>
          {validaciones.errores.map((v,i)=><div key={i} style={{padding:"6px 10px",background:"rgba(231,76,60,.08)",border:"1px solid "+T.red+"22",borderRadius:6,marginBottom:4,fontSize:11}}>
            <div style={{color:T.red,fontWeight:700}}>{v.msg}</div>
            <div style={{color:T.muted,marginTop:1,fontSize:10}}>{v.detalle}</div>
          </div>)}
        </div>}
        {validaciones.warnings.length>0&&<div style={{marginTop:8}}>
          <div style={{fontSize:10,color:T.yellow,fontWeight:800,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>⚠️ ADVERTENCIAS — revísalas pero se pueden importar</div>
          {validaciones.warnings.map((v,i)=><div key={i} style={{padding:"6px 10px",background:"rgba(255,213,79,.06)",border:"1px solid "+T.yellow+"22",borderRadius:6,marginBottom:4,fontSize:11}}>
            <div style={{color:T.yellow,fontWeight:700}}>{v.msg}</div>
            <div style={{color:T.muted,marginTop:1,fontSize:10}}>{v.detalle}</div>
          </div>)}
        </div>}
        {validaciones.ok.length>0&&validaciones.errores.length===0&&validaciones.warnings.length===0&&<div style={{marginTop:8}}>
          <div style={{fontSize:10,color:T.green,fontWeight:800,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>✅ TODO BIEN</div>
          {validaciones.ok.map((m,i)=><div key={i} style={{padding:"4px 10px",fontSize:11,color:T.green}}>✓ {m}</div>)}
        </div>}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
        <div style={{fontSize:12,fontWeight:700}}>📋 Preview: <span style={{color:T.green}}>+{$(totIng)}</span> · <span style={{color:T.red}}>-{$(totEgr)}</span> · <span style={{color:itemsValid.length>0?T.gold:T.muted}}>{itemsValid.length} movs a importar</span> {nDup>0&&<span style={{color:T.yellow,marginLeft:6}}>⚠️ {nDup} duplicados (omitidos)</span>}</div>
        <button onClick={()=>{if(confirm("¿Descartar TODOS los "+items.length+" movimientos del preview?\n\nNo afecta nada en el sistema, solo limpia esta pantalla."))setItems([]);}} style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+T.red+"55",background:"rgba(231,76,60,.08)",color:T.red,fontSize:11,fontWeight:700,cursor:"pointer"}}>✕ Descartar preview</button>
      </div>
      <div style={{borderRadius:8,border:"1px solid #333",overflow:"hidden",fontSize:11,maxHeight:380,overflowY:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead style={{position:"sticky",top:0,background:"#1a1a1a"}}>
            <tr>
              <th style={{padding:"6px 6px",textAlign:"left",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Fuente</th>
              <th style={{padding:"6px 6px",textAlign:"left",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Fecha</th>
              <th style={{padding:"6px 6px",textAlign:"left",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Descripción</th>
              <th style={{padding:"6px 6px",textAlign:"left",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Obra</th>
              <th style={{padding:"6px 6px",textAlign:"right",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Ingreso</th>
              <th style={{padding:"6px 6px",textAlign:"right",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Egreso</th>
              <th style={{padding:"6px",width:30}}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it,idx)=><tr key={idx} style={{borderBottom:"1px solid #2a2a2a",background:it.duplicado?"rgba(255,213,79,.06)":idx%2===0?"rgba(255,255,255,.01)":"transparent",opacity:it.duplicado?.5:1}} title={it.duplicado?"⚠️ Duplicado: ya existe en movs":""}>
              <td style={{padding:"4px 6px",borderRight:"1px solid #2a2a2a",fontSize:9,color:T.muted}}>{it.fuente}{it.duplicado&&<span style={{color:T.yellow,fontSize:9,marginLeft:4}}>⚠️</span>}</td>
              <td style={{padding:"4px 6px",borderRight:"1px solid #2a2a2a"}}><input value={it.fecha} onChange={e=>updateItem(idx,"fecha",e.target.value)} type="date" style={{background:"transparent",border:"none",color:T.text,fontSize:10,width:110,outline:"none"}}/></td>
              <td style={{padding:"4px 6px",borderRight:"1px solid #2a2a2a"}}><input value={it.desc} onChange={e=>updateItem(idx,"desc",e.target.value)} style={{background:"transparent",border:"none",color:T.text,fontSize:11,width:"100%",outline:"none"}}/></td>
              <td style={{padding:"4px 6px",borderRight:"1px solid #2a2a2a"}}>
                <select value={it.obra} onChange={e=>updateItem(idx,"obra",e.target.value)} style={{background:it.obraMatch==="sin-match"?"rgba(231,76,60,.1)":it.obraMatch==="fuzzy"?"rgba(255,213,79,.06)":"transparent",border:"none",color:it.obraMatch==="sin-match"?T.red:T.text,fontSize:10,width:"100%",outline:"none"}}>
                  <option value="">— sin obra —</option>
                  {obras.map(o=><option key={o.id} value={o.nombre}>{o.nombre}</option>)}
                </select>
                {it.obraMatch==="fuzzy"&&<div style={{fontSize:8,color:T.yellow}}>≈ "{it.obraOrig}"</div>}
                {it.obraMatch==="sin-match"&&<div style={{fontSize:8,color:T.red}}>⚠️ "{it.obraOrig}" no existe</div>}
              </td>
              <td style={{padding:"4px 6px",borderRight:"1px solid #2a2a2a",textAlign:"right"}}>{it.tipo==="ing"?<input value={it.monto} onChange={e=>updateItem(idx,"monto",e.target.value)} type="number" style={{background:"transparent",border:"none",color:T.green,fontWeight:800,fontSize:11,width:80,textAlign:"right",outline:"none"}}/>:"-"}</td>
              <td style={{padding:"4px 6px",borderRight:"1px solid #2a2a2a",textAlign:"right"}}>{it.tipo==="egr"?<input value={it.monto} onChange={e=>updateItem(idx,"monto",e.target.value)} type="number" style={{background:"transparent",border:"none",color:T.red,fontWeight:800,fontSize:11,width:80,textAlign:"right",outline:"none"}}/>:"-"}</td>
              <td style={{padding:"4px",textAlign:"center"}}><button onClick={()=>removeItem(idx)} style={{background:"transparent",border:"none",color:T.red,cursor:"pointer",fontSize:12}}>✕</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {/* ═══ RESUMEN CON TOTALES POR SECCIÓN ═══ */}
      {(()=>{
        const ingItems=itemsValid.filter(it=>it.tipo==="ing");
        const egrOtros=itemsValid.filter(it=>it.tipo==="egr"&&it.cat!=="Nómina");
        const nomItems=itemsValid.filter(it=>it.tipo==="egr"&&it.cat==="Nómina");
        const totIngS=ingItems.reduce((s,it)=>s+Number(it.monto),0);
        const totEgrS=egrOtros.reduce((s,it)=>s+Number(it.monto),0);
        const totNomS=nomItems.reduce((s,it)=>s+Number(it.monto),0);
        return <div style={{background:"rgba(255,255,255,.03)",border:"1px solid "+T.gold+"55",borderRadius:10,padding:12,marginBottom:10}}>
          <div style={{fontSize:11,color:T.gold,fontWeight:800,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>📊 Resumen — Verifica los totales antes de importar</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
            <div style={{padding:10,background:"rgba(76,175,80,.08)",border:"1px solid "+T.green+"33",borderRadius:7,textAlign:"center"}}>
              <div style={{fontSize:9,color:T.green,fontWeight:700,textTransform:"uppercase"}}>📈 Ingresos</div>
              <div style={{fontSize:18,fontWeight:800,color:T.green,marginTop:2}}>{$(totIngS)}</div>
              <div style={{fontSize:10,color:T.muted}}>{ingItems.length} mov(s)</div>
            </div>
            <div style={{padding:10,background:"rgba(231,76,60,.08)",border:"1px solid "+T.red+"33",borderRadius:7,textAlign:"center"}}>
              <div style={{fontSize:9,color:T.red,fontWeight:700,textTransform:"uppercase"}}>📉 Gastos</div>
              <div style={{fontSize:18,fontWeight:800,color:T.red,marginTop:2}}>{$(totEgrS)}</div>
              <div style={{fontSize:10,color:T.muted}}>{egrOtros.length} mov(s)</div>
            </div>
            <div style={{padding:10,background:"rgba(171,71,188,.08)",border:"1px solid "+T.purple+"33",borderRadius:7,textAlign:"center"}}>
              <div style={{fontSize:9,color:T.purple,fontWeight:700,textTransform:"uppercase"}}>💼 Nómina</div>
              <div style={{fontSize:18,fontWeight:800,color:T.purple,marginTop:2}}>{$(totNomS)}</div>
              <div style={{fontSize:10,color:T.muted}}>{nomItems.length} mov(s)</div>
            </div>
          </div>
          <div style={{padding:"8px 10px",background:"rgba(201,149,107,.06)",borderRadius:6,fontSize:11,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:T.gold,fontWeight:700}}>TOTAL A IMPORTAR</span>
            <span style={{fontSize:14,fontWeight:800,color:T.gold}}>{itemsValid.length} movs · {$(totIngS+totEgrS+totNomS)}</span>
          </div>
          {nDup>0&&<div style={{marginTop:6,fontSize:10,color:T.yellow,textAlign:"center"}}>⚠️ {nDup} duplicado(s) se omitirán</div>}
        </div>;
      })()}
      <button onClick={()=>{
        const valid=items.filter(it=>!it.duplicado&&Number(it.monto)>0&&it.desc);
        if(valid.length===0){alert("No hay items válidos para importar");return;}
        if(bloquearImport){if(!confirm("⚠️ HAY ERRORES en la validación (score "+score+"%).\n\nSe recomienda corregir antes de importar.\n\n¿Importar de todas formas? (No recomendado)"))return;}
        const nomC=valid.filter(v=>v.cat==="Nómina").length;
        const ingC=valid.filter(v=>v.tipo==="ing").length;
        const egrC=valid.filter(v=>v.tipo==="egr"&&v.cat!=="Nómina").length;
        if(!confirm("¿Importar "+valid.length+" movimientos del viernes "+fechaSem+"?\n\n"+
          "• "+ingC+" ingresos: "+$(totIng)+"\n"+
          "• "+egrC+" gastos: "+$(totEgr-valid.filter(v=>v.cat==="Nómina").reduce((s,v)=>s+Number(v.monto),0))+"\n"+
          "• "+nomC+" nómina: "+$(valid.filter(v=>v.cat==="Nómina").reduce((s,v)=>s+Number(v.monto),0))+"\n\n"+
          "TOTAL: "+$(totIng+totEgr)+"\n"+
          (nDup>0?"\n("+nDup+" duplicados omitidos)":"")+
          "\nScore de confianza: "+score+"%"
        ))return;
        onImport(valid);
      }} style={{...sB,background:bloquearImport?"linear-gradient(135deg,"+T.red+","+T.orange+")":"linear-gradient(135deg,"+T.green+","+T.gold+")",marginTop:6,fontSize:15,fontWeight:800,padding:"14px",boxShadow:"0 4px 14px rgba(76,175,80,.25)"}}>{bloquearImport?"⚠️ IMPORTAR CON ERRORES":"💾 IMPORTAR "+itemsValid.length+" MOVIMIENTOS"}</button>
    </div>;
    })()}
  </div>;
}
function ResincronizarView({obras,movs,caja,onAplicarNube}){
  const [estado,setEstado]=useState("inicio");
  const [datosNube,setDatosNube]=useState(null);
  const [error,setError]=useState(null);
  const cargarDeNube=async()=>{
    setEstado("cargando");setError(null);
    try{
      const headers={'apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY};
      const fetchKey=async(k)=>{
        const r=await fetch(SUPA_URL+'/rest/v1/ev_data?key=eq.'+k+'&select=value,updated_at&order=updated_at.desc.nullslast',{headers});
        if(!r.ok)throw new Error('HTTP '+r.status+' para '+k);
        const j=await r.json();
        return j&&j.length>0?j[0].value:[];
      };
      const obrasNube=await fetchKey('obras');
      const movsNube=await fetchKey('movs');
      const cajaNube=await fetchKey('caja');
      const recNube=await fetchKey('rec');
      setDatosNube({obras:obrasNube,movs:movsNube,caja:cajaNube,rec:recNube});
      setEstado("ok");
    }catch(e){setError(String(e.message||e));setEstado("error");}
  };
  if(estado==="inicio")return <div>
    <div style={{background:"rgba(66,165,245,.08)",border:"1px solid "+T.blue+"33",borderRadius:8,padding:14,marginBottom:14}}>
      <div style={{color:T.blue,fontWeight:700,marginBottom:6,fontSize:13}}>🔄 ¿Para qué sirve esto?</div>
      <div style={{fontSize:11,color:T.muted,lineHeight:1.6}}>Si borraste algo y reaparece, o si te FALTA algo que ya habías creado (como cotizaciones perdidas), aquí puedes ver QUÉ HAY en la nube vs QUÉ TIENES en local. Después decides si quieres reemplazar lo local con lo de la nube.</div>
    </div>
    <button onClick={cargarDeNube} style={{...sB,background:"linear-gradient(135deg,"+T.blue+","+T.purple+")",fontSize:14}}>📥 Traer todo desde la nube y comparar</button>
  </div>;
  if(estado==="cargando")return <div style={{textAlign:"center",padding:40}}>
    <div style={{fontSize:32,marginBottom:8}}>⏳</div>
    <div style={{color:T.blue,fontWeight:700}}>Descargando desde Supabase...</div>
  </div>;
  if(estado==="error")return <div>
    <div style={{padding:14,background:"rgba(231,76,60,.08)",border:"1px solid "+T.red+"44",borderRadius:8,marginBottom:10}}>
      <div style={{color:T.red,fontWeight:700,marginBottom:4}}>⚠️ Error al conectar con Supabase</div>
      <div style={{fontSize:11,color:T.muted}}>{error}</div>
    </div>
    <button onClick={cargarDeNube} style={{...sB,background:T.blue}}>🔄 Reintentar</button>
  </div>;
  // estado === "ok" — mostrar comparativa
  const cmp=(label,nube,local,id="id")=>{
    const nIds=new Set(nube.map(x=>x[id]));
    const lIds=new Set(local.map(x=>x[id]));
    const soloNube=nube.filter(x=>!lIds.has(x[id]));
    const soloLocal=local.filter(x=>!nIds.has(x[id]));
    return {label,nube:nube.length,local:local.length,soloNube,soloLocal};
  };
  const cObras=cmp("🏗 Obras",datosNube.obras,obras);
  const cMovs=cmp("💰 Movimientos",datosNube.movs,movs);
  const cCaja=cmp("🧾 Caja Chica",datosNube.caja,caja);
  return <div>
    <div style={{padding:10,background:"rgba(76,175,80,.06)",border:"1px solid "+T.green+"33",borderRadius:8,marginBottom:14,fontSize:11,color:T.muted}}>
      <span style={{color:T.green,fontWeight:700}}>✓ Datos descargados</span>. Compara qué hay en la nube vs local.
    </div>
    {[cObras,cMovs,cCaja].map(c=>{const dif=c.soloNube.length>0||c.soloLocal.length>0;return <div key={c.label} style={{padding:12,background:"rgba(255,255,255,.02)",border:"1px solid "+(dif?T.yellow+"44":T.border),borderRadius:8,marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontWeight:700,fontSize:13}}>{c.label}</div>
        <div style={{display:"flex",gap:14,fontSize:11}}>
          <span style={{color:T.blue}}>☁️ Nube: <b>{c.nube}</b></span>
          <span style={{color:T.muted}}>💻 Local: <b>{c.local}</b></span>
        </div>
      </div>
      {c.soloNube.length>0&&<div style={{marginTop:6,padding:8,background:"rgba(66,165,245,.06)",borderRadius:5,fontSize:11}}>
        <div style={{color:T.blue,fontWeight:700,marginBottom:4}}>🆕 {c.soloNube.length} en la nube que NO tienes local (perdidos):</div>
        {c.soloNube.slice(0,5).map((x,i)=><div key={i} style={{fontSize:10,color:T.text,padding:"2px 0"}}>• {x.nombre||x.desc||x.concepto||x.id} {x.cliente?"— "+x.cliente:""} {x.cotizado?"— "+$(x.cotizado):""}{x.ing>0?" +"+$(x.ing):""}{x.egr>0?" -"+$(x.egr):""}{x.monto?" "+$(x.monto):""}</div>)}
        {c.soloNube.length>5&&<div style={{fontSize:10,color:T.muted}}>... y {c.soloNube.length-5} más</div>}
      </div>}
      {c.soloLocal.length>0&&<div style={{marginTop:6,padding:8,background:"rgba(255,213,79,.06)",borderRadius:5,fontSize:11}}>
        <div style={{color:T.yellow,fontWeight:700,marginBottom:4}}>⚠️ {c.soloLocal.length} en local que NO están en la nube (sin sincronizar):</div>
        {c.soloLocal.slice(0,5).map((x,i)=><div key={i} style={{fontSize:10,color:T.text,padding:"2px 0"}}>• {x.nombre||x.desc||x.concepto||x.id}</div>)}
        {c.soloLocal.length>5&&<div style={{fontSize:10,color:T.muted}}>... y {c.soloLocal.length-5} más</div>}
      </div>}
      {!dif&&<div style={{fontSize:11,color:T.green,padding:"4px 0"}}>✓ Sincronizado correctamente</div>}
    </div>;})}
    <div style={{marginTop:14,padding:10,background:"rgba(231,76,60,.04)",border:"1px solid "+T.red+"22",borderRadius:6,fontSize:11,color:T.muted,marginBottom:10}}>
      <div style={{color:T.red,fontWeight:700,marginBottom:4}}>⚠️ Aplicar versión de la nube:</div>
      <div>Si los datos de la nube son los correctos (porque local tiene errores), puedes <b>reemplazar lo local con lo de la nube</b>. Tus cambios locales no sincronizados se perderán.</div>
    </div>
    <button onClick={()=>{if(!confirm("¿REEMPLAZAR datos locales con los de la nube?\n\nObras nube: "+cObras.nube+" (local: "+cObras.local+")\nMovs nube: "+cMovs.nube+" (local: "+cMovs.local+")\nCaja nube: "+cCaja.nube+" (local: "+cCaja.local+")\n\nLos datos locales sin sincronizar SE PIERDEN."))return;onAplicarNube(datosNube);}} style={{...sB,background:"linear-gradient(135deg,"+T.blue+","+T.purple+")"}}>📥 Aplicar versión de la nube (reemplaza local)</button>
  </div>;
}
function AuditoriaSistemaView({obras,movs,caja,onNormalizar,onEliminarObrasDup,onFusionarVariantes,onCrearObraFantasma}){
  // 1. Detectar obras DUPLICADAS en obras[] (mismo nombre normalizado, distinto id)
  const dupGroups={};
  obras.forEach(o=>{const k=normSearch(o.nombre);if(!dupGroups[k])dupGroups[k]=[];dupGroups[k].push(o);});
  const obrasDuplicadas=Object.entries(dupGroups).filter(([k,arr])=>arr.length>1).map(([k,arr])=>({key:k,nombre:arr[0].nombre,obras:arr}));
  // 2. Variantes de nombre en movs/caja (ej: "CORAL #39" vs "Coral 39" vs "CORAL#39")
  const variantesPorKey={};
  const todasObrasNombres=new Set(obras.map(o=>o.nombre));
  const procesar=(obraStr)=>{if(!obraStr||obraStr==="General")return;const k=normSearch(obraStr);if(!variantesPorKey[k])variantesPorKey[k]={canonico:"",variantes:new Map()};const vm=variantesPorKey[k].variantes;vm.set(obraStr,(vm.get(obraStr)||0)+1);};
  movs.forEach(m=>procesar(m.obra));
  caja.forEach(c=>procesar(c.obra));
  Object.entries(variantesPorKey).forEach(([k,v])=>{const real=obras.find(o=>normSearch(o.nombre)===k);v.canonico=real?real.nombre:[...v.variantes.keys()].sort((a,b)=>v.variantes.get(b)-v.variantes.get(a))[0];v.esFantasma=!real;});
  const variantesMultiples=Object.entries(variantesPorKey).filter(([k,v])=>v.variantes.size>1).map(([k,v])=>({key:k,canonico:v.canonico,esFantasma:v.esFantasma,variantes:[...v.variantes.entries()].map(([n,c])=>({nombre:n,count:c}))}));
  // 3. Obras fantasma (movs/caja con obra que no existe en obras[])
  const fantasmas=Object.entries(variantesPorKey).filter(([k,v])=>v.esFantasma).map(([k,v])=>({key:k,canonico:v.canonico,nMovs:[...v.variantes.values()].reduce((s,n)=>s+n,0)}));
  // 4. Movimientos sin obra
  const sinObra=movs.filter(m=>!m.obra||m.obra==="General").length+caja.filter(c=>!c.obra||c.obra==="General").length;
  // 5. Variantes con espacios o caracteres raros
  const sucias=Object.entries(variantesPorKey).filter(([k,v])=>{return [...v.variantes.keys()].some(n=>n!==n.trim()||/  +/.test(n));}).length;
  const totalProblemas=obrasDuplicadas.length+variantesMultiples.length+fantasmas.length+sucias;
  return <div>
    {/* Resumen */}
    <div style={{background:totalProblemas>0?"rgba(231,76,60,.06)":"rgba(76,175,80,.06)",border:"1px solid "+(totalProblemas>0?T.red+"33":T.green+"33"),borderRadius:10,padding:14,marginBottom:14}}>
      <div style={{fontSize:11,color:totalProblemas>0?T.red:T.green,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>{totalProblemas>0?"⚠️ Encontré "+totalProblemas+" problema"+(totalProblemas!==1?"s":"")+" en tus datos":"✓ Sistema limpio"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
        <div><div style={{fontSize:9,color:T.muted,textTransform:"uppercase"}}>Obras Duplicadas</div><div style={{fontSize:22,fontWeight:800,color:obrasDuplicadas.length>0?T.red:T.muted}}>{obrasDuplicadas.length}</div></div>
        <div><div style={{fontSize:9,color:T.muted,textTransform:"uppercase"}}>Variantes Nombre</div><div style={{fontSize:22,fontWeight:800,color:variantesMultiples.length>0?T.yellow:T.muted}}>{variantesMultiples.length}</div></div>
        <div><div style={{fontSize:9,color:T.muted,textTransform:"uppercase"}}>Fantasmas</div><div style={{fontSize:22,fontWeight:800,color:fantasmas.length>0?T.purple:T.muted}}>{fantasmas.length}</div></div>
        <div><div style={{fontSize:9,color:T.muted,textTransform:"uppercase"}}>Sin Obra</div><div style={{fontSize:22,fontWeight:800,color:T.muted}}>{sinObra}</div></div>
      </div>
    </div>
    {/* Botón Magic: arreglar todo de un click */}
    {(obrasDuplicadas.length>0||variantesMultiples.length>0)&&<button onClick={()=>{if(!confirm("🪄 LIMPIEZA AUTOMÁTICA:\n\n• Unificar nombres de obra (todas las variantes a uno solo)\n• Fusionar obras duplicadas en obras[]\n\n¿Continuar?"))return;onNormalizar();}} style={{...sB,background:"linear-gradient(135deg,"+T.gold+","+T.orange+")",marginBottom:12,fontSize:14}}>🪄 ARREGLAR TODO AUTOMÁTICAMENTE</button>}
    {/* Sección 1: Obras Duplicadas en obras[] */}
    {obrasDuplicadas.length>0&&<div style={{marginBottom:14}}>
      <div style={{fontSize:11,color:T.red,fontWeight:800,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>🔴 1. Obras duplicadas en sistema ({obrasDuplicadas.length})</div>
      <div style={{fontSize:11,color:T.muted,marginBottom:8}}>Tienes varios "registros de obra" con el mismo nombre. Esto causa que aparezcan dos veces en TODOS los listados.</div>
      {obrasDuplicadas.map(d=><div key={d.key} style={{background:"rgba(231,76,60,.04)",border:"1px solid "+T.red+"22",borderRadius:8,padding:10,marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontSize:13,fontWeight:700,color:T.red}}>"{d.nombre}" — {d.obras.length} copias</div>
          <button onClick={()=>{if(confirm("¿Fusionar las "+d.obras.length+" copias de '"+d.nombre+"' en una sola?\n\nSe suma el cotizado y se preservan partidas/movs."))onEliminarObrasDup(d.obras);}} style={{padding:"5px 12px",borderRadius:6,border:"none",background:T.red,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>🔗 Fusionar</button>
        </div>
        <div style={{display:"grid",gap:4}}>
          {d.obras.map(o=><div key={o.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.muted,padding:"4px 8px",background:"rgba(255,255,255,.02)",borderRadius:5}}>
            <span>{o.cliente||"sin cliente"} · {FASES[o.fase]||o.fase}</span>
            <span style={{color:T.gold,fontWeight:700}}>{$(o.cotizado||0)}</span>
          </div>)}
        </div>
      </div>)}
    </div>}
    {/* Sección 2: Variantes de nombre en movimientos */}
    {variantesMultiples.length>0&&<div style={{marginBottom:14}}>
      <div style={{fontSize:11,color:T.yellow,fontWeight:800,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>🟡 2. Variantes de nombre en movs ({variantesMultiples.length})</div>
      <div style={{fontSize:11,color:T.muted,marginBottom:8}}>Misma obra escrita de diferentes formas. Causa que el filtro no encuentre todos los movs.</div>
      {variantesMultiples.map(v=><div key={v.key} style={{background:"rgba(255,213,79,.04)",border:"1px solid "+T.yellow+"22",borderRadius:8,padding:10,marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontSize:13,fontWeight:700,color:T.yellow}}>Canónico: "{v.canonico}" {v.esFantasma&&<span style={{fontSize:9,color:T.purple,marginLeft:6}}>👻 fantasma</span>}</div>
          <button onClick={()=>{if(confirm("¿Cambiar TODAS las variantes ("+v.variantes.length+") a '"+v.canonico+"'?\n\nActualiza todos los movs y caja chica."))onFusionarVariantes(v.key,v.canonico);}} style={{padding:"5px 12px",borderRadius:6,border:"none",background:T.yellow,color:"#000",fontSize:11,fontWeight:700,cursor:"pointer"}}>✓ Unificar</button>
        </div>
        <div style={{display:"grid",gap:3}}>
          {v.variantes.sort((a,b)=>b.count-a.count).map(va=><div key={va.nombre} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 8px",background:"rgba(255,255,255,.02)",borderRadius:4}}>
            <span style={{color:va.nombre===v.canonico?T.green:T.text,fontFamily:"monospace"}}>{va.nombre===v.canonico?"✓ ":"  "}"{va.nombre}"</span>
            <span style={{color:T.muted}}>{va.count} mov{va.count!==1?"s":""}</span>
          </div>)}
        </div>
      </div>)}
    </div>}
    {/* Sección 3: Fantasmas */}
    {fantasmas.length>0&&<div style={{marginBottom:14}}>
      <div style={{fontSize:11,color:T.purple,fontWeight:800,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>👻 3. Obras fantasma ({fantasmas.length})</div>
      <div style={{fontSize:11,color:T.muted,marginBottom:8}}>Movimientos con obra que no existe en el sistema. Puedes <b style={{color:T.green}}>crearla como obra real</b> de un click (✨) o <b style={{color:T.blue}}>reasignar sus movs</b> a otra obra (🔀).</div>
      <div style={{display:"grid",gap:4}}>
        {fantasmas.map(f=><div key={f.key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"rgba(171,71,188,.04)",border:"1px solid "+T.purple+"22",borderRadius:5,fontSize:11,gap:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{color:T.purple,fontWeight:600}}>👻 "{f.canonico}"</div>
            <div style={{color:T.muted,fontSize:10}}>{f.nMovs} mov{f.nMovs!==1?"s":""} sin obra registrada</div>
          </div>
          <button onClick={()=>{if(onCrearObraFantasma)onCrearObraFantasma(f.canonico);}} style={{padding:"6px 10px",borderRadius:5,border:"1px solid "+T.green+"55",background:"rgba(76,175,80,.1)",color:T.green,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}} title="Crear esta obra en el sistema (los movs se le asocian automáticamente)">✨ Crear como obra</button>
        </div>)}
      </div>
    </div>}
    {totalProblemas===0&&<div style={{textAlign:"center",padding:30,color:T.green}}>
      <div style={{fontSize:48,marginBottom:8}}>✨</div>
      <div style={{fontWeight:700,marginBottom:4}}>¡Todo limpio!</div>
      <div style={{fontSize:11,color:T.muted}}>No detecté problemas de duplicación o inconsistencia.</div>
    </div>}
  </div>;
}
function ImportadorMasivoForm({tipo,obras,onImport}){
  // tipo: "ing" o "egr"
  const [modo,setModo]=useState("pegar"); // pegar, foto, archivo
  const [pegado,setPegado]=useState("");
  const [parseado,setParseado]=useState([]);
  const [escaneando,setEscaneando]=useState(false);
  const titulo=tipo==="ing"?"Ingresos":"Egresos";
  const colorTipo=tipo==="ing"?T.green:T.red;
  // Helper: parsear texto pegado (TSV o CSV)
  const parsearTexto=(txt)=>{
    if(!txt.trim()){setParseado([]);return;}
    const lineas=txt.split("\n").filter(l=>l.trim());
    // Detectar separador: tab o coma
    const sep=lineas[0].includes("\t")?"\t":",";
    // Detectar si primera línea es header
    const primera=lineas[0].split(sep).map(c=>c.trim().toLowerCase());
    const haySSHeader=primera.some(c=>["fecha","mes","descripcion","descripción","desc","concepto","obra","total","monto","ingreso","egreso","gasto","proveedor","cliente"].includes(c));
    const startIdx=haySSHeader?1:0;
    const headers=haySSHeader?primera:["col0","col1","col2","col3","col4","col5","col6","col7"];
    // Detectar índices de columnas clave
    const findCol=(opts)=>{for(const o of opts){const i=headers.findIndex(h=>h.includes(o));if(i>=0)return i;}return -1;};
    const colFecha=findCol(["fecha","date"]);
    const colDesc=findCol(["descripcion","descripción","desc","concepto"]);
    const colObra=findCol(["obra","proyecto"]);
    const colMonto=findCol(["total","monto","ingreso","egreso","gasto"]);
    const colCat=findCol(["categoria","categoría","cat"]);
    const colProv=findCol(["proveedor","prov","cliente"]);
    // Función para parsear fecha "22/5/26" → "2026-05-22"
    const parseDate=(s)=>{
    if(!s||!String(s).trim())return "";
    s=String(s).trim();
    // ISO ya formateado
    if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
    // DD/MM/AAAA o DD/MM/AA
    let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if(m){const d=m[1].padStart(2,"0");const mo=m[2].padStart(2,"0");let y=m[3];if(y.length===2)y="20"+y;return y+"-"+mo+"-"+d;}
    // DD-MM-AAAA o DD-MM-AA
    m=s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
    if(m){const d=m[1].padStart(2,"0");const mo=m[2].padStart(2,"0");let y=m[3];if(y.length===2)y="20"+y;return y+"-"+mo+"-"+d;}
    // DD.MM.AAAA
    m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if(m){const d=m[1].padStart(2,"0");const mo=m[2].padStart(2,"0");let y=m[3];if(y.length===2)y="20"+y;return y+"-"+mo+"-"+d;}
    // Texto tipo "29 mayo 2026" o "29 de mayo de 2026"
    const meses={"enero":"01","febrero":"02","marzo":"03","abril":"04","mayo":"05","junio":"06","julio":"07","agosto":"08","septiembre":"09","octubre":"10","noviembre":"11","diciembre":"12"};
    const ml=s.toLowerCase();
    for(const[nm,mn]of Object.entries(meses)){
      const reM=new RegExp("(\\d{1,2})\\s+(?:de\\s+)?"+nm+"(?:\\s+(?:de\\s+)?(\\d{4}))?");
      const mm=ml.match(reM);
      if(mm){const d=mm[1].padStart(2,"0");const y=mm[2]||String(new Date().getFullYear());return y+"-"+mn+"-"+d;}
    }
    return ""; // No se pudo parsear → vacío (NO td())
  };
    // Función para parsear monto "1,381.77" → 1381.77
    const parseMonto=(s)=>{if(!s)return 0;return Number(String(s).replace(/[^0-9.-]/g,""))||0;};
    // Match obra con fuzzy
    const matchObra=(nombre)=>{if(!nombre)return "";const n=normSearch(nombre);const exact=obras.find(o=>normSearch(o.nombre)===n);if(exact)return exact.nombre;const part=obras.find(o=>normSearch(o.nombre).includes(n)||n.includes(normSearch(o.nombre)));return part?part.nombre:nombre;};
    const items=[];
    for(let i=startIdx;i<lineas.length;i++){
      const celdas=lineas[i].split(sep).map(c=>c.trim().replace(/^"|"$/g,""));
      if(celdas.every(c=>!c))continue;
      const desc=colDesc>=0?celdas[colDesc]:celdas.find(c=>c.length>5&&isNaN(Number(c)))||"";
      const fecha=(colFecha>=0?parseDate(celdas[colFecha]):"")||td();
      const obraStr=colObra>=0?celdas[colObra]:"";
      const obra=matchObra(obraStr);
      const monto=colMonto>=0?parseMonto(celdas[colMonto]):parseMonto(celdas[celdas.length-1]);
      if(monto>0&&desc){
        const cat=colCat>=0?celdas[colCat]:"";
        const prov=colProv>=0?celdas[colProv]:"";
        items.push({fecha,desc,obra,monto,cat,prov,obraOrig:obraStr,obraMatch:obraStr&&obra===obraStr?"exacto":obraStr&&obras.find(o=>normSearch(o.nombre).includes(normSearch(obraStr))||normSearch(obraStr).includes(normSearch(o.nombre)))?"fuzzy":obraStr?"sin-match":""});
      }
    }
    setParseado(items);
  };
  const escanearFoto=async(file)=>{
    setEscaneando(true);
    try{
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej("err");r.readAsDataURL(file);});
      const prompt='Esta es una tabla de '+(tipo==="ing"?"INGRESOS":"GASTOS/EGRESOS")+'. Extrae TODOS los renglones como JSON array. Columnas a identificar: fecha, descripcion, obra (si tiene), monto/total. Las fechas estilo "22/5/26" conviértelas a "2026-05-22". Responde SOLO un JSON array sin markdown: [{"fecha":"2026-05-22","desc":"...","obra":"coral","monto":1234},...]. Si no detectas nada: []';
      const data=await callAI([{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:b64}},{type:"text",text:prompt}]}],4000);
      const text=data.content?.map(i=>i.text||"").join("")||"[]";
      const items=JSON.parse(text.replace(/```json|```/g,"").trim());
      if(Array.isArray(items)){
        // Match obras
        const matched=items.map(it=>{const n=normSearch(it.obra||"");const exact=obras.find(o=>normSearch(o.nombre)===n);const part=!exact&&n&&obras.find(o=>normSearch(o.nombre).includes(n)||n.includes(normSearch(o.nombre)));return{...it,obra:exact?exact.nombre:part?part.nombre:it.obra||"",obraOrig:it.obra||"",obraMatch:exact?"exacto":part?"fuzzy":it.obra?"sin-match":""};});
        setParseado(matched);
      }
    }catch(e){if(e.message==="NO_KEY")alert("⚠️ Configura tu API Key en Más → 🔑 API Key IA");else alert("Error: "+e.message.slice(0,100));}
    setEscaneando(false);
  };
  const updateItem=(idx,key,val)=>setParseado(prev=>prev.map((it,i)=>i===idx?{...it,[key]:val}:it));
  const removeItem=(idx)=>setParseado(prev=>prev.filter((_,i)=>i!==idx));
  const totalImport=parseado.reduce((s,it)=>s+(Number(it.monto)||0),0);
  return <div>
    {/* Tabs de modo */}
    <div style={{display:"flex",gap:4,marginBottom:12}}>
      {[{k:"pegar",i:"📋",l:"Pegar de Excel"},{k:"foto",i:"📷",l:"Subir foto (IA)"},{k:"archivo",i:"📄",l:"Archivo CSV"}].map(t=><button key={t.k} onClick={()=>setModo(t.k)} style={{flex:1,padding:"10px 6px",borderRadius:8,border:modo===t.k?"2px solid "+colorTipo:"1px solid "+T.border,background:modo===t.k?colorTipo+"15":T.card,color:modo===t.k?colorTipo:T.muted,cursor:"pointer",fontSize:11,fontWeight:700}}><div style={{fontSize:16}}>{t.i}</div>{t.l}</button>)}
    </div>
    {/* Modo: pegar */}
    {modo==="pegar"&&<div>
      <div style={{fontSize:11,color:T.muted,marginBottom:6}}>Copia las celdas de tu Excel/Sheets y pégalas aquí. El sistema detecta automáticamente las columnas.</div>
      <textarea value={pegado} onChange={e=>{setPegado(e.target.value);parsearTexto(e.target.value);}} placeholder="fecha    descripcion    obra    total&#10;22/5/26    Gasolina ram    coral    500&#10;..." style={{...sI,minHeight:120,fontSize:11,fontFamily:"monospace"}}/>
    </div>}
    {/* Modo: foto */}
    {modo==="foto"&&<label style={{display:"block",padding:24,border:"2px dashed "+(escaneando?T.blue:T.border),borderRadius:10,textAlign:"center",cursor:escaneando?"wait":"pointer",background:escaneando?"#0a1a33":"#111"}}>
      <input type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{const raw=e.target.files[0];if(!raw)return;try{const f=await compressImage(raw);escanearFoto(f);}catch(err){alert(err.message);}}}/>
      {escaneando?<div><div style={{color:T.blue,fontWeight:700,fontSize:14}}>🤖 IA analizando tabla...</div><div style={{fontSize:11,color:T.muted,marginTop:6}}>Extrayendo fechas, descripciones, obras y montos</div></div>:<div><div style={{fontSize:36}}>📷</div><div style={{color:colorTipo,fontWeight:700,fontSize:13,marginTop:4}}>Toma o sube foto de tu tabla</div><div style={{fontSize:10,color:T.muted,marginTop:4}}>La IA reconoce las columnas automáticamente</div></div>}
    </label>}
    {/* Modo: archivo */}
    {modo==="archivo"&&<label style={{display:"block",padding:20,border:"2px dashed "+T.border,borderRadius:10,textAlign:"center",cursor:"pointer",background:"#111"}}>
      <input type="file" accept=".csv,.txt" style={{display:"none"}} onChange={e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=ev=>{setPegado(ev.target.result);parsearTexto(ev.target.result);};r.readAsText(file,"UTF-8");}}/>
      <div style={{fontSize:32}}>📄</div>
      <div style={{color:colorTipo,fontWeight:700,marginTop:4}}>Subir CSV</div>
      <div style={{fontSize:10,color:T.muted,marginTop:4}}>Exporta de Excel como CSV → arrastra aquí</div>
    </label>}
    {/* Preview */}
    {parseado.length>0&&<div style={{marginTop:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:11,color:colorTipo,fontWeight:800,letterSpacing:.5,textTransform:"uppercase"}}>📋 Preview · {parseado.length} {titulo.toLowerCase()} · {$(totalImport)}</div>
      </div>
      <div style={{borderRadius:8,border:"1px solid #333",overflow:"hidden",fontSize:11,maxHeight:340,overflowY:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead style={{position:"sticky",top:0,background:"#1a1a1a"}}>
            <tr>
              <th style={{padding:"6px 8px",textAlign:"left",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Fecha</th>
              <th style={{padding:"6px 8px",textAlign:"left",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Descripción</th>
              <th style={{padding:"6px 8px",textAlign:"left",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Obra</th>
              <th style={{padding:"6px 8px",textAlign:"right",fontSize:9,color:T.gold,borderRight:"1px solid #333"}}>Monto</th>
              <th style={{padding:"6px",width:30}}></th>
            </tr>
          </thead>
          <tbody>
            {parseado.map((it,idx)=><tr key={idx} style={{borderBottom:"1px solid #2a2a2a",background:idx%2===0?"rgba(255,255,255,.01)":"transparent"}}>
              <td style={{padding:"4px 8px",borderRight:"1px solid #2a2a2a"}}><input value={it.fecha} onChange={e=>updateItem(idx,"fecha",e.target.value)} type="date" style={{background:"transparent",border:"none",color:T.text,fontSize:11,width:120,outline:"none"}}/></td>
              <td style={{padding:"4px 8px",borderRight:"1px solid #2a2a2a"}}><input value={it.desc} onChange={e=>updateItem(idx,"desc",e.target.value)} style={{background:"transparent",border:"none",color:T.text,fontSize:11,width:"100%",outline:"none"}}/></td>
              <td style={{padding:"4px 8px",borderRight:"1px solid #2a2a2a"}}>
                <select value={it.obra} onChange={e=>updateItem(idx,"obra",e.target.value)} style={{background:it.obraMatch==="sin-match"?"rgba(231,76,60,.1)":it.obraMatch==="fuzzy"?"rgba(255,213,79,.06)":"transparent",border:"none",color:it.obraMatch==="sin-match"?T.red:T.text,fontSize:11,width:"100%",outline:"none"}}>
                  <option value="">— sin obra —</option>
                  {obras.map(o=><option key={o.id} value={o.nombre}>{o.nombre}</option>)}
                </select>
                {it.obraMatch==="fuzzy"&&<div style={{fontSize:9,color:T.yellow}}>≈ "{it.obraOrig}"</div>}
                {it.obraMatch==="sin-match"&&<div style={{fontSize:9,color:T.red}}>⚠️ "{it.obraOrig}" no existe</div>}
              </td>
              <td style={{padding:"4px 8px",borderRight:"1px solid #2a2a2a",textAlign:"right"}}><input value={it.monto} onChange={e=>updateItem(idx,"monto",e.target.value)} type="number" style={{background:"transparent",border:"none",color:colorTipo,fontWeight:800,fontSize:12,width:80,textAlign:"right",outline:"none"}}/></td>
              <td style={{padding:"4px",textAlign:"center"}}><button onClick={()=>removeItem(idx)} style={{background:"transparent",border:"none",color:T.red,cursor:"pointer",fontSize:12}} title="Quitar">✕</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <button onClick={()=>{const valid=parseado.filter(it=>Number(it.monto)>0&&it.desc);if(valid.length===0){alert("No hay items válidos para importar");return;}if(!confirm("¿Importar "+valid.length+" "+titulo.toLowerCase()+" ("+$(totalImport)+")?"))return;onImport(valid);}} style={{...sB,background:colorTipo,marginTop:12}}>💾 Importar {parseado.length} {titulo.toLowerCase()} · {$(totalImport)}</button>
    </div>}
  </div>;
}
function ObrasSimilaresView({obras,movs,caja,onFusionar}){
  // Incluir obras "reales" + obras fantasmas (nombres encontrados en movs/caja sin match en obras[])
  const sameObra3=(a,b)=>{const na=(a||"").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");const nb=(b||"").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");return na===nb;};
  const todosNombres=new Map();
  obras.forEach(o=>todosNombres.set(normSearch(o.nombre),{id:o.id,nombre:o.nombre,cotizado:o.cotizado||0,cliente:o.cliente||"",fase:o.fase,isFantasma:false}));
  movs.forEach(m=>{if(m.obra){const k=normSearch(m.obra);if(!todosNombres.has(k))todosNombres.set(k,{id:"F-"+k,nombre:m.obra,cotizado:0,cliente:"",isFantasma:true});}});
  caja.forEach(c=>{if(c.obra){const k=normSearch(c.obra);if(!todosNombres.has(k))todosNombres.set(k,{id:"F-"+k,nombre:c.obra,cotizado:0,cliente:"",isFantasma:true});}});
  const todasObras=[...todosNombres.values()];
  // Enriquecer con stats de movs
  todasObras.forEach(o=>{
    o.ing=movs.filter(m=>m.ing>0&&sameObra3(m.obra,o.nombre)).reduce((s,m)=>s+m.ing,0);
    o.egr=movs.filter(m=>m.egr>0&&sameObra3(m.obra,o.nombre)).reduce((s,m)=>s+m.egr,0)+caja.filter(c=>sameObra3(c.obra,o.nombre)&&c.status!=="rechazado").reduce((s,c)=>s+c.monto,0);
    o.nMovs=movs.filter(m=>sameObra3(m.obra,o.nombre)).length+caja.filter(c=>sameObra3(c.obra,o.nombre)).length;
  });
  const grupos=agruparObrasSimilares(todasObras);
  const [seleccionPorGrupo,setSeleccionPorGrupo]=useState({}); // {grupoIdx: {destinoId: id, fusionar: Set<id>}}
  const toggleEnGrupo=(gIdx,id)=>{
    setSeleccionPorGrupo(prev=>{
      const cur=prev[gIdx]||{destinoId:null,fusionar:new Set()};
      const nueva=new Set(cur.fusionar);
      if(nueva.has(id))nueva.delete(id);else nueva.add(id);
      return {...prev,[gIdx]:{...cur,fusionar:nueva}};
    });
  };
  const setDestino=(gIdx,id)=>setSeleccionPorGrupo(prev=>({...prev,[gIdx]:{...(prev[gIdx]||{fusionar:new Set()}),destinoId:id}}));
  if(grupos.length===0){
    const exclusiones=obtenerExclusionesObras();
    return <div>
      <div style={{textAlign:"center",padding:30,color:T.green}}>
        <div style={{fontSize:42,marginBottom:8}}>✅</div>
        <div style={{fontWeight:700,fontSize:14,color:T.green}}>No se detectaron obras duplicadas</div>
        <div style={{fontSize:11,color:T.muted,marginTop:6}}>Todas tus obras tienen nombres únicos o números distintos.</div>
      </div>
      {exclusiones.length>0&&<div style={{marginTop:14,padding:12,background:"rgba(255,255,255,.02)",border:"1px solid "+T.border,borderRadius:8}}>
        <div style={{fontSize:11,color:T.gold,fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>📋 Exclusiones manuales ({exclusiones.length})</div>
        <div style={{fontSize:10,color:T.muted,marginBottom:8}}>Pares que marcaste como "NO duplicadas". El sistema no las volverá a sugerir.</div>
        <div style={{display:"grid",gap:4,maxHeight:200,overflowY:"auto",marginBottom:10}}>
          {exclusiones.map((par,i)=><div key={i} style={{padding:"4px 8px",background:"rgba(255,255,255,.02)",borderRadius:4,fontSize:11,display:"flex",justifyContent:"space-between"}}>
            <span style={{color:T.text}}>"{par[0]}" ↔ "{par[1]}"</span>
          </div>)}
        </div>
        <button onClick={()=>{if(!confirm("¿Limpiar TODAS las "+exclusiones.length+" exclusiones?\n\nEl sistema volverá a sugerir TODOS los pares que habías marcado como 'no duplicados'."))return;guardarExclusionesObras([]);alert("✓ Limpiado. Refresca la página.");}} style={{padding:"6px 12px",borderRadius:5,border:"1px solid "+T.red+"55",background:"rgba(231,76,60,.08)",color:T.red,fontSize:11,fontWeight:700,cursor:"pointer",width:"100%"}}>⟲ Limpiar todas las exclusiones</button>
      </div>}
    </div>;
  }
  return <div>
    <div style={{background:"rgba(255,213,79,.06)",border:"1px solid "+T.yellow+"33",borderRadius:8,padding:12,marginBottom:14,fontSize:11,color:T.muted,lineHeight:1.5}}>
      <div style={{color:T.yellow,fontWeight:700,marginBottom:4}}>🔍 Detecté {grupos.length} grupo{grupos.length!==1?"s":""} de obras parecidas</div>
      Para cada grupo: marca las obras que son <b>la misma</b> con el checkbox, elige cuál es la "principal" (donde quedará todo), y dale "🔗 Fusionar grupo".
    </div>
    {grupos.map((grupo,gIdx)=>{
      const sel=seleccionPorGrupo[gIdx]||{destinoId:null,fusionar:new Set()};
      const grupoSorted=[...grupo].sort((a,b)=>(b.cotizado||0)-(a.cotizado||0));
      const numSeleccionadas=sel.fusionar.size;
      const totIng=grupo.reduce((s,o)=>s+o.ing,0);
      const totEgr=grupo.reduce((s,o)=>s+o.egr,0);
      const tokensComunes=obraTokens(grupo[0].nombre).filter(t=>grupo.every(o=>obraTokens(o.nombre).includes(t)));
      return <div key={gIdx} style={{background:"rgba(255,255,255,.02)",border:"1px solid "+T.border,borderRadius:10,padding:12,marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <div>
            <div style={{fontSize:11,color:T.gold,fontWeight:800,textTransform:"uppercase",letterSpacing:.5}}>📦 Grupo "{tokensComunes.join(" · ").toUpperCase()||grupo[0].nombre}"</div>
            <div style={{fontSize:10,color:T.muted,marginTop:2}}>{grupo.length} obras · Cobrado total {$(totIng)} · Gastado total {$(totEgr)}</div>
          </div>
          <button onClick={()=>{
            if(!confirm("¿Marcar este grupo como obras DISTINTAS?\n\nEl sistema no las volverá a sugerir como duplicadas."))return;
            const exclusiones=obtenerExclusionesObras();
            for(let i=0;i<grupo.length;i++){
              for(let j=i+1;j<grupo.length;j++){
                const par=[normSearch(grupo[i].nombre),normSearch(grupo[j].nombre)];
                if(!exclusiones.some(ex=>(ex[0]===par[0]&&ex[1]===par[1])||(ex[0]===par[1]&&ex[1]===par[0])))exclusiones.push(par);
              }
            }
            guardarExclusionesObras(exclusiones);
            alert("✓ Marcadas como obras distintas. Refresca la página para que desaparezcan.");
          }} style={{padding:"10px 16px",borderRadius:8,border:"2px solid "+T.green,background:"linear-gradient(135deg,rgba(76,175,80,.15),rgba(76,175,80,.05))",color:T.green,fontSize:13,fontWeight:800,cursor:"pointer",whiteSpace:"nowrap",boxShadow:"0 2px 8px rgba(76,175,80,.2)"}} title="No son duplicadas, son obras distintas">🚫 NO son duplicadas</button>
        </div>
        <div style={{display:"grid",gap:4,marginBottom:8}}>
          {grupoSorted.map(o=><div key={o.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:sel.destinoId===o.id?"rgba(76,175,80,.08)":sel.fusionar.has(o.id)?"rgba(171,71,188,.06)":"rgba(255,255,255,.02)",border:"1px solid "+(sel.destinoId===o.id?T.green+"55":sel.fusionar.has(o.id)?T.purple+"33":T.border),borderRadius:6}}>
            <input type="checkbox" checked={sel.fusionar.has(o.id)} onChange={()=>toggleEnGrupo(gIdx,o.id)} disabled={sel.destinoId===o.id} style={{cursor:"pointer",accentColor:T.purple}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{o.nombre} {o.isFantasma&&<span style={{fontSize:9,color:T.purple,marginLeft:4}}>👻 fantasma</span>} {sel.destinoId===o.id&&<span style={{fontSize:9,color:T.green,marginLeft:4,fontWeight:800}}>✓ PRINCIPAL</span>}</div>
              <div style={{fontSize:9,color:T.muted,marginTop:1}}>{o.cliente||"Sin cliente"} {o.cotizado>0&&<>· Cotizado {$(o.cotizado)}</>} · {o.nMovs} movs · {$(o.ing)} cob / {$(o.egr)} gas</div>
            </div>
            <button onClick={()=>setDestino(gIdx,sel.destinoId===o.id?null:o.id)} disabled={o.isFantasma} style={{background:sel.destinoId===o.id?T.green+"33":"rgba(76,175,80,.08)",border:"1px solid "+T.green+"33",color:T.green,cursor:o.isFantasma?"not-allowed":"pointer",fontSize:10,padding:"5px 10px",borderRadius:5,fontWeight:700,opacity:o.isFantasma?.3:1,whiteSpace:"nowrap"}} title={o.isFantasma?"Una obra fantasma no puede ser PRINCIPAL":"Marcar como obra principal"}>{sel.destinoId===o.id?"✓ Principal":"⭐ Principal"}</button>
          </div>)}
        </div>
        <button onClick={()=>{
          if(!sel.destinoId){alert("Selecciona la obra PRINCIPAL (estrella)");return;}
          if(numSeleccionadas===0){alert("Marca al menos una obra con ✓ para fusionar a la principal");return;}
          const destino=grupo.find(o=>o.id===sel.destinoId);
          const fusionarObras=grupo.filter(o=>sel.fusionar.has(o.id)&&o.id!==sel.destinoId);
          if(fusionarObras.length===0){alert("No marcaste ninguna obra distinta a la principal");return;}
          if(!confirm("¿Fusionar "+fusionarObras.length+" obra(s) en '"+destino.nombre+"'?\n\nSe reasignan TODOS los movimientos y las obras secundarias se eliminan.\n\nEsta acción NO se puede deshacer."))return;
          onFusionar(destino,fusionarObras);
          setSeleccionPorGrupo(prev=>{const nv={...prev};delete nv[gIdx];return nv;});
        }} disabled={!sel.destinoId||numSeleccionadas===0} style={{padding:"8px 14px",borderRadius:6,border:"none",background:sel.destinoId&&numSeleccionadas>0?T.purple:T.dim,color:"#fff",fontWeight:700,fontSize:12,cursor:sel.destinoId&&numSeleccionadas>0?"pointer":"not-allowed",width:"100%"}}>🔗 Fusionar {numSeleccionadas} obra{numSeleccionadas!==1?"s":""} en "{(grupo.find(o=>o.id===sel.destinoId)||{}).nombre||"...selecciona principal"}"</button>
      </div>;
    })}
  </div>;
}
function DelObraForm({obra,obras,movs,caja,onDone}){
  const sameObra=(a,b)=>{const na=(a||"").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");const nb=(b||"").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");return na===nb;};
  const movsObra=movs.filter(m=>sameObra(m.obra,obra.nombre));
  const cajaObra=caja.filter(c=>sameObra(c.obra,obra.nombre));
  const totalMovs=movsObra.length+cajaObra.length;
  const totalMonto=movsObra.reduce((s,m)=>s+(m.ing||0)+(m.egr||0),0)+cajaObra.reduce((s,c)=>s+c.monto,0);
  const [accion,setAccion]=useState(totalMovs>0?"reasignar":"solo");
  const [destino,setDestino]=useState("");
  const otrasObras=obras.filter(o=>o.id!==obra.id).map(o=>o.nombre).sort();
  return <div>
    <div style={{textAlign:"center",marginBottom:14}}>
      <div style={{fontSize:36,marginBottom:8}}>⚠️</div>
      <div style={{fontSize:16,fontWeight:800}}>¿Eliminar "{obra.nombre}"?</div>
      <div style={{fontSize:11,color:T.muted,marginTop:4}}>Cotizado: {$(obra.cotizado||0)}</div>
    </div>
    {totalMovs>0?<div style={{background:"rgba(255,213,79,.06)",border:"1px solid "+T.yellow+"33",borderRadius:8,padding:12,marginBottom:14}}>
      <div style={{fontSize:11,color:T.yellow,fontWeight:700,marginBottom:6}}>⚠️ Esta obra tiene {totalMovs} movimiento{totalMovs!==1?"s":""} ({$(totalMonto)})</div>
      <div style={{fontSize:11,color:T.muted}}>{movsObra.length} en finanzas · {cajaObra.length} en caja chica</div>
    </div>:<div style={{fontSize:11,color:T.green,padding:10,background:"rgba(76,175,80,.06)",borderRadius:8,marginBottom:14,textAlign:"center"}}>✓ Sin movimientos asociados</div>}

    <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>¿Qué hacer con los movimientos?</div>

    {totalMovs>0&&<>
      <label style={{display:"flex",alignItems:"flex-start",gap:8,padding:10,border:"1px solid "+(accion==="reasignar"?T.gold:T.border),borderRadius:8,marginBottom:6,cursor:"pointer",background:accion==="reasignar"?"rgba(201,149,107,.06)":"transparent"}}>
        <input type="radio" name="acc" checked={accion==="reasignar"} onChange={()=>setAccion("reasignar")} style={{marginTop:3}}/>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:12,color:T.gold}}>🔀 Reasignar a otra obra (RECOMENDADO)</div>
          <div style={{fontSize:10,color:T.muted,marginTop:2}}>Los {totalMovs} movs quedan en otra obra activa</div>
          {accion==="reasignar"&&<select style={{...sI,marginTop:6,fontSize:12}} value={destino} onChange={e=>setDestino(e.target.value)}>
            <option value="">— Selecciona obra destino —</option>
            {otrasObras.map(n=><option key={n} value={n}>{n}</option>)}
          </select>}
        </div>
      </label>
      <label style={{display:"flex",alignItems:"flex-start",gap:8,padding:10,border:"1px solid "+(accion==="general"?T.blue:T.border),borderRadius:8,marginBottom:6,cursor:"pointer",background:accion==="general"?"rgba(66,165,245,.06)":"transparent"}}>
        <input type="radio" name="acc" checked={accion==="general"} onChange={()=>setAccion("general")} style={{marginTop:3}}/>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:12,color:T.blue}}>📂 Mover a "General" (sin obra)</div>
          <div style={{fontSize:10,color:T.muted,marginTop:2}}>Los movs quedan registrados pero sin obra asignada</div>
        </div>
      </label>
      <label style={{display:"flex",alignItems:"flex-start",gap:8,padding:10,border:"1px solid "+(accion==="borrar"?T.red:T.border),borderRadius:8,marginBottom:6,cursor:"pointer",background:accion==="borrar"?"rgba(231,76,60,.06)":"transparent"}}>
        <input type="radio" name="acc" checked={accion==="borrar"} onChange={()=>setAccion("borrar")} style={{marginTop:3}}/>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:12,color:T.red}}>🗑 Borrar TODO (obra + movimientos)</div>
          <div style={{fontSize:10,color:T.muted,marginTop:2}}>⚠️ Pierdes {$(totalMonto)} en registros. No se puede deshacer.</div>
        </div>
      </label>
    </>}
    <label style={{display:"flex",alignItems:"flex-start",gap:8,padding:10,border:"1px solid "+(accion==="solo"?T.purple:T.border),borderRadius:8,marginBottom:12,cursor:"pointer",background:accion==="solo"?"rgba(171,71,188,.06)":"transparent"}}>
      <input type="radio" name="acc" checked={accion==="solo"} onChange={()=>setAccion("solo")} style={{marginTop:3}}/>
      <div style={{flex:1}}>
        <div style={{fontWeight:700,fontSize:12,color:T.purple}}>👻 Solo borrar obra (dejar movs como "fantasma")</div>
        <div style={{fontSize:10,color:T.muted,marginTop:2}}>Los movs siguen ahí con el nombre viejo. Luego limpias desde el análisis.</div>
      </div>
    </label>

    <button style={{...sB,background:T.red,opacity:(accion==="reasignar"&&!destino)?.4:1,cursor:(accion==="reasignar"&&!destino)?"not-allowed":"pointer"}} disabled={accion==="reasignar"&&!destino} onClick={()=>onDone(accion,destino)}>
      🗑 Eliminar "{obra.nombre}"
    </button>
  </div>;
}
function AnalisisDesfaseView({movs,caja,obras,setMovs,setCaja,setObras,show,cm}){
  const [reasignarFrom,setReasignarFrom]=useState(null);
  const [reasignarTo,setReasignarTo]=useState("");
  // Selección múltiple para fusión inline
  const [seleccionadas,setSeleccionadas]=useState(new Set()); // Set de keys de obras a fusionar
  const [elegirPrincipal,setElegirPrincipal]=useState(false);
  const [principalKey,setPrincipalKey]=useState(null);
  const toggleSel=(key)=>setSeleccionadas(prev=>{const s=new Set(prev);if(s.has(key))s.delete(key);else s.add(key);return s;});
  const sameObra2=(a,b)=>{const na=(a||"").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");const nb=(b||"").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");return na===nb;};
  // Fusiona N keys de obras: reasigna todos los movs/caja a la principal + elimina obras duplicadas del array obras
  const fusionarSeleccionadas=(listaFull,principalK)=>{
    const seleccionadasObj=listaFull.filter(o=>seleccionadas.has(o.key));
    const principal=seleccionadasObj.find(o=>o.key===principalK);
    if(!principal){if(show)show("⚠️ Selecciona la obra principal");return;}
    const otras=seleccionadasObj.filter(o=>o.key!==principalK);
    let nMovs=0,nCaja=0;
    let newMovs=movs,newCaja=caja;
    otras.forEach(o=>{
      newMovs=newMovs.map(m=>{if(normSearch(m.obra||"")===o.key){nMovs++;return{...m,obra:principal.nombre};}return m;});
      newCaja=newCaja.map(c=>{if(normSearch(c.obra||"")===o.key){nCaja++;return{...c,obra:principal.nombre};}return c;});
    });
    // También: si la principal tiene un nombre distinto al canónico, normalizar TODOS sus movs al canónico
    const realPrincipal=obras.find(o=>normSearch(o.nombre)===principalK);
    if(realPrincipal&&realPrincipal.nombre!==principal.nombre){
      newMovs=newMovs.map(m=>{if(normSearch(m.obra||"")===principalK&&m.obra!==realPrincipal.nombre){nMovs++;return{...m,obra:realPrincipal.nombre};}return m;});
      newCaja=newCaja.map(c=>{if(normSearch(c.obra||"")===principalK&&c.obra!==realPrincipal.nombre){nCaja++;return{...c,obra:realPrincipal.nombre};}return c;});
    }
    setMovs(newMovs);setCaja(newCaja);
    // Si las "otras" tienen obras REALES (no fantasmas) en obras[], eliminarlas (después de transferir sus movs)
    if(setObras){
      const aEliminarKeys=new Set(otras.filter(o=>!o.isFantasma).map(o=>o.key));
      if(aEliminarKeys.size>0){
        const sumaCotizado=obras.filter(o=>aEliminarKeys.has(normSearch(o.nombre))).reduce((s,o)=>s+(o.cotizado||0),0);
        const newObras=obras.filter(o=>!aEliminarKeys.has(normSearch(o.nombre))).map(o=>{
          if(normSearch(o.nombre)===principalK&&sumaCotizado>0)return{...o,cotizado:(o.cotizado||0)+sumaCotizado};
          return o;
        });
        setObras(newObras);
      }
    }
    setSeleccionadas(new Set());setElegirPrincipal(false);setPrincipalKey(null);
    if(show)show("🔗 "+otras.length+" obras fusionadas en '"+principal.nombre+"' · "+(nMovs+nCaja)+" movs reasignados");
  };
  const doReasignar=(origen,destino)=>{
    const newMovs=movs.map(m=>{if(sameObra2(m.obra,origen)){return{...m,obra:destino};}return m;});
    const newCaja=caja.map(c=>{if(sameObra2(c.obra,origen)){return{...c,obra:destino};}return c;});
    const nM=movs.filter(m=>sameObra2(m.obra,origen)).length;
    const nC=caja.filter(c=>sameObra2(c.obra,origen)).length;
    setMovs(newMovs);setCaja(newCaja);
    setReasignarFrom(null);setReasignarTo("");
    if(show)show("✓ "+(nM+nC)+" movs reasignados a "+(destino||"General"));
  };
  // === FIX: Agrupar por nombre NORMALIZADO para evitar duplicados (CORAL #39 vs coral 39) ===
  const sameObra=(a,b)=>{const na=normSearch(a||"");const nb=normSearch(b||"");return na===nb;};
  // Usa el nombre canónico de la obra REAL si existe, si no usa el nombre tal cual aparece en el primer mov
  const map={};
  const getKey=(rawNombre)=>{
    if(!rawNombre)return "__GENERAL__";
    return normSearch(rawNombre);
  };
  const getNombreCanonico=(rawNombre,key)=>{
    if(key==="__GENERAL__")return "📂 General (sin obra)";
    // Si hay obra real con ese nombre normalizado, usar el nombre oficial
    const real=obras.find(o=>normSearch(o.nombre)===key);
    return real?real.nombre:rawNombre;
  };
  movs.forEach(m=>{
    const k=getKey(m.obra);
    if(!map[k])map[k]={nombre:getNombreCanonico(m.obra,k),ing:0,egr:0,cot:0,cat:{},isFantasma:false,nMovs:0};
    map[k].nMovs++;
    if(m.ing>0)map[k].ing+=m.ing;
    if(m.egr>0){map[k].egr+=m.egr;const c=m.cat||"Sin cat";map[k].cat[c]=(map[k].cat[c]||0)+m.egr;}
  });
  caja.filter(c=>c.status!=="rechazado").forEach(c=>{
    const k=getKey(c.obra);
    if(!map[k])map[k]={nombre:getNombreCanonico(c.obra,k),ing:0,egr:0,cot:0,cat:{},isFantasma:false,nMovs:0};
    map[k].nMovs++;
    map[k].egr+=c.monto;
    map[k].cat["Caja Chica"]=(map[k].cat["Caja Chica"]||0)+c.monto;
  });
  // Marcar cotización y fantasma + sumar cotizado de obras reales agrupadas
  Object.keys(map).forEach(k=>{
    const o=map[k];
    if(k==="__GENERAL__"){o.isFantasma=false;o.tipo="general";return;}
    // Sumar cotizados de TODAS las obras reales que normalizan a esta key (puede haber duplicadas en obras[])
    const realesMatch=obras.filter(x=>normSearch(x.nombre)===k);
    if(realesMatch.length>0){
      o.cot=realesMatch.reduce((s,r)=>s+(r.cotizado||0),0);
      o.fase=realesMatch[0].fase;
      o.isFantasma=false;
      o.tipo="obra";
      // Si hay >1 obra real con el mismo nombre normalizado, marcarla como duplicada en obras[]
      if(realesMatch.length>1)o.duplicadaEnObras=realesMatch.length;
    }else{
      o.isFantasma=true;
      o.tipo="fantasma";
    }
  });
  // Calcular diferencia (con key para selección múltiple)
  const lista=Object.entries(map).map(([key,o])=>{
    const dif=o.ing-o.egr;
    const cobPct=o.cot?Math.round((o.ing/o.cot)*100):0;
    const gasPct=o.cot?Math.round((o.egr/o.cot)*100):0;
    const desfase=gasPct-cobPct;
    let status="ok";
    if(dif<0)status="perdida";
    else if(o.cot&&desfase>20)status="descapitalizado";
    return {...o,key,dif,cobPct,gasPct,desfase,status};
  }).sort((a,b)=>a.dif-b.dif);
  const totIng=lista.reduce((s,o)=>s+o.ing,0);
  const totEgr=lista.reduce((s,o)=>s+o.egr,0);
  const totDif=totIng-totEgr;
  const enPerdida=lista.filter(o=>o.status==="perdida");
  const descap=lista.filter(o=>o.status==="descapitalizado");
  const fantasmas=lista.filter(o=>o.isFantasma);
  return <div>
    {/* Resumen ejecutivo */}
    <div style={{background:totDif<0?"rgba(231,76,60,.08)":"rgba(76,175,80,.08)",border:"1px solid "+(totDif<0?T.red+"33":T.green+"33"),borderRadius:10,padding:14,marginBottom:14}}>
      <div style={{fontSize:10,color:totDif<0?T.red:T.green,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>{totDif<0?"⚠️ Balance NEGATIVO":"✓ Balance positivo"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <div><div style={{fontSize:9,color:T.muted,textTransform:"uppercase"}}>Cobrado</div><div style={{fontSize:18,fontWeight:800,color:T.green}}>{$(totIng)}</div></div>
        <div><div style={{fontSize:9,color:T.muted,textTransform:"uppercase"}}>Gastado</div><div style={{fontSize:18,fontWeight:800,color:T.red}}>{$(totEgr)}</div></div>
        <div><div style={{fontSize:9,color:T.muted,textTransform:"uppercase"}}>Diferencia</div><div style={{fontSize:18,fontWeight:800,color:totDif>=0?T.green:T.red}}>{$(totDif)}</div></div>
      </div>
    </div>
    {/* Resumen por categoría de problema */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
      <div style={{background:"rgba(231,76,60,.06)",border:"1px solid "+T.red+"22",borderRadius:8,padding:10}}>
        <div style={{fontSize:9,color:T.red,fontWeight:700,textTransform:"uppercase"}}>🔴 En pérdida</div>
        <div style={{fontSize:20,fontWeight:800,color:T.red}}>{enPerdida.length}</div>
        <div style={{fontSize:10,color:T.muted}}>{$(enPerdida.reduce((s,o)=>s+o.dif,0))}</div>
      </div>
      <div style={{background:"rgba(255,213,79,.06)",border:"1px solid "+T.yellow+"22",borderRadius:8,padding:10}}>
        <div style={{fontSize:9,color:T.yellow,fontWeight:700,textTransform:"uppercase"}}>🟡 Descapitalizado</div>
        <div style={{fontSize:20,fontWeight:800,color:T.yellow}}>{descap.length}</div>
        <div style={{fontSize:10,color:T.muted}}>Gastas más rápido que cobras</div>
      </div>
      <div style={{background:"rgba(171,71,188,.06)",border:"1px solid "+T.purple+"22",borderRadius:8,padding:10}}>
        <div style={{fontSize:9,color:T.purple,fontWeight:700,textTransform:"uppercase"}}>👻 Fantasmas</div>
        <div style={{fontSize:20,fontWeight:800,color:T.purple}}>{fantasmas.length}</div>
        <div style={{fontSize:10,color:T.muted}}>{$(fantasmas.reduce((s,o)=>s+o.dif,0))}</div>
      </div>
    </div>
    {/* Tabla compacta de obras */}
    <div style={{borderRadius:8,border:"1px solid #333",overflow:"hidden",fontSize:12}}>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:620}}>
          <thead>
            <tr style={{background:"#1a1a1a",borderBottom:"2px solid #444"}}>
              <th style={{padding:"8px 4px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",borderRight:"1px solid #333",width:30}} title="Marca varias y fusiónalas">☑</th>
              <th style={{padding:"8px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",borderRight:"1px solid #333",width:24}}>●</th>
              <th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",borderRight:"1px solid #333"}}>Proyecto</th>
              <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:T.green,textTransform:"uppercase",borderRight:"1px solid #333",width:100}}>Cobrado</th>
              <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:T.red,textTransform:"uppercase",borderRight:"1px solid #333",width:100}}>Gastado</th>
              <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",borderRight:"1px solid #333",width:110}}>Diferencia</th>
              <th style={{padding:"8px",textAlign:"center",fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",width:80}}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((o,idx)=>{
              const sem=o.status==="perdida"?T.red:o.status==="descapitalizado"?T.yellow:o.isFantasma?T.purple:T.green;
              const isOpen=reasignarFrom===o.nombre;
              const isSel=seleccionadas.has(o.key);
              return [<tr key={idx} style={{background:isSel?"rgba(171,71,188,.12)":idx%2===0?"rgba(255,255,255,.01)":"transparent",borderBottom:isOpen?"none":"1px solid #2a2a2a",boxShadow:isSel?"inset 4px 0 0 "+T.purple:"none"}}>
                <td style={{padding:"6px 4px",textAlign:"center",borderRight:"1px solid #2a2a2a"}}>
                  {o.tipo!=="general"&&<input type="checkbox" checked={isSel} onChange={()=>toggleSel(o.key)} style={{cursor:"pointer",accentColor:T.purple,width:16,height:16}} title="Marcar para fusionar"/>}
                </td>
                <td style={{padding:"6px",textAlign:"center",borderRight:"1px solid #2a2a2a"}} title={o.status}>
                  <span style={{display:"inline-block",width:10,height:10,borderRadius:5,background:sem}}/>
                </td>
                <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a"}}>
                  <div style={{fontWeight:600,fontSize:12}}>{o.nombre} {o.isFantasma&&<span style={{fontSize:9,color:T.purple,marginLeft:4}}>👻 fantasma</span>} {o.duplicadaEnObras&&<span style={{fontSize:9,color:T.red,marginLeft:4,background:"rgba(231,76,60,.1)",padding:"1px 5px",borderRadius:4}}>⚠️ {o.duplicadaEnObras} registros duplicados en Obras</span>}</div>
                  {o.cot>0&&<div style={{fontSize:9,color:T.muted}}>Cotizado {$(o.cot)} · Cobrado {o.cobPct}% · Gastado {o.gasPct}%</div>}
                  {!o.cot&&o.tipo!=="general"&&<div style={{fontSize:9,color:T.muted}}>Sin presupuesto registrado</div>}
                </td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:T.green,fontSize:12,borderRight:"1px solid #2a2a2a"}}>{$(o.ing)}</td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:T.red,fontSize:12,borderRight:"1px solid #2a2a2a"}}>{$(o.egr)}</td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:800,color:o.dif>=0?T.green:T.red,fontSize:13,borderRight:"1px solid #2a2a2a"}}>{$(o.dif)}</td>
                <td style={{padding:"4px 6px",textAlign:"center"}}>
                  {(o.isFantasma||o.tipo==="obra")&&o.tipo!=="general"&&<button onClick={()=>{setReasignarFrom(isOpen?null:o.nombre);setReasignarTo("");}} style={{background:isOpen?T.purple+"33":"rgba(171,71,188,.12)",border:"1px solid "+T.purple+"55",color:T.purple,cursor:"pointer",fontSize:10,padding:"4px 8px",borderRadius:5,fontWeight:700,whiteSpace:"nowrap"}} title="Reasignar movimientos">🔀 Fusionar</button>}
                </td>
              </tr>,
              isOpen&&<tr key={idx+"-r"} style={{background:"rgba(171,71,188,.06)",borderBottom:"1px solid #2a2a2a"}}>
                <td colSpan={7} style={{padding:"10px 14px"}}>
                  <div style={{fontSize:11,color:T.purple,fontWeight:700,marginBottom:6}}>🔀 Reasignar TODOS los movs de "{o.nombre}" a:</div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    <select style={{...sI,flex:1,minWidth:200,fontSize:12,padding:"8px"}} value={reasignarTo} onChange={e=>setReasignarTo(e.target.value)}>
                      <option value="">— Selecciona obra destino —</option>
                      <option value="__general__">📂 General (sin obra)</option>
                      {obrasDestinoValidas(obras).filter(x=>!sameObra2(x.nombre,o.nombre)).sort((a,b)=>(b.cotizado||0)-(a.cotizado||0)).map(x=><option key={x.id} value={x.nombre}>{x.nombre}{x.cliente?" — "+x.cliente:""}{x.cotizado>0?" ($"+Math.round(x.cotizado/1000)+"K)":""}</option>)}
                    </select>
                    <button onClick={()=>{if(!reasignarTo){if(show)show("Selecciona destino");return;}const dest=reasignarTo==="__general__"?"":reasignarTo;if(!confirm("¿Reasignar todos los movs de '"+o.nombre+"' a '"+(dest||"General")+"'?"))return;doReasignar(o.nombre,dest);}} style={{padding:"8px 16px",borderRadius:6,border:"none",background:T.purple,color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>Fusionar</button>
                    <button onClick={()=>{setReasignarFrom(null);setReasignarTo("");}} style={{padding:"8px 12px",borderRadius:6,border:"1px solid "+T.border,background:"transparent",color:T.muted,fontSize:11,cursor:"pointer"}}>Cancelar</button>
                  </div>
                </td>
              </tr>];
            })}
          </tbody>
          <tfoot>
            <tr style={{background:"#1a1a1a",borderTop:"2px solid #444"}}>
              <td colSpan={3} style={{padding:"8px 10px",fontSize:11,fontWeight:700,color:T.gold}}>TOTAL ({lista.length})</td>
              <td style={{padding:"8px",textAlign:"right",fontWeight:800,color:T.green,fontSize:13,borderLeft:"1px solid #333"}}>{$(totIng)}</td>
              <td style={{padding:"8px",textAlign:"right",fontWeight:800,color:T.red,fontSize:13,borderLeft:"1px solid #333"}}>{$(totEgr)}</td>
              <td style={{padding:"8px",textAlign:"right",fontWeight:800,color:totDif>=0?T.green:T.red,fontSize:14,borderLeft:"1px solid #333"}}>{$(totDif)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    {/* Explicación */}
    <div style={{marginTop:12,padding:10,background:"rgba(255,255,255,.02)",borderRadius:8,fontSize:11,color:T.muted,lineHeight:1.6}}>
      <div style={{color:T.gold,fontWeight:700,marginBottom:4}}>📖 Cómo leer:</div>
      <div>🔴 <b style={{color:T.red}}>Pérdida</b>: gastaste MÁS de lo que cobraste. Te están metiendo de tu bolsa.</div>
      <div>🟡 <b style={{color:T.yellow}}>Descapitalizado</b>: vas a buen ritmo de gasto pero atrasado en cobranza (gastaste {">"} 20% más que lo que llevas cobrado). Pídele al cliente.</div>
      <div>👻 <b style={{color:T.purple}}>Fantasma</b>: tiene movimientos pero la obra ya no existe en tu sistema. Marcala con ☑ y la fusionas en un clic.</div>
      <div>🟢 <b style={{color:T.green}}>OK</b>: cobranza al día y rentable.</div>
      <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid "+T.border,color:T.purple}}>💡 <b>Tip:</b> Marca con ☑ las obras que sean LA MISMA y aparece abajo un botón "Fusionar X obras". Sin salir del análisis.</div>
    </div>
    {/* === BARRA INFERIOR FLOTANTE: Acciones con selección múltiple === */}
    {seleccionadas.size>=2&&!elegirPrincipal&&(()=>{
      const sels=lista.filter(o=>seleccionadas.has(o.key));
      const totIng=sels.reduce((s,o)=>s+o.ing,0);
      const totEgr=sels.reduce((s,o)=>s+o.egr,0);
      return <div style={{position:"sticky",bottom:0,marginTop:14,padding:"12px 14px",background:"linear-gradient(135deg,rgba(171,71,188,.18),rgba(171,71,188,.08))",border:"2px solid "+T.purple,borderRadius:10,boxShadow:"0 -4px 20px rgba(0,0,0,.5)",zIndex:50}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontSize:12,fontWeight:800,color:T.purple}}>🔗 {seleccionadas.size} obras seleccionadas → si son LA MISMA, fusionarlas</div>
            <div style={{fontSize:10,color:T.muted,marginTop:2}}>{sels.map(s=>s.nombre).join(" + ")} · Total: cobrado {$(totIng)} · gastado {$(totEgr)}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>{setSeleccionadas(new Set());setPrincipalKey(null);}} style={{padding:"8px 12px",borderRadius:6,border:"1px solid "+T.border,background:"transparent",color:T.muted,fontSize:11,cursor:"pointer"}}>Cancelar</button>
            <button onClick={()=>setElegirPrincipal(true)} style={{padding:"8px 16px",borderRadius:6,border:"none",background:T.purple,color:"#fff",fontWeight:800,fontSize:12,cursor:"pointer"}}>Fusionar {seleccionadas.size} obras →</button>
          </div>
        </div>
      </div>;
    })()}
    {/* === MODAL DE ELEGIR PRINCIPAL === */}
    {elegirPrincipal&&(()=>{
      const sels=lista.filter(o=>seleccionadas.has(o.key));
      return <div onClick={()=>setElegirPrincipal(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:5500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{maxWidth:520,width:"100%",background:"#1a1a1a",border:"1px solid "+T.purple,borderRadius:12,padding:18,boxShadow:"0 20px 60px rgba(0,0,0,.6)"}}>
          <div style={{fontSize:14,fontWeight:800,color:T.purple,marginBottom:6}}>🔗 ¿Cuál es la obra PRINCIPAL?</div>
          <div style={{fontSize:11,color:T.muted,marginBottom:12}}>Las demás se fusionarán en esa. Sus movs se reasignan y se eliminan las obras secundarias.</div>
          <div style={{display:"grid",gap:6,marginBottom:14}}>
            {sels.map(o=>{const isPrincipal=principalKey===o.key;return <div key={o.key} onClick={()=>setPrincipalKey(o.key)} style={{padding:"10px 12px",background:isPrincipal?"rgba(76,175,80,.12)":"rgba(255,255,255,.02)",border:"2px solid "+(isPrincipal?T.green:T.border),borderRadius:8,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13}}>{o.nombre} {isPrincipal&&<span style={{fontSize:10,color:T.green,marginLeft:6,fontWeight:800}}>✓ PRINCIPAL</span>} {o.isFantasma&&<span style={{fontSize:9,color:T.purple,marginLeft:4}}>👻</span>}</div>
                  <div style={{fontSize:10,color:T.muted,marginTop:2}}>{o.cot>0?"Cotizado "+$(o.cot)+" · ":""}{o.nMovs} mov{o.nMovs!==1?"s":""} · Ing {$(o.ing)} · Eg {$(o.egr)}</div>
                </div>
                <span style={{width:18,height:18,borderRadius:9,border:"2px solid "+(isPrincipal?T.green:T.dim),display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,color:T.green,background:isPrincipal?T.green:"transparent"}}>{isPrincipal?"✓":""}</span>
              </div>
            </div>;})}
          </div>
          <div style={{padding:10,background:"rgba(255,213,79,.06)",borderRadius:6,fontSize:11,color:T.muted,marginBottom:12}}>💡 Tip: elige la obra REAL (no fantasma) con más cotizado o más cliente registrado.</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setElegirPrincipal(false);setPrincipalKey(null);}} style={{flex:1,padding:"10px",borderRadius:6,border:"1px solid "+T.border,background:"transparent",color:T.muted,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            <button onClick={()=>{if(!principalKey){if(show)show("Selecciona cuál es la principal");return;}const p=sels.find(s=>s.key===principalKey);if(!confirm("¿Fusionar "+(sels.length-1)+" obra(s) en '"+p.nombre+"'?\n\nNo se puede deshacer."))return;fusionarSeleccionadas(lista,principalKey);}} disabled={!principalKey} style={{flex:2,padding:"10px",borderRadius:6,border:"none",background:principalKey?T.purple:T.dim,color:"#fff",fontWeight:800,fontSize:13,cursor:principalKey?"pointer":"not-allowed"}}>🔗 Fusionar todo en {principalKey?(sels.find(s=>s.key===principalKey)||{}).nombre:"..."}</button>
          </div>
        </div>
      </div>;
    })()}
  </div>;
}
function FusionarObrasForm({finObras,obras,countMovs,onFuse}){
  const[origen,setOrigen]=useState("");
  const[destino,setDestino]=useState("");
  // Solo obras destino válidas (activas, con cliente o cotizado >0 preferidas)
  const obrasActivas=obrasDestinoValidas(obras).sort((a,b)=>(b.cotizado||0)-(a.cotizado||0)).map(o=>({nombre:o.nombre,cliente:o.cliente,cotizado:o.cotizado||0}));
  const oCount=origen?countMovs(origen):0;
  return <div>
    <div style={{background:"rgba(171,71,188,.08)",border:"1px solid rgba(171,71,188,.2)",borderRadius:8,padding:12,marginBottom:14,fontSize:11,color:T.muted,lineHeight:1.5}}>
      <div style={{color:T.purple,fontWeight:700,marginBottom:4}}>🔀 Reasignar movimientos a otra obra</div>
      Mueve todos los ingresos, egresos y caja chica de la obra <b>ORIGEN</b> a la obra <b>DESTINO</b>. Útil para limpiar obras fantasma (eliminadas pero con movimientos colgados).
    </div>
    <Fl l="Obra ORIGEN (de dónde mover)">
      <select style={sI} value={origen} onChange={e=>setOrigen(e.target.value)}>
        <option value="">— Selecciona obra a fusionar —</option>
        {finObras.filter(o=>o.isFantasma).length>0&&<optgroup label="⚠️ FANTASMAS (recomendado)">{finObras.filter(o=>o.isFantasma).map(o=><option key={o.key} value={o.nombre}>⚠️ {o.nombre}</option>)}</optgroup>}
        {finObras.filter(o=>!o.isFantasma).length>0&&<optgroup label="✓ Activas">{finObras.filter(o=>!o.isFantasma).map(o=><option key={o.key} value={o.nombre}>{o.nombre}</option>)}</optgroup>}
      </select>
    </Fl>
    {origen&&<div style={{fontSize:11,color:T.yellow,padding:"6px 10px",background:"rgba(255,213,79,.08)",borderRadius:6,marginBottom:10}}>📊 <b>{oCount}</b> movimiento{oCount!==1?"s":""} se reasignarán</div>}
    <Fl l="Obra DESTINO (a dónde mover)">
      <select style={sI} value={destino} onChange={e=>setDestino(e.target.value)} disabled={!origen}>
        <option value="">— Selecciona obra destino —</option>
        {obrasActivas.filter(o=>normSearch(o.nombre)!==normSearch(origen)).map(o=><option key={o.nombre} value={o.nombre}>{o.nombre}{o.cliente?" — "+o.cliente:""}{o.cotizado>0?" ($"+Math.round(o.cotizado/1000)+"K)":""}</option>)}
        <option value="__general__">📂 General (sin obra)</option>
      </select>
    </Fl>
    <button style={{...sB,background:T.purple,opacity:(origen&&destino)?1:.4,cursor:(origen&&destino)?"pointer":"not-allowed"}} disabled={!origen||!destino} onClick={()=>{
      if(!origen||!destino)return;
      const destFinal=destino==="__general__"?"":destino;
      if(!confirm("¿Reasignar "+oCount+" movimiento(s) de '"+origen+"' a '"+(destFinal||"General")+"'?\n\nEsta acción NO se puede deshacer."))return;
      onFuse(origen,destFinal);
    }}>🔀 Fusionar {oCount>0?"("+oCount+" movs)":""}</button>
  </div>;
}

// ═══ PRORRATEAR GASTO FIJO ENTRE OBRAS ACTIVAS ═══
// Resuelve dos problemas:
//   A) Gasto fijo nuevo (renta, luz, IMSS) — capturar 1 monto y repartirlo entre N obras
//   B) Gastos sueltos existentes (categoría CARPINTERIA / sin obra) — distribuirlos en bulk
function ProrratearGastoForm({obras,movs,setMovs,enviarAPapelera,user,td,show,cm,_lastWrite}){
  const[tab,setTab]=useState("nuevo");
  // Obras activas: status en proceso, no terminadas ni canceladas
  const obrasActivas=useMemo(()=>obras.filter(o=>{
    const st=(o.status||"").toLowerCase();const fs=(o.fase||"").toLowerCase();
    if(st==="terminada"||st==="cancelada"||st==="pausada")return false;
    if(fs==="terminada"||fs==="entregada"||fs==="cancelada")return false;
    return true;
  }).sort((a,b)=>(b.cotizado||0)-(a.cotizado||0)),[obras]);
  // ── Estado pestaña A: Nuevo gasto ──
  const[nConcepto,setNConcepto]=useState("");
  const[nMonto,setNMonto]=useState("");
  const[nFecha,setNFecha]=useState(td());
  const[nCategoria,setNCategoria]=useState("Renta");
  const[nProv,setNProv]=useState("");
  // ── Selección de obras destino (default: todas las activas) ──
  const[obrasSel,setObrasSel]=useState(()=>new Set(obrasActivas.map(o=>o.id)));
  const toggleObra=id=>{const s=new Set(obrasSel);s.has(id)?s.delete(id):s.add(id);setObrasSel(s);};
  const allOn=obrasActivas.length>0&&obrasActivas.every(o=>obrasSel.has(o.id));
  // ── Método de reparto ──
  const[metodo,setMetodo]=useState("cotizado");
  const[pesoManual,setPesoManual]=useState({});
  // ── Estado pestaña B: Gastos sueltos existentes ──
  const obrasNorm=useMemo(()=>new Set(obras.map(o=>normSearch(o.nombre))),[obras]);
  // Detectar gastos sueltos: egresos sin obra, o con obra fantasma (CARPINTERIA, TALLER, etc.)
  const gastosSueltos=useMemo(()=>{
    return movs.filter(m=>{
      if(m.t==="ing")return false;
      if(m.status==="rechazado")return false;
      const ob=normSearch(m.obra||"");
      if(!ob)return true; // sin obra
      if(!obrasNorm.has(ob))return true; // obra fantasma
      // Si la obra es CARPINTERIA, TALLER, GENERAL, etc → suelto aunque exista
      if(/^(carpinteria|taller|general|gastos? generales?|fijos?)$/i.test(m.obra||""))return true;
      return false;
    });
  },[movs,obrasNorm]);
  const[selMovsSueltos,setSelMovsSueltos]=useState(()=>new Set());
  // Helper para leer el monto REAL del mov (usa egr/ing/monto en orden de prioridad)
  const getMovMonto=m=>Number(m?.egr||0)>0?Number(m.egr):Number(m?.ing||0)>0?Number(m.ing):Number(m?.monto||0);
  const totalSueltos=[...selMovsSueltos].reduce((s,id)=>{const m=movs.find(x=>x.id===id);return s+(m?getMovMonto(m):0);},0);
  // Obras incluidas en el reparto
  const obrasIncluidas=obrasActivas.filter(o=>obrasSel.has(o.id));
  // Calcular reparto según método
  const calcReparto=(monto)=>{
    if(obrasIncluidas.length===0||monto<=0)return [];
    const pesos=obrasIncluidas.map(o=>{
      if(metodo==="igual")return 1;
      if(metodo==="cotizado")return Math.max(o.cotizado||0,1);
      if(metodo==="avance")return Math.max((o.cotizado||0)*((o.avance||0)/100),1);
      if(metodo==="manual")return Math.max(Number(pesoManual[o.id]||0),0.0001);
      return 1;
    });
    const suma=pesos.reduce((a,b)=>a+b,0);
    if(suma<=0)return [];
    // Reparto con redondeo a 2 decimales, ajustando el último para cuadrar exacto
    const partes=obrasIncluidas.map((o,i)=>({obra:o,parte:Math.round((monto*pesos[i]/suma)*100)/100,pct:Math.round(pesos[i]/suma*1000)/10}));
    const sumaPartes=partes.reduce((s,p)=>s+p.parte,0);
    const dif=Math.round((monto-sumaPartes)*100)/100;
    if(dif!==0&&partes.length>0)partes[partes.length-1].parte=Math.round((partes[partes.length-1].parte+dif)*100)/100;
    return partes;
  };
  const monto=Number(String(nMonto).replace(/[^0-9.-]/g,""))||0;
  const reparto=calcReparto(monto);
  const repartoSueltos=calcReparto(totalSueltos);
  // Categorías comunes de gastos fijos
  const CATS=["Renta","Luz","Agua","Gas","Internet","Teléfono","IMSS / Cuotas","Sueldos generales","Materiales en bulk","Herramientas","Mantenimiento","Otro"];
  // ── Acción: crear N egresos del nuevo gasto ──
  const crearNuevoProrrateo=()=>{
    if(!nConcepto.trim()){show("⚠️ Falta concepto");return;}
    if(monto<=0){show("⚠️ Monto inválido");return;}
    if(reparto.length===0){show("⚠️ Selecciona al menos una obra");return;}
    if(!confirm("¿Crear "+reparto.length+" egresos por un total de $"+monto.toLocaleString("es-MX")+"?\n\nSe distribuirá entre las obras seleccionadas.")) return;
    const loteId="PRO"+Date.now();
    const nuevosMovs=reparto.map((r,i)=>({
      id:"M"+Date.now()+"_"+i+Math.random().toString(36).slice(2,5),
      t:"egr",
      fecha:nFecha||td(),
      desc:"["+nCategoria+"] "+nConcepto+" — "+r.pct+"%",
      prov:nProv||nCategoria,
      obra:r.obra.nombre,
      cat:nCategoria,
      monto:r.parte,
      user:user.nombre,
      status:"aprobado",
      prorrateoLote:loteId,
      prorrateoOrigen:nConcepto,
      creadoFecha:td()
    }));
    setMovs(prev=>[...prev,...nuevosMovs]);
    _lastWrite.current["movs"]=Date.now()+15000;
    show("🧮 "+reparto.length+" egresos creados · $"+monto.toLocaleString("es-MX")+" distribuido");
    cm();
  };
  // ── Acción: redistribuir gastos sueltos existentes ──
  const redistribuirSueltos=()=>{
    if(selMovsSueltos.size===0){show("⚠️ Selecciona gastos a redistribuir");return;}
    // FIX: usar repartoSueltos (basado en el total de gastos sueltos), NO reparto (basado en el formulario "Nuevo gasto")
    if(repartoSueltos.length===0){show("⚠️ Selecciona al menos una obra destino");return;}
    if(!confirm("¿Redistribuir "+selMovsSueltos.size+" gasto(s) por $"+totalSueltos.toLocaleString("es-MX")+" entre "+repartoSueltos.length+" obras?\n\nLos originales irán a la Papelera, se crearán nuevos por obra.")) return;
    // 1) Mandar a papelera los originales seleccionados
    const aBorrar=movs.filter(m=>selMovsSueltos.has(m.id));
    aBorrar.forEach(m=>enviarAPapelera("mov",m,"Redistribuido por prorrateo"));
    // 2) Crear nuevos egresos por cada obra destino, agrupando todos los gastos sueltos
    const loteId="PRR"+Date.now();
    const nuevos=repartoSueltos.map((r,i)=>({
      id:"M"+Date.now()+"_"+i+Math.random().toString(36).slice(2,5),
      t:"egr",
      fecha:td(),
      desc:"Gastos generales prorrateados ("+aBorrar.length+" movs) — "+r.pct+"%",
      prov:"Prorrateo Taller",
      obra:r.obra.nombre,
      cat:"Gastos generales",
      ing:0,            // ← para que la tabla lo lea
      egr:r.parte,      // ← CRÍTICO: el sistema muestra m.egr en la columna
      monto:r.parte,    // ← retrocompat
      user:user.nombre,
      status:"aprobado",
      prorrateoLote:loteId,
      creadoFecha:td()
    }));
    const movsRestantes=movs.filter(m=>!selMovsSueltos.has(m.id));
    setMovs([...movsRestantes,...nuevos]);
    _lastWrite.current["movs"]=Date.now()+15000;
    show("🧮 "+aBorrar.length+" gastos redistribuidos → "+nuevos.length+" obras");
    cm();
  };
  return <div>
    {/* Tabs */}
    <div style={{display:"flex",gap:6,marginBottom:14,borderBottom:"1px solid "+T.border,paddingBottom:8}}>
      <button onClick={()=>setTab("nuevo")} style={{padding:"7px 14px",borderRadius:6,border:"none",background:tab==="nuevo"?T.gold:"transparent",color:tab==="nuevo"?"#000":T.muted,fontWeight:700,fontSize:12,cursor:"pointer"}}>＋ Nuevo gasto fijo</button>
      <button onClick={()=>setTab("existentes")} style={{padding:"7px 14px",borderRadius:6,border:"none",background:tab==="existentes"?T.gold:"transparent",color:tab==="existentes"?"#000":T.muted,fontWeight:700,fontSize:12,cursor:"pointer"}}>♻️ Gastos sueltos {gastosSueltos.length>0&&<span style={{background:T.yellow+"33",color:T.yellow,padding:"1px 6px",borderRadius:8,fontSize:10,marginLeft:4}}>{gastosSueltos.length}</span>}</button>
    </div>
    {/* Info */}
    <div style={{background:"rgba(201,149,107,.08)",border:"1px solid "+T.gold+"44",borderRadius:8,padding:10,marginBottom:14,fontSize:11,color:T.muted,lineHeight:1.5}}>
      <div style={{color:T.gold,fontWeight:700,marginBottom:3}}>🧮 ¿Qué es prorratear?</div>
      Es repartir un gasto que no es de una sola obra (renta del taller, luz, IMSS, materiales en bulk) <b>entre las obras activas</b>. Así sabes el costo REAL de cada obra y dejas de tener egresos "sueltos".
    </div>
    {tab==="nuevo"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8,marginBottom:10}}>
        <Fl l="Concepto del gasto"><input style={sI} value={nConcepto} onChange={e=>setNConcepto(e.target.value)} placeholder="Ej: Renta del taller — Mayo 2026"/></Fl>
        <Fl l="Monto total"><input type="number" style={sI} value={nMonto} onChange={e=>setNMonto(e.target.value)} placeholder="10000"/></Fl>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
        <Fl l="Fecha"><input type="date" style={sI} value={nFecha} onChange={e=>setNFecha(e.target.value)}/></Fl>
        <Fl l="Categoría">
          <select style={sI} value={nCategoria} onChange={e=>setNCategoria(e.target.value)}>
            {CATS.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </Fl>
        <Fl l="Proveedor (opc)"><input style={sI} value={nProv} onChange={e=>setNProv(e.target.value)} placeholder="CFE / Arrendador / etc"/></Fl>
      </div>
    </div>}
    {tab==="existentes"&&<div>
      <div style={{fontSize:11,color:T.muted,marginBottom:8}}>Detecté <b style={{color:T.yellow}}>{gastosSueltos.length}</b> gasto(s) sueltos (sin obra o asignados a "CARPINTERIA"/"TALLER"). Selecciona los que quieras repartir entre obras activas:</div>
      <div style={{maxHeight:240,overflowY:"auto",border:"1px solid "+T.border,borderRadius:8,marginBottom:10}}>
        {gastosSueltos.length===0?<div style={{padding:20,textAlign:"center",color:T.muted,fontSize:12}}>✅ No hay gastos sueltos por redistribuir</div>:
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead style={{position:"sticky",top:0,background:"#1a1a1a"}}>
              <tr>
                <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:10}}>
                  <input type="checkbox" checked={selMovsSueltos.size===gastosSueltos.length&&gastosSueltos.length>0} onChange={e=>{if(e.target.checked)setSelMovsSueltos(new Set(gastosSueltos.map(m=>m.id)));else setSelMovsSueltos(new Set());}}/>
                </th>
                <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:10}}>FECHA</th>
                <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:10}}>CONCEPTO</th>
                <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:10}}>OBRA ACTUAL</th>
                <th style={{padding:6,textAlign:"right",color:T.gold,fontSize:10}}>MONTO</th>
              </tr>
            </thead>
            <tbody>
              {gastosSueltos.map((m,i)=><tr key={m.id} style={{background:i%2?"rgba(255,255,255,.02)":"transparent",cursor:"pointer"}} onClick={()=>{const s=new Set(selMovsSueltos);s.has(m.id)?s.delete(m.id):s.add(m.id);setSelMovsSueltos(s);}}>
                <td style={{padding:6}}><input type="checkbox" checked={selMovsSueltos.has(m.id)} onChange={()=>{}}/></td>
                <td style={{padding:6,color:T.muted}}>{m.fecha}</td>
                <td style={{padding:6}}>{m.desc}</td>
                <td style={{padding:6,color:T.yellow}}>{m.obra||"(sin obra)"}</td>
                <td style={{padding:6,textAlign:"right",fontWeight:700,color:T.red}}>${getMovMonto(m).toLocaleString("es-MX")}</td>
              </tr>)}
            </tbody>
          </table>}
      </div>
      {selMovsSueltos.size>0&&<div style={{padding:"8px 12px",background:"rgba(255,213,79,.08)",border:"1px solid "+T.yellow+"44",borderRadius:6,marginBottom:10,fontSize:12,color:T.yellow,fontWeight:700}}>📊 {selMovsSueltos.size} seleccionado(s) · Total a repartir: ${totalSueltos.toLocaleString("es-MX")}</div>}
    </div>}
    {/* === MÉTODO DE REPARTO === */}
    <div style={{marginBottom:10}}>
      <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",marginBottom:6,letterSpacing:1}}>Método de reparto</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
        {[
          {k:"igual",l:"⚖️ Por igual",d:"Mismo monto a cada obra"},
          {k:"cotizado",l:"💰 Por cotizado",d:"Obra más grande paga más"},
          {k:"avance",l:"📊 Por avance",d:"Obra más avanzada paga más"},
          {k:"manual",l:"✋ Manual",d:"Tú decides cada %"}
        ].map(m=><button key={m.k} onClick={()=>setMetodo(m.k)} style={{padding:"10px 8px",borderRadius:7,border:metodo===m.k?"2px solid "+T.gold:"1px solid "+T.border,background:metodo===m.k?"rgba(201,149,107,.08)":"transparent",color:metodo===m.k?T.gold:T.muted,cursor:"pointer",textAlign:"left"}}>
          <div style={{fontSize:11,fontWeight:700}}>{m.l}</div>
          <div style={{fontSize:9,marginTop:2,opacity:.7}}>{m.d}</div>
        </button>)}
      </div>
    </div>
    {/* === SELECCIÓN DE OBRAS === */}
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Obras destino ({obrasIncluidas.length})</div>
        <button onClick={()=>{if(allOn)setObrasSel(new Set());else setObrasSel(new Set(obrasActivas.map(o=>o.id)));}} style={{background:"none",border:"none",color:T.blue,fontSize:10,cursor:"pointer",textDecoration:"underline"}}>{allOn?"Ninguna":"Todas"}</button>
      </div>
      <div style={{maxHeight:180,overflowY:"auto",border:"1px solid "+T.border,borderRadius:8}}>
        {obrasActivas.length===0?<div style={{padding:14,textAlign:"center",color:T.muted,fontSize:11}}>No hay obras activas — crea o reactiva alguna</div>:
          obrasActivas.map(o=><div key={o.id} onClick={()=>toggleObra(o.id)} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderBottom:"1px solid "+T.border,cursor:"pointer",background:obrasSel.has(o.id)?"rgba(76,175,80,.06)":"transparent"}}>
            <input type="checkbox" checked={obrasSel.has(o.id)} onChange={()=>{}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.nombre}</div>
              <div style={{fontSize:9,color:T.muted}}>{o.cliente||"sin cliente"} · Cotizado ${(o.cotizado||0).toLocaleString("es-MX")} · Avance {o.avance||0}%</div>
            </div>
            {metodo==="manual"&&obrasSel.has(o.id)&&<input type="number" placeholder="peso" value={pesoManual[o.id]||""} onClick={e=>e.stopPropagation()} onChange={e=>setPesoManual({...pesoManual,[o.id]:e.target.value})} style={{width:60,padding:"4px 6px",borderRadius:5,border:"1px solid "+T.border,background:"#1a1a1a",color:T.text,fontSize:11}}/>}
          </div>)}
      </div>
    </div>
    {/* === PREVIEW DEL REPARTO === */}
    {(tab==="nuevo"?monto>0:totalSueltos>0)&&reparto.length>0&&<div style={{marginBottom:14}}>
      <div style={{fontSize:10,color:T.green,fontWeight:700,textTransform:"uppercase",marginBottom:6,letterSpacing:1}}>👁 Previa del reparto</div>
      <div style={{border:"1px solid "+T.green+"33",borderRadius:8,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead><tr style={{background:"rgba(76,175,80,.08)"}}>
            <th style={{padding:6,textAlign:"left",color:T.green,fontSize:10}}>OBRA</th>
            <th style={{padding:6,textAlign:"right",color:T.green,fontSize:10}}>%</th>
            <th style={{padding:6,textAlign:"right",color:T.green,fontSize:10}}>PARTE</th>
          </tr></thead>
          <tbody>
            {(tab==="nuevo"?reparto:repartoSueltos).map((r,i)=><tr key={i} style={{background:i%2?"rgba(255,255,255,.02)":"transparent"}}>
              <td style={{padding:6}}>{r.obra.nombre}</td>
              <td style={{padding:6,textAlign:"right",color:T.muted}}>{r.pct}%</td>
              <td style={{padding:6,textAlign:"right",fontWeight:700,color:T.red}}>${r.parte.toLocaleString("es-MX")}</td>
            </tr>)}
            <tr style={{borderTop:"2px solid "+T.green,background:"rgba(76,175,80,.06)"}}>
              <td style={{padding:8,fontWeight:800}}>TOTAL</td>
              <td style={{padding:8,textAlign:"right",fontWeight:800}}>100%</td>
              <td style={{padding:8,textAlign:"right",fontWeight:800,color:T.red,fontSize:13}}>${(tab==="nuevo"?monto:totalSueltos).toLocaleString("es-MX")}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>}
    {/* === BOTÓN ACCIÓN === */}
    {tab==="nuevo"?
      <button onClick={crearNuevoProrrateo} style={{...sB,background:T.gold,opacity:(monto>0&&reparto.length>0&&nConcepto)?1:.4,cursor:(monto>0&&reparto.length>0&&nConcepto)?"pointer":"not-allowed"}} disabled={!(monto>0&&reparto.length>0&&nConcepto)}>🧮 Crear {reparto.length} egresos ({reparto.length>0?"$"+monto.toLocaleString("es-MX"):"$0"})</button>
      :
      <button onClick={redistribuirSueltos} style={{...sB,background:T.gold,opacity:(selMovsSueltos.size>0&&repartoSueltos.length>0)?1:.4,cursor:(selMovsSueltos.size>0&&repartoSueltos.length>0)?"pointer":"not-allowed"}} disabled={!(selMovsSueltos.size>0&&repartoSueltos.length>0)}>♻️ Redistribuir {selMovsSueltos.size} gastos → {repartoSueltos.length} obras</button>
    }
    <div style={{fontSize:9,color:T.dim,textAlign:"center",marginTop:10,lineHeight:1.5}}>💡 Tip: si usas "Por cotizado", la obra más grande absorbe proporcionalmente más gastos fijos.<br/>Cada parte se registra como un egreso independiente que puedes ver y editar en Finanzas.</div>
  </div>;
}

// ═══ SYNC GOOGLE SHEETS ═══
// Lee directo del Google Sheet del taller (modo "cualquiera con el link puede ver")
// El equipo del taller llena INGRESOS, GASTOS, NOMINA en el Sheet; aquí se importan en 1 click
const SHEET_ID_DEFAULT="1Y93GJJNBVz91P9DxKlKVCgW6AmVuc_GZE7p8kpCOxbo";
// Parser CSV BLINDADO: respeta saltos de línea dentro de comillas (ej: descripciones multilínea).
// Lee carácter por carácter, NO hace split por \n primero (eso rompía filas multilínea).
function parseCSV(csv){
  const rows=[];
  let current=[];
  let field="";
  let inQ=false;
  for(let i=0;i<csv.length;i++){
    const c=csv[i];
    const next=csv[i+1];
    if(c==='"'){
      // Escape de comillas dobles ("") dentro de un campo
      if(inQ&&next==='"'){field+='"';i++;}
      else{inQ=!inQ;}
    }else if(c===","&&!inQ){
      current.push(field);field="";
    }else if((c==="\n"||c==="\r")&&!inQ){
      // Final de fila (fuera de comillas)
      if(c==="\r"&&next==="\n")i++; // tragar \r\n
      current.push(field);
      // Solo agregar si la fila no está completamente vacía
      if(current.some(v=>v.trim()))rows.push(current);
      current=[];field="";
    }else{
      // Carácter normal — incluye \n dentro de comillas (se preserva como parte del campo)
      field+=c;
    }
  }
  // Último campo y última fila (si no terminó con \n)
  if(field!==""||current.length>0){
    current.push(field);
    if(current.some(v=>v.trim()))rows.push(current);
  }
  if(rows.length<2)return [];
  const headers=rows[0].map(h=>String(h).trim());
  return rows.slice(1).map(vals=>{
    const row={};
    headers.forEach((h,i)=>row[h]=String(vals[i]||"").trim());
    return row;
  });
}
// Palabras que disparan auto-prorrateo entre obras activas (sin importar mayúsculas/paréntesis)
// Incluye: "general", "GENERAL (sin obra)", "herramienta", "repartir", etc.
const esPalabraProrrateo=(s)=>{
  if(!s)return false;
  // Quita paréntesis y todo lo que tienen adentro: "GENERAL (sin obra)" → "GENERAL"
  const lim=String(s).toLowerCase().trim().replace(/\s*\(.*?\)\s*/g,"").trim();
  return /^(herramienta|herramientas|general|sin\s*obra|repartir|prorratear|dividir|compartido|compartidos|todas?|todos|all|taller)$/.test(lim);
};
function GoogleSheetsSyncForm({obras,movs,setMovs,enviarAPapelera,user,td,show,cm,_lastWrite}){
  const[sheetId,setSheetId]=useState(()=>{try{return localStorage.getItem("ev_sheetId")||SHEET_ID_DEFAULT;}catch{return SHEET_ID_DEFAULT;}});
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");
  const[rows,setRows]=useState([]); // Cada fila del Sheet con su status (nuevo/duplicado/error)
  const[debug,setDebug]=useState(null);
  const[selRows,setSelRows]=useState(()=>new Set());
  const[filtroStatus,setFiltroStatus]=useState("nuevo"); // todos|nuevo|duplicado|error
  // LIMPIAR el localStorage viejo de hashes (estaba causando que aparecieran como "ya importados" aunque ya hubieran sido borrados)
  useEffect(()=>{try{localStorage.removeItem("ev_sheetsHashesImportados");}catch{}},[]);
  const extractId=(input)=>{
    const m=String(input).match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m?m[1]:String(input).trim();
  };
  const norm=s=>(s||"").toString().toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");
  // Detección de duplicados EN TIEMPO REAL contra movs[] actual. Si borras un mov, vuelve a aparecer como "nuevo".
  // Buscamos por sheetHash (si fue importado de Sheet) Y por similitud (fecha+monto+desc+obra)
  const calcHash=mov=>[mov.t,mov.fecha,norm(mov.desc),norm(mov.obra||""),Math.round(Number(mov.monto)*100)/100].join("|");
  // Busca el mov del sistema que match con una fila del Sheet (para diagnóstico forense)
  const findMovEnSistema=mov=>{
    // Prioridad 1: match por sheetHash exacto
    const porHash=movs.find(m=>m.sheetHash===mov._hash);
    if(porHash)return porHash;
    // Prioridad 2: match por similitud
    return movs.find(m=>{
      const montoM=Number(m.ing||0)>0?Number(m.ing):Number(m.egr||m.monto||0);
      return m.t===mov.t
        &&m.fecha===mov.fecha
        &&Math.abs(montoM-Number(mov.monto))<0.5
        &&norm(m.desc)===norm(mov.desc)
        &&norm(m.obra||"")===norm(mov.obra||"");
    });
  };
  const esDuplicadoSistema=mov=>!!findMovEnSistema(mov);
  // Parser de monto BLINDADO: maneja "9,300.00", "9.300,00", "$9300", "9300", " 9300 "
  const parseMonto=s=>{
    if(s===null||s===undefined||s==="")return 0;
    let str=String(s).trim().replace(/[$\s]/g,"");
    if(!str)return 0;
    // Si tiene formato europeo "9.300,00" (puntos como miles, coma decimal) → convertir
    if(/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(str)){str=str.replace(/\./g,"").replace(",",".");}
    else{str=str.replace(/,/g,"");}
    str=str.replace(/[^0-9.-]/g,"");
    const n=parseFloat(str);
    return isNaN(n)?0:n;
  };
  // Helper: lee de un row con cualquier capitalización del nombre de columna
  const getCol=(row,...names)=>{
    for(const n of names){
      // Caso exacto
      if(row[n]!==undefined&&row[n]!=="")return row[n];
      // Caso case-insensitive
      const lk=Object.keys(row).find(k=>k.toLowerCase().trim()===n.toLowerCase().trim());
      if(lk&&row[lk]!=="")return row[lk];
    }
    return "";
  };
  // Helper: convertir fecha DD/MM/YYYY o D/M/YYYY → YYYY-MM-DD, dejar tal cual si ya es ISO
  const fixFecha=(f)=>{
    if(!f)return "";
    const s=String(f).trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
    const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if(m){const d=m[1].padStart(2,"0");const mm=m[2].padStart(2,"0");let y=m[3];if(y.length===2)y="20"+y;return y+"-"+mm+"-"+d;}
    return s.slice(0,10);
  };
  // Helper: detectar si un row de nómina es separador de semana o vacío
  const esSepSemana=(empleado)=>{
    if(!empleado)return true;
    const e=empleado.trim().toUpperCase();
    return /SEMANA\s*\d|TOTAL:|🟡|🟢|🔵|🟠|🔴/i.test(e);
  };
  // Construir un movimiento + clasificar su status (nuevo / duplicado / error)
  const construirMov=(base)=>{
    const errores=[];
    if(!base.desc||!base.desc.trim())errores.push("sin descripción");
    if(base.monto<=0)errores.push("monto $0 o inválido"+(base._montoRaw?" (Sheet: '"+base._montoRaw+"')":""));
    if(!base.fecha)errores.push("sin fecha");
    const mov={
      id:"GS"+Date.now()+"_"+Math.random().toString(36).slice(2,9),
      ...base,
      user:user.nombre,status:"aprobado",origen:"GoogleSheets",creadoFecha:td(),
      _errores:errores
    };
    mov._hash=calcHash(mov);
    // Clasificar: error → duplicado-en-sistema → nueva
    if(errores.length>0)mov._status="error";
    else if(esDuplicadoSistema(mov))mov._status="duplicado";
    else mov._status="nuevo";
    return mov;
  };
  const cargarSheet=async()=>{
    const id=extractId(sheetId);
    if(!id||id.length<20){setErr("ID de Sheet inválido");return;}
    setLoading(true);setErr("");setRows([]);setDebug(null);
    try{localStorage.setItem("ev_sheetId",id);}catch{}
    try{
      const errorsBySheet={};
      const fetchSheet=async(sheetName)=>{
        const url="https://docs.google.com/spreadsheets/d/"+id+"/gviz/tq?tqx=out:csv&sheet="+encodeURIComponent(sheetName);
        try{
          const r=await fetch(url);
          if(!r.ok){errorsBySheet[sheetName]="HTTP "+r.status+(r.status===404?" (¿la hoja '"+sheetName+"' existe con ese nombre exacto?)":(r.status===403||r.status===401)?" (Sheet privado — ponlo público)":"");return [];}
          const text=await r.text();
          if(text.trim().startsWith("<")||text.includes("<html")){errorsBySheet[sheetName]="Google devolvió HTML — el Sheet NO está público todavía";return [];}
          return parseCSV(text);
        }catch(e){errorsBySheet[sheetName]="Error de red: "+(e.message||e);return [];}
      };
      const [ingRows,gasRows,nomRows]=await Promise.all([fetchSheet("INGRESOS"),fetchSheet("GASTOS"),fetchSheet("NOMINA")]);
      if(ingRows.length===0&&gasRows.length===0&&nomRows.length===0&&Object.keys(errorsBySheet).length>0){
        throw new Error("No pude leer ninguna hoja:\n"+Object.entries(errorsBySheet).map(([k,v])=>"• "+k+": "+v).join("\n"));
      }
      const todasFilas=[];
      // INGRESOS — fila por fila (sin agrupar, sin descartar)
      ingRows.forEach((r,idx)=>{
        const fecha=fixFecha(getCol(r,"fecha","Fecha","FECHA"));
        const desc=getCol(r,"descripcion","descripción","Descripción","Descripcion","Concepto","concepto","CONCEPTO");
        const obra=getCol(r,"obra","Obra","OBRA");
        const cliente=getCol(r,"cliente","Cliente","CLIENTE");
        const montoStr=getCol(r,"total","Total","TOTAL","monto","Monto","MONTO","ingreso","Ingreso","INGRESO");
        const monto=parseMonto(montoStr);
        // Saltar filas COMPLETAMENTE vacías
        if(!desc&&!obra&&monto<=0&&!fecha)return;
        todasFilas.push(construirMov({
          t:"ing",fecha:fecha||td(),desc:desc.trim(),obra:obra.trim(),prov:cliente.trim(),monto,
          _sheetSrc:"INGRESOS",_sheetRow:idx+2,_montoRaw:montoStr
        }));
      });
      // GASTOS — fila por fila, SIN auto-prorrateo (se hace aparte con la herramienta "Prorratear gasto")
      gasRows.forEach((r,idx)=>{
        const fecha=fixFecha(getCol(r,"fecha","Fecha","FECHA"));
        const desc=getCol(r,"descripcion","descripción","Descripción","Descripcion","Concepto","concepto","CONCEPTO");
        const obra=getCol(r,"obra","Obra","OBRA");
        const prov=getCol(r,"proveedor","Proveedor","PROVEEDOR");
        const cat=getCol(r,"categoría","Categoría","Categoria","categoria","CATEGORÍA","CATEGORIA");
        const montoStr=getCol(r,"total","Total","TOTAL","monto","Monto","MONTO","egreso","Egreso","EGRESO");
        const monto=parseMonto(montoStr);
        if(!desc&&!obra&&monto<=0&&!fecha)return;
        todasFilas.push(construirMov({
          t:"egr",fecha:fecha||td(),desc:desc.trim(),obra:obra.trim(),prov:prov.trim(),cat:cat.trim(),monto,
          _sheetSrc:"GASTOS",_sheetRow:idx+2,_montoRaw:montoStr
        }));
      });
      // NOMINA — soporta DOS formatos:
      //   FORMATO NUEVO (recomendado): una fila por (empleado, obra) con columnas: fecha, empleado, puesto, obra, dias, monto
      //   FORMATO VIEJO (compat): nombre, puesto/cargo, sueldo base, extras, dias y obra (con desglose en la celda), total
      let fechaSemanaActual=td();
      const MESES={enero:"01",febrero:"02",marzo:"03",abril:"04",mayo:"05",junio:"06",julio:"07",agosto:"08",septiembre:"09",octubre:"10",noviembre:"11",diciembre:"12"};
      const reN=/(\d+)\s*d[ií]as?\s+([^()\$]+?)\s*\(\$?\s*([\d,]+(?:\.\d+)?)\s*\)/gi;
      // Detectar qué formato usa el Sheet mirando los headers
      const nomHeaders=nomRows[0]?Object.keys(nomRows[0]).map(h=>h.toLowerCase().trim()):[];
      const esFormatoNuevo=nomHeaders.some(h=>h==="empleado"||h==="dias"||h==="días")&&nomHeaders.some(h=>h==="obra");
      nomRows.forEach((r,idx)=>{
        // ── Detección de fila separadora de semana (común a ambos formatos) ──
        const primerCampo=getCol(r,"fecha","Fecha","FECHA","nombre","Nombre","empleado","Empleado");
        if(esSepSemana(primerCampo)){
          const txt=primerCampo.toLowerCase();
          const m=txt.match(/(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/);
          if(m){
            const d=m[1].padStart(2,"0");const mes=MESES[m[2]]||"01";
            const yearMatch=txt.match(/\b(20\d{2})\b/);
            let year;
            if(yearMatch)year=yearMatch[1];
            else if(fechaSemanaActual&&/^\d{4}-/.test(fechaSemanaActual))year=fechaSemanaActual.slice(0,4);
            else year=String(new Date().getFullYear());
            fechaSemanaActual=year+"-"+mes+"-"+d;
          }
          return;
        }
        if(esFormatoNuevo){
          // ═══ FORMATO NUEVO ═══ una fila = un (empleado, obra)
          const fechaCell=fixFecha(getCol(r,"fecha","Fecha","FECHA"));
          const empleado=getCol(r,"empleado","Empleado","nombre","Nombre");
          const puesto=getCol(r,"puesto","Puesto","puesto/cargo","cargo","Cargo");
          const obraD=getCol(r,"obra","Obra","OBRA");
          const dias=Number(getCol(r,"dias","días","Dias","Días","DIAS"))||0;
          const montoStr=getCol(r,"monto","Monto","MONTO","total","Total","TOTAL");
          const montoD=parseMonto(montoStr);
          if(!empleado.trim()||montoD<=0)return;
          const fechaFinal=fechaCell||fechaSemanaActual||td();
          todasFilas.push(construirMov({
            t:"egr",fecha:fechaFinal,
            desc:"Nómina "+empleado.trim()+(dias>0?" — "+dias+" día"+(dias!==1?"s":""):""),
            obra:obraD.trim(),
            prov:empleado.trim()+(puesto?" ("+puesto+")":""),
            cat:"Nómina",
            monto:montoD,
            _sheetSrc:"NOMINA",_sheetRow:idx+2,_montoRaw:montoStr
          }));
        }else{
          // ═══ FORMATO VIEJO ═══ una fila = un empleado con desglose en una celda
          const empleado=getCol(r,"nombre","Nombre","NOMBRE","empleado","Empleado","EMPLEADO");
          const desglose=getCol(r,"dias y obra","días y obra","Dias y obra","Días y obra","DIAS Y OBRA","obras-desglose","Obras-desglose","Desglose","desglose","Detalle","DESGLOSE");
          const totalStr=getCol(r,"total","Total","TOTAL","monto","Monto");
          const total=parseMonto(totalStr);
          if(!empleado.trim()||total<=0)return;
          const matches=[...desglose.matchAll(reN)];
          if(matches.length===0){
            todasFilas.push(construirMov({
              t:"egr",fecha:fechaSemanaActual,desc:"Nómina "+empleado.trim(),obra:"",prov:empleado.trim(),cat:"Nómina",monto:total,
              _sheetSrc:"NOMINA",_sheetRow:idx+2,_montoRaw:totalStr
            }));
          }else{
            matches.forEach((mt,subIdx)=>{
              const dias=Number(mt[1]);const obraD=mt[2].trim();const montoD=parseMonto(mt[3]);
              todasFilas.push(construirMov({
                t:"egr",fecha:fechaSemanaActual,desc:"Nómina "+empleado.trim()+" — "+dias+" día"+(dias!==1?"s":""),obra:obraD,prov:empleado.trim(),cat:"Nómina",monto:montoD,
                _sheetSrc:"NOMINA",_sheetRow:idx+2+"."+(subIdx+1),_montoRaw:mt[3]
              }));
            });
          }
        }
      });
      setRows(todasFilas);
      // Pre-seleccionar SOLO los "nuevo"
      setSelRows(new Set(todasFilas.filter(r=>r._status==="nuevo").map(r=>r.id)));
      setDebug({
        rawIng:ingRows.length,rawGas:gasRows.length,rawNom:nomRows.length,
        headersIng:ingRows[0]?Object.keys(ingRows[0]):[],
        headersGas:gasRows[0]?Object.keys(gasRows[0]):[],
        headersNom:nomRows[0]?Object.keys(nomRows[0]):[],
        errorsBySheet
      });
      setLoading(false);
    }catch(e){
      setErr(e.message||"No pude leer el Sheet");
      setLoading(false);
    }
  };
  // Stats por status
  const stats=useMemo(()=>({
    nuevo:rows.filter(r=>r._status==="nuevo").length,
    duplicado:rows.filter(r=>r._status==="duplicado").length,
    error:rows.filter(r=>r._status==="error").length
  }),[rows]);
  // Filas filtradas para mostrar en la tabla
  const rowsVisibles=useMemo(()=>filtroStatus==="todos"?rows:rows.filter(r=>r._status===filtroStatus),[rows,filtroStatus]);
  // Solo las filas seleccionadas que existen + son "nuevo"
  const seleccionadasValidas=useMemo(()=>rows.filter(r=>selRows.has(r.id)&&r._status==="nuevo"),[rows,selRows]);
  const totalSeleccionado=seleccionadasValidas.reduce((s,r)=>s+r.monto,0);
  const toggleRow=id=>{
    const s=new Set(selRows);s.has(id)?s.delete(id):s.add(id);setSelRows(s);
  };
  const toggleAllVisibles=()=>{
    const seleccionables=rowsVisibles.filter(r=>r._status==="nuevo");
    if(seleccionables.length===0)return;
    const todasSel=seleccionables.every(r=>selRows.has(r.id));
    const s=new Set(selRows);
    if(todasSel)seleccionables.forEach(r=>s.delete(r.id));
    else seleccionables.forEach(r=>s.add(r.id));
    setSelRows(s);
  };
  const importar=async()=>{
    if(seleccionadasValidas.length===0){show("⚠️ No hay filas válidas seleccionadas");return;}
    const totalMonto=seleccionadasValidas.reduce((s,r)=>s+Number(r.monto),0);
    // === PASO 1: CONFIRMACIÓN INICIAL ===
    const msg1="VERIFICA antes de confirmar:\n\n"+
      "• "+seleccionadasValidas.length+" movimientos\n"+
      "• "+seleccionadasValidas.filter(r=>r.t==="ing").length+" ingresos\n"+
      "• "+seleccionadasValidas.filter(r=>r.t==="egr").length+" egresos\n"+
      "• Total: $"+totalMonto.toLocaleString("es-MX",{minimumFractionDigits:2})+"\n\n"+
      "Estas filas NUNCA se podrán volver a importar (hash guardado).";
    if(!confirm(msg1))return;
    // === PASO 2: CONSTRUCCIÓN EXPLÍCITA — usa ing/egr como el resto del sistema ===
    // IMPORTANTE: El sistema usa campos m.ing y m.egr para los montos (NO m.monto).
    // Mantenemos m.monto también para retrocompatibilidad con vistas que lo usan.
    const loteId="GS"+Date.now();
    const limpios=seleccionadasValidas.map((r,idx)=>{
      const montoNum=Number(r.monto);
      if(isNaN(montoNum)||montoNum<=0){
        console.error("Mov con monto inválido:",r);
      }
      const esIng=r.t==="ing";
      return {
        id:"GS"+Date.now()+"_"+idx+"_"+Math.random().toString(36).slice(2,6),
        t:String(r.t),
        fecha:String(r.fecha),
        desc:String(r.desc||""),
        prov:String(r.prov||""),
        obra:String(r.obra||""),
        cat:String(r.cat||""),
        ing:esIng?montoNum:0,      // ← CAMPO CRÍTICO para que aparezca en la tabla
        egr:esIng?0:montoNum,      // ← CAMPO CRÍTICO para que aparezca en la tabla
        monto:montoNum,             // ← retrocompatibilidad con Finanzas filtradas
        user:String(r.user||""),
        status:"aprobado",
        origen:"GoogleSheets",
        creadoFecha:String(r.creadoFecha||td()),
        loteImport:loteId,
        sheetHash:String(r._hash||"")
      };
    });
    // === PASO 3: PREVIEW EXPLÍCITO de lo que se va a guardar ===
    const muestra=limpios.slice(0,5).map(m=>"  • "+m.fecha+" | "+(m.t==="ing"?"INGRESO":"EGRESO")+" | "+m.desc.slice(0,30)+" | "+(m.obra||"(sin obra)")+" | $"+m.monto.toLocaleString("es-MX",{minimumFractionDigits:2})).join("\n");
    const sumaFinal=limpios.reduce((s,m)=>s+m.monto,0);
    const msg2="ÚLTIMA VERIFICACIÓN — primeros "+Math.min(5,limpios.length)+" movimientos a guardar:\n\n"+muestra+"\n"+
      (limpios.length>5?"  ... y "+(limpios.length-5)+" más\n":"")+
      "\nSUMA TOTAL: $"+sumaFinal.toLocaleString("es-MX",{minimumFractionDigits:2})+"\n\n"+
      "¿Los MONTOS están correctos? Aceptar = se guardan en el sistema.";
    if(!confirm(msg2)){show("❌ Importación cancelada");return;}
    // === PASO 4: GUARDADO con await + verificación ===
    console.log("[GoogleSheets Sync] PRE-import — primeros 3 movs a guardar:",limpios.slice(0,3));
    console.log("[GoogleSheets Sync] PRE-import — movs en sistema antes:",movs.length);
    const movsAntes=movs.length;
    let finalLen=0;
    try{
      await setMovs(prev=>{
        const final=[...prev,...limpios];
        finalLen=final.length;
        console.log("[GoogleSheets Sync] Total movs después:",final.length,"- últimos 3:",final.slice(-3).map(m=>m.desc+"="+m.egr+"/"+m.ing+" cat="+m.cat));
        return final;
      });
      _lastWrite.current["movs"]=Date.now()+30000; // 30s de cooldown extra
    }catch(e){
      console.error("Error en setMovs:",e);
      alert("❌ Error guardando:\n"+(e.message||e));
      return;
    }
    // === PASO 5: Registrar el lote para que puedas deshacer si algo salió mal ===
    try{localStorage.setItem("ev_ultimoLote",JSON.stringify({loteId,count:limpios.length,tipo:"Google Sheets",timestamp:Date.now()}));}catch{}
    // === PASO 6: ALERT FINAL DE VERIFICACIÓN — Miguel debe confirmar que ve el resultado ===
    const fechas=limpios.map(m=>m.fecha).sort();
    const primera=fechas[0]||"?";const ultima=fechas[fechas.length-1]||"?";
    const ingCount=limpios.filter(m=>m.t==="ing").length;
    const egrCount=limpios.filter(m=>m.t==="egr").length;
    const nominaCount=limpios.filter(m=>m.cat==="Nómina").length;
    alert(
      "✅ IMPORTADO CON ÉXITO\n\n"+
      "• "+limpios.length+" movimientos guardados\n"+
      "• "+ingCount+" ingresos · "+egrCount+" egresos\n"+
      "• "+nominaCount+" son nóminas (cat: Nómina)\n"+
      "• Total: $"+sumaFinal.toLocaleString("es-MX",{minimumFractionDigits:2})+"\n"+
      "• Fechas: "+primera+" → "+ultima+"\n\n"+
      "📊 Antes había "+movsAntes+" movs · ahora "+finalLen+" (debió subir +"+limpios.length+")\n\n"+
      "VERIFICA AHORA en Finanzas:\n"+
      "1. Quita TODOS los filtros (✗ Limpiar todo)\n"+
      "2. Click pestaña '📅 Nóminas'\n"+
      "3. Debes ver "+nominaCount+" nuevas con fechas entre "+primera+" y "+ultima+"\n\n"+
      "Si NO las ves → ALGO falló, avisa con un screenshot."
    );
    show("✅ "+limpios.length+" importados · $"+sumaFinal.toLocaleString("es-MX"));
    cm();
  };
  const STATUS_CFG={
    nuevo:{c:T.green,ic:"🟢",l:"Nueva"},
    duplicado:{c:T.yellow,ic:"🟡",l:"Ya en sistema"},
    error:{c:T.red,ic:"🔴",l:"Error"}
  };
  return <div>
    <div style={{background:"linear-gradient(135deg,rgba(76,175,80,.10),rgba(66,165,245,.06))",border:"1px solid "+T.green+"55",borderRadius:10,padding:12,marginBottom:14,fontSize:11,color:T.muted,lineHeight:1.5}}>
      <div style={{color:T.green,fontWeight:700,marginBottom:4,fontSize:12}}>📊 Sync seguro de Google Sheets</div>
      <b>Cero duplicados garantizado.</b> Cada fila tiene una huella única — si ya la importaste, NUNCA se vuelve a importar. Las filas con error (monto $0, sin descripción) NO se pueden importar: las marco en rojo para que las arregles en el Sheet.
    </div>
    <Fl l="URL o ID del Google Sheet">
      <input style={sI} value={sheetId} onChange={e=>setSheetId(e.target.value)} placeholder="Pega aquí la URL del Sheet"/>
    </Fl>
    <div style={{padding:"8px 10px",background:"rgba(255,213,79,.06)",border:"1px solid "+T.yellow+"33",borderRadius:7,fontSize:10,color:T.muted,marginBottom:12,lineHeight:1.5}}>
      <b style={{color:T.yellow}}>⚠️ El Sheet DEBE estar público:</b> Compartir → "Cualquier persona con el enlace" → <b>Lector</b>. Hojas leídas: <b>INGRESOS, GASTOS, NOMINA</b>.
    </div>
    <button onClick={cargarSheet} disabled={loading} style={{...sB,background:loading?T.muted:T.blue,opacity:loading?.6:1,cursor:loading?"wait":"pointer"}}>{loading?"⏳ Leyendo Sheet...":"🔄 Conectar y leer Sheet"}</button>
    {/* Botón RESET TOTAL — limpia todos los imports de Google Sheets para empezar de cero */}
    {(()=>{const totalGS=movs.filter(m=>m.origen==="GoogleSheets").length;if(totalGS===0)return null;return <button onClick={()=>{
      if(!confirm("🚨 RESET COMPLETO\n\nVa a mandar a Papelera TODOS los "+totalGS+" movimientos que vinieron de Google Sheets (sin importar su estado).\n\nDespués vas a poder importar todo desde cero con el formato correcto.\n\n¿Continuar?"))return;
      if(!confirm("¿100% seguro? Esto borra "+totalGS+" movs."))return;
      const aBorrar=movs.filter(m=>m.origen==="GoogleSheets");
      aBorrar.forEach(m=>enviarAPapelera("mov",m,"RESET de imports Google Sheets"));
      const ids=new Set(aBorrar.map(m=>m.id));
      setMovs(prev=>prev.filter(m=>!ids.has(m.id)));
      _lastWrite.current["movs"]=Date.now()+30000;
      show("🚨 "+aBorrar.length+" movs de Google Sheets → Papelera. Listo para empezar limpio.");
      setRows([]);setSelRows(new Set());setDebug(null);
    }} style={{...sB,background:"#3a1010",color:T.red,border:"1px solid "+T.red+"55",marginTop:6,fontSize:11}}>🚨 RESET TOTAL: borrar los {totalGS} imports anteriores de Google Sheets</button>;})()}
    {err&&<div style={{padding:10,background:"rgba(231,76,60,.08)",border:"1px solid "+T.red+"55",borderRadius:7,fontSize:11,color:T.red,marginTop:10,whiteSpace:"pre-line"}}>⚠️ {err}</div>}
    {rows.length>0&&<div style={{marginTop:14}}>
      {/* Detector y limpiador de movs basura (import anterior con monto pero sin ing/egr) */}
      {(()=>{
        // Movs basura = origen GoogleSheets + tiene monto > 0 pero ing y egr son 0/undefined
        // Esos son los movs que aparecen como "Ya en sistema" pero en la tabla se ven como $0
        const basura=movs.filter(m=>m.origen==="GoogleSheets"&&Number(m.monto||0)>0&&Number(m.ing||0)===0&&Number(m.egr||0)===0);
        if(basura.length===0)return null;
        return <div style={{padding:"12px 14px",background:"linear-gradient(135deg,rgba(255,213,79,.12),rgba(231,76,60,.06))",border:"2px solid "+T.yellow+"77",borderRadius:8,marginBottom:10}}>
          <div style={{fontSize:12,fontWeight:800,color:T.yellow,marginBottom:4}}>⚠️ Detecté {basura.length} movs basura del import anterior</div>
          <div style={{fontSize:11,color:T.muted,marginBottom:8,lineHeight:1.5}}>
            Esos movs se guardaron con el bug viejo: tienen <code>monto</code> pero les falta <code>ing/egr</code>, por eso en la tabla aparecen como <b style={{color:T.red}}>$0</b>. Y como están en el sistema, ahora bloquean la re-importación como "Ya en sistema". <b>Bórralos para volver a importar limpio:</b>
          </div>
          <button onClick={()=>{
            if(!confirm("¿Mandar a Papelera "+basura.length+" movs basura?\n\nSon los que aparecen como $0 en la tabla. Se pueden recuperar de la Papelera por 30 días si te equivocas.\n\nDespués de limpiarlos, vuelve a 'Conectar y leer Sheet' y los verás como NUEVOS para re-importar."))return;
            basura.forEach(m=>enviarAPapelera("mov",m,(m.desc||"")+" (movs basura import GS)"));
            const idsBasura=new Set(basura.map(m=>m.id));
            setMovs(prev=>prev.filter(m=>!idsBasura.has(m.id)));
            _lastWrite.current["movs"]=Date.now()+30000;
            show("🧹 "+basura.length+" movs basura → Papelera. Ahora dale 'Conectar y leer Sheet' otra vez.");
            // Resetear el preview para forzar re-lectura
            setRows([]);setSelRows(new Set());setDebug(null);
          }} style={{padding:"10px 16px",borderRadius:7,border:"none",background:T.red,color:"#fff",fontWeight:800,fontSize:12,cursor:"pointer"}}>🧹 Limpiar {basura.length} movs basura</button>
        </div>;
      })()}
      {/* Filtros por status — clickeables */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:10}}>
        <div onClick={()=>setFiltroStatus("todos")} style={{padding:8,border:filtroStatus==="todos"?"2px solid "+T.gold:"1px solid "+T.border,borderRadius:7,cursor:"pointer",textAlign:"center"}}>
          <div style={{fontSize:18,fontWeight:800,color:T.text}}>{rows.length}</div>
          <div style={{fontSize:9,color:T.muted}}>Todas</div>
        </div>
        {Object.entries(STATUS_CFG).map(([k,c])=><div key={k} onClick={()=>setFiltroStatus(k)} style={{padding:8,border:filtroStatus===k?"2px solid "+c.c:"1px solid "+T.border,borderRadius:7,cursor:"pointer",textAlign:"center",background:filtroStatus===k?c.c+"11":"transparent",opacity:stats[k]>0?1:.5}}>
          <div style={{fontSize:18,fontWeight:800,color:c.c}}>{stats[k]}</div>
          <div style={{fontSize:9,color:T.muted}}>{c.ic} {c.l}</div>
        </div>)}
      </div>
      {/* Selección actual + total */}
      <div style={{padding:"10px 14px",background:seleccionadasValidas.length>0?"rgba(76,175,80,.10)":"rgba(255,255,255,.03)",border:"1px solid "+(seleccionadasValidas.length>0?T.green+"55":T.border),borderRadius:7,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:12,color:seleccionadasValidas.length>0?T.green:T.muted,fontWeight:700}}>{seleccionadasValidas.length>0?"✅ "+seleccionadasValidas.length+" fila(s) seleccionadas":"Nada seleccionado"}</div>
          {seleccionadasValidas.length>0&&<div style={{fontSize:10,color:T.muted,marginTop:2}}>Total a importar: <b style={{color:T.text,fontSize:13}}>${totalSeleccionado.toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div>}
        </div>
        <button onClick={importar} disabled={seleccionadasValidas.length===0} style={{padding:"10px 18px",borderRadius:8,border:"none",background:seleccionadasValidas.length>0?T.green:T.muted,color:"#fff",fontWeight:800,fontSize:13,cursor:seleccionadasValidas.length>0?"pointer":"not-allowed",opacity:seleccionadasValidas.length>0?1:.5}}>📊 IMPORTAR {seleccionadasValidas.length}</button>
      </div>
      {/* === PANEL FORENSE: cuando el filtro está en "duplicado" === */}
      {filtroStatus==="duplicado"&&stats.duplicado>0&&(()=>{
        const duplicados=rows.filter(r=>r._status==="duplicado");
        // Recopilar info de los movs reales del sistema
        const detalle=duplicados.map(r=>{
          const m=findMovEnSistema(r);
          return {r,m};
        });
        // ¿Cuántos tienen monto $0 en el sistema (basura)?
        const conMontoCero=detalle.filter(d=>d.m&&Number(d.m.ing||0)===0&&Number(d.m.egr||0)===0&&Number(d.m.monto||0)===0);
        const conMontoOK=detalle.filter(d=>d.m&&(Number(d.m.ing||0)>0||Number(d.m.egr||0)>0));
        const conMontoSoloMonto=detalle.filter(d=>d.m&&Number(d.m.ing||0)===0&&Number(d.m.egr||0)===0&&Number(d.m.monto||0)>0);
        return <div style={{padding:"12px 14px",background:"rgba(255,213,79,.08)",border:"1px solid "+T.yellow+"55",borderRadius:8,marginBottom:10,fontSize:11,lineHeight:1.6}}>
          <div style={{color:T.yellow,fontWeight:800,marginBottom:6,fontSize:12}}>🔬 Análisis forense de los {duplicados.length} "Ya en sistema"</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:8}}>
            <div style={{padding:8,background:"rgba(76,175,80,.06)",borderRadius:6,borderLeft:"3px solid "+T.green}}>
              <div style={{fontSize:18,fontWeight:800,color:T.green}}>{conMontoOK.length}</div>
              <div style={{fontSize:10,color:T.muted}}>✅ OK · tienen ing/egr correcto</div>
            </div>
            <div style={{padding:8,background:"rgba(255,213,79,.06)",borderRadius:6,borderLeft:"3px solid "+T.yellow}}>
              <div style={{fontSize:18,fontWeight:800,color:T.yellow}}>{conMontoSoloMonto.length}</div>
              <div style={{fontSize:10,color:T.muted}}>⚠ Basura · solo tienen monto, sin ing/egr</div>
            </div>
            <div style={{padding:8,background:"rgba(231,76,60,.06)",borderRadius:6,borderLeft:"3px solid "+T.red}}>
              <div style={{fontSize:18,fontWeight:800,color:T.red}}>{conMontoCero.length}</div>
              <div style={{fontSize:10,color:T.muted}}>💥 Vacíos · sin monto, ing ni egr</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {(conMontoSoloMonto.length+conMontoCero.length)>0&&<button onClick={()=>{
              const toClean=[...conMontoSoloMonto,...conMontoCero].map(d=>d.m);
              if(!confirm("¿Mandar a Papelera "+toClean.length+" movs basura del sistema?\n\nSon los que NO tienen ing/egr correcto (aparecen como $0 en la tabla de Finanzas).\n\nDespués de borrarlos, vuelve a 'Conectar y leer Sheet' y los verás como NUEVOS para re-importar."))return;
              toClean.forEach(m=>enviarAPapelera("mov",m,(m.desc||"")+" (basura GS)"));
              const ids=new Set(toClean.map(m=>m.id));
              setMovs(prev=>prev.filter(m=>!ids.has(m.id)));
              _lastWrite.current["movs"]=Date.now()+30000;
              show("🧹 "+toClean.length+" movs basura → Papelera. Vuelve a leer el Sheet.");
              setRows([]);setSelRows(new Set());setDebug(null);
            }} style={{padding:"8px 12px",borderRadius:6,border:"none",background:T.red,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer"}}>🧹 Borrar {conMontoSoloMonto.length+conMontoCero.length} basura</button>}
            {conMontoOK.length>0&&<div style={{padding:"8px 12px",background:"rgba(76,175,80,.08)",borderRadius:6,color:T.green,fontSize:10}}>
              ℹ️ Los {conMontoOK.length} OK ya están bien en Finanzas. Si no los ves, quita filtros y revisa.
            </div>}
          </div>
        </div>;
      })()}
      {/* Tabla DETALLADA — fila por fila */}
      <div style={{maxHeight:420,overflowY:"auto",border:"1px solid "+T.border,borderRadius:8,marginBottom:10}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead style={{position:"sticky",top:0,background:"#1a1a1a",zIndex:1}}>
            <tr>
              <th style={{padding:6,textAlign:"center",color:T.gold,fontSize:9,width:30}}><input type="checkbox" onChange={toggleAllVisibles} title="Seleccionar todas las visibles"/></th>
              <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:9,whiteSpace:"nowrap"}}>STATUS</th>
              <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:9}}>SHEET</th>
              <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:9}}>FECHA</th>
              <th style={{padding:6,textAlign:"center",color:T.gold,fontSize:9,width:30}}>TIPO</th>
              <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:9}}>CONCEPTO</th>
              <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:9}}>OBRA</th>
              <th style={{padding:6,textAlign:"right",color:T.gold,fontSize:9}}>MONTO</th>
            </tr>
          </thead>
          <tbody>
            {rowsVisibles.map((r,i)=>{
              const cfg=STATUS_CFG[r._status];
              const seleccionable=r._status==="nuevo";
              const movSis=r._status==="duplicado"?findMovEnSistema(r):null;
              const movSisMonto=movSis?(Number(movSis.ing||0)>0?Number(movSis.ing):Number(movSis.egr||movSis.monto||0)):0;
              return <tr key={r.id} onClick={()=>seleccionable&&toggleRow(r.id)} style={{background:i%2?"rgba(255,255,255,.02)":"transparent",borderLeft:"3px solid "+cfg.c+"77",cursor:seleccionable?"pointer":"default",opacity:seleccionable?1:.55}}>
                <td style={{padding:5,textAlign:"center"}}><input type="checkbox" checked={selRows.has(r.id)} disabled={!seleccionable} onChange={()=>{}} onClick={e=>e.stopPropagation()}/></td>
                <td style={{padding:5,color:cfg.c,fontWeight:700,whiteSpace:"nowrap"}}>{cfg.ic} {cfg.l}</td>
                <td style={{padding:5,color:T.muted,fontSize:9,whiteSpace:"nowrap"}}>{r._sheetSrc}:{r._sheetRow}</td>
                <td style={{padding:5,color:T.muted,whiteSpace:"nowrap"}}>{r.fecha}</td>
                <td style={{padding:5,textAlign:"center"}}>{r.t==="ing"?"📈":"📉"}</td>
                <td style={{padding:5,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.desc+(r._errores&&r._errores.length>0?"\n⚠ "+r._errores.join("; "):"")}>{r.desc||<i style={{color:T.red}}>(sin desc)</i>}</td>
                <td style={{padding:5,color:T.gold,fontSize:9,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.obra}>{r.obra||"—"}</td>
                <td style={{padding:5,textAlign:"right",fontWeight:700,whiteSpace:"nowrap"}}>
                  {r.monto>0?<span style={{color:r.t==="ing"?T.green:T.red}}>${r.monto.toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2})}</span>:<span style={{color:T.red}} title={"Sheet decía: '"+r._montoRaw+"'"}>$0 ⚠</span>}
                  {/* Cuando es duplicado, mostrar lo que tiene el sistema lado a lado */}
                  {movSis&&<div style={{fontSize:9,color:movSisMonto>0?T.green:T.red,marginTop:2,fontWeight:600}} title={"Sistema id="+movSis.id+" cat="+movSis.cat+" ing="+(movSis.ing||0)+" egr="+(movSis.egr||0)+" monto="+(movSis.monto||0)}>
                    Sistema: {movSisMonto>0?"$"+movSisMonto.toLocaleString("es-MX"):"$0 ⚠"}
                  </div>}
                </td>
              </tr>;
            })}
            {rowsVisibles.length===0&&<tr><td colSpan={8} style={{padding:20,textAlign:"center",color:T.muted}}>(sin filas en este filtro)</td></tr>}
          </tbody>
        </table>
      </div>
      {/* Mensaje de errores */}
      {stats.error>0&&<div style={{padding:10,background:"rgba(231,76,60,.06)",border:"1px solid "+T.red+"33",borderRadius:7,fontSize:11,color:T.muted,marginBottom:10}}>
        <b style={{color:T.red}}>⚠️ {stats.error} fila(s) con error</b> — NO se importan. Click "🔴 Error" arriba para verlas. Arregla el Sheet (monto, descripción) y vuelve a "🔄 Conectar y leer".
      </div>}
      {/* Diagnóstico técnico (colapsable) */}
      {debug&&<details style={{marginTop:8,fontSize:10}}>
        <summary style={{cursor:"pointer",color:T.muted}}>🔍 Detalles técnicos de lo que se leyó</summary>
        <div style={{padding:8,background:"rgba(0,0,0,.2)",borderRadius:6,marginTop:6,color:T.muted}}>
          <div>INGRESOS: {debug.rawIng} filas{debug.errorsBySheet.INGRESOS?<span style={{color:T.red}}> · {debug.errorsBySheet.INGRESOS}</span>:""}</div>
          <div>GASTOS: {debug.rawGas} filas{debug.errorsBySheet.GASTOS?<span style={{color:T.red}}> · {debug.errorsBySheet.GASTOS}</span>:""}</div>
          <div>NOMINA: {debug.rawNom} filas{debug.errorsBySheet.NOMINA?<span style={{color:T.red}}> · {debug.errorsBySheet.NOMINA}</span>:""}</div>
          {debug.headersGas.length>0&&<div style={{marginTop:4}}>Columnas GASTOS: <code style={{color:T.gold}}>{debug.headersGas.join(" | ")}</code></div>}
        </div>
      </details>}
    </div>}
    <div style={{fontSize:9,color:T.dim,textAlign:"center",marginTop:12,lineHeight:1.5}}>💡 Para repartir gastos generales/herramientas entre obras, usa <b>Finanzas → ⋯ → 🧮 Prorratear gasto</b> DESPUÉS de importar.</div>
  </div>;
}

// ═══ PUERTA DE ACCESO (Supabase Auth) — cuenta compartida del taller ═══
// Correo fijo (no es secreto). Lo único que se teclea es la contraseña, UNA vez por dispositivo.
const TEAM_EMAIL="arq.villarreal07@gmail.com";
function LoginGate({onAuthed}){
  const[pass,setPass]=useState("");
  const[err,setErr]=useState("");
  const[busy,setBusy]=useState(false);
  const entrar=async()=>{
    if(busy)return;
    if(!pass){setErr("Escribe la contraseña del taller");return;}
    setBusy(true);setErr("");
    try{await AUTH.signIn(TEAM_EMAIL,pass);onAuthed();}
    catch(e){const m=String(e.message||"");setErr(/invalid login|credentials|invalid/i.test(m)?"Contraseña incorrecta":(m||"No se pudo iniciar sesión"));setBusy(false);}
  };
  return <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:360}}>
      <div style={{textAlign:"center",marginBottom:24,display:"flex",flexDirection:"column",alignItems:"center"}}>
        <BrandFull size="big" sub="Carpintería Arquitectónica"/>
        <div style={{fontSize:9,color:T.dim,marginTop:8,fontStyle:"italic"}}>— Donde la madera encuentra su forma —</div>
      </div>
      <div style={{background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.06)",borderRadius:14,padding:18}}>
        <div style={{fontSize:13,fontWeight:700,color:T.gold,marginBottom:2}}>🔒 Acceso del taller</div>
        <div style={{fontSize:11,color:T.muted,marginBottom:14}}>Solo la primera vez en este dispositivo. Después entras directo con tu PIN.</div>
        {/* Correo oculto para que el navegador guarde la contraseña, pero no se teclea */}
        <input type="email" autoComplete="username" value={TEAM_EMAIL} readOnly style={{display:"none"}}/>
        <Fl l="Contraseña del taller"><input id="login-pass" type="password" autoFocus autoComplete="current-password" style={sI} value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")entrar();}} placeholder="••••••••"/></Fl>
        {err&&<div style={{fontSize:11,color:T.red,background:"rgba(231,76,60,.08)",border:"1px solid "+T.red+"33",borderRadius:8,padding:"8px 10px",marginBottom:8}}>⚠️ {err}</div>}
        <button style={{...sB,opacity:busy?.6:1,cursor:busy?"wait":"pointer"}} onClick={entrar} disabled={busy}>{busy?"Entrando...":"Entrar"}</button>
      </div>
    </div>
  </div>;
}

export default function App(){
  const[w,setW]=useState(typeof window!=="undefined"?window.innerWidth:400);
  useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  const D=w>=860;const G=D?"1fr 1fr":"1fr";
  const[authed,setAuthed]=useState(()=>AUTH.isAuthed());
  const[user,setUser]=useState(null);
  const[sec,setSec]=useState("dash");
  const[sub,setSub]=useState(null);
  const[modal,setModal]=useState(null);
  const[md,setMd]=useState(null);
  const[moreOpen,setMoreOpen]=useState(false);
  const[loading,setLoading]=useState(true);
  const[syncStatus,setSyncStatus]=useState("");
  const[saveStatus,setSaveStatus]=useState({state:"idle",msg:""});
  const[searchOpen,setSearchOpen]=useState(false);
  const[searchQ,setSearchQ]=useState("");
  // Auto-marcar como visto cuando se entra a una sección (delay 2s)
  useEffect(()=>{
    if(!user)return;
    const t=setTimeout(()=>{
      const map={finanzas:"movs",cajachica:"caja",cotizaciones:"cotizaciones",obras:"obras"};
      if(map[sec])setLastSeen(prev=>{const n={...prev,[map[sec]]:Date.now()};try{localStorage.setItem("ev_lastSeen",JSON.stringify(n));}catch{}return n;});
    },2000);
    return ()=>clearTimeout(t);
  },[sec,user]);
  // Marca de "último visto" por sección — items con fecha > este timestamp son "nuevos"
  const[lastSeen,setLastSeen]=useState(()=>{try{return JSON.parse(localStorage.getItem("ev_lastSeen")||"{}");}catch{return {};}});
  const marcarVisto=(seccion)=>{const next={...lastSeen,[seccion]:Date.now()};setLastSeen(next);try{localStorage.setItem("ev_lastSeen",JSON.stringify(next));}catch{}};
  const esNuevo=(seccion,ts)=>!lastSeen[seccion]||(ts||0)>lastSeen[seccion];
  // Tour de bienvenida primera vez
  const[tourStep,setTourStep]=useState(()=>{try{return localStorage.getItem("ev_tourDone")?-1:0;}catch{return -1;}});
  const tourSteps=[
    {icon:"👋",titulo:"¡Bienvenido a Ensamble Villarreal!",texto:"Te muestro las 4 pantallas más importantes en 60 segundos. Puedes cerrar en cualquier momento."},
    {icon:"🏠",titulo:"Inicio — tu dashboard",texto:"Aquí ves cuánto debe haber en caja, las obras activas, alertas y los movimientos del periodo. Es tu vista del día a día."},
    {icon:"📝",titulo:"Cotizar y Cotizaciones",texto:"En Cotizar creas un presupuesto nuevo (con catálogo, escribiendo, escaneando o con IA). Las cotizaciones pendientes aparecen en Cotizaciones — desde ahí las autorizas y pasan a Obras."},
    {icon:"🏗 ",titulo:"Obras",texto:"Cada obra autorizada tiene cliente, presupuesto, fases, avance, cobrado vs gastado. Click en una obra para ver detalle: ingresos, egresos, fotos, bitácora."},
    {icon:"💰",titulo:"Finanzas",texto:"Todos tus ingresos, egresos y caja chica. Ahí registras movimientos, ves el desfase, fusionas obras duplicadas y exportas a Excel."},
    {icon:"🔍",titulo:"Tips útiles",texto:"Usa Ctrl+K para buscar cualquier cosa al instante. El botón flotante naranja (+) te deja registrar un egreso rápido. La papelera 🗑 guarda 30 días lo que borres por si te equivocas."}
  ];
  const cerrarTour=()=>{try{localStorage.setItem("ev_tourDone","1");}catch{}setTourStep(-1);};
  // Highlight de fila recién creada (animación verde 3s)
  const[highlightedIds,setHighlightedIds]=useState(new Set());
  const highlightNew=id=>{setHighlightedIds(prev=>{const s=new Set(prev);s.add(id);return s;});setTimeout(()=>{setHighlightedIds(prev=>{const s=new Set(prev);s.delete(id);return s;});},3500);};
  // Auto-ocultar nav inferior al scroll hacia abajo
  const[navVisible,setNavVisible]=useState(true);
  const _lastScroll=useRef(0);
  useEffect(()=>{
    const h=()=>{const y=window.scrollY;const diff=y-_lastScroll.current;if(Math.abs(diff)<10)return;if(diff>0&&y>100)setNavVisible(false);else setNavVisible(true);_lastScroll.current=y;};
    window.addEventListener("scroll",h,{passive:true});
    return ()=>window.removeEventListener("scroll",h);
  },[]);
  // Cmd+K / Ctrl+K para abrir búsqueda global
  useEffect(()=>{
    const h=e=>{if((e.ctrlKey||e.metaKey)&&e.key==="k"){e.preventDefault();setSearchOpen(true);}if(e.key==="Escape")setSearchOpen(false);};
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  },[]);
  const[pendientesCount,setPendientesCount]=useState(()=>_getPendienteCount());
  // Suscribirse a eventos de guardado para mostrar indicador visual
  useEffect(()=>{
    const fn=({status,key,err})=>{
      setPendientesCount(_getPendienteCount());
      if(status==="saving")setSaveStatus({state:"saving",msg:"💾 Guardando..."});
      else if(status==="saved")setSaveStatus({state:"saved",msg:"✓ Guardado"});
      else if(status==="error")setSaveStatus({state:"error",msg:"⚠️ "+(err?String(err).slice(0,40):"Sin guardar — en cola")+" — reintentando",key,err});
      else if(status==="pending")setSaveStatus({state:"error",msg:"⏳ Pendiente — en cola para reintentar"});
    };
    _saveListeners.add(fn);
    return ()=>_saveListeners.delete(fn);
  },[]);
  // Auto-ocultar "Guardado" tras 2s
  useEffect(()=>{if(saveStatus.state==="saved"){const t=setTimeout(()=>setSaveStatus({state:"idle",msg:""}),2500);return ()=>clearTimeout(t);}},[saveStatus.state]);
  // Reintenta pendientes cada 45s si quedan
  useEffect(()=>{const iv=setInterval(()=>{if(_getPendienteCount()>0){DB.reintentarPendientes().then(ok=>{if(ok>0)console.log(ok+" pendientes sincronizados");setPendientesCount(_getPendienteCount());});}},45000);return ()=>clearInterval(iv);},[]);
  // Pre-guardado: no salir si hay pendientes sin sincronizar
  useEffect(()=>{
    const h=(e)=>{if(_getPendienteCount()>0){e.preventDefault();e.returnValue="Tienes "+_getPendienteCount()+" cambios sin sincronizar a la nube. ¿Salir de todas formas?";return e.returnValue;}};
    window.addEventListener("beforeunload",h);
    return ()=>window.removeEventListener("beforeunload",h);
  },[]);
  const[obras,setObrasR]=useState([]);
  const[movs,setMovsR]=useState([]);
  const[caja,setCajaR]=useState([]);
  const[auts,setAutsR]=useState([]);
  const[recibos,setRecR]=useState([]);
  const[inv,setInvR]=useState(INV_INIT);
  const[clis,setClisR]=useState([]);
  const[cont,setContR]=useState([]);
  const[provs,setProvsR]=useState(PROVS_INIT);
  const[users,setUsersR]=useState(USERS_SEED);
  const[catalogo,setCatalogoR]=useState(CATALOGO_INIT);
  const[nominas,setNominasR]=useState([]);
  const[documentos,setDocumentosR]=useState([]);
  const[preciosUnit,setPreciosUnitR]=useState(PRECIOS_INIT);
  const[papelera,setPapeleraR]=useState([]);
  useEffect(()=>{if(CLOUD&&!authed)return;(async()=>{
    if(CLOUD)setSyncStatus("Conectando a la nube...");
    const d={obras:await DB.get('obras',[]),movs:await DB.get('movs',[]),caja:await DB.get('caja',[]),auts:await DB.get('auts',[]),rec:await DB.get('rec',[]),inv:await DB.get('inv',INV_INIT),clis:await DB.get('clis',[]),cont:await DB.get('cont',[]),provs:await DB.get('provs',PROVS_INIT),users:await DB.get('users',USERS_SEED),catalogo:await DB.get('catalogo',CATALOGO_INIT),nominas:await DB.get('nominas',[]),documentos:await DB.get('documentos',[]),preciosUnit:await DB.get('preciosUnit',PRECIOS_INIT),papelera:await DB.get('papelera',[])};
    if(CLOUD)setSyncStatus(_syncOk?"☁️ Nube sincronizada":"⚠️ Usando datos locales");
    // Reintenta pendientes al cargar
    if(CLOUD){DB.reintentarPendientes().then(ok=>{if(ok>0)console.log("✓ "+ok+" pendientes sincronizados al cargar");});}
    // Datos ya viven en Supabase — no se tocan al actualizar el código
    if(!d.nominas||d.nominas.length===0)d.nominas=[{id:"N01",nombre:"Nómina Carpintería",monto:15000,frecuencia:"semanal",tipo:"Nómina"},{id:"N02",nombre:"Renta Carpintería",monto:11000,frecuencia:"mensual",tipo:"Renta"},{id:"N05",nombre:"IMSS",monto:16563,frecuencia:"mensual",tipo:"IMSS"},{id:"N06",nombre:"Luz Carpintería",monto:2500,frecuencia:"mensual",tipo:"Servicios"},{id:"N07",nombre:"Caja Chica Carpintería",monto:5000,frecuencia:"semanal",tipo:"Caja chica"},{id:"N08",nombre:"Francisco — Carpintero",monto:4000,frecuencia:"semanal",tipo:"Nómina"},{id:"N09",nombre:"Erik — Carpintero",monto:4000,frecuencia:"semanal",tipo:"Nómina"},{id:"N10",nombre:"Héctor — Carpintero",monto:3500,frecuencia:"semanal",tipo:"Nómina"},{id:"N11",nombre:"Barnizador",monto:3500,frecuencia:"semanal",tipo:"Nómina"}];

    // Fix duplicate obra IDs
    const seenIds=new Set();d.obras=d.obras.map(o=>{if(seenIds.has(o.id)){return{...o,id:"OB"+Date.now()+Math.random().toString(36).slice(2,6)};}seenIds.add(o.id);return o;});
    // Fix duplicate movs/caja IDs (causaban editar/borrar el registro equivocado)
    const movsDedup=_dedupNumIds(d.movs);d.movs=movsDedup.out;
    const cajaDedup=_dedupNumIds(d.caja);d.caja=cajaDedup.out;
    setObrasR(d.obras);setMovsR(d.movs);setCajaR(d.caja);setAutsR(d.auts);setRecR(d.rec);setInvR(d.inv);setClisR(d.clis);setContR(d.cont);setProvsR(d.provs);setUsersR(d.users);setCatalogoR(d.catalogo);if(d.nominas)setNominasR(d.nominas);if(d.documentos)setDocumentosR(d.documentos);if(d.preciosUnit)setPreciosUnitR(d.preciosUnit);
    if(movsDedup.changed)DB.set('movs',d.movs);
    if(cajaDedup.changed)DB.set('caja',d.caja);
    // Auto-purge papelera >30 días
    const now=Date.now();const pap=(d.papelera||[]).filter(p=>now-(p.ts||0)<30*24*60*60*1000);
    setPapeleraR(pap);
    if(pap.length<(d.papelera||[]).length)DB.set('papelera',pap);
    // Save fixed obras back if duplicates were found
    if(seenIds.size<d.obras.length)DB.set('obras',d.obras);
    setLoading(false);})();},[authed]);
  // Auto-sync cada 30s — compara por HASH (no por longitud) para detectar modificaciones
  const _lastWrite=useRef({});
  const _lastHash=useRef({});
  useEffect(()=>{if(!CLOUD)return;const iv=setInterval(async()=>{try{
    await AUTH.ensureFresh();
    // Reintentar pendientes ANTES de leer (los pendientes son la verdad local)
    await DB.reintentarPendientes();
    const keys=[['obras',setObrasR],['movs',setMovsR],['caja',setCajaR],['rec',setRecR],['users',setUsersR],['nominas',setNominasR],['inv',setInvR],['clis',setClisR],['provs',setProvsR],['catalogo',setCatalogoR],['auts',setAutsR],['documentos',setDocumentosR]];const now=Date.now();const pend=_getPendientes();for(const[k,setter]of keys){
    // Cooldown 60s tras escritura local — protege cambios recientes (incluidos borrados)
    if(_lastWrite.current[k]&&now-_lastWrite.current[k]<60000)continue;
    // Si hay cambios locales EN COLA, no tocar: la cola es la verdad local (evita revivir borrados)
    if(pend[k])continue;
    const r=await fetch(SUPA_URL+'/rest/v1/ev_data?key=eq.'+k+'&select=value,updated_at',{headers:{'apikey':SUPA_KEY,'Authorization':_bearer()}});
    if(!r.ok)continue;
    const j=await r.json();if(!Array.isArray(j)||j.length===0)continue;
    const cloud=j[0].value;
    const cloudTs=j[0].updated_at?Date.parse(j[0].updated_at):0;
    // Para caja comparamos sin el contenido de los tickets (local los guarda recortados)
    const cloudLite=k==='caja'&&Array.isArray(cloud)?cloud.map(c=>c.ticket&&c.ticket.length>500?{...c,ticket:'[nube]'}:c):cloud;
    const local=JSON.parse(localStorage.getItem('ev_'+k)||'[]');
    if(_hash(cloudLite)===_hash(local))continue; // Iguales: nada que hacer
    // Solo BAJAR de la nube si es MÁS RECIENTE que nuestro último cambio local (= otro dispositivo lo cambió).
    // Nunca empujamos desde aquí: wrap() ya sube cada cambio con datos completos, así NUNCA se revive un borrado.
    if(cloudTs>(_lastWrite.current[k]||0)){
      setter(cloud);
      try{localStorage.setItem('ev_'+k,JSON.stringify(cloudLite));}catch{}
      _lastHash.current[k]=_hash(cloudLite);
    }
  }}catch(e){console.warn('Auto-sync error:',e);}},30000);return()=>clearInterval(iv);},[]);
  // Wrap mejorado: hace push robusto y reporta éxito/error
  const wrap=(raw,set,key)=>async v=>{
    const n=typeof v==="function"?v(raw):v;
    set(n);
    _lastWrite.current[key]=Date.now();
    _lastHash.current[key]=_hash(n);
    // Local sync (sin esperar)
    try{const lite=key==='caja'&&Array.isArray(n)?n.map(c=>c.ticket&&c.ticket.length>500?{...c,ticket:'[nube]'}:c):n;localStorage.setItem('ev_'+key,JSON.stringify(lite));}catch{}
    // Cloud push (devuelve Promise pero no bloqueamos)
    if(CLOUD){_notifySave('saving',key);const ok=await DB.push(key,n);if(!ok){_notifySave('error',key);}}
    return n;
  };
  const setObras=wrap(obras,setObrasR,"obras"),setMovs=wrap(movs,setMovsR,"movs"),setCaja=wrap(caja,setCajaR,"caja"),setAuts=wrap(auts,setAutsR,"auts"),setRecibos=wrap(recibos,setRecR,"rec"),setInv=wrap(inv,setInvR,"inv"),setClis=wrap(clis,setClisR,"clis"),setCont=wrap(cont,setContR,"cont"),setProvs=wrap(provs,setProvsR,"provs"),setUsers=wrap(users,setUsersR,"users"),setCatalogo=wrap(catalogo,setCatalogoR,"catalogo"),setNominas=wrap(nominas,setNominasR,"nominas"),setDocumentos=wrap(documentos,setDocumentosR,"documentos"),setPreciosUnit=wrap(preciosUnit,setPreciosUnitR,"preciosUnit"),setPapelera=wrap(papelera,setPapeleraR,"papelera");
  // Helper: enviar registro borrado a papelera (con metadata para restaurar)
  const enviarAPapelera=(tipo,item,descripcion)=>{
    setPapelera(prev=>[...prev,{id:"PAP-"+Date.now()+Math.random().toString(36).slice(2,5),tipo,item,descripcion:descripcion||item.nombre||item.desc||item.concepto||"(sin descripción)",ts:Date.now(),user:user?.nombre||"Sistema"}]);
  };
  // Helper: restaurar de papelera
  const restaurarDePapelera=(papEntry)=>{
    const {tipo,item}=papEntry;
    if(tipo==="obra")setObras(prev=>[...prev,item]);
    else if(tipo==="mov")setMovs(prev=>[...prev,item]);
    else if(tipo==="caja")setCaja(prev=>[...prev,item]);
    else if(tipo==="recibo")setRecibos(prev=>[...prev,item]);
    setPapelera(prev=>prev.filter(p=>p.id!==papEntry.id));
    show("✓ Restaurado a "+tipo);
  };
  const cats=[...new Set(catalogo.map(c=>c.cat))];
  const[toast,setToast]=useState(null);
  const[cliTab,setCliTab]=useState("resumen");
  const[loginUser,setLoginUser]=useState(null);
  const[pinInput,setPinInput]=useState("");
  const[cotP,setCotP]=useState([]);
  const[cotNom,setCotNom]=useState("");
  const[cotEmp,setCotEmp]=useState("");
  const[cotNum,setCotNum]=useState(1);
  const[scanning,setScanning]=useState(false);const[iaInstr,setIaInstr]=useState("");
  const[cotTab,setCotTab]=useState("catalogo");
  const[conIva,setConIva]=useState(true);
  const[editObraId,setEditObraId]=useState(null);
  const[confirmDel,setConfirmDel]=useState(null);
  const[docFilt,setDocFilt]=useState("todo");const[docBusq,setDocBusq]=useState("");const[docVerTodo,setDocVerTodo]=useState(false);const[cliObraTab,setCliObraTab]=useState(null);
  const[chatMsgs,setChatMsgs]=useState([{role:"assistant",content:"¡Hola! Soy el asistente de Ensamble Villarreal. Puedo ayudarte con cotizaciones, consultar datos de obras, calcular materiales, redactar mensajes para clientes y más. ¿En qué te ayudo?"}]);
  const[chatIn,setChatIn]=useState("");const[chatLoading,setChatLoading]=useState(false);
  const chatRef=useRef(null);
  const sendChat=async()=>{if(!chatIn.trim()||chatLoading)return;const msg=chatIn.trim();setChatIn("");const newMsgs=[...chatMsgs,{role:"user",content:msg}];setChatMsgs(newMsgs);setChatLoading(true);try{const key=getApiKey();if(!key)throw new Error("NO_KEY");const ctx="Eres el asistente IA de Ensamble Villarreal, carpintería arquitectónica en Aguascalientes. Datos: "+obras.length+" obras, "+clis.length+" clientes, balance: "+$(tIng-tEgr)+". Responde en español, breve y útil.";const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:1000,system:ctx,messages:newMsgs.map(m=>({role:m.role,content:m.content}))})});const data=await r.json();const reply=data.content?.map(i=>i.text||"").join("")||"Error";setChatMsgs(prev=>[...prev,{role:"assistant",content:reply}]);}catch(e){setChatMsgs(prev=>[...prev,{role:"assistant",content:e.message==="NO_KEY"?"⚠️ Configura tu API Key en Más → 🔑 API Key IA":"Error: "+e.message}]);}setChatLoading(false);setTimeout(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},100);};
  const show=msg=>{setToast(msg);setTimeout(()=>setToast(null),2500);};
  const can=p=>user&&ROLES[user.rol].permisos.includes(p);
  const om=(t,d)=>{setModal(t);setMd(d||null);};
  const cm=()=>{setModal(null);setMd(null);};
  const go=(s,d)=>{if(s==="apikey"){om("apikey");return;}setSec(s);setSub(d||null);setMoreOpen(false);if(s==="finanzas"&&!subTab.match(/^(movs|caja|tablero|recibos|auth)$/))setSubTab("movs");if(s==="taller"&&!subTab.match(/^(inv|provs|catalogo)$/))setSubTab("inv");};
  const tIng=movs.filter(m=>m.ing>0).reduce((s,m)=>s+m.ing,0);
  const tEgr=movs.filter(m=>m.egr>0).reduce((s,m)=>s+m.egr,0);
  const tCaja=caja.filter(c=>c.status!=="rechazado").reduce((s,c)=>s+c.monto,0);
  const cajaPend=caja.filter(c=>c.status==="pendiente").length;
  const tCot=obras.reduce((s,o)=>s+o.cotizado,0);
  const pendA=auts.filter(a=>a.status==="pendiente").length;
  const lowS=inv.filter(i=>i.stock<=i.minimo);
  const oAct=obras.filter(o=>o.fase&&o.fase!=="cotizacion"&&o.fase!=="entregado"&&o.fase!=="cancelado");
  const cotsPend=obras.filter(o=>o.fase==="cotizacion").length;
  const subCot=cotP.reduce((s,p)=>s+p.precio*p.cant,0);
  const totCot=conIva?subCot*1.16:subCot;
  const addCotP=item=>{const ex=cotP.find(p=>p.id===item.id);if(ex)setCotP(cotP.map(p=>p.id===item.id?{...p,cant:p.cant+1}:p));else setCotP([...cotP,{...item,cant:1}]);};
  const genRec=m=>{const id="R-"+String(recibos.length+1).padStart(3,"0");setRecibos(prev=>[...prev,{id,fecha:m.fecha,cliente:m.prov,concepto:m.desc,monto:m.ing,obra:m.obra}]);return id;};
  const saveDoc=(tipo,titulo,cliente,obra,monto,data)=>{const id="D-"+_rid();setDocumentos(prev=>{const updated=prev.map(d=>(d.tipo===tipo&&d.obra===obra&&d.vigente)?{...d,vigente:false}:d);return[...updated,{id,tipo,titulo,cliente:cliente||"",obra:obra||"",monto:monto||0,fecha:td(),hora:new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),user:user?.nombre||"",data,vigente:true,version:(prev.filter(d=>d.tipo===tipo&&d.obra===obra).length)+1}];});return id;};
  const openPdfCot=(o)=>{om("pdfCot",o);try{saveDoc("cotizacion","Cotización "+o.nombre,o.cliente,o.nombre,o.cotizado,{obraId:o.id});}catch{}};
  const openPdfCli=(data)=>{om("pdfCli",data);try{saveDoc("estado_cuenta","Estado de Cuenta "+data.ob.nombre,data.cli.nombre,data.ob.nombre,data.ob.cotizado,{obraId:data.ob.id,cliId:data.cli.id});}catch{}};
  const ensureCli=(nombre)=>{if(!nombre)return;const n=nombre.trim();const nn=normName(n);if(!nn)return;setClis(prev=>{if(prev.some(c=>normName(c.nombre)===nn))return prev;return[...prev,{id:"C"+_rid(),nombre:n,tel:"",email:"",dir:""}];});};
  const scanFile=async(fileOrPages)=>{setScanning(true);try{
    // Si es un objeto multiplePages (PDF convertido a varias imágenes), procesar todas
    let content;
    if(fileOrPages&&fileOrPages.multiplePages){
      const items=[];
      for(const img of fileOrPages.images){
        const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej("err");r.readAsDataURL(img);});
        items.push({type:"image",source:{type:"base64",media_type:"image/jpeg",data:b64}});
      }
      items.push({type:"text",text:'Analiza este conjunto de páginas de cotización de carpintería. Extrae TODOS los conceptos de TODAS las páginas con su precio unitario y cantidad. Responde SOLO JSON array sin markdown: [{"desc":"descripción completa del concepto","precio":12345,"cant":1}]. Si no encuentras nada: []'});
      content=items;
    }else{
      const file=fileOrPages;
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej("err");r.readAsDataURL(file);});
      const isPdf=file.type==="application/pdf";
      content=[isPdf?{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}}:{type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:b64}},{type:"text",text:'Analiza este documento/imagen de cotización de carpintería. Extrae TODOS los conceptos con su precio unitario y cantidad. Responde SOLO JSON array sin markdown: [{"desc":"descripción completa del concepto","precio":12345,"cant":1}]. Si un concepto tiene cantidad mayor a 1, ponla. Si no encuentras nada: []'}];
    }const data=await callAI([{role:"user",content}],2000);const text=data.content?.map(i=>i.text||"").join("")||"[]";const items=JSON.parse(text.replace(/```json|```/g,"").trim());if(Array.isArray(items)&&items.length>0){setCotP(prev=>[...prev,...items.map((it,i)=>({id:"S-"+Date.now()+"-"+i,cat:"Escaneado",desc:it.desc||"Concepto",precio:Number(it.precio)||0,cant:Number(it.cant)||1}))]);show(items.length+" conceptos extraídos");}else show("No se encontraron conceptos en la imagen");}catch(e){if(e.message==="NO_KEY"){show("⚠️ Configura API Key");om("apikey");}else{show("Error: "+e.message.slice(0,80));console.error("scanFile:",e);}}setScanning(false);};
  const scanPlano=async(fileOrPages,instrucciones)=>{setScanning(true);try{
    let content;
    const preciosTabla=preciosUnit.map(p=>"- "+p.cat+" / "+p.desc+": $"+p.precio.toLocaleString()+"/"+p.unidad+(p.notas?" ("+p.notas+")":"")).join("\n");
    const promptText='INSTRUCCIONES DEL USUARIO: '+(instrucciones||"Cotiza todo lo que veas de carpintería")+'\n\nEres el presupuestador de Ensamble Villarreal (carpintería arquitectónica en Aguascalientes). USA EXCLUSIVAMENTE los siguientes precios unitarios del usuario:\n\n'+preciosTabla+'\n\nINSTRUCCIONES CRÍTICAS:\n1. MIDE del plano: metros lineales (ml), metros cuadrados (m²) o piezas (pza) de cada elemento\n2. Identifica QUÉ es: cocina, closet, puerta, mueble de baño, etc.\n3. ELIGE el precio unitario más cercano de la tabla anterior\n4. Multiplica: cantidad × precio_unit = total\n5. Si no estás seguro de la medida, indícalo en la descripción\n\nResponde SOLO JSON array (sin markdown):\n[{"desc":"Cocina integral 4.5ml MDF blanco","cant":4.5,"unidad":"ml","precioUnit":3500,"precio":15750}]\n\n- "precio" es SIEMPRE cant × precioUnit\n- "unidad" debe ser ml, m2 o pza\n- Sin markdown, sin explicación, solo el JSON.';
    if(fileOrPages&&fileOrPages.multiplePages){
      const items=[];
      for(const img of fileOrPages.images){
        const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej("err");r.readAsDataURL(img);});
        items.push({type:"image",source:{type:"base64",media_type:"image/jpeg",data:b64}});
      }
      items.push({type:"text",text:promptText});
      content=items;
    }else{
      const file=fileOrPages;
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej("err");r.readAsDataURL(file);});
      const isPdf=file.type==="application/pdf";
      content=[isPdf?{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}}:{type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:b64}},{type:"text",text:promptText}];
    }
    const data=await callAI([{role:"user",content}],4000);const text=data.content?.map(i=>i.text||"").join("")||"[]";const clean=text.replace(/```json|```/g,"").trim();const items=JSON.parse(clean);if(Array.isArray(items)&&items.length>0){setCotP(prev=>[...prev,...items.map((it,i)=>({id:"IA-"+Date.now()+"-"+i,cat:"IA Experta",desc:it.desc||"Concepto",precio:Number(it.precio)||0,cant:Number(it.cant)||1,unidad:it.unidad||"",precioUnit:Number(it.precioUnit)||0}))]);show("🤖 "+items.length+" partidas generadas por IA");}else show("No se detectaron elementos de carpintería");}catch(e){if(e.message==="NO_KEY"){show("⚠️ Configura API Key");om("apikey");}else{show("Error: "+e.message.slice(0,80));console.error("scanPlano:",e);}}setScanning(false);};
  const[subTab,setSubTab]=useState("");
  const[ff,setFf]=useState("todo");const[fObra,setFObra]=useState("");const[fBusq,setFBusq]=useState("");const[fDesde,setFDesde]=useState("");const[fHasta,setFHasta]=useState("");const[selMovs,setSelMovs]=useState([]);const[delConfText,setDelConfText]=useState("");const[mostrarHerramientas,setMostrarHerramientas]=useState(false);
  // Filtros por columna estilo Excel (Finanzas)
  const [fcConcepto,setFcConcepto]=useState("");
  const [fcProv,setFcProv]=useState("");
  const [fcObraCol,setFcObraCol]=useState("");
  const [fcUser,setFcUser]=useState("");
  // Estados de ordenamiento Excel-like para cada tabla {col,dir} — dir = 1 asc, -1 desc
  const [sortFin,setSortFin]=useState({col:"fecha",dir:-1});
  const [sortCaja,setSortCaja]=useState({col:"fecha",dir:-1});
  const [sortCot,setSortCot]=useState({col:"id",dir:-1});
  const [sortObr,setSortObr]=useState({col:"cotizado",dir:-1});
  // Helper de orden genérico: invierte si misma col, set ascendente si nueva
  const toggleSort=(setter,current,col)=>setter({col,dir:current.col===col?-current.dir:1});
  // Helper para comparar valores cualquiera (strings, numbers, dates, undefined)
  const cmpVal=(a,b,dir)=>{
    if(a==null&&b==null)return 0;if(a==null)return 1;if(b==null)return -1;
    if(typeof a==="number"&&typeof b==="number")return (a-b)*dir;
    return String(a).localeCompare(String(b),"es")*dir;
  };
  // Component visual: header clickeable con flecha asc/desc
  const SortTh=({col,label,sort,setSort,style})=>{
    const active=sort.col===col;
    return <th onClick={()=>toggleSort(setSort,sort,col)} style={{cursor:"pointer",userSelect:"none",...style}} title={"Ordenar por "+label}>
      <span style={{display:"inline-flex",alignItems:"center",gap:3}}>
        {label}
        <span style={{fontSize:9,color:active?T.gold:T.dim,marginLeft:2}}>{active?(sort.dir>0?"▲":"▼"):"⇅"}</span>
      </span>
    </th>;
  };
  // === Dashboard state ===
  const[dashPer,setDashPer]=useState("year");
  const[alertasOpen,setAlertasOpen]=useState(true);
  // Auto-limpiar selección cuando cambian filtros (evita selecciones fantasma)
  useEffect(()=>{setSelMovs([]);},[ff,fObra,fBusq,fDesde,fHasta]);

  // ═══ FINANZAS COMPUTED ═══
  const finAll=(()=>{const a=[];movs.forEach(m=>a.push({t:m.ing>0?"ing":"egr",fecha:m.fecha,desc:m.desc,prov:m.prov||"",obra:m.obra||"",monto:m.ing>0?m.ing:m.egr,user:m.user||"",cat:m.cat||"",id:"m"+m.id,status:"aprobado",rec:m.recibo}));caja.forEach(c=>a.push({t:"caja",fecha:c.fecha,desc:c.concepto,prov:"",obra:c.obra||"",monto:c.monto,user:c.resp||"",cat:"Caja Chica",id:"c"+c.id,status:c.status||"aprobado",ticket:c.ticket,cajaId:c.id}));a.sort((x,y)=>y.fecha>x.fecha?1:y.fecha<x.fecha?-1:0);return a;})();
  const finFilt=finAll.filter(m=>{
    const mF=fixDateGlobal(m.fecha);
    if(fDesde&&mF&&mF<fDesde)return false;
    if(fHasta&&mF&&mF>fHasta)return false;
    if(ff==="ing"&&m.t!=="ing")return false;
    if(ff==="egr"&&m.t!=="egr")return false; // FIX: solo egresos puros, no caja chica
    if(ff==="caja"&&m.t!=="caja")return false;
    if(ff==="nom"&&!["Nómina","Renta","IMSS","Destajo"].includes(m.cat))return false;
    if(ff==="rec"&&!m.rec)return false;
    if(fObra){if(normSearch(m.obra)!==normSearch(fObra))return false;} // FIX: ignora acentos/mayúsculas
    // Filtros por columna (estilo Excel)
    if(fcConcepto&&!normSearch(m.desc).includes(normSearch(fcConcepto)))return false;
    if(fcProv&&!normSearch(m.prov).includes(normSearch(fcProv)))return false;
    if(fcObraCol&&!normSearch(m.obra).includes(normSearch(fcObraCol)))return false;
    if(fcUser&&!normSearch(m.user).includes(normSearch(fcUser)))return false;
    if(fBusq){
      const q=normSearch(fBusq);
      if(!normSearch(m.desc).includes(q)
        &&!normSearch(m.prov).includes(q)
        &&!normSearch(m.obra).includes(q)
        &&!normSearch(m.cat).includes(q)
        &&!normSearch(m.user).includes(q))return false; // FIX: incluye user y normaliza
    }
    return true;
  });
  const finIng=finFilt.filter(m=>m.t==="ing").reduce((s,m)=>s+m.monto,0);
  const finEgr=finFilt.filter(m=>m.t!=="ing").reduce((s,m)=>s+m.monto,0);
  // FIX: dedupe obras normalizadas (evita duplicados por mayúsculas/acentos)
  // Obras encontradas en movimientos + caja chica (dedupe por nombre normalizado)
  // Marca con isFantasma=true si NO existe en obras[] (obra eliminada pero con movs colgados)
  const finObras=(()=>{
    const map=new Map();
    const obrasNorm=new Set(obras.map(o=>normSearch(o.nombre)));
    finAll.forEach(m=>{if(m.obra){const k=normSearch(m.obra);if(!map.has(k))map.set(k,{nombre:m.obra,key:k,isFantasma:!obrasNorm.has(k)});}});
    return [...map.values()].sort((a,b)=>{
      // Activas primero, fantasmas después
      if(a.isFantasma!==b.isFantasma)return a.isFantasma?1:-1;
      return a.nombre.localeCompare(b.nombre);
    });
  })();
  const finFantasmas=finObras.filter(o=>o.isFantasma);
  const allNav=[];
  if(can("dash"))allNav.push({key:"dash",icon:"🏠",label:"Inicio",grp:"neg"});
  // Nota: "Cotizar" se accede ahora desde el botón "+ Nueva" en Cotizaciones
  if(can("cot")||can("obras")||can("obras_ver"))allNav.push({key:"cotizaciones",icon:"📋",label:"Cotizaciones",grp:"neg"});
  if(can("obras")||can("obras_ver"))allNav.push({key:"obras",icon:"🏗️",label:"Obras",grp:"neg"});
  if(can("money")||can("caja")||can("recibos")||can("anal"))allNav.push({key:"finanzas",icon:"💰",label:"Finanzas",grp:"fin"});
  if(can("caja"))allNav.push({key:"cajachica",icon:"🧾",label:"Caja Chica",grp:"fin"});
  allNav.push({key:"nominas",icon:"📅",label:"Nóminas",grp:"fin"});
  if(can("inv")||can("provs"))allNav.push({key:"taller",icon:"🔨",label:"Taller",grp:"tal"});
  if(can("clis"))allNav.push({key:"clis",icon:"👤",label:"Clientes",grp:"neg"});
  if(can("auth"))allNav.push({key:"auth_sec",icon:"✅",label:"Autorizar",grp:"sys"});
  allNav.push({key:"docs_sec",icon:"📁",label:"Documentos",grp:"sys"});
  allNav.push({key:"apikey",icon:"🔑",label:"API Key IA",grp:"sys"});
  if(can("usuarios"))allNav.push({key:"usuarios",icon:"👥",label:"Usuarios",grp:"sys"});
  allNav.push({key:"auditoria",icon:"🔬",label:"Auditoría",grp:"sys"});
  allNav.push({key:"papelera",icon:"🗑",label:"Papelera"+(papelera.length>0?" ("+papelera.length+")":""),grp:"sys"});
  const NAV_GRPS=[{id:"neg",label:"NEGOCIO"},{id:"fin",label:"FINANZAS"},{id:"tal",label:"TALLER"},{id:"sys",label:"SISTEMA"}];
  const mobT=allNav.slice(0,4);if(allNav.length>4)mobT.push({key:"_more",icon:"☰",label:"Más"});

  // ═══ PUERTA DE ACCESO ═══ (login real de nube antes de cualquier dato)
  if(CLOUD&&!authed)return <LoginGate onAuthed={()=>setAuthed(true)}/>;

  // ═══ LOADING ═══
  if(loading)return <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{textAlign:"center"}}><BrandFull size="big" sub="Carpintería Arquitectónica"/><div style={{marginTop:20,fontSize:13,color:T.muted}}>{syncStatus||"Cargando..."}</div><div style={{width:40,height:4,background:"#222",borderRadius:2,margin:"12px auto",overflow:"hidden"}}><div style={{width:"60%",height:"100%",background:T.gold,borderRadius:2,animation:"load 1s infinite alternate"}}></div></div></div></div>;

  // ═══ LOGIN ═══
  if(!user){
    // PIN entry screen
    if(loginUser)return <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{width:"100%",maxWidth:340,textAlign:"center"}}>
        <div style={{width:64,height:64,borderRadius:20,background:ROLES[loginUser.rol].color+"22",color:ROLES[loginUser.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:22,margin:"0 auto 12px"}}>{loginUser.avatar}</div>
        <div style={{fontSize:18,fontWeight:800,marginBottom:4}}>{loginUser.nombre}</div>
        <div style={{fontSize:11,color:ROLES[loginUser.rol].color,marginBottom:20}}>{ROLES[loginUser.rol].icon} {ROLES[loginUser.rol].nombre}</div>
        <div style={{fontSize:12,color:T.muted,marginBottom:12}}>Ingresa tu PIN</div>
        <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:8}}>{[0,1,2,3].map(i=><div key={i} style={{width:44,height:52,borderRadius:12,border:"2px solid "+(pinInput.length>i?T.gold:T.border),background:pinInput.length>i?"rgba(201,149,107,.08)":"rgba(255,255,255,.03)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:800,color:T.gold}}>{pinInput[i]?"●":""}</div>)}</div>
        <input type="number" autoFocus value={pinInput} onChange={e=>{const v=e.target.value.slice(0,4);setPinInput(v);if(v.length===4){if(!loginUser.pin||loginUser.pin===v){setUser(loginUser);setSec(loginUser.rol==="cliente"?"portal":ROLES[loginUser.rol].permisos[0]);if(loginUser.rol==="cliente")setCliTab("resumen");setLoginUser(null);setPinInput("");}else{setPinInput("");show("PIN incorrecto");}}}} style={{position:"absolute",opacity:0,width:1,height:1}} inputMode="numeric" pattern="[0-9]*"/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,maxWidth:240,margin:"16px auto 0"}}>{[1,2,3,4,5,6,7,8,9,"",0,"←"].map((n,i)=><button key={i} onClick={()=>{if(n==="←")setPinInput(prev=>prev.slice(0,-1));else if(n!==""&&pinInput.length<4){const nv=pinInput+n;setPinInput(nv);if(nv.length===4){if(!loginUser.pin||loginUser.pin===nv){setUser(loginUser);setSec(loginUser.rol==="cliente"?"portal":ROLES[loginUser.rol].permisos[0]);if(loginUser.rol==="cliente")setCliTab("resumen");setLoginUser(null);setPinInput("");}else{setPinInput("");show("PIN incorrecto");}}}}} style={{padding:"14px 0",borderRadius:12,border:"1px solid "+T.border,background:n===""?"transparent":"rgba(255,255,255,.04)",color:n==="←"?T.red:T.text,fontWeight:700,fontSize:n==="←"?16:20,cursor:n===""?"default":"pointer",visibility:n===""?"hidden":"visible"}}>{n}</button>)}</div>
        <button onClick={()=>{setLoginUser(null);setPinInput("");}} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",marginTop:16,fontSize:12}}>← Regresar</button>
        {toast&&<div style={{position:"fixed",top:40,left:"50%",transform:"translateX(-50%)",background:"#3a1a1a",color:T.red,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:700,zIndex:2000}}>{toast}</div>}
      </div></div>;

    // User list
    return <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:D?500:420}}>
      <div style={{textAlign:"center",marginBottom:28,display:"flex",flexDirection:"column",alignItems:"center"}}><BrandFull size="big" sub="Carpintería Arquitectónica"/><div style={{fontSize:9,color:T.dim,marginTop:8,fontStyle:"italic"}}>— Donde la madera encuentra su forma —</div>{CLOUD&&<div style={{marginTop:6,fontSize:10,color:_syncOk?T.green:T.yellow}}>{_syncOk?"☁️ Nube sincronizada":"⏳ Verificando nube..."}</div>}{CLOUD&&AUTH.isAuthed()&&<div style={{marginTop:8}}><button onClick={()=>{AUTH.signOut();setUser(null);setAuthed(false);}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",fontSize:10,textDecoration:"underline"}}>Cerrar sesión de nube ({AUTH.email()})</button></div>}</div>
      {users.filter(u=>u.rol!=="cliente").length>0&&<div><div style={{fontSize:11,color:T.gold,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Equipo</div>
      <div style={{display:"grid",gridTemplateColumns:G,gap:6}}>{users.filter(u=>u.rol!=="cliente").map(u=> <button key={u.id} onClick={()=>{if(u.pin){setLoginUser(u);setPinInput("");}else{setUser(u);setSec(ROLES[u.rol].permisos[0]);}}} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.06)",backdropFilter:"blur(4px)",borderRadius:10,cursor:"pointer",textAlign:"left"}}><div style={{width:40,height:40,borderRadius:20,background:ROLES[u.rol].color+"22",color:ROLES[u.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13}}>{u.avatar}</div><div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:T.text}}>{u.nombre}</div><div style={{fontSize:10,color:T.muted}}>{ROLES[u.rol].icon} {ROLES[u.rol].nombre}</div></div>{u.pin&&<span style={{color:T.dim,fontSize:14}}>🔒</span>}</button>)}</div></div>}
      {users.filter(u=>u.rol==="cliente").length>0&&<div><div style={{fontSize:11,color:T.teal,fontWeight:700,textTransform:"uppercase",marginBottom:8,marginTop:18,paddingTop:14,borderTop:"1px solid "+T.border}}>Portal Clientes</div>
      {users.filter(u=>u.rol==="cliente").map(u=> <button key={u.id} onClick={()=>{if(u.pin){setLoginUser(u);setPinInput("");}else{setUser(u);setSec("portal");setCliTab("resumen");}}} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:"#0a1a1a",border:"1px solid #1a3a3a",borderRadius:10,cursor:"pointer",textAlign:"left",marginBottom:6}}><div style={{width:40,height:40,borderRadius:20,background:T.teal+"22",color:T.teal,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13}}>{u.avatar}</div><div><div style={{fontWeight:700,color:T.text}}>{u.nombre}</div><div style={{fontSize:10,color:T.teal}}>{obras.find(o=>o.id===u.proyectoId)?.nombre||"Sin proyecto"}</div></div>{u.pin&&<span style={{color:T.dim,fontSize:14}}>🔒</span>}</button>)}</div>}
    </div></div>;
  }

  const role=ROLES[user.rol];

  // ═══ CLIENT PORTAL ═══
  if(user.rol==="cliente"){
    const ob=obras.find(o=>o.id===user.proyectoId);
    if(!ob)return <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:"#090f0d",color:T.text,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{textAlign:"center"}}><div style={{fontSize:40}}>🏗️</div><div style={{fontWeight:700,margin:"10px 0"}}>Sin proyecto asignado</div><button onClick={()=>setUser(null)} style={{...sB,maxWidth:200}}>Regresar</button></div></div>;
    const exts=ob.extras||[];const pags=ob.pagos||[];const docs=ob.docs||[];const bita=ob.bitacora||[];
    const tExt=exts.filter(e=>e.status==="aprobado").reduce((s,e)=>s+e.monto,0);const tP=ob.cotizado+tExt;
    const tPag=movs.filter(m=>m.ing>0&&sameObra(m.obra,ob.nombre)).reduce((s,m)=>s+m.ing,0);const resta=tP-tPag;
    const a1=Math.round(ob.cotizado*.6);const a2=Math.round(ob.cotizado*.2);const a3=Math.round(ob.cotizado*.2);
    const etapa=tPag<a1?"Anticipo 60%":tPag<a1+a2?"Avance 20%":"Entrega 20%";
    const sigPago=tPag<a1?a1-tPag:tPag<a1+a2?a1+a2-tPag:tP-tPag;
    const pagHist=movs.filter(m=>m.ing>0&&sameObra(m.obra,ob.nombre)).sort((a,b)=>a.fecha>b.fecha?1:-1);
    return <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:"#090f0d",color:T.text,minHeight:"100vh",fontSize:13,maxWidth:900,margin:"0 auto"}}>
      <div style={{padding:"12px 16px",background:"#0f1a18",borderBottom:"1px solid #1a2e2a",display:"flex",justifyContent:"space-between",alignItems:"center"}}><BrandFull size="small" color={T.teal}/><div onClick={()=>setUser(null)} style={{cursor:"pointer",width:28,height:28,borderRadius:14,background:T.teal+"22",color:T.teal,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800}}>{user.avatar}</div></div>
      <div style={{padding:"14px 16px",background:"#0f1a18"}}><div style={{fontSize:20,fontWeight:800}}>{ob.nombre}</div><div style={{fontSize:12,color:T.muted,marginTop:4}}>{ob.cliente}</div><div style={{marginTop:8}}><Bar v={ob.avance} mx={100} c={T.teal} h={6}/><div style={{fontSize:10,color:T.muted,textAlign:"right"}}>{ob.avance}%</div></div></div>
      <div style={{padding:"8px 12px 80px"}}>
        {cliTab==="resumen"&&<div>
          <Card><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Stat label="Presupuesto" value={$(ob.cotizado)} color={T.gold}/>
            <Stat label="Pagado" value={$(tPag)} color={T.green}/>
            <Stat label="Resta" value={$(resta)} color={resta>0?T.yellow:T.green}/>
            <Stat label="Extras" value={$(tExt)} color={T.orange}/>
          </div><div style={{marginTop:10}}><Bar v={tPag} mx={tP} c={T.teal}/><div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginTop:4}}><span style={{color:T.muted}}>{pc(tPag,tP)}% pagado</span><span style={{color:T.teal,fontWeight:700}}>Resta: {$(resta)}</span></div></div></Card>
          <Card><div style={{fontSize:10,color:T.teal,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Condiciones de Pago</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              <div style={{textAlign:"center",padding:10,borderRadius:10,background:tPag>=a1?"rgba(76,175,80,.08)":"rgba(255,215,84,.06)",border:"1px solid "+(tPag>=a1?"rgba(76,175,80,.2)":"rgba(255,215,84,.15)")}}><div style={{fontSize:9,color:T.muted}}>ANTICIPO</div><div style={{fontSize:20,fontWeight:800,color:tPag>=a1?T.green:T.yellow}}>60%</div><div style={{fontSize:13,fontWeight:700}}>{$(a1)}</div><div style={{fontSize:9,color:tPag>=a1?T.green:T.muted,marginTop:2}}>{tPag>=a1?"✓ Pagado":"Pendiente"}</div></div>
              <div style={{textAlign:"center",padding:10,borderRadius:10,background:tPag>=a1+a2?"rgba(76,175,80,.08)":"rgba(255,255,255,.02)",border:"1px solid "+(tPag>=a1+a2?"rgba(76,175,80,.2)":T.border)}}><div style={{fontSize:9,color:T.muted}}>AVANCE</div><div style={{fontSize:20,fontWeight:800,color:tPag>=a1+a2?T.green:T.muted}}>20%</div><div style={{fontSize:13,fontWeight:700}}>{$(a2)}</div><div style={{fontSize:9,color:tPag>=a1+a2?T.green:T.muted,marginTop:2}}>{tPag>=a1+a2?"✓ Pagado":"Pendiente"}</div></div>
              <div style={{textAlign:"center",padding:10,borderRadius:10,background:tPag>=tP?"rgba(76,175,80,.08)":"rgba(255,255,255,.02)",border:"1px solid "+(tPag>=tP?"rgba(76,175,80,.2)":T.border)}}><div style={{fontSize:9,color:T.muted}}>ENTREGA</div><div style={{fontSize:20,fontWeight:800,color:tPag>=tP?T.green:T.muted}}>20%</div><div style={{fontSize:13,fontWeight:700}}>{$(a3)}</div><div style={{fontSize:9,color:tPag>=tP?T.green:T.muted,marginTop:2}}>{tPag>=tP?"✓ Pagado":"Pendiente"}</div></div>
            </div>
            {sigPago>0&&<div style={{marginTop:10,padding:12,background:"rgba(201,149,107,.06)",borderRadius:10,border:"1px solid rgba(201,149,107,.15)",textAlign:"center"}}><div style={{fontSize:10,color:T.muted}}>Próximo pago: {etapa}</div><div style={{fontSize:24,fontWeight:800,color:T.gold}}>{$(sigPago)}</div></div>}
          </Card>
          <Card><div style={{fontSize:10,color:T.teal,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Fechas del Proyecto</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><div style={{fontSize:9,color:T.muted}}>INICIO</div><div style={{fontWeight:700,fontSize:14}}>{ob.inicio?fd(ob.inicio):"Por definir"}</div></div>
              <div><div style={{fontSize:9,color:T.muted}}>ENTREGA ESTIMADA</div><div style={{fontWeight:700,fontSize:14}}>{ob.entrega?fd(ob.entrega):"Por definir"}</div></div>
            </div>
          </Card>
          {bita.length>0&&<Card><div style={{fontSize:10,color:T.teal,fontWeight:700,marginBottom:8}}>📋 Notas Recientes</div>{bita.slice(-5).reverse().map(b=> <div key={b.id} style={{padding:"6px 0",borderBottom:"1px solid #0a1a18",fontSize:12}}><div style={{fontWeight:600}}>{b.nota}</div><div style={{fontSize:10,color:T.muted}}>{fd(b.fecha)}</div></div>)}</Card>}
        </div>}
        {cliTab==="pagos"&&<div>
          <Card><div style={{fontSize:10,color:T.teal,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Historial de Pagos</div>
            {pagHist.length>0?pagHist.map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #0a1a18"}}><div><div style={{fontWeight:700}}>{p.desc}</div><div style={{fontSize:10,color:T.muted}}>{fd(p.fecha)}</div></div><div style={{fontWeight:800,color:T.green,fontSize:16}}>{$(p.ing)}</div></div>):<div style={{textAlign:"center",padding:20,color:T.muted}}>Sin pagos registrados</div>}
            {pagHist.length>0&&<div style={{display:"flex",justifyContent:"space-between",paddingTop:10,marginTop:6,borderTop:"2px solid #1a2e2a",fontWeight:800}}><span>Total Pagado</span><span style={{color:T.green,fontSize:16}}>{$(tPag)}</span></div>}
          </Card>
        </div>}
        {cliTab==="extras"&&<div>{exts.map(e=> <Card key={e.id}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:700}}>{e.desc}</span><Badge s={e.status}/></div><div style={{display:"flex",justifyContent:"space-between",marginTop:4}}><span style={{fontSize:11,color:T.muted}}>{fd(e.fecha)}</span><span style={{fontWeight:800,color:T.orange}}>{$(e.monto)}</span></div></Card>)}<button style={{...sB,maxWidth:300,background:T.orange+"22",color:T.orange}} onClick={()=>om("solEx")}>Solicitar Extra</button></div>}
      </div>
      {modal==="recC"&&md&&<ModalW title="Recibo" onClose={cm}><ReciboView data={md}/></ModalW>}
      {modal==="solEx"&&<ModalW title="Extra" onClose={cm}><ExtraForm onSave={e=>{const up={...ob,extras:[...(ob.extras||[]),{...e,id:(ob.extras?.length||0)+1,status:"pendiente",fecha:td()}]};setObras(obras.map(o=>o.id===ob.id?up:o));cm();show("Enviado");}}/></ModalW>}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:300,background:"#0f1a18",borderTop:"1px solid #1a2e2a",display:"flex",justifyContent:"center"}}><div style={{display:"flex",maxWidth:900,width:"100%"}}>{[{k:"resumen",i:"📊",l:"Resumen"},{k:"pagos",i:"💰",l:"Pagos"},{k:"extras",i:"➕",l:"Extras"}].map(t=> <button key={t.k} onClick={()=>setCliTab(t.k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:cliTab===t.k?T.teal:T.dim}}><span style={{fontSize:18}}>{t.i}</span><span style={{fontSize:8,fontWeight:600}}>{t.l}</span></button>)}<button onClick={()=>setUser(null)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:T.red}}><span style={{fontSize:18}}>🚪</span><span style={{fontSize:8,fontWeight:600}}>Salir</span></button></div></div>
      {toast&&<div style={{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"#1a3a2a",color:T.green,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:700,zIndex:2000}}>{toast}</div>}
    </div>;
  }


  // ═══ MAIN CONTENT ═══
  const content= <div style={{padding:D?"16px 24px":"6px 12px 80px",flex:1,overflowY:"auto"}}>
    {sec==="dash"&&(()=>{
      // ═══ CÁLCULOS DASHBOARD ═══
      const totCob=movs.filter(m=>m.ing>0).reduce((s,m)=>s+m.ing,0);
      const totEgrM=movs.filter(m=>m.egr>0).reduce((s,m)=>s+m.egr,0);
      const totCajaC=caja.filter(c=>c.status!=="rechazado").reduce((s,c)=>s+c.monto,0);
      const totGas=totEgrM+totCajaC;
      const cajaEsperada=totCob-totGas;
      const porCobrar=tCot-totCob;
      const margenGlobal=tCot-totGas;
      // Periodo filter helper
      const inPeriod=fStr=>{if(dashPer==="all")return true;if(!fStr)return false;const f=fixDateGlobal(fStr);if(!f)return false;const d=new Date(f+"T12:00:00");if(isNaN(d))return false;const now=new Date();if(dashPer==="month")return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();if(dashPer==="quarter")return d.getFullYear()===now.getFullYear()&&Math.floor(d.getMonth()/3)===Math.floor(now.getMonth()/3);if(dashPer==="year")return d.getFullYear()===now.getFullYear();return true;};
      const cobPer=movs.filter(m=>m.ing>0&&inPeriod(m.fecha)).reduce((s,m)=>s+m.ing,0);
      const egrPer=movs.filter(m=>m.egr>0&&inPeriod(m.fecha)).reduce((s,m)=>s+m.egr,0);
      const cajaPer=caja.filter(c=>c.status!=="rechazado"&&inPeriod(c.fecha)).reduce((s,c)=>s+c.monto,0);
      const gasPer=egrPer+cajaPer;
      const utilPer=cobPer-gasPer;
      // Mensual últimos 12 meses
      const lastMonths=(()=>{const arr=[];const now=new Date();for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");arr.push({key,label:d.toLocaleDateString("es-MX",{month:"short"}).replace(".","").toUpperCase().slice(0,3),y:d.getFullYear(),m:d.getMonth()});}return arr;})();
      const monthly=lastMonths.map(mm=>{
        const ing=movs.filter(x=>x.ing>0&&(x.fecha||"").startsWith(mm.key)).reduce((s,x)=>s+x.ing,0);
        const eg=movs.filter(x=>x.egr>0&&(x.fecha||"").startsWith(mm.key)).reduce((s,x)=>s+x.egr,0);
        const cj=caja.filter(x=>x.status!=="rechazado"&&(x.fecha||"").startsWith(mm.key)).reduce((s,x)=>s+x.monto,0);
        return {...mm,ing,egr:eg+cj,bal:ing-eg-cj};
      });
      const sparkBal=monthly.map(m=>m.bal);
      const sparkIng=monthly.map(m=>m.ing);
      const sparkEgr=monthly.map(m=>m.egr);
      const sparkUtil=monthly.map(m=>m.ing-m.egr);
      // Categorías de gasto
      const catMap={};
      movs.forEach(m=>{if(m.egr>0){const c=m.cat||"Sin categoría";catMap[c]=(catMap[c]||0)+m.egr;}});
      if(totCajaC>0)catMap["Caja Chica"]=(catMap["Caja Chica"]||0)+totCajaC;
      const catColors=[T.gold,T.green,T.red,T.blue,T.purple,T.orange,T.teal,T.yellow,"#9c27b0","#00bcd4"];
      const catData=Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label,value],i)=>({label,value,color:catColors[i%catColors.length]}));
      const totCat=catData.reduce((s,c)=>s+c.value,0)||1;
      // Obras enriquecidas
      const obrasRich=oAct.map(o=>{
        const cob=movs.filter(m=>m.ing>0&&sameObra(m.obra,o.nombre)).reduce((s,m)=>s+m.ing,0);
        const gas=movs.filter(m=>m.egr>0&&sameObra(m.obra,o.nombre)).reduce((s,m)=>s+m.egr,0)+caja.filter(c=>sameObra(c.obra,o.nombre)&&c.status!=="rechazado").reduce((s,c)=>s+c.monto,0);
        const margen=o.cotizado-gas;
        const margenPct=o.cotizado?(margen/o.cotizado)*100:0;
        const sem=margenPct<5?"#ef5350":margenPct<20?"#FFD54F":"#4CAF50";
        const venc=o.entrega&&fixDateGlobal(o.entrega)<td();
        return {...o,cob,gas,margen,margenPct,sem,venc};
      }).sort((a,b)=>b.cotizado-a.cotizado);
      // Rankings
      const topMonto=[...obrasRich].sort((a,b)=>b.cotizado-a.cotizado).slice(0,5);
      const topMargen=[...obrasRich].sort((a,b)=>b.margenPct-a.margenPct).slice(0,5);
      const topAvance=[...obrasRich].sort((a,b)=>(b.avance||0)-(a.avance||0)).slice(0,5);
      // Alertas
      const alertas=[];
      if(pendA>0)alertas.push({c:T.yellow,i:"🔔",t:pendA+" autorización(es) pendiente(s)",act:()=>{go("finanzas");setSubTab("auth");}});
      if(cajaPend>0)alertas.push({c:T.orange,i:"🧾",t:cajaPend+" tickets de caja chica por aprobar",act:()=>go("cajachica")});
      obrasRich.forEach(o=>{
        if(o.margen<0)alertas.push({c:T.red,i:"⚠️",t:o.nombre+": margen NEGATIVO ("+$(o.margen)+")",act:()=>go("obras",o)});
        if(o.venc)alertas.push({c:T.red,i:"📅",t:o.nombre+": entrega vencida ("+fd(o.entrega)+")",act:()=>go("obras",o)});
        if(o.cotizado>0&&o.gas/o.cotizado>0.5&&o.cob/o.cotizado<0.3)alertas.push({c:T.orange,i:"💸",t:o.nombre+": gastado "+pc(o.gas,o.cotizado)+"% pero cobrado solo "+pc(o.cob,o.cotizado)+"%",act:()=>go("obras",o)});
      });
      if(lowS.length>0)alertas.push({c:T.orange,i:"📦",t:lowS.length+" material(es) bajos de stock",act:()=>go("taller")});
      const periodos=[{k:"month",l:"Mes"},{k:"quarter",l:"Trim"},{k:"year",l:"Año"},{k:"all",l:"Todo"}];
      const periodLabel=periodos.find(p=>p.k===dashPer)?.l||"Año";
      return <div>
        {/* HEADER + PERIOD */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:D?22:18,fontWeight:800}}>Hola, {(user.nombre||"").split(" ")[0]} <span style={{color:T.muted,fontWeight:400,fontSize:D?16:13}}>·</span> <span style={{color:T.gold}}>buen día 👋</span></div>
            <div style={{fontSize:11,color:T.muted,marginTop:2}}>{new Date().toLocaleDateString("es-MX",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}</div>
          </div>
          <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.03)",padding:4,borderRadius:10,border:"1px solid "+T.border}}>
            {periodos.map(p=><button key={p.k} onClick={()=>setDashPer(p.k)} style={{padding:"6px 14px",borderRadius:7,border:"none",background:dashPer===p.k?T.gold:"transparent",color:dashPer===p.k?"#0b0b0b":T.muted,fontWeight:700,fontSize:11,cursor:"pointer"}}>{p.l}</button>)}
          </div>
        </div>
        {/* HERO KPI: CAJA ESPERADA */}
        <Card style={{background:"linear-gradient(135deg,rgba(201,149,107,.10),rgba(201,149,107,.02))",border:"1px solid rgba(201,149,107,.25)",padding:D?18:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 220px"}}>
              <div style={{fontSize:10,color:T.gold,fontWeight:700,letterSpacing:1.4,textTransform:"uppercase",marginBottom:4}}>💰 Cuánto debe haber en caja</div>
              <div style={{fontSize:D?34:26,fontWeight:800,color:cajaEsperada>=0?T.gold:T.red,lineHeight:1.1}}>{$(cajaEsperada)}</div>
              <div style={{fontSize:10,color:T.muted,marginTop:4}}>Cobrado <span style={{color:T.green,fontWeight:700}}>{$(totCob)}</span> − Gastado <span style={{color:T.red,fontWeight:700}}>{$(totGas)}</span></div>
            </div>
            <div style={{flex:"0 0 auto"}}>
              <Sparkline data={sparkBal} color={T.gold} width={D?180:130} height={48}/>
              <div style={{fontSize:9,color:T.muted,textAlign:"right",marginTop:2}}>Balance · 12 meses</div>
            </div>
          </div>
        </Card>
        {/* KPIs DEL PERIODO */}
        <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr":"1fr 1fr 1fr",gap:8,marginBottom:8}}>
          <Card style={{padding:12}}>
            <div style={{fontSize:8,color:T.muted,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Cobrado · {periodLabel}</div>
            <div style={{fontSize:D?20:16,fontWeight:800,color:T.green,marginTop:2}}>{$(cobPer)}</div>
            <div style={{marginTop:6}}><Sparkline data={sparkIng} color={T.green} width={D?180:120} height={28}/></div>
          </Card>
          <Card style={{padding:12}}>
            <div style={{fontSize:8,color:T.muted,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Gastado · {periodLabel}</div>
            <div style={{fontSize:D?20:16,fontWeight:800,color:T.red,marginTop:2}}>{$(gasPer)}</div>
            <div style={{marginTop:6}}><Sparkline data={sparkEgr} color="#e91e63" width={D?180:120} height={28}/></div>
          </Card>
          <Card style={{padding:12}}>
            <div style={{fontSize:8,color:T.muted,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Utilidad · {periodLabel}</div>
            <div style={{fontSize:D?20:16,fontWeight:800,color:utilPer>=0?T.blue:T.red,marginTop:2}}>{$(utilPer)}</div>
            <div style={{marginTop:6}}><Sparkline data={sparkUtil} color={T.blue} width={D?180:120} height={28}/></div>
          </Card>
        </div>
        {/* QUICK STATS */}
        <Card style={{padding:D?14:10}}>
          <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr 1fr":"1fr 1fr",gap:D?14:10}}>
            <div onClick={()=>go("cotizaciones")} style={{cursor:"pointer"}}><div style={{fontSize:9,color:T.muted,textTransform:"uppercase",fontWeight:700}}>Cotizaciones pend.</div><div style={{fontSize:18,fontWeight:800,color:cotsPend>0?T.yellow:T.muted}}>{cotsPend}</div></div>
            <div onClick={()=>go("obras")} style={{cursor:"pointer"}}><div style={{fontSize:9,color:T.muted,textTransform:"uppercase",fontWeight:700}}>Obras activas</div><div style={{fontSize:18,fontWeight:800,color:T.green}}>{oAct.length}</div></div>
            <div><div style={{fontSize:9,color:T.muted,textTransform:"uppercase",fontWeight:700}}>Cotizado total</div><div style={{fontSize:18,fontWeight:800,color:T.gold}}>{$(tCot)}</div></div>
            <div><div style={{fontSize:9,color:T.muted,textTransform:"uppercase",fontWeight:700}}>Por cobrar</div><div style={{fontSize:18,fontWeight:800,color:porCobrar>0?T.yellow:T.green}}>{$(porCobrar)}</div></div>
          </div>
        </Card>
        {/* ALERTAS */}
        {alertas.length>0&&<Card style={{borderColor:"rgba(255,213,79,.25)",background:"rgba(255,213,79,.04)"}}>
          <div onClick={()=>setAlertasOpen(!alertasOpen)} style={{display:"flex",justifyContent:"space-between",cursor:"pointer",alignItems:"center"}}>
            <div style={{fontSize:11,color:T.yellow,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>⚠️ Centro de Alertas · {alertas.length}</div>
            <span style={{color:T.muted,fontSize:14}}>{alertasOpen?"▼":"▶"}</span>
          </div>
          {alertasOpen&&<div style={{marginTop:10,display:"grid",gap:6}}>
            {alertas.slice(0,8).map((a,i)=><div key={i} onClick={a.act} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"rgba(255,255,255,.02)",borderRadius:8,border:"1px solid "+a.c+"33",cursor:a.act?"pointer":"default"}}>
              <span style={{fontSize:16}}>{a.i}</span>
              <span style={{fontSize:12,color:a.c,fontWeight:600,flex:1}}>{a.t}</span>
              {a.act&&<span style={{color:T.muted,fontSize:14}}>›</span>}
            </div>)}
          </div>}
        </Card>}
        {/* ═══ TABLA DE OBRAS ═══ Vista clara y descargable */}
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
            <div style={{fontSize:12,color:T.gold,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>🏗️ Reporte por Obra · {obrasRich.length} activas</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>{
                // Generar PDF ejecutivo para el encargado del taller
                const catObra=(obId,obNombre)=>{
                  const cats={};
                  movs.filter(m=>m.egr>0&&sameObra(m.obra,obNombre)).forEach(m=>{const c=m.cat||"Sin cat";cats[c]=(cats[c]||0)+m.egr;});
                  caja.filter(c=>sameObra(c.obra,obNombre)&&c.status!=="rechazado").forEach(c=>{cats["Caja Chica"]=(cats["Caja Chica"]||0)+c.monto;});
                  return Object.entries(cats).sort((a,b)=>b[1]-a[1]);
                };
                const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte de Obras - Ensamble Villarreal</title><style>
                  body{font-family:Arial,sans-serif;color:#222;margin:0;padding:20px;font-size:11px}
                  h1{color:#1B5E20;margin:0;font-size:20px}
                  h2{color:#8B6914;font-size:14px;margin:20px 0 8px;border-bottom:2px solid #C9956B;padding-bottom:4px}
                  table{width:100%;border-collapse:collapse;margin-bottom:16px}
                  th{background:#1B5E20;color:#fff;padding:8px;text-align:left;font-size:10px;text-transform:uppercase}
                  td{padding:6px 8px;border-bottom:1px solid #ddd;font-size:11px}
                  .r{text-align:right}
                  .b{font-weight:700}
                  .g{color:#2E7D32}
                  .rr{color:#C62828}
                  .subtable{background:#f9f9f9;font-size:10px;margin-left:20px;margin-bottom:8px;width:calc(100% - 20px)}
                  .subtable th{background:#666;padding:4px 8px}
                  .subtable td{padding:3px 8px}
                  .head{display:flex;justify-content:space-between;border-bottom:3px solid #1B5E20;padding-bottom:14px;margin-bottom:16px}
                  @media print{body{padding:12px}}
                </style></head><body>
                <div class="head">
                  <div><h1>ENSAMBLE VILLARREAL</h1><div style="color:#666;font-size:10px">Carpintería Arquitectónica · Circuito Los Sauces 136, Aguascalientes</div></div>
                  <div style="text-align:right"><div style="font-size:14px;font-weight:700;color:#1B5E20">REPORTE DE OBRAS</div><div style="font-size:10px;color:#666">Fecha: ${fd(td())}</div></div>
                </div>
                ${(()=>{
                  // KPIs GLOBALES (todo el sistema, no solo obras activas)
                  const tIngGlobal=movs.filter(m=>m.ing>0).reduce((s,m)=>s+m.ing,0);
                  const tEgrGlobal=movs.filter(m=>m.egr>0).reduce((s,m)=>s+m.egr,0)+caja.filter(c=>c.status!=="rechazado").reduce((s,c)=>s+c.monto,0);
                  const utilidad=tIngGlobal-tEgrGlobal;
                  const utilColor=utilidad>=0?"#2E7D32":"#C62828";
                  return `<div style="background:linear-gradient(135deg,#f5f5dc,#fff);border:2px solid #C9956B;border-radius:8px;padding:14px;margin-bottom:20px">
                    <div style="font-size:11px;font-weight:800;color:#8B6914;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">💰 Cuánto debe haber en caja</div>
                    <div style="font-size:32px;font-weight:800;color:${utilColor};margin-bottom:2px">${$(utilidad)}</div>
                    <div style="font-size:11px;color:#666">Cobrado <b style="color:#2E7D32">${$(tIngGlobal)}</b> − Gastado <b style="color:#C62828">${$(tEgrGlobal)}</b></div>
                  </div>
                  <div style="display:flex;gap:10px;margin-bottom:20px">
                    <div style="flex:1;padding:12px;border:1px solid #ddd;border-radius:6px;text-align:center">
                      <div style="font-size:9px;color:#666;font-weight:700;text-transform:uppercase">Cobrado · Año</div>
                      <div style="font-size:20px;font-weight:800;color:#2E7D32;margin-top:2px">${$(tIngGlobal)}</div>
                    </div>
                    <div style="flex:1;padding:12px;border:1px solid #ddd;border-radius:6px;text-align:center">
                      <div style="font-size:9px;color:#666;font-weight:700;text-transform:uppercase">Gastado · Año</div>
                      <div style="font-size:20px;font-weight:800;color:#C62828;margin-top:2px">${$(tEgrGlobal)}</div>
                    </div>
                    <div style="flex:1;padding:12px;border:1px solid #ddd;border-radius:6px;text-align:center">
                      <div style="font-size:9px;color:#666;font-weight:700;text-transform:uppercase">Utilidad · Año</div>
                      <div style="font-size:20px;font-weight:800;color:${utilColor};margin-top:2px">${$(utilidad)}</div>
                    </div>
                  </div>`;
                })()}
                <h2>Resumen de Obras Activas</h2>
                <table>
                  <tr><td style="width:25%">Total Cotizado</td><td class="r b">${$(obrasRich.reduce((s,o)=>s+(o.cotizado||0),0))}</td>
                      <td style="width:25%">Total Cobrado</td><td class="r b g">${$(obrasRich.reduce((s,o)=>s+(o.cob||0),0))}</td></tr>
                  <tr><td>Total Gastado</td><td class="r b rr">${$(obrasRich.reduce((s,o)=>s+(o.gas||0),0))}</td>
                      <td>Obras Activas</td><td class="r b">${obrasRich.length}</td></tr>
                </table>
                <h2>Detalle por Obra</h2>
                <table>
                  <thead><tr><th>#</th><th>OBRA</th><th>CLIENTE</th><th>FASE</th><th class="r">COTIZADO</th><th class="r">COBRADO</th><th class="r">GASTADO</th><th class="r">MARGEN</th><th class="r">AVANCE</th></tr></thead>
                  <tbody>
                  ${obrasRich.map((o,i)=>`<tr><td>${i+1}</td><td class="b">${o.nombre}</td><td>${o.cliente||"—"}</td><td>${FASES[o.fase]||o.fase||""}</td><td class="r">${$(o.cotizado||0)}</td><td class="r g">${$(o.cob||0)}</td><td class="r rr">${$(o.gas||0)}</td><td class="r b ${o.margen>=0?"g":"rr"}">${$(o.margen||0)}</td><td class="r">${o.avance||0}%</td></tr>`).join("")}
                  <tr style="font-weight:800;background:#e8f5e9;border-top:2px solid #1B5E20">
                    <td colspan="4">TOTAL (${obrasRich.length} obras)</td>
                    <td class="r">${$(obrasRich.reduce((s,o)=>s+(o.cotizado||0),0))}</td>
                    <td class="r g">${$(obrasRich.reduce((s,o)=>s+(o.cob||0),0))}</td>
                    <td class="r rr">${$(obrasRich.reduce((s,o)=>s+(o.gas||0),0))}</td>
                    <td class="r ${obrasRich.reduce((s,o)=>s+(o.margen||0),0)>=0?"g":"rr"}">${$(obrasRich.reduce((s,o)=>s+(o.margen||0),0))}</td>
                    <td class="r">—</td>
                  </tr>
                  </tbody>
                </table>
                <h2>Desglose de Gastos por Categoría (por obra)</h2>
                ${obrasRich.filter(o=>o.gas>0).map(o=>{
                  const cats=catObra(o.id,o.nombre);
                  if(cats.length===0)return "";
                  return `<div style="margin-bottom:14px"><div style="font-weight:700;color:#1B5E20;margin-bottom:4px">${o.nombre} <span style="color:#666;font-weight:400">— ${o.cliente||"sin cliente"}</span></div>
                  <table class="subtable"><thead><tr><th>CATEGORÍA</th><th class="r">MONTO</th><th class="r">% DE LA OBRA</th></tr></thead><tbody>
                  ${cats.map(([c,mo])=>`<tr><td>${c}</td><td class="r">${$(mo)}</td><td class="r">${Math.round(mo/o.gas*100)}%</td></tr>`).join("")}
                  <tr style="font-weight:700;background:#e8f5e9"><td>TOTAL GASTADO</td><td class="r">${$(o.gas)}</td><td class="r">100%</td></tr>
                  </tbody></table></div>`;
                }).join("")}
                <div style="margin-top:30px;text-align:center;color:#999;font-size:9px;font-style:italic">— Donde la madera encuentra su forma —</div>
                </body></html>`;
                const w=window.open("","","width=1000,height=800");
                w.document.write(html);w.document.close();
                setTimeout(()=>w.print(),300);
              }} style={{padding:"7px 14px",borderRadius:6,border:"1px solid "+T.gold+"66",background:"linear-gradient(135deg,rgba(201,149,107,.15),rgba(201,149,107,.05))",color:T.gold,fontSize:11,fontWeight:800,cursor:"pointer"}}>📄 PDF para taller</button>
              <button onClick={()=>go("obras")} style={{background:"transparent",border:"1px solid "+T.border,color:T.muted,fontSize:11,cursor:"pointer",padding:"7px 12px",borderRadius:6}}>Ver todas →</button>
            </div>
          </div>
          {obrasRich.length>0?<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:D?600:400}}>
            <thead style={{position:"sticky",top:0,background:"#1a1a1a"}}><tr>
              <th style={{padding:"8px 6px",textAlign:"left",color:T.gold,fontSize:10,borderBottom:"2px solid "+T.gold+"33"}}>OBRA</th>
              {D&&<th style={{padding:"8px 6px",textAlign:"left",color:T.gold,fontSize:10,borderBottom:"2px solid "+T.gold+"33"}}>CLIENTE</th>}
              <th style={{padding:"8px 6px",textAlign:"right",color:T.gold,fontSize:10,borderBottom:"2px solid "+T.gold+"33"}}>COTIZADO</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:T.gold,fontSize:10,borderBottom:"2px solid "+T.gold+"33"}}>COBRADO</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:T.gold,fontSize:10,borderBottom:"2px solid "+T.gold+"33"}}>GASTADO</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:T.gold,fontSize:10,borderBottom:"2px solid "+T.gold+"33"}}>MARGEN</th>
              {D&&<th style={{padding:"8px 6px",textAlign:"center",color:T.gold,fontSize:10,borderBottom:"2px solid "+T.gold+"33"}}>AVANCE</th>}
            </tr></thead>
            <tbody>
              {obrasRich.map((o,i)=><tr key={o.id} onClick={()=>go("obras",o)} style={{cursor:"pointer",background:i%2?"rgba(255,255,255,.02)":"transparent",borderLeft:"3px solid "+o.sem}} onMouseEnter={e=>e.currentTarget.style.background="rgba(201,149,107,.08)"} onMouseLeave={e=>e.currentTarget.style.background=i%2?"rgba(255,255,255,.02)":"transparent"}>
                <td style={{padding:"7px 6px",fontWeight:700,fontSize:12}}>{o.nombre}<div style={{fontSize:9,color:FCC[o.fase],fontWeight:600,textTransform:"uppercase"}}>{FASES[o.fase]}</div></td>
                {D&&<td style={{padding:"7px 6px",fontSize:11,color:T.muted}}>{o.cliente||"—"}</td>}
                <td style={{padding:"7px 6px",textAlign:"right",fontWeight:700,color:T.gold,whiteSpace:"nowrap"}}>{$(o.cotizado||0)}</td>
                <td style={{padding:"7px 6px",textAlign:"right",fontWeight:700,color:T.green,whiteSpace:"nowrap"}}>{$(o.cob||0)}<div style={{fontSize:9,color:T.muted,fontWeight:400}}>{o.cotizado?Math.round((o.cob/o.cotizado)*100):0}%</div></td>
                <td style={{padding:"7px 6px",textAlign:"right",fontWeight:700,color:T.red,whiteSpace:"nowrap"}}>{$(o.gas||0)}<div style={{fontSize:9,color:T.muted,fontWeight:400}}>{o.cotizado?Math.round((o.gas/o.cotizado)*100):0}%</div></td>
                <td style={{padding:"7px 6px",textAlign:"right",fontWeight:800,color:o.margen>=0?T.green:T.red,whiteSpace:"nowrap"}}>{$(o.margen||0)}<div style={{fontSize:9,color:T.muted,fontWeight:400}}>{Math.round(o.margenPct||0)}%</div></td>
                {D&&<td style={{padding:"7px 6px",textAlign:"center"}}><div style={{width:"100%",height:6,background:"#222",borderRadius:3,overflow:"hidden"}}><div style={{width:(o.avance||0)+"%",height:"100%",background:FCC[o.fase]}}/></div><div style={{fontSize:9,color:T.muted,marginTop:2}}>{o.avance||0}%</div></td>}
              </tr>)}
              <tr style={{borderTop:"2px solid "+T.gold,background:"rgba(201,149,107,.06)"}}>
                <td style={{padding:"10px 6px",fontWeight:800,fontSize:12,color:T.gold}}>TOTAL ({obrasRich.length})</td>
                {D&&<td/>}
                <td style={{padding:"10px 6px",textAlign:"right",fontWeight:800,color:T.gold,fontSize:12}}>{$(obrasRich.reduce((s,o)=>s+(o.cotizado||0),0))}</td>
                <td style={{padding:"10px 6px",textAlign:"right",fontWeight:800,color:T.green,fontSize:12}}>{$(obrasRich.reduce((s,o)=>s+(o.cob||0),0))}</td>
                <td style={{padding:"10px 6px",textAlign:"right",fontWeight:800,color:T.red,fontSize:12}}>{$(obrasRich.reduce((s,o)=>s+(o.gas||0),0))}</td>
                <td style={{padding:"10px 6px",textAlign:"right",fontWeight:800,fontSize:12,color:obrasRich.reduce((s,o)=>s+(o.margen||0),0)>=0?T.green:T.red}}>{$(obrasRich.reduce((s,o)=>s+(o.margen||0),0))}</td>
                {D&&<td/>}
              </tr>
            </tbody>
          </table></div>:<div style={{textAlign:"center",padding:30,color:T.muted}}>Sin obras activas</div>}
        </Card>
        {/* RANKINGS */}
        {obrasRich.length>0&&<Card>
          <div style={{fontSize:11,color:T.gold,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>🏆 Top obras</div>
          <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr":"1fr",gap:14}}>
            <div>
              <div style={{fontSize:9,color:T.muted,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Por monto</div>
              {topMonto.map((o,i)=><div key={o.id} onClick={()=>go("obras",o)} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:i<topMonto.length-1?"1px solid "+T.border:"none",cursor:"pointer"}}>
                <span style={{width:18,height:18,borderRadius:9,background:i===0?T.gold:T.dim,color:i===0?"#0b0b0b":T.muted,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800}}>{i+1}</span>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{o.nombre}</div></div>
                <span style={{fontSize:11,color:T.gold,fontWeight:800,whiteSpace:"nowrap"}}>{$(o.cotizado)}</span>
              </div>)}
            </div>
            <div>
              <div style={{fontSize:9,color:T.muted,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Por margen %</div>
              {topMargen.map((o,i)=><div key={o.id} onClick={()=>go("obras",o)} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:i<topMargen.length-1?"1px solid "+T.border:"none",cursor:"pointer"}}>
                <span style={{width:18,height:18,borderRadius:9,background:i===0?T.green:T.dim,color:i===0?"#0b0b0b":T.muted,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800}}>{i+1}</span>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{o.nombre}</div></div>
                <span style={{fontSize:11,color:o.margenPct>=0?T.green:T.red,fontWeight:800,whiteSpace:"nowrap"}}>{Math.round(o.margenPct)}%</span>
              </div>)}
            </div>
            <div>
              <div style={{fontSize:9,color:T.muted,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Por avance</div>
              {topAvance.map((o,i)=><div key={o.id} onClick={()=>go("obras",o)} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:i<topAvance.length-1?"1px solid "+T.border:"none",cursor:"pointer"}}>
                <span style={{width:18,height:18,borderRadius:9,background:i===0?T.blue:T.dim,color:i===0?"#0b0b0b":T.muted,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800}}>{i+1}</span>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{o.nombre}</div></div>
                <span style={{fontSize:11,color:T.blue,fontWeight:800,whiteSpace:"nowrap"}}>{o.avance||0}%</span>
              </div>)}
            </div>
          </div>
        </Card>}
        {/* ÚLTIMOS MOVIMIENTOS */}
        {movs.length>0&&<Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:11,color:T.gold,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>🕐 Últimos movimientos</div>
            <button onClick={()=>go("finanzas")} style={{background:"transparent",border:"none",color:T.muted,fontSize:10,cursor:"pointer"}}>Ver todos →</button>
          </div>
          <div style={{display:"grid",gap:4}}>{movs.slice(-6).reverse().map(m=><div key={m.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",background:"rgba(255,255,255,.015)",borderRadius:6}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.desc}</div>
              <div style={{fontSize:9,color:T.dim}}>{fd(m.fecha)} · {m.prov||"—"} · {m.obra||"General"}</div>
            </div>
            <span style={{fontSize:12,fontWeight:800,color:m.ing>0?T.green:T.red,whiteSpace:"nowrap"}}>{m.ing>0?"+":"-"}{$(m.ing>0?m.ing:m.egr)}</span>
          </div>)}</div>
        </Card>}
      </div>;
    })()}

    {sec==="cot"&&<div style={{maxWidth:700}}>
      {editObraId&&<div style={{background:"#2a2000",border:"1px solid #FFD54F44",borderRadius:10,padding:"10px 14px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{color:T.yellow,fontWeight:700}}>✏️ Editando: {cotEmp||cotNom}</span><button onClick={()=>{setEditObraId(null);setCotP([]);setCotNom("");setCotEmp("");}} style={{background:"#333",border:"none",color:"#999",borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>Cancelar</button></div>}
      <Card><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}><div><input list="cot-cli-list" style={sI} placeholder="Cliente" value={cotNom} onChange={e=>setCotNom(e.target.value)}/><datalist id="cot-cli-list">{clis.map(c=><option key={c.id} value={c.nombre}/>)}</datalist></div><input style={sI} placeholder="Obra" value={cotEmp} onChange={e=>setCotEmp(e.target.value)}/></div>
        {/* Warning de obras similares en tiempo real */}
        {!editObraId&&cotEmp.length>=3&&(()=>{const sim=findSimilarObras(cotEmp,obras,editObraId);if(sim.length===0)return null;return <div style={{marginTop:8,padding:10,background:"rgba(255,213,79,.08)",border:"1px solid "+T.yellow+"44",borderRadius:8}}>
          <div style={{fontSize:11,color:T.yellow,fontWeight:700,marginBottom:6}}>⚠️ Ya existe{sim.length>1?"n":""} {sim.length} obra{sim.length>1?"s":""} parecida{sim.length>1?"s":""}. ¿Es la misma?</div>
          <div style={{display:"grid",gap:4}}>{sim.slice(0,4).map(o=><div key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"6px 8px",background:"rgba(255,255,255,.02)",borderRadius:6}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{o.nombre}</div>
              <div style={{fontSize:10,color:T.muted}}>{o.cliente||"sin cliente"} · {$(o.cotizado||0)} · {FASES[o.fase]||o.fase}</div>
            </div>
            <button onClick={()=>{setCotP(o.partidas||[]);setCotNom(o.cliente||"");setCotEmp(o.nombre||"");setConIva(o.conIva!==false);setEditObraId(o.id);show("✏️ Editando "+o.nombre);}} style={{padding:"5px 10px",borderRadius:5,border:"1px solid "+T.gold+"44",background:"rgba(201,149,107,.1)",color:T.gold,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>✏️ Usar esta</button>
          </div>)}</div>
        </div>;})()}
      </Card>
      <div style={{display:"flex",gap:4,marginBottom:8}}>{[{k:"catalogo",i:"📦",l:"Catálogo"},{k:"libre",i:"✏️",l:"Escribir"},{k:"foto",i:"📷",l:"Escanear"},{k:"ia",i:"🤖",l:"IA Experta"}].map(t=> <button key={t.k} onClick={()=>setCotTab(t.k)} style={{flex:1,padding:"10px 6px",borderRadius:8,border:cotTab===t.k?"2px solid "+T.gold:"1px solid "+T.border,background:cotTab===t.k?"#1a1510":T.card,color:cotTab===t.k?T.gold:T.muted,cursor:"pointer",fontSize:11,fontWeight:700}}><div style={{fontSize:16}}>{t.i}</div>{t.l}</button>)}</div>
      {cotTab==="catalogo"&&<button onClick={()=>om("cat")} style={{...sB,background:"#222",color:T.gold,border:"1px solid "+T.border,marginTop:0,marginBottom:8}}>Abrir catálogo</button>}
      {cotTab==="libre"&&<Card><CustomItemForm existingCats={[...new Set([...ALL_CATS,...cats])]} onAdd={item=>{setCotP(prev=>[...prev,item]);setCatalogo(prev=>[...prev,{id:item.id,cat:item.cat,desc:item.desc,precio:item.precio}]);show("Agregado al catálogo y cotización");}}/></Card>}
      {cotTab==="foto"&&<Card><div style={{fontSize:12,color:T.muted,marginBottom:10}}>Sube foto o PDF de cotización existente. La IA extrae conceptos y precios.</div>{!getApiKey()&&<div style={{background:"rgba(255,215,84,.06)",border:"1px solid rgba(255,215,84,.15)",borderRadius:8,padding:10,marginBottom:10,fontSize:11}}><span style={{color:T.yellow,fontWeight:700}}>⚠️ Requiere API Key</span> <span style={{color:T.muted}}>— Ve a Más → 🔑 API Key IA para configurar</span></div>}<label style={{display:"block",padding:20,border:"2px dashed "+(scanning?T.blue:T.border),borderRadius:10,textAlign:"center",cursor:scanning?"wait":"pointer",background:scanning?"#0a1a33":"#111"}}><input type="file" accept="image/*,.pdf,application/pdf" style={{display:"none"}} onChange={async e=>{const raw=e.target.files[0];if(!raw)return;try{const f=await compressImage(raw);scanFile(f);}catch(err){alert(err.message);}}}/>{scanning?<div style={{color:T.blue,fontWeight:700}}>🔄 Analizando...</div>:<div><div style={{fontSize:32}}>📄</div><div style={{color:T.gold,fontWeight:700}}>Foto, imagen o PDF</div><div style={{fontSize:10,color:T.muted,marginTop:4}}>📷 Cámara · 🖼️ Galería · 📄 PDF (auto)</div></div>}</label></Card>}
      {cotTab==="ia"&&<Card><div style={{background:"linear-gradient(135deg,rgba(201,149,107,.08),rgba(107,152,201,.08))",border:"1px solid rgba(201,149,107,.15)",borderRadius:10,padding:14,marginBottom:12}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span style={{fontSize:20}}>🤖</span><div><div style={{fontWeight:800,color:T.gold}}>Cotización con IA Experta</div><div style={{fontSize:10,color:T.muted}}>Sube planos, fotos del espacio o describe el proyecto. La IA genera partidas con precios de mercado.</div></div></div></div>{!getApiKey()&&<div style={{background:"rgba(255,215,84,.06)",border:"1px solid rgba(255,215,84,.15)",borderRadius:8,padding:10,marginBottom:10,fontSize:11}}><span style={{color:T.yellow,fontWeight:700}}>⚠️ Requiere API Key</span> <span style={{color:T.muted}}>— Ve a Más → 🔑 API Key IA</span></div>}<Fl l="Instrucciones (opcional)"><textarea style={{...sI,minHeight:60,fontSize:12}} value={iaInstr} onChange={e=>setIaInstr(e.target.value)} placeholder="Ej: Cotizar cocina integral 4ml con isla, closets de las 3 recámaras, mueble de baño..."/></Fl><label style={{display:"block",padding:24,border:"2px dashed "+(scanning?T.blue:T.border),borderRadius:10,textAlign:"center",cursor:scanning?"wait":"pointer",background:scanning?"#0a1a33":"#111",marginBottom:10}}><input type="file" accept="image/*,.pdf,application/pdf" style={{display:"none"}} onChange={async e=>{const raw=e.target.files[0];if(!raw)return;try{const f=await compressImage(raw);scanPlano(f,iaInstr);}catch(err){alert(err.message);}}}/>{scanning?<div><div style={{color:T.blue,fontWeight:700,fontSize:14}}>🤖 Analizando como experto...</div><div style={{fontSize:11,color:T.muted,marginTop:6}}>Evaluando materiales, herrajes, acabados y mano de obra...</div></div>:<div><div style={{fontSize:36}}>📐</div><div style={{color:T.gold,fontWeight:700,fontSize:13,marginTop:4}}>Subir plano, foto o render</div><div style={{fontSize:10,color:T.muted,marginTop:4}}>📐 Planos · 📷 Fotos · 🖼️ Renders · 📄 PDFs (auto-comprime)</div></div>}</label><div style={{fontSize:10,color:T.dim,padding:"6px 0"}}><div style={{fontWeight:700,marginBottom:4,color:T.muted}}>La IA considera:</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:2}}>{"Cocinas integrales,Closets y vestidores,Puertas (interiores/principales),Muebles de baño,Barras y gabinetes,Estantería y libreros,Herrajes premium,Instalación y flete".split(",").map(x=><span key={x} style={{fontSize:9}}>• {x}</span>)}</div></div></Card>}
      {cotP.length>0&&<Card>
        <div style={{fontSize:10,color:T.gold,fontWeight:700,marginBottom:8}}>PARTIDAS ({cotP.length})</div>
        {cotP.map((p,i)=> <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid "+T.border}}><div style={{flex:1}}><input value={p.desc} onChange={e=>setCotP(cotP.map((x,j)=>j===i?{...x,desc:e.target.value}:x))} style={{background:"transparent",border:"none",color:T.text,fontSize:12,fontWeight:600,width:"100%",outline:"none",padding:0}}/><div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}><button onClick={()=>setCotP(cotP.map((x,j)=>j===i?{...x,cant:Math.max(1,x.cant-1)}:x))} style={{background:"#222",border:"1px solid #444",color:"#ccc",borderRadius:6,width:28,height:28,cursor:"pointer"}}>−</button><span style={{fontSize:14,fontWeight:700,minWidth:20,textAlign:"center"}}>{p.cant}</span><button onClick={()=>setCotP(cotP.map((x,j)=>j===i?{...x,cant:x.cant+1}:x))} style={{background:"#222",border:"1px solid #444",color:"#ccc",borderRadius:6,width:28,height:28,cursor:"pointer"}}>+</button></div></div><div style={{textAlign:"right",minWidth:100}}><div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2}}><span style={{color:T.muted,fontSize:11}}>$</span><input inputMode="numeric" value={p.precio||""} onFocus={e=>e.target.select()} onChange={e=>{const v=e.target.value.replace(/[^0-9]/g,"");setCotP(cotP.map((x,j)=>j===i?{...x,precio:Number(v)||0}:x));}} style={{background:"transparent",border:"none",color:T.text,fontSize:13,fontWeight:700,width:80,textAlign:"right",outline:"none",padding:0}}/></div><div style={{fontSize:10,color:T.muted}}>{p.cant>1&&"= "+$(p.precio*p.cant)}</div><button onClick={()=>setCotP(cotP.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:10}}>Quitar</button></div></div>)}
        <div style={{borderTop:"2px solid "+T.border,marginTop:10,paddingTop:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{color:T.muted}}>Subtotal</span><span>{$(subCot)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:T.muted}}>IVA 16%</span><button onClick={()=>setConIva(!conIva)} style={{background:conIva?"#1a3a1a":"#2a1111",color:conIva?T.green:T.red,border:"none",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700,cursor:"pointer"}}>{conIva?"✓ Sí":"✕ No"}</button></div><span style={{color:conIva?T.text:T.dim,textDecoration:conIva?"none":"line-through"}}>{$(subCot*.16)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:22,fontWeight:800,color:T.gold,paddingTop:6,borderTop:"1px solid "+T.dim}}><span>TOTAL</span><span>{$(totCot)}</span></div>
        </div>
      </Card>}
      {/* Botón Guardar/Actualizar SIEMPRE visible (en modo edición o con partidas) */}
      {(editObraId||cotP.length>0)&&<div style={{position:"sticky",bottom:D?0:60,zIndex:50,background:T.bg,padding:"8px 0",marginTop:cotP.length>0?0:12,borderTop:cotP.length===0?"1px solid "+T.border:"none"}}>
        {editObraId&&cotP.length===0&&<div style={{fontSize:11,color:T.yellow,padding:"6px 10px",background:"rgba(255,213,79,.08)",borderRadius:6,marginBottom:8,textAlign:"center"}}>⚠️ Esta cotización no tiene partidas. Puedes guardar solo con cliente/obra actualizados.</div>}
        <button style={{...sB,fontSize:15}} onClick={()=>{
          if(!cotNom&&!cotEmp){show("Pon al menos un cliente o nombre de obra");return;}
          // El cliente se registra al AUTORIZAR la obra, NO al cotizar.
          // Solo lo aseguramos si se edita una obra YA autorizada (no una cotización).
          if(editObraId){
            const _obEdit=obras.find(o=>o.id===editObraId);
            if(_obEdit&&_obEdit.fase&&_obEdit.fase!=="cotizacion")ensureCli(cotNom);
            setObras(prev=>prev.map(o=>o.id===editObraId?{...o,nombre:cotEmp||cotNom||o.nombre,cliente:cotNom||o.cliente,cotizado:totCot,subtotal:subCot,conIva,partidas:[...cotP],modificadoPor:user.nombre,modificadoFecha:td()}:o));
            setEditObraId(null);setCotP([]);setCotNom("");setCotEmp("");setConIva(true);
            show("✓ Cotización actualizada");
          }else{
            const nuevoId="OB"+Date.now()+Math.random().toString(36).slice(2,5);
            setObras(prev=>[...prev,{id:nuevoId,nombre:(cotEmp||cotNom||"Cot")+" #"+cotNum,cliente:cotNom,status:"cotizado",cotizado:totCot,subtotal:subCot,conIva,egreso:0,fase:"cotizacion",avance:0,partidas:[...cotP],extras:[],pagos:[],docs:[],bitacora:[],creadoPor:user.nombre,creadoFecha:td()}]);
            setCotNum(n=>n+1);setCotP([]);setCotNom("");setCotEmp("");setConIva(true);
            show("✓ Proyecto creado");
          }
        }}>{editObraId?"💾 Actualizar Cotización":"💾 Guardar como proyecto"}{cotP.length>0&&" — "+$(totCot)}</button>
      </div>}
    </div>}

    {sec==="cotizaciones"&&!sub&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:18,fontWeight:800}}>Cotizaciones <span style={{color:T.muted,fontWeight:500,fontSize:13}}>· {obras.filter(o=>o.fase==="cotizacion").length}</span></div>
        <button onClick={()=>go("cot")} style={{padding:"8px 16px",borderRadius:8,border:"none",background:T.gold,color:"#000",fontWeight:700,fontSize:12,cursor:"pointer"}}>+ Nueva Cotización</button>
      </div>
      {(()=>{const cots=obras.filter(o=>o.fase==="cotizacion").sort((a,b)=>cmpVal(a[sortCot.col],b[sortCot.col],sortCot.dir));const totalCot=cots.reduce((s,o)=>s+(o.cotizado||0),0);return cots.length>0?<div style={{borderRadius:8,border:"1px solid #333",overflow:"hidden",fontSize:12}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:D?720:480}}>
            <thead>
              <tr style={{background:"#1a1a1a",borderBottom:"2px solid #444"}}>
                <th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:36}}>#</th>
                <SortTh col="nombre" label="Proyecto" sort={sortCot} setSort={setSortCot} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,borderRight:"1px solid #333"}}/>
                {D&&<SortTh col="cliente" label="Cliente" sort={sortCot} setSort={setSortCot} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:160}}/>}
                <SortTh col="cotizado" label="Monto" sort={sortCot} setSort={setSortCot} style={{padding:"8px 10px",textAlign:"right",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:110}}/>
                {D&&<SortTh col="creadoPor" label="Creado por" sort={sortCot} setSort={setSortCot} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:110}}/>}
                <th style={{padding:"8px 10px",textAlign:"center",fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",width:D?160:110}}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cots.map((o,idx)=><tr key={o.id}
                onClick={()=>{setSec("cotizaciones");setSub(o);}}
                style={{background:idx%2===0?"rgba(255,255,255,.01)":"transparent",borderBottom:"1px solid #2a2a2a",cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(201,149,107,.06)"}
                onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?"rgba(255,255,255,.01)":"transparent"}>
                <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",color:T.dim,fontSize:10,whiteSpace:"nowrap"}}>{idx+1}</td>
                <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a"}}>
                  <div style={{fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{o.nombre}</div>
                  {!D&&<div style={{fontSize:10,color:T.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{o.cliente||"—"} {o.creadoPor&&<span style={{color:T.dim}}>· {o.creadoPor.split(" ")[0]}</span>}</div>}
                </td>
                {D&&<td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",fontSize:11,color:T.muted,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.cliente||"—"}</td>}
                <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",textAlign:"right",fontWeight:800,color:T.gold,whiteSpace:"nowrap",fontSize:13}}>{$(o.cotizado)}</td>
                {D&&<td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",fontSize:11,whiteSpace:"nowrap"}} title={o.creadoFecha?"Creado: "+fd(o.creadoFecha)+(o.modificadoPor?"\nModificado por "+o.modificadoPor+" el "+fd(o.modificadoFecha):""):""}>{o.creadoPor?<span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:18,height:18,borderRadius:9,background:T.gold+"22",color:T.gold,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800}}>{o.creadoPor.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)}</span><span style={{color:T.muted}}>{o.creadoPor.split(" ")[0]}</span></span>:<span style={{color:T.dim}}>—</span>}</td>}
                <td style={{padding:"4px 6px",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                  <div style={{display:"flex",gap:3,justifyContent:"center",alignItems:"center"}}>
                    {user.rol==="admin"&&<button onClick={()=>{
                      if(!confirm("¿Autorizar "+o.nombre+"?\n\nPasará a Obras como autorizada."))return;
                      const up={...o,fase:"autorizada",status:"en_proceso"};
                      setObras(obras.map(x=>x.id===o.id?up:x));
                      ensureCli(o.cliente);
                      show("✓ "+o.nombre+" autorizada");
                    }} style={{background:"rgba(66,165,245,.12)",border:"1px solid "+T.blue+"33",color:T.blue,cursor:"pointer",fontSize:11,padding:"4px 8px",borderRadius:5,fontWeight:700}} title="Autorizar (pasa a Obras)">✓</button>}
                    <button onClick={()=>openPdfCot(o)} style={{background:"rgba(76,175,80,.12)",border:"1px solid "+T.green+"33",color:T.green,cursor:"pointer",fontSize:11,padding:"4px 8px",borderRadius:5,fontWeight:700}} title="Ver/Descargar PDF">📄</button>
                    <button onClick={()=>{
                      const dup={...o,id:"OB"+Date.now(),nombre:o.nombre+" (copia)",fase:"cotizacion",status:"cotizado",avance:0,partidas:(o.partidas||[]).map(p=>({...p,id:"C-"+Date.now()+"-"+Math.random().toString(36).slice(2,6)})),extras:[],pagos:[],docs:[],bitacora:[]};
                      setObras(prev=>[...prev,dup]);
                      show("📋 Duplicada");
                    }} style={{background:"rgba(171,71,188,.12)",border:"1px solid "+T.purple+"33",color:T.purple,cursor:"pointer",fontSize:11,padding:"4px 8px",borderRadius:5,fontWeight:700}} title="Duplicar">📋</button>
                    {user.rol==="admin"&&<button onClick={async()=>{
                      if(!confirm("¿Eliminar "+o.nombre+"?\n\nIrá a la Papelera, puedes recuperarla por 30 días."))return;
                      enviarAPapelera("obra",o);
                      const newObras=obras.filter(x=>x.id!==o.id);
                      setObras(newObras);
                      // Forzar escritura inmediata a nube + bloqueo del poll por 30s
                      _lastWrite.current["obras"]=Date.now()+15000;
                      show("🗑 Eliminando...");
                      try{
                        if(CLOUD){
                          const r=await fetch(SUPA_URL+'/rest/v1/ev_data',{method:'POST',headers:{'apikey':SUPA_KEY,'Authorization':_bearer(),'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},body:JSON.stringify({key:"obras",value:newObras})});
                          if(r.ok)show("🗑 "+o.nombre+" eliminada ✓");
                          else show("⚠️ Error nube — eliminada local");
                        }else show("🗑 Eliminada");
                      }catch(err){show("⚠️ Error — recarga la página");}
                    }} style={{background:"rgba(231,76,60,.12)",border:"1px solid "+T.red+"33",color:T.red,cursor:"pointer",fontSize:11,padding:"4px 8px",borderRadius:5,fontWeight:700}} title="Eliminar">🗑</button>}
                  </div>
                </td>
              </tr>)}
            </tbody>
            <tfoot>
              <tr style={{background:"#1a1a1a",borderTop:"2px solid #444"}}>
                <td colSpan={D?3:2} style={{padding:"8px 10px",fontSize:11,fontWeight:700,color:T.gold}}>TOTAL ({cots.length} cotización{cots.length!==1?"es":""})</td>
                <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,color:T.gold,fontSize:13,borderLeft:"1px solid #333"}}>{$(totalCot)}</td>
                {D&&<td></td>}
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>:<Card style={{textAlign:"center",padding:24}}><div style={{color:T.muted}}>Sin cotizaciones pendientes. Usa "+ Nueva Cotización" para crear una.</div></Card>;})()}
    </div>}

    {sec==="cotizaciones"&&sub&&<div style={{maxWidth:800}}>
      <button onClick={()=>setSub(null)} style={{background:"none",border:"none",color:T.gold,cursor:"pointer",fontSize:13,padding:0,marginBottom:8}}>← Cotizaciones</button>
      {(()=>{const s=sub;return <div>
        <Card><div style={{fontSize:22,fontWeight:800,marginBottom:4}}>{s.nombre}</div><div style={{fontSize:12,color:T.muted,marginBottom:8}}>{s.cliente||"Sin cliente"} · {fd(s.inicio)}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Stat label="Subtotal" value={$(s.subtotal||0)} color={T.gold}/><Stat label="Total" value={$(s.cotizado)} color={T.gold}/></div></Card>
        <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr":"1fr",gap:6,marginBottom:8}}>
          {user.rol==="admin"&&<button style={{...sB,background:"#0a1a3a",color:T.blue,border:"1px solid "+T.blue+"44",marginTop:0}} onClick={()=>{const up={...s,fase:"autorizada",status:"en_proceso"};setObras(obras.map(o=>o.id===s.id?up:o));ensureCli(s.cliente);setSub(null);go("obras");show(s.nombre+" → Obras ✓");}}>✓ Autorizar y Pasar a Obras</button>}
          <button style={{...sB,background:"#1a1510",color:T.gold,border:"1px solid "+T.gold+"44",marginTop:0}} onClick={()=>{setCotP(s.partidas||[]);setCotNom(s.cliente||"");setCotEmp(s.nombre||"");setConIva(s.conIva!==false);setEditObraId(s.id);setSub(null);go("cot");}}>📝 Editar</button>
          <button style={{...sB,background:"#0a1a0a",color:T.green,border:"1px solid "+T.green+"44",marginTop:0}} onClick={()=>openPdfCot(s)}>📄 PDF</button>
          <button style={{...sB,background:"#1a1a2a",color:T.blue,border:"1px solid "+T.blue+"44",marginTop:0}} onClick={()=>{const dup={...s,id:"OB"+Date.now(),nombre:s.nombre+" (copia)",fase:"cotizacion",status:"cotizado",avance:0,partidas:(s.partidas||[]).map(p=>({...p,id:"C-"+Date.now()+"-"+Math.random().toString(36).slice(2,6)})),extras:[],pagos:[],docs:[],bitacora:[]};setObras(prev=>[...prev,dup]);setSub(dup);show("Cotización duplicada ✓");}}>📋 Duplicar</button>
        </div>
        {(s.partidas||[]).length>0&&<Card><div style={{fontSize:10,color:T.gold,fontWeight:700,marginBottom:8}}>PARTIDAS ({s.partidas.length})</div>{s.partidas.map((p,i)=> <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid "+T.border,fontSize:12}}><div style={{flex:1}}>{p.id&&<b style={{color:T.gold}}>{p.id} </b>}{p.desc}{p.cant>1&&<span style={{color:T.muted}}> ×{p.cant}</span>}</div><span style={{fontWeight:700}}>{$(p.precio*p.cant)}</span></div>)}<div style={{borderTop:"2px solid "+T.border,marginTop:6,paddingTop:6,display:"flex",justifyContent:"space-between",fontWeight:800,color:T.gold}}><span>TOTAL{s.conIva!==false?" (IVA incl.)":""}</span><span>{$(s.cotizado)}</span></div></Card>}
      </div>;})()}
    </div>}

    {sec==="obras"&&!sub&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:18,fontWeight:800}}>Obras <span style={{color:T.muted,fontWeight:500,fontSize:13}}>· {obras.filter(o=>o.fase&&o.fase!=="cotizacion").length}</span></div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          {(()=>{const todasObras=[...obras,...[...new Set([...movs.map(m=>m.obra),...caja.map(c=>c.obra)])].filter(n=>n&&!obras.some(o=>normSearch(o.nombre)===normSearch(n))).map((n,i)=>({id:"F-"+i,nombre:n,cotizado:0,isFantasma:true}))];const grupos=agruparObrasSimilares(todasObras);const exclusionesCount=obtenerExclusionesObras().length;return <div style={{display:"flex",gap:4,alignItems:"center"}}>
            <button onClick={()=>om("obrasSimilares")} style={{padding:"8px 14px",borderRadius:8,border:"1px solid "+(grupos.length>0?T.purple:T.green)+"55",background:grupos.length>0?"rgba(171,71,188,.08)":"rgba(76,175,80,.05)",color:grupos.length>0?T.purple:T.green,fontWeight:700,fontSize:12,cursor:"pointer"}} title={grupos.length>0?"Hay obras posiblemente duplicadas":"Revisar duplicadas / Ver exclusiones manuales"}>{grupos.length>0?"🔗 Detectar duplicadas":"✓ Sin duplicadas"} {grupos.length>0&&<span style={{background:T.yellow+"33",color:T.yellow,padding:"1px 6px",borderRadius:6,fontSize:10,marginLeft:4}}>{grupos.length}</span>}</button>
            {grupos.length>0&&<button onClick={()=>{
              if(!confirm("🚫 ¿Marcar TODOS los "+grupos.length+" grupo(s) detectados como obras DISTINTAS?\n\nEjemplo: 'CORAL #39' y 'CORAL #40' son obras distintas — no son duplicadas.\n\nDespués de esto, el sistema no las volverá a sugerir."))return;
              const exclusiones=obtenerExclusionesObras();
              let agregadas=0;
              grupos.forEach(g=>{for(let i=0;i<g.length;i++){for(let j=i+1;j<g.length;j++){const par=[normSearch(g[i].nombre),normSearch(g[j].nombre)];if(!exclusiones.some(ex=>(ex[0]===par[0]&&ex[1]===par[1])||(ex[0]===par[1]&&ex[1]===par[0]))){exclusiones.push(par);agregadas++;}}}});
              guardarExclusionesObras(exclusiones);
              show("✓ "+agregadas+" par(es) marcados como NO duplicados. Refresca la página.");
            }} style={{padding:"8px 12px",borderRadius:8,border:"2px solid "+T.green,background:"linear-gradient(135deg,rgba(76,175,80,.15),rgba(76,175,80,.05))",color:T.green,fontWeight:800,fontSize:12,cursor:"pointer",boxShadow:"0 2px 6px rgba(76,175,80,.2)"}} title="Marcar todos como NO duplicados (son obras distintas)">🚫 NO son duplicadas</button>}
            {exclusionesCount>0&&<button onClick={()=>{
              if(!confirm("¿Limpiar las "+exclusionesCount+" exclusiones manuales?\n\nVas a permitir que el sistema vuelva a sugerir todas las obras que habías marcado como 'no duplicadas'."))return;
              guardarExclusionesObras([]);
              show("✓ Exclusiones limpiadas. Refresca la página.");
            }} style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+T.muted+"33",background:"transparent",color:T.muted,fontSize:10,cursor:"pointer"}} title={exclusionesCount+" pares marcados como NO duplicados — click para resetear"}>⟲ {exclusionesCount}</button>}
          </div>;})()}
          {can("obras")&&<button onClick={()=>om("addOb")} style={{padding:"8px 16px",borderRadius:8,border:"none",background:T.gold,color:"#000",fontWeight:700,fontSize:12,cursor:"pointer"}}>+ Nueva Obra</button>}
        </div>
      </div>
      {(()=>{
        const obrasAut=obras.filter(o=>o.fase&&o.fase!=="cotizacion");
        if(obrasAut.length===0)return <Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin obras autorizadas. Autoriza cotizaciones para verlas aquí.</div></Card>;
        // Pre-calcular cobrado/gastado/margen para todas las obras
        const enrich=obrasAut.map(o=>{
          const cob=movs.filter(m=>m.ing>0&&sameObra(m.obra,o.nombre)).reduce((s,m)=>s+m.ing,0);
          const gas=movs.filter(m=>m.egr>0&&sameObra(m.obra,o.nombre)).reduce((s,m)=>s+m.egr,0)+caja.filter(c=>sameObra(c.obra,o.nombre)&&c.status!=="rechazado").reduce((s,c)=>s+c.monto,0);
          const margen=(o.cotizado||0)-gas;
          const margenPct=o.cotizado?Math.round((margen/o.cotizado)*100):0;
          const venc=o.entrega&&fixDateGlobal(o.entrega)<td();
          const sem=margen<0?T.red:margenPct<20?T.yellow:T.green;
          return {...o,cob,gas,margen,margenPct,venc,sem};
        });
        const totCot=enrich.reduce((s,o)=>s+(o.cotizado||0),0);
        const totCob=enrich.reduce((s,o)=>s+o.cob,0);
        const totGas=enrich.reduce((s,o)=>s+o.gas,0);
        const totMar=totCot-totGas;
        return <div style={{borderRadius:8,border:"1px solid #333",overflow:"hidden",fontSize:12}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:D?1100:560}}>
              <thead>
                <tr style={{background:"#1a1a1a",borderBottom:"2px solid #444"}}>
                  <th style={{padding:"8px 8px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:30}}>#</th>
                  <th style={{padding:"8px 8px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:24}}>●</th>
                  <SortTh col="nombre" label="Proyecto" sort={sortObr} setSort={setSortObr} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,borderRight:"1px solid #333"}}/>
                  {D&&<SortTh col="cliente" label="Cliente" sort={sortObr} setSort={setSortObr} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:140}}/>}
                  <SortTh col="cotizado" label="Cotizado" sort={sortObr} setSort={setSortObr} style={{padding:"8px 8px",textAlign:"right",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:100}}/>
                  {D&&<SortTh col="cob" label="Cobrado" sort={sortObr} setSort={setSortObr} style={{padding:"8px 8px",textAlign:"right",fontSize:9,fontWeight:700,color:T.green,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:100}}/>}
                  {D&&<SortTh col="gas" label="Gastado" sort={sortObr} setSort={setSortObr} style={{padding:"8px 8px",textAlign:"right",fontSize:9,fontWeight:700,color:T.red,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:100}}/>}
                  <SortTh col="margen" label="Margen" sort={sortObr} setSort={setSortObr} style={{padding:"8px 8px",textAlign:"right",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:100}}/>
                  <SortTh col="avance" label="Avance" sort={sortObr} setSort={setSortObr} style={{padding:"8px 8px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:120}}/>
                  {D&&<SortTh col="entrega" label="Entrega" sort={sortObr} setSort={setSortObr} style={{padding:"8px 8px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:90}}/>}
                  <th style={{padding:"8px 8px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",width:50}}></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(FASES).filter(([k])=>k!=="cotizacion").map(([k,label])=>{
                  const list=enrich.filter(o=>o.fase===k).sort((a,b)=>cmpVal(a[sortObr.col],b[sortObr.col],sortObr.dir));
                  if(!list.length)return null;
                  const subCot=list.reduce((s,o)=>s+(o.cotizado||0),0);
                  const subCob=list.reduce((s,o)=>s+o.cob,0);
                  const subGas=list.reduce((s,o)=>s+o.gas,0);
                  const subMar=subCot-subGas;
                  const colCount=D?11:7;
                  return [
                    <tr key={k+"-h"} style={{background:FCC[k]+"15",borderBottom:"1px solid #2a2a2a"}}>
                      <td colSpan={D?4:3} style={{padding:"5px 10px",fontSize:10,fontWeight:800,color:FCC[k],letterSpacing:.5,textTransform:"uppercase"}}>● {label} <span style={{color:T.muted,fontWeight:500,marginLeft:6}}>({list.length})</span></td>
                      <td style={{padding:"5px 8px",textAlign:"right",fontSize:11,fontWeight:800,color:T.gold,whiteSpace:"nowrap"}}>{$(subCot)}</td>
                      {D&&<td style={{padding:"5px 8px",textAlign:"right",fontSize:11,fontWeight:800,color:T.green,whiteSpace:"nowrap"}}>{$(subCob)}</td>}
                      {D&&<td style={{padding:"5px 8px",textAlign:"right",fontSize:11,fontWeight:800,color:T.red,whiteSpace:"nowrap"}}>{$(subGas)}</td>}
                      <td style={{padding:"5px 8px",textAlign:"right",fontSize:11,fontWeight:800,color:subMar>=0?T.green:T.red,whiteSpace:"nowrap"}}>{$(subMar)}</td>
                      <td colSpan={D?3:2}></td>
                    </tr>,
                    ...list.map((o,idx)=><tr key={o.id}
                      onClick={()=>setSub(o)}
                      style={{background:idx%2===0?"rgba(255,255,255,.01)":"transparent",borderBottom:"1px solid #2a2a2a",cursor:"pointer"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(201,149,107,.06)"}
                      onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?"rgba(255,255,255,.01)":"transparent"}>
                      <td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a",color:T.dim,fontSize:10,whiteSpace:"nowrap",textAlign:"center"}}>{idx+1}</td>
                      <td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a",textAlign:"center"}} title={o.margen<0?"Margen negativo":o.margenPct<20?"Margen bajo":"Margen sano"}>
                        <span style={{display:"inline-block",width:10,height:10,borderRadius:5,background:o.sem}}/>
                      </td>
                      <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:D?260:160}}>{o.nombre}</span>
                          {o.venc&&<span style={{fontSize:10,color:T.red}} title="Entrega vencida">⏰</span>}
                          {o.creadoPor&&<span title={"Creado por "+o.creadoPor+(o.creadoFecha?" el "+fd(o.creadoFecha):"")} style={{width:16,height:16,borderRadius:8,background:T.gold+"22",color:T.gold,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:800,flexShrink:0}}>{o.creadoPor.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)}</span>}
                        </div>
                        {!D&&<div style={{fontSize:10,color:T.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160,marginTop:1}}>{o.cliente||"—"} {o.creadoPor&&<span style={{color:T.dim}}>· {o.creadoPor.split(" ")[0]}</span>}</div>}
                      </td>
                      {D&&<td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",fontSize:11,color:T.muted,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.cliente||"—"}</td>}
                      <td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a",textAlign:"right",fontWeight:700,color:T.gold,whiteSpace:"nowrap",fontSize:12}}>{$(o.cotizado)}</td>
                      {D&&<td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a",textAlign:"right",whiteSpace:"nowrap"}}>
                        <div style={{fontWeight:700,color:T.green,fontSize:12}}>{$(o.cob)}</div>
                        <div style={{fontSize:9,color:T.muted}}>{o.cotizado?pc(o.cob,o.cotizado):0}%</div>
                      </td>}
                      {D&&<td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a",textAlign:"right",fontWeight:700,color:T.red,whiteSpace:"nowrap",fontSize:12}}>{$(o.gas)}</td>}
                      <td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a",textAlign:"right",whiteSpace:"nowrap"}}>
                        <div style={{fontWeight:800,color:o.margen>=0?T.green:T.red,fontSize:12}}>{$(o.margen)}</div>
                        <div style={{fontSize:9,color:o.margen>=0?T.green:T.red,fontWeight:600}}>{o.margenPct}%</div>
                      </td>
                      <td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a"}}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          <div style={{flex:1,minWidth:50}}><Bar v={o.avance||0} mx={100} c={FCC[o.fase]} h={5}/></div>
                          <span style={{fontSize:10,fontWeight:700,color:T.muted,minWidth:28,textAlign:"right"}}>{o.avance||0}%</span>
                        </div>
                      </td>
                      {D&&<td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a",textAlign:"center",fontSize:10,color:o.venc?T.red:T.muted,whiteSpace:"nowrap"}}>{o.entrega?fd(o.entrega):"—"}</td>}
                      <td style={{padding:"6px 8px",textAlign:"center"}}>
                        <span style={{color:T.muted,fontSize:14}}>›</span>
                      </td>
                    </tr>)
                  ];
                })}
              </tbody>
              <tfoot>
                <tr style={{background:"#1a1a1a",borderTop:"2px solid #444"}}>
                  <td colSpan={D?4:3} style={{padding:"8px 10px",fontSize:11,fontWeight:700,color:T.gold}}>TOTAL ({enrich.length} obra{enrich.length!==1?"s":""})</td>
                  <td style={{padding:"8px 8px",textAlign:"right",fontWeight:800,color:T.gold,fontSize:13,borderLeft:"1px solid #333"}}>{$(totCot)}</td>
                  {D&&<td style={{padding:"8px 8px",textAlign:"right",fontWeight:800,color:T.green,fontSize:13,borderLeft:"1px solid #333"}}>{$(totCob)}</td>}
                  {D&&<td style={{padding:"8px 8px",textAlign:"right",fontWeight:800,color:T.red,fontSize:13,borderLeft:"1px solid #333"}}>{$(totGas)}</td>}
                  <td style={{padding:"8px 8px",textAlign:"right",fontWeight:800,color:totMar>=0?T.green:T.red,fontSize:13,borderLeft:"1px solid #333"}}>{$(totMar)}</td>
                  <td colSpan={D?3:2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>;
      })()}
    </div>}

    {sec==="obras"&&sub&&(()=>{
      const obIng=movs.filter(m=>m.ing>0&&sameObra(m.obra,sub.nombre));const obEgr=movs.filter(m=>m.egr>0&&sameObra(m.obra,sub.nombre));const obCaja=caja.filter(c=>sameObra(c.obra,sub.nombre)&&c.status!=="rechazado");
      const totIng=obIng.reduce((s,m)=>s+m.ing,0);const totEgr=obEgr.reduce((s,m)=>s+m.egr,0);const totCajaOb=obCaja.reduce((s,c)=>s+c.monto,0);
      const gastoTotal=totEgr+totCajaOb;const margen=sub.cotizado-gastoTotal;const rentPct=sub.cotizado?pc(margen,sub.cotizado):0;
      const pagCliente=totIng;const restaCliente=sub.cotizado-pagCliente;
      const a1=Math.round(sub.cotizado*.6);const a2=Math.round(sub.cotizado*.2);const a3=Math.round(sub.cotizado*.2);
      // Agrupar egresos por categoría
      const catMap={};obEgr.forEach(m=>{const c=m.cat||"Sin categoría";if(!catMap[c])catMap[c]=0;catMap[c]+=m.egr;});obCaja.forEach(c=>{const k="Caja Chica";if(!catMap[k])catMap[k]=0;catMap[k]+=c.monto;});
      const catArr=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
      const allMoves=[...obIng.map(m=>({...m,tipo:"ing",monto:m.ing})),...obEgr.map(m=>({...m,tipo:"egr",monto:m.egr})),...obCaja.map(c=>({fecha:c.fecha,desc:c.concepto,tipo:"caja",monto:c.monto,prov:c.resp}))].sort((a,b)=>b.fecha>a.fecha?1:-1);
      return <div style={{maxWidth:900}}>
      <button onClick={()=>setSub(null)} style={{background:"none",border:"none",color:T.gold,cursor:"pointer",fontSize:13,padding:0,marginBottom:8}}>← Obras</button>
      <Card><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}><div><div style={{fontSize:22,fontWeight:800}}>{sub.nombre}</div><div style={{fontSize:12,color:T.muted}}>{sub.cliente} · {FASES[sub.fase]||sub.fase}</div></div><span style={{background:FCC[sub.fase]+"33",color:FCC[sub.fase],padding:"4px 14px",borderRadius:10,fontSize:11,fontWeight:700}}>{FASES[sub.fase]}</span></div><Bar v={sub.avance} mx={100} c={FCC[sub.fase]} h={6}/><div style={{fontSize:10,color:T.muted,textAlign:"right",marginTop:3}}>Avance: {sub.avance||0}%</div></Card>

      <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr 1fr":"1fr 1fr",gap:8,marginBottom:8}}>
        <Card style={{background:"rgba(201,149,107,.06)",borderColor:"rgba(201,149,107,.15)"}}><Stat label="Presupuesto" value={$(sub.cotizado)} color={T.gold}/></Card>
        <Card style={{background:"rgba(76,175,80,.06)",borderColor:"rgba(76,175,80,.15)"}}><Stat label="Cobrado" value={$(pagCliente)} color={T.green}/><div style={{fontSize:9,color:T.muted,marginTop:2}}>{pc(pagCliente,sub.cotizado)}% cobrado</div></Card>
        <Card style={{background:"rgba(231,76,60,.06)",borderColor:"rgba(231,76,60,.15)"}}><Stat label="Gastado" value={$(gastoTotal)} color={T.red}/><div style={{fontSize:9,color:T.muted,marginTop:2}}>{pc(gastoTotal,sub.cotizado)}% del presupuesto</div></Card>
        <Card style={{background:margen>=0?"rgba(76,175,80,.06)":"rgba(231,76,60,.06)",borderColor:margen>=0?"rgba(76,175,80,.15)":"rgba(231,76,60,.15)"}}><Stat label="Margen / Utilidad" value={$(margen)} color={margen>=0?T.green:T.red}/><div style={{fontSize:9,color:margen>=0?T.green:T.red,marginTop:2,fontWeight:700}}>{rentPct}% rentabilidad</div></Card>
      </div>

      <Card><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Flujo del Cliente</div>
        <div style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}><span style={{color:T.muted}}>Cobrado: {$(pagCliente)}</span><span style={{color:restaCliente>0?T.yellow:T.green,fontWeight:700}}>Falta: {$(restaCliente)}</span></div><Bar v={pagCliente} mx={sub.cotizado} c={T.green} h={6}/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          {[{l:"Anticipo 60%",v:a1,ok:pagCliente>=a1},{l:"Avance 20%",v:a2,ok:pagCliente>=a1+a2},{l:"Entrega 20%",v:a3,ok:pagCliente>=sub.cotizado}].map((e,i)=><div key={i} style={{textAlign:"center",padding:10,borderRadius:10,background:e.ok?"rgba(76,175,80,.06)":"rgba(255,255,255,.025)",border:"1px solid "+(e.ok?"rgba(76,175,80,.15)":T.border)}}><div style={{fontSize:9,color:T.muted}}>{e.l}</div><div style={{fontSize:16,fontWeight:800,color:e.ok?T.green:T.text}}>{$(e.v)}</div><div style={{fontSize:9,color:e.ok?T.green:T.muted,marginTop:2}}>{e.ok?"✅ Recibido":"⏳ Pendiente"}</div></div>)}
        </div>
      </Card>

      <Card><div style={{fontSize:10,color:T.red,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Costos del Proyecto</div>
        <div style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}><span style={{color:T.muted}}>Gastado: {$(gastoTotal)}</span><span style={{color:gastoTotal>sub.cotizado?T.red:T.green,fontWeight:700}}>Disponible: {$(sub.cotizado-gastoTotal)}</span></div><Bar v={gastoTotal} mx={sub.cotizado} c={gastoTotal>sub.cotizado?T.red:T.orange} h={6}/></div>
        {catArr.length>0?<div>{catArr.map(([cat,total],i)=><div key={cat} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid "+T.border}}><div style={{flex:1}}><div style={{fontWeight:600,fontSize:12}}>{cat}</div><Bar v={total} mx={gastoTotal} c={T.orange} h={3}/></div><div style={{textAlign:"right",minWidth:90}}><span style={{fontWeight:800,color:T.red}}>{$(total)}</span><div style={{fontSize:9,color:T.muted}}>{pc(total,gastoTotal)}%</div></div></div>)}</div>:<div style={{textAlign:"center",padding:16,color:T.muted}}>Sin gastos registrados</div>}
      </Card>

      <Card><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontSize:10,color:T.blue,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Movimientos del Proyecto ({allMoves.length})</div><div style={{display:"flex",gap:4}}><button onClick={()=>om("addIng")} style={{padding:"5px 12px",borderRadius:8,border:"none",background:"rgba(76,175,80,.1)",color:T.green,fontWeight:700,fontSize:10,cursor:"pointer"}}>+ Ingreso</button><button onClick={()=>om("addEgr")} style={{padding:"5px 12px",borderRadius:8,border:"none",background:"rgba(231,76,60,.1)",color:T.red,fontWeight:700,fontSize:10,cursor:"pointer"}}>+ Egreso</button></div></div>
        {allMoves.length>0?allMoves.slice(0,30).map((m,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid "+T.border,fontSize:12}}>
          <div><div style={{display:"flex",alignItems:"center",gap:4}}><span style={{color:m.tipo==="ing"?T.green:T.red}}>{m.tipo==="ing"?"⬆":"⬇"}</span><span style={{fontWeight:600}}>{m.desc}</span>{m.tipo==="caja"&&<span style={{fontSize:9,background:T.orange+"22",color:T.orange,padding:"1px 6px",borderRadius:6}}>Caja</span>}</div><div style={{fontSize:10,color:T.dim}}>{fd(m.fecha)}{m.prov&&" · "+m.prov}{m.cat&&" · "+m.cat}</div></div>
          <span style={{fontWeight:800,color:m.tipo==="ing"?T.green:T.red,whiteSpace:"nowrap"}}>{m.tipo==="ing"?"+":"-"}{$(m.monto)}</span>
        </div>):<div style={{textAlign:"center",padding:16,color:T.muted}}>Sin movimientos para esta obra</div>}
        {allMoves.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:10,paddingTop:10,borderTop:"2px solid "+T.border}}><div><div style={{fontSize:9,color:T.muted}}>TOTAL INGRESOS</div><div style={{fontWeight:800,color:T.green}}>{$(totIng)}</div></div><div><div style={{fontSize:9,color:T.muted}}>TOTAL EGRESOS</div><div style={{fontWeight:800,color:T.red}}>{$(gastoTotal)}</div></div><div><div style={{fontSize:9,color:T.muted}}>FLUJO NETO</div><div style={{fontWeight:800,color:totIng-gastoTotal>=0?T.green:T.red}}>{$(totIng-gastoTotal)}</div></div></div>}
      </Card>

      <Card><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Estatus del Proyecto</div><div style={{display:"flex",gap:2,marginBottom:12,overflowX:"auto"}}>{FASE_ORD.map((f,i)=>{const cur=FASE_ORD.indexOf(sub.fase);const done=i<=cur;return <div key={f} style={{flex:1,textAlign:"center",minWidth:D?0:60}}><div style={{width:"100%",height:4,borderRadius:2,background:done?FCC[f]:T.border,marginBottom:4}}/><div style={{fontSize:9,color:done?FCC[f]:T.dim,fontWeight:done?700:400}}>{FASES[f]}</div></div>})}</div>{user.rol==="admin"&&<div><div style={{fontSize:10,color:T.muted,marginBottom:6}}>Cambiar estatus:</div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{FASE_ORD.map(f=><button key={f} onClick={()=>{const up={...sub,fase:f,status:f==="cotizacion"?"cotizado":f==="entregado"?"completado":"en_proceso"};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);show(FASES[f]+" ✓");}} style={{padding:"6px 12px",borderRadius:8,border:sub.fase===f?"2px solid "+FCC[f]:"1px solid "+T.border,background:sub.fase===f?FCC[f]+"22":"transparent",color:sub.fase===f?FCC[f]:T.muted,fontSize:10,fontWeight:sub.fase===f?700:400,cursor:"pointer"}}>{FASES[f]}</button>)}<button onClick={()=>{const up={...sub,fase:"cancelado",status:"cancelado"};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);show("Cancelado");}} style={{padding:"6px 12px",borderRadius:8,border:sub.fase==="cancelado"?"2px solid "+FCC.cancelado:"1px solid "+T.border,background:sub.fase==="cancelado"?FCC.cancelado+"22":"transparent",color:sub.fase==="cancelado"?FCC.cancelado:T.dim,fontSize:10,cursor:"pointer"}}>Cancelado</button></div></div>}</Card>

      <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr 1fr":"1fr 1fr",gap:6,marginBottom:8}}><button style={{...sB,background:"rgba(38,166,154,.08)",color:T.teal,border:"1px solid "+T.teal+"33",marginTop:0}} onClick={()=>{if(sub.cliente){const cn=sub.cliente.toLowerCase();let cli=clis.find(c=>c.nombre.toLowerCase()===cn);if(!cli){cli={id:"C"+_rid(),nombre:sub.cliente,tel:"",email:"",dir:""};ensureCli(sub.cliente);cli=clis.find(c2=>c2.nombre.toLowerCase()===sub.cliente.toLowerCase())||cli;}go("clis",cli);}else{show("Esta obra no tiene cliente asignado");}}}>👤 Estado de Cuenta</button><button style={{...sB,background:"#1a1510",color:T.gold,border:"1px solid "+T.gold+"44",marginTop:0}} onClick={()=>{setCotP(sub.partidas||[]);setCotNom(sub.cliente||"");setCotEmp(sub.nombre||"");setConIva(sub.conIva!==false);setEditObraId(sub.id);setSub(null);go("cot");}}>📝 Editar Cotización</button><button style={{...sB,background:"#0a1a0a",color:T.green,border:"1px solid "+T.green+"44",marginTop:0}} onClick={()=>openPdfCot(sub)}>📄 Generar PDF</button><button style={{...sB,background:"#1a1a2a",color:T.blue,border:"1px solid "+T.blue+"33",marginTop:0}} onClick={()=>{const dup={...sub,id:"OB"+Date.now(),nombre:sub.nombre+" (copia)",fase:"cotizacion",status:"cotizado",avance:0,partidas:(sub.partidas||[]).map(p=>({...p,id:"C-"+Date.now()+"-"+Math.random().toString(36).slice(2,6)})),extras:[],pagos:[],docs:[],bitacora:[]};setObras(prev=>[...prev,dup]);show("Duplicada como cotización ✓");go("cotizaciones");}}>📋 Duplicar</button><button style={{...sB,background:"#1a0a0a",color:T.red,border:"1px solid "+T.red+"33",marginTop:0}} onClick={()=>om("delOb",sub)}>🗑 Eliminar</button></div>

      {(sub.partidas||[]).length>0&&<Card><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{fontSize:10,color:T.gold,fontWeight:700}}>PARTIDAS ({sub.partidas.length})</div></div>{sub.partidas.map((p,i)=> <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid "+T.border,fontSize:12}}><div style={{flex:1}}>{p.id&&<b style={{color:T.gold}}>{p.id} </b>}{p.desc}{p.cant>1&&<span style={{color:T.muted}}> ×{p.cant}</span>}</div><div style={{display:"flex",alignItems:"center",gap:4}}><span style={{color:T.muted,fontSize:11}}>$</span><input inputMode="numeric" value={p.precio||""} onFocus={e=>e.target.select()} onChange={e=>{const np=Number(e.target.value.replace(/[^0-9]/g,""))||0;const newP=[...sub.partidas];newP[i]={...newP[i],precio:np};const newSub=newP.reduce((s,x)=>s+x.precio*x.cant,0);const up={...sub,partidas:newP,subtotal:newSub,cotizado:sub.conIva!==false?Math.round(newSub*1.16):newSub};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);}} style={{background:"transparent",border:"1px solid "+T.border,borderRadius:6,color:T.text,fontSize:13,fontWeight:700,width:80,textAlign:"right",padding:"4px 6px",outline:"none"}}/></div></div>)}<div style={{borderTop:"2px solid "+T.border,marginTop:6,paddingTop:6,display:"flex",justifyContent:"space-between",fontWeight:800,color:T.gold}}><span>TOTAL{sub.conIva!==false?" (IVA incl.)":""}</span><span>{$(sub.cotizado)}</span></div></Card>}

      <div style={{display:"grid",gridTemplateColumns:G,gap:8}}>
        <Card><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:10,color:T.gold,fontWeight:700}}>DOCUMENTOS</span><button onClick={()=>om("addDoc")} style={{background:"#222",border:"1px solid #444",color:T.gold,borderRadius:6,padding:"3px 10px",fontSize:10,cursor:"pointer"}}>+</button></div>{(sub.docs||[]).map(d=> <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid "+T.border}}><span>{DOC_IC[d.tipo]}</span><div style={{fontSize:12}}>{d.nombre}</div></div>)}</Card>
        <Card><div style={{fontSize:10,color:T.orange,fontWeight:700,marginBottom:6}}>EXTRAS ({(sub.extras||[]).length})</div>{(sub.extras||[]).map(e=> <div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid "+T.border}}><span style={{fontSize:12}}>{e.desc}</span><div><Badge s={e.status}/> <span style={{color:T.orange,fontWeight:700}}>{$(e.monto)}</span></div></div>)}</Card>
      </div>
      <Card><div style={{fontSize:10,color:T.blue,fontWeight:700,marginBottom:6}}>BITÁCORA</div>{(sub.bitacora||[]).slice().reverse().map(b=> <div key={b.id} style={{padding:"5px 0",borderBottom:"1px solid "+T.border}}><div style={{fontSize:12}}>{b.nota}</div><div style={{fontSize:10,color:T.dim}}>{fd(b.fecha)} · {b.user}</div></div>)}<BitacoraForm onSave={nota=>{const up={...sub,bitacora:[...(sub.bitacora||[]),{id:(sub.bitacora?.length||0)+1,fecha:td(),nota,user:user.nombre}]};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);show("Bitácora ✓");}}/></Card>
    </div>})()}


    
    {sec==="nominas"&&<div>
      <div style={{fontSize:18,fontWeight:800,marginBottom:12}}>Nóminas y Pagos Fijos</div>
      <button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300}} onClick={()=>om("addNom")}>+ Agregar Pago Fijo</button>
      <div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{nominas.map(n=> <Card key={n.id}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontWeight:700,fontSize:14}}>{n.nombre}</div><div style={{fontSize:10,color:T.muted}}>{n.tipo} · {n.frecuencia}</div></div><div style={{textAlign:"right"}}><div style={{fontWeight:800,color:T.orange,fontSize:16}}>{$(n.monto)}</div><div style={{display:"flex",gap:4,marginTop:4,justifyContent:"flex-end"}}><button onClick={()=>{const m={fecha:td(),prov:n.nombre,desc:n.nombre,ing:0,egr:n.monto,obra:"CARPINTERIA",cat:n.tipo,user:user.nombre,id:_nextNumId(movs)};setMovs(prev=>[...prev,m]);show(n.nombre+" registrado");}} style={{background:"#1a1a0a",color:T.yellow,border:"1px solid "+T.yellow+"33",borderRadius:6,padding:"4px 10px",fontSize:10,cursor:"pointer",fontWeight:700}}>💸 Pagar</button><button onClick={()=>{setNominas(prev=>prev.filter(x=>x.id!==n.id));show("Eliminado");}} style={{background:"#2a0a0a",color:T.red,border:"1px solid "+T.red+"33",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>🗑</button></div></div></div></Card>)}</div>
      {nominas.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin pagos fijos</div></Card>}
      <div style={{marginTop:16,fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Historial de Nóminas</div>
      <div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{movs.filter(m=>["Nómina","Renta","IMSS","Destajo"].includes(m.cat)).slice().reverse().map(m=> <Card key={m.id}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:600}}>{m.desc}</div><div style={{fontSize:10,color:T.dim}}>{fd(m.fecha)} · {m.cat}</div></div><span style={{fontWeight:700,color:T.red}}>{$(m.egr)}</span></div></Card>)}</div>
    </div>}

    {sec==="taller"&&<div style={{display:"flex",gap:4,marginBottom:12}}>{[{k:"inv",l:"Inventario"},{k:"provs",l:"Proveedores"},{k:"catalogo",l:"Catálogo"},{k:"precios",l:"💰 Precios Unitarios"}].map(t=><button key={t.k} onClick={()=>setSubTab(t.k)} style={{padding:"8px 14px",borderRadius:10,border:subTab===t.k?"2px solid "+T.gold:"1px solid "+T.border,background:subTab===t.k?"#1a1510":"transparent",color:subTab===t.k?T.gold:T.muted,cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{t.l}</button>)}</div>}
    {sec==="taller"&&subTab==="inv"&&<div><button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300}} onClick={()=>om("addInv")}>+ Material</button><div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{inv.sort((a,b)=>(a.stock<=a.minimo?0:1)-(b.stock<=b.minimo?0:1)).map(it=> <Card key={it.id} style={{borderLeft:it.stock<=it.minimo?"3px solid "+T.red:"none"}}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:700}}>{it.nombre}</div><div style={{fontSize:10,color:T.dim}}>{it.cat} · {$(it.precio)}/{it.unidad}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:it.stock<=it.minimo?T.red:T.green}}>{it.stock}</div><div style={{fontSize:9,color:T.muted}}>min:{it.minimo}</div></div></div><Bar v={it.stock} mx={it.minimo*3} c={it.stock<=it.minimo?T.red:T.green}/></Card>)}</div></div>}

    {sec==="taller"&&subTab==="provs"&&<div><button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300}} onClick={()=>om("addProv")}>+ Proveedor</button><div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{provs.map(p=>{const pMvs=movs.filter(m=>m.egr>0&&m.prov===p.nombre);const pTot=pMvs.reduce((s,m)=>s+m.egr,0);const pObs=[...new Set(pMvs.map(m=>m.obra).filter(Boolean))];return <Card key={p.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><div><div style={{fontWeight:700}}>{p.nombre}</div><div style={{fontSize:11,color:T.muted}}>{p.contacto}{p.tel&&" · "+p.tel}</div></div><div style={{textAlign:"right"}}><div style={{fontWeight:800,color:T.red}}>{$(pTot)}</div><div style={{fontSize:9,color:T.muted}}>{pMvs.length} compras</div></div></div><div style={{fontSize:11,color:T.muted}}>{p.material} · {[...Array(p.calif||0)].map((_,i)=><span key={i}>⭐</span>)}</div>{pObs.length>0&&<div style={{marginTop:6,paddingTop:6,borderTop:"1px solid "+T.border,display:"flex",flexWrap:"wrap",gap:4}}>{pObs.map(o=><span key={o} style={{fontSize:9,background:T.gold+"15",color:T.gold,padding:"2px 6px",borderRadius:6}}>{o}</span>)}</div>}{p.credito>0&&<div style={{fontSize:10,color:T.blue,marginTop:4}}>Crédito: {p.credito} días</div>}</Card>})}</div></div>}


    {sec==="finanzas"&&<div>
        {/* Banner DESHACER última importación */}
        {(()=>{
          try{
            const ul=JSON.parse(localStorage.getItem("ev_ultimoLote")||"null");
            if(!ul)return null;
            const minutos=Math.floor((Date.now()-ul.timestamp)/60000);
            // Solo mostrar si fue en las últimas 2 horas
            if(minutos>120)return null;
            const tiempo=minutos<1?"hace unos segundos":minutos<60?"hace "+minutos+" min":"hace "+Math.floor(minutos/60)+"h";
            return <div style={{background:"linear-gradient(135deg,rgba(66,165,245,.10),rgba(66,165,245,.04))",border:"1px solid "+T.blue+"55",borderRadius:10,padding:"10px 14px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:12,fontWeight:800,color:T.blue}}>📥 Importaste {ul.count} movimientos ({ul.tipo}) {tiempo}</div>
                <div style={{fontSize:10,color:T.muted,marginTop:2}}>Si te equivocaste, puedes deshacer en un solo clic.</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>{try{localStorage.removeItem("ev_ultimoLote");}catch{};show("✓ Confirmado");}} style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+T.green+"44",background:"rgba(76,175,80,.08)",color:T.green,fontSize:11,fontWeight:700,cursor:"pointer"}}>✓ Está bien</button>
                <button onClick={async()=>{
                  if(!confirm("¿Deshacer la importación de "+ul.count+" movimientos?\n\nIrán a la Papelera, puedes recuperarlos por 30 días."))return;
                  const aBorrar=movs.filter(m=>m.loteImport===ul.loteId);
                  if(aBorrar.length===0){show("⚠️ No encontré los movimientos del lote");return;}
                  aBorrar.forEach(m=>enviarAPapelera("mov",m,m.desc+" (deshacer import)"));
                  const newMovs=movs.filter(m=>m.loteImport!==ul.loteId);
                  setMovs(newMovs);
                  _lastWrite.current["movs"]=Date.now()+15000;
                  try{localStorage.removeItem("ev_ultimoLote");}catch{}
                  show("⬅️ "+aBorrar.length+" movs deshechos · en la Papelera");
                }} style={{padding:"6px 12px",borderRadius:6,border:"none",background:T.red,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer"}}>⬅️ Deshacer importación</button>
              </div>
            </div>;
          }catch{return null;}
        })()}
        {/* === STATS HORIZONTALES estilo VAARQ (1 línea) === */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"rgba(255,255,255,.02)",border:"1px solid "+T.border,borderRadius:8,marginBottom:10,flexWrap:"wrap",gap:14}}>
          <div style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:.8}}>Entradas</span>
              <span style={{fontSize:18,fontWeight:800,color:T.green}}>{$(finIng)}</span>
            </div>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:.8}}>Salidas</span>
              <span style={{fontSize:18,fontWeight:800,color:T.red}}>{$(finEgr)}</span>
            </div>
            <div onClick={()=>finIng-finEgr<0?om("analisisDesfase"):null} style={{display:"flex",alignItems:"baseline",gap:6,cursor:finIng-finEgr<0?"pointer":"default"}} title={finIng-finEgr<0?"Click para analizar desfase":""}>
              <span style={{fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:.8}}>Neto</span>
              <span style={{fontSize:18,fontWeight:800,color:finIng-finEgr>=0?T.green:T.red}}>{$(finIng-finEgr)}</span>
              {finIng-finEgr<0&&<span style={{fontSize:10,color:T.red,marginLeft:2}}>🔍</span>}
            </div>
          </div>
          <span style={{fontSize:11,color:T.muted}}>{finFilt.length} movimientos</span>
        </div>
        {/* Banner de alerta cuando hay desfase */}
        {finIng-finEgr<0&&<div onClick={()=>om("analisisDesfase")} style={{background:"linear-gradient(135deg,rgba(231,76,60,.12),rgba(231,76,60,.04))",border:"1px solid "+T.red+"44",borderRadius:10,padding:"10px 14px",marginBottom:10,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontSize:11,color:T.red,fontWeight:800,letterSpacing:.5}}>🚨 Hay un desfase de {$(Math.abs(finIng-finEgr))}</div>
            <div style={{fontSize:10,color:T.muted,marginTop:2}}>Click aquí para ver qué obras lo están causando</div>
          </div>
          <span style={{color:T.red,fontSize:18,fontWeight:800}}>→</span>
        </div>}
        {/* === TOOLBAR PRINCIPAL: Acciones primarias grandes === */}
        <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
          <button style={{padding:"10px 20px",borderRadius:8,border:"none",background:T.green,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:6}} onClick={()=>om("addIng")}>＋ Ingreso</button>
          <button style={{padding:"10px 20px",borderRadius:8,border:"none",background:T.red,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:6}} onClick={()=>om("addEgr")}>＋ Egreso</button>
          <div style={{flex:1}}/>
          <button style={{padding:"10px 16px",borderRadius:8,border:"1px solid "+T.border,background:"transparent",color:T.muted,fontWeight:600,fontSize:12,cursor:"pointer"}} onClick={()=>{const rows=[["Fecha","Tipo","Concepto","Proveedor/Cliente","Obra","Categoría","Ingreso","Egreso","Usuario","Status"]];finFilt.forEach(m=>{rows.push([m.fecha,m.t==="ing"?"Ingreso":m.t==="egr"?"Egreso":m.t==="caja"?"Caja Chica":"Otro",'"'+(m.desc||"").replace(/"/g,"'")+'"','"'+(m.prov||"").replace(/"/g,"'")+'"','"'+(m.obra||"").replace(/"/g,"'")+'"','"'+(m.cat||"").replace(/"/g,"'")+'"',m.t==="ing"?m.monto:"",m.t!=="ing"?m.monto:"",'"'+(m.user||"").replace(/"/g,"'")+'"',m.status||"aprobado"]);});const csv="\uFEFF"+rows.map(r=>r.join(",")).join("\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="Finanzas_Ensamble_"+td()+".csv";a.click();URL.revokeObjectURL(url);show("📥 Exportado "+finFilt.length+" movimientos");}}>📥 Exportar</button>
          <button style={{padding:"10px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,"+T.gold+","+T.orange+")",color:"#fff",fontWeight:800,fontSize:12,cursor:"pointer",boxShadow:"0 2px 8px rgba(201,149,107,.3)"}} onClick={()=>om("menuImportar")} title="Opciones de importación masiva">📥 Importar ▾</button>
          <button style={{padding:"10px 12px",borderRadius:8,border:"1px solid "+T.border,background:"transparent",color:T.muted,fontWeight:600,fontSize:13,cursor:"pointer"}} onClick={()=>setMostrarHerramientas(!mostrarHerramientas)} title="Herramientas avanzadas">⋯</button>
        </div>
        {/* === TOOLBAR SECUNDARIO (oculto): Herramientas avanzadas === */}
        {mostrarHerramientas&&<div style={{display:"flex",gap:6,marginBottom:8,padding:"8px 10px",background:"rgba(255,255,255,.02)",border:"1px solid "+T.border,borderRadius:8,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginRight:4}}>🛠 Herramientas:</span>
          <button style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+T.red+"33",background:"transparent",color:T.red,fontSize:11,cursor:"pointer",fontWeight:600}} onClick={()=>{
            const fixDate=f=>{if(!f)return"";f=String(f).trim();if(/^\d{4}-\d{2}-\d{2}/.test(f))return f.slice(0,10);if(/^\d{2}\/\d{2}\/\d{4}$/.test(f)){const[d,mm,y]=f.split("/");return y+"-"+mm+"-"+d;}if(/^\d{2}-\d{2}-\d{4}$/.test(f)){const[d,mm,y]=f.split("-");return y+"-"+mm+"-"+d;}return f;};
            const norm=s=>(s||"").toString().toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ");
            const dups=[];const seen=new Set();
            for(let i=0;i<finAll.length;i++){if(seen.has(finAll[i].id))continue;const a=finAll[i];const aDesc=norm(a.desc);const aFechaStr=fixDate(a.fecha);if(!aFechaStr||!/^\d{4}-\d{2}-\d{2}$/.test(aFechaStr))continue;const aFecha=new Date(aFechaStr+"T12:00:00").getTime();if(isNaN(aFecha))continue;for(let j=i+1;j<finAll.length;j++){const b=finAll[j];if(seen.has(b.id))continue;if(b.t!==a.t)continue;if(Math.abs(b.monto-a.monto)>0.5)continue;if(norm(b.desc)!==aDesc)continue;const bFechaStr=fixDate(b.fecha);if(!/^\d{4}-\d{2}-\d{2}$/.test(bFechaStr))continue;const bFecha=new Date(bFechaStr+"T12:00:00").getTime();if(isNaN(bFecha))continue;if(Math.abs(bFecha-aFecha)>2*86400000)continue;dups.push(b.id);seen.add(b.id);}}
            if(dups.length===0){show("✅ No se detectaron duplicados");return;}
            setSelMovs(dups);show("🔍 "+dups.length+" duplicados detectados");
          }}>🔍 Detectar duplicados</button>
          <button style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+T.yellow+"33",background:"transparent",color:T.yellow,fontSize:11,cursor:"pointer",fontWeight:600}} onClick={()=>{
            const fixDate=f=>{if(!f)return"";f=String(f).trim();if(/^\d{4}-\d{2}-\d{2}/.test(f))return f.slice(0,10);if(/^\d{2}\/\d{2}\/\d{4}$/.test(f)){const[d,mm,y]=f.split("/");return y+"-"+mm+"-"+d;}if(/^\d{2}-\d{2}-\d{4}$/.test(f)){const[d,mm,y]=f.split("-");return y+"-"+mm+"-"+d;}return f;};
            let nMovs=0,nCaja=0;
            const newMovs=movs.map(m=>{const nf=fixDate(m.fecha);if(nf!==m.fecha){nMovs++;return{...m,fecha:nf};}return m;});
            const newCaja=caja.map(c=>{const nf=fixDate(c.fecha);if(nf!==c.fecha){nCaja++;return{...c,fecha:nf};}return c;});
            if(nMovs===0&&nCaja===0){show("✅ Fechas OK");return;}
            if(!confirm("Reparar "+nMovs+" movs y "+nCaja+" caja con fecha mal?"))return;
            setMovs(newMovs);setCaja(newCaja);show("🛠 "+(nMovs+nCaja)+" fechas reparadas");
          }}>🛠 Reparar fechas</button>
          <button style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+T.purple+"55",background:finFantasmas.length>0?"rgba(171,71,188,.08)":"transparent",color:T.purple,fontSize:11,cursor:"pointer",fontWeight:700}} onClick={()=>om("fusionarObras")}>🔀 Fusionar obras {finFantasmas.length>0&&<span style={{background:T.yellow+"33",color:T.yellow,padding:"1px 5px",borderRadius:6,fontSize:9,marginLeft:3}}>{finFantasmas.length} fantasma{finFantasmas.length!==1?"s":""}</span>}</button>
          <button style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+T.gold+"66",background:"linear-gradient(135deg,rgba(201,149,107,.12),rgba(201,149,107,.04))",color:T.gold,fontSize:11,cursor:"pointer",fontWeight:700}} onClick={()=>om("prorratear")} title="Repartir un gasto fijo (renta, luz, IMSS) entre las obras activas">🧮 Prorratear gasto</button>
          <button style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+T.blue+"55",background:finIng-finEgr<0?"rgba(231,76,60,.08)":"rgba(66,165,245,.08)",color:finIng-finEgr<0?T.red:T.blue,fontSize:11,cursor:"pointer",fontWeight:700}} onClick={()=>om("analisisDesfase")}>🔍 Analizar desfase {finIng-finEgr<0&&<span style={{background:T.red+"33",color:T.red,padding:"1px 5px",borderRadius:6,fontSize:9,marginLeft:3}}>{$(finIng-finEgr)}</span>}</button>
          <button style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+T.red,background:"transparent",color:T.red,fontSize:11,cursor:"pointer",fontWeight:700}} onClick={()=>{
            const total=movs.length+caja.length;if(total===0){show("✅ Sistema ya está vacío");return;}
            if(!confirm("⚠️ Vas a BORRAR "+total+" movimientos. ¿Continuar?"))return;
            if(!confirm("⚠️ Última oportunidad. ¿100% seguro?"))return;
            const conf=prompt("Escribe: BORRAR TODO");
            if(conf!=="BORRAR TODO"){show("Cancelado");return;}
            setMovs([]);setCaja([]);setSelMovs([]);show("🧹 "+total+" eliminados");
          }}>🚨 Borrar TODO</button>
        </div>}
        <div style={{display:"flex",gap:4,marginBottom:8,overflowX:"auto",paddingBottom:2}}>
          {[{k:"todo",l:"Todo",c:T.gold},{k:"ing",l:"⬆ Ingresos",c:T.green},{k:"egr",l:"⬇ Egresos",c:T.red},{k:"caja",l:"🧾 Caja Chica",c:T.orange},{k:"nom",l:"📅 Nóminas",c:T.purple},{k:"rec",l:"🧾 Recibos",c:T.blue}].map(f=>
            <button key={f.k} onClick={()=>setFf(f.k)} style={{padding:"6px 14px",borderRadius:20,border:ff===f.k?"2px solid "+f.c:"1px solid "+T.border,background:ff===f.k?f.c+"18":"transparent",color:ff===f.k?f.c:T.muted,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{f.l}</button>
          )}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          <input style={{...sI,flex:1,padding:"8px 12px",fontSize:12}} placeholder="🔍 Buscar concepto, proveedor, obra..." value={fBusq} onChange={e=>setFBusq(e.target.value)}/>
          <select style={{...sI,width:D?220:140,padding:"8px",fontSize:11}} value={fObra} onChange={e=>setFObra(e.target.value)}>
            <option value="">Todas las obras</option>
            {finObras.filter(o=>!o.isFantasma).length>0&&<optgroup label="✓ ACTIVAS">{finObras.filter(o=>!o.isFantasma).map(o=><option key={o.key} value={o.nombre}>{o.nombre}</option>)}</optgroup>}
            {finFantasmas.length>0&&<optgroup label={"⚠️ FANTASMAS ("+finFantasmas.length+") — Fusionar"}>{finFantasmas.map(o=><option key={o.key} value={o.nombre}>⚠️ {o.nombre}</option>)}</optgroup>}
          </select>
          {(ff!=="todo"||fObra||fBusq||fDesde||fHasta||selMovs.length>0)&&<button onClick={()=>{setFf("todo");setFObra("");setFBusq("");setFDesde("");setFHasta("");setSelMovs([]);}} style={{background:"rgba(231,76,60,.08)",border:"1px solid "+T.red+"33",color:T.red,borderRadius:8,padding:"8px 14px",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",fontWeight:700}}>✗ Limpiar todo</button>}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:10,color:T.muted,fontWeight:700,letterSpacing:1}}>📅 PERIODO:</span>
          <input type="date" style={{...sI,width:140,padding:"6px 10px",fontSize:11}} value={fDesde} onChange={e=>setFDesde(e.target.value)}/>
          <span style={{color:T.muted,fontSize:11}}>→</span>
          <input type="date" style={{...sI,width:140,padding:"6px 10px",fontSize:11}} value={fHasta} onChange={e=>setFHasta(e.target.value)}/>
          {(fDesde||fHasta)&&<button onClick={()=>{setFDesde("");setFHasta("");}} style={{background:"rgba(255,255,255,.06)",border:"1px solid "+T.border,color:T.muted,borderRadius:8,padding:"6px 10px",fontSize:10,cursor:"pointer"}}>✗</button>}
          <button onClick={()=>{const d=new Date();const day=d.getDay()||7;const mon=new Date(d);mon.setDate(d.getDate()-(day-1));const sun=new Date(mon);sun.setDate(mon.getDate()+6);setFDesde(mon.toISOString().slice(0,10));setFHasta(sun.toISOString().slice(0,10));}} style={{background:"rgba(76,175,80,.08)",border:"1px solid "+T.green+"55",color:T.green,borderRadius:8,padding:"6px 12px",fontSize:10,cursor:"pointer",fontWeight:700}}>📅 Esta semana</button>
          <button onClick={()=>{const d=new Date();const day=d.getDay()||7;const mon=new Date(d);mon.setDate(d.getDate()-(day-1)-7);const sun=new Date(mon);sun.setDate(mon.getDate()+6);setFDesde(mon.toISOString().slice(0,10));setFHasta(sun.toISOString().slice(0,10));}} style={{background:"rgba(255,213,79,.06)",border:"1px solid "+T.yellow+"33",color:T.yellow,borderRadius:8,padding:"6px 12px",fontSize:10,cursor:"pointer",fontWeight:700}}>Sem pasada</button>
          <button onClick={()=>{const d=new Date();const start=new Date(d);start.setDate(d.getDate()-27);setFDesde(start.toISOString().slice(0,10));setFHasta(d.toISOString().slice(0,10));}} style={{background:"rgba(66,165,245,.06)",border:"1px solid "+T.blue+"33",color:T.blue,borderRadius:8,padding:"6px 12px",fontSize:10,cursor:"pointer",fontWeight:700}}>Últ 4 sem</button>
          <button onClick={()=>{const d=new Date();const m=String(d.getMonth()+1).padStart(2,"0");const y=d.getFullYear();const last=new Date(y,d.getMonth()+1,0).getDate();setFDesde(y+"-"+m+"-01");setFHasta(y+"-"+m+"-"+String(last).padStart(2,"0"));}} style={{background:"rgba(255,255,255,.04)",border:"1px solid "+T.border,color:T.muted,borderRadius:8,padding:"6px 12px",fontSize:10,cursor:"pointer"}}>Este mes</button>
          <button onClick={()=>{const y=new Date().getFullYear();setFDesde(y+"-01-01");setFHasta(y+"-12-31");}} style={{background:"rgba(201,149,107,.08)",border:"1px solid "+T.gold+"33",color:T.gold,borderRadius:8,padding:"6px 12px",fontSize:10,cursor:"pointer",fontWeight:700}}>Este año</button>
        </div>
        {/* === RESUMEN POR SEMANA (cards click para filtrar) === */}
        {(()=>{
          // Agrupar finFilt por semana (lunes-domingo)
          const porSemana={};
          finFilt.forEach(m=>{
            const f=fixDateGlobal(m.fecha||"");
            if(!f)return;
            const d=new Date(f+"T12:00:00");
            if(isNaN(d))return;
            const day=d.getDay()||7;
            const mon=new Date(d);mon.setDate(d.getDate()-(day-1));
            const wk=mon.toISOString().slice(0,10);
            if(!porSemana[wk])porSemana[wk]={inicio:wk,ing:0,egr:0,nMovs:0};
            porSemana[wk].nMovs++;
            if(m.t==="ing")porSemana[wk].ing+=m.monto;
            else porSemana[wk].egr+=m.monto;
          });
          const semanas=Object.values(porSemana).sort((a,b)=>b.inicio.localeCompare(a.inicio)).slice(0,8);
          if(semanas.length<=1)return null; // Si solo hay una semana, no vale la pena mostrar el desglose
          return <div style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:11,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>📊 Desglose por semana ({semanas.length})</div>
              <div style={{fontSize:10,color:T.muted}}>Click una semana para filtrar</div>
            </div>
            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
              {semanas.map(s=>{const bal=s.ing-s.egr;const fin=new Date(s.inicio+"T12:00:00");fin.setDate(fin.getDate()+6);const finStr=fin.toISOString().slice(0,10);return <div key={s.inicio} onClick={()=>{setFDesde(s.inicio);setFHasta(finStr);}} style={{flex:"0 0 auto",minWidth:160,padding:10,background:"rgba(255,255,255,.02)",border:"1px solid "+T.border,borderRadius:8,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(201,149,107,.06)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.02)"}>
                <div style={{fontSize:10,color:T.muted,fontWeight:700,marginBottom:4}}>📅 {fd(s.inicio)} - {fd(finStr)}</div>
                <div style={{display:"grid",gap:2}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:T.muted}}>Ingresos</span><span style={{color:T.green,fontWeight:700}}>+{$(s.ing)}</span></div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:T.muted}}>Egresos</span><span style={{color:T.red,fontWeight:700}}>-{$(s.egr)}</span></div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,paddingTop:3,marginTop:3,borderTop:"1px solid "+T.border}}><span style={{fontWeight:700}}>Balance</span><span style={{color:bal>=0?T.green:T.red,fontWeight:800}}>{$(bal)}</span></div>
                  <div style={{fontSize:9,color:T.dim,textAlign:"right",marginTop:2}}>{s.nMovs} movs</div>
                </div>
              </div>;})}
            </div>
          </div>;
        })()}
        {user.rol==="admin"&&selMovs.length>0&&<div style={{background:"rgba(231,76,60,.12)",border:"1px solid "+T.red+"66",borderRadius:8,padding:"10px 14px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <span style={{color:T.red,fontWeight:700,fontSize:12}}>🗑 {selMovs.length} seleccionado(s) de {finFilt.length} filtrados</span>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setSelMovs([])} style={{background:"rgba(255,255,255,.06)",border:"none",color:T.muted,borderRadius:6,padding:"6px 12px",fontSize:11,cursor:"pointer",fontWeight:700}}>Limpiar selección</button>
            <button onClick={()=>{setDelConfText("");om("delMasivo");}} style={{background:T.red,border:"none",color:"#fff",borderRadius:6,padding:"6px 14px",fontSize:11,cursor:"pointer",fontWeight:800}}>🗑 Eliminar {selMovs.length}</button>
          </div>
        </div>}
        <div style={{borderRadius:8,border:"1px solid #333",overflow:"hidden",fontSize:12}}>
          <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
            <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed",minWidth:D?760:480}}>
              <thead>
                <tr style={{background:"#1a1a1a",borderBottom:"2px solid #444"}}>
                  {user.rol==="admin"&&<th style={{padding:"6px 4px",textAlign:"center",fontSize:10,fontWeight:700,color:T.gold,borderRight:"1px solid #333",width:28}}><input type="checkbox" checked={finFilt.length>0&&selMovs.length===finFilt.length} onChange={e=>setSelMovs(e.target.checked?finFilt.map(m=>m.id):[])} style={{cursor:"pointer",width:14,height:14,accentColor:T.gold}} title="Seleccionar todos los visibles"/></th>}
                  <th style={{padding:"6px 6px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.5,whiteSpace:"nowrap",borderRight:"1px solid #333",width:32}}>#</th>
                  <SortTh col="fecha" label="Fecha" sort={sortFin} setSort={setSortFin} style={{padding:"6px 6px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.5,whiteSpace:"nowrap",borderRight:"1px solid #333",width:72}}/>
                  <SortTh col="desc" label="Concepto" sort={sortFin} setSort={setSortFin} style={{padding:"6px 6px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.5,borderRight:"1px solid #333"}}/>
                  {D&&<SortTh col="prov" label="Prov / Cliente" sort={sortFin} setSort={setSortFin} style={{padding:"6px 6px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.5,whiteSpace:"nowrap",borderRight:"1px solid #333",width:110}}/>}
                  {D&&<SortTh col="obra" label="Obra" sort={sortFin} setSort={setSortFin} style={{padding:"6px 6px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.5,whiteSpace:"nowrap",borderRight:"1px solid #333",width:100}}/>}
                  <SortTh col="status" label="Status" sort={sortFin} setSort={setSortFin} style={{padding:"6px 6px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.5,whiteSpace:"nowrap",borderRight:"1px solid #333",width:70}}/>
                  <SortTh col="monto" label="Ingreso" sort={sortFin} setSort={setSortFin} style={{padding:"6px 6px",textAlign:"right",fontSize:9,fontWeight:700,color:T.green,textTransform:"uppercase",letterSpacing:.5,whiteSpace:"nowrap",borderRight:"1px solid #333",width:88}}/>
                  <SortTh col="monto" label="Egreso" sort={sortFin} setSort={setSortFin} style={{padding:"6px 6px",textAlign:"right",fontSize:9,fontWeight:700,color:T.red,textTransform:"uppercase",letterSpacing:.5,whiteSpace:"nowrap",borderRight:"1px solid #333",width:88}}/>
                  {D&&<SortTh col="user" label="Usuario" sort={sortFin} setSort={setSortFin} style={{padding:"6px 6px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.5,whiteSpace:"nowrap",borderRight:"1px solid #333",width:80}}/>}
                  {user.rol==="admin"&&<th style={{padding:"6px 6px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,width:52}}></th>}
                </tr>
              </thead>
              <tbody>
                {/* Fila de FILTROS POR COLUMNA (estilo Excel) */}
                <tr style={{background:"rgba(255,255,255,.02)",borderBottom:"1px solid #333"}}>
                  {user.rol==="admin"&&<td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}></td>}
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}></td>
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}></td>
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}>
                    <input value={fcConcepto} onChange={e=>setFcConcepto(e.target.value)} placeholder="filtrar..." style={{width:"100%",background:"transparent",border:"1px solid "+T.border,color:T.text,fontSize:10,padding:"2px 6px",borderRadius:3,outline:"none"}}/>
                  </td>
                  {D&&<td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}>
                    <input value={fcProv} onChange={e=>setFcProv(e.target.value)} placeholder="filtrar..." style={{width:"100%",background:"transparent",border:"1px solid "+T.border,color:T.text,fontSize:10,padding:"2px 6px",borderRadius:3,outline:"none"}}/>
                  </td>}
                  {D&&<td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}>
                    <input value={fcObraCol} onChange={e=>setFcObraCol(e.target.value)} placeholder="filtrar..." style={{width:"100%",background:"transparent",border:"1px solid "+T.border,color:T.text,fontSize:10,padding:"2px 6px",borderRadius:3,outline:"none"}}/>
                  </td>}
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}></td>
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}></td>
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}></td>
                  {D&&<td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}>
                    <input value={fcUser} onChange={e=>setFcUser(e.target.value)} placeholder="filtrar..." style={{width:"100%",background:"transparent",border:"1px solid "+T.border,color:T.text,fontSize:10,padding:"2px 6px",borderRadius:3,outline:"none"}}/>
                  </td>}
                  {user.rol==="admin"&&<td style={{padding:"3px 6px"}}>
                    {(fcConcepto||fcProv||fcObraCol||fcUser)&&<button onClick={()=>{setFcConcepto("");setFcProv("");setFcObraCol("");setFcUser("");}} style={{background:"transparent",border:"none",color:T.red,fontSize:11,cursor:"pointer"}} title="Limpiar filtros columnas">✕</button>}
                  </td>}
                </tr>
                {finFilt.length===0&&<tr><td colSpan={D?(user.rol==="admin"?10:9):(user.rol==="admin"?6:5)} style={{padding:30,textAlign:"center",color:T.dim}}>Sin resultados</td></tr>}
                {[...finFilt].sort((a,b)=>cmpVal(a[sortFin.col],b[sortFin.col],sortFin.dir)).map((m,idx)=>{const isP=m.status==="pendiente"&&m.t==="caja";const isHl=highlightedIds.has(m.id);return <tr key={m.id}
                  onClick={()=>{if(m.ticket)om("verTicket",m);if(m.rec)om("vRec",recibos.find(r=>r.id===m.rec));}}
                  style={{background:isHl?"rgba(76,175,80,.18)":isP?"rgba(241,196,15,.05)":idx%2===0?"rgba(255,255,255,.01)":"transparent",borderBottom:"1px solid #2a2a2a",cursor:m.ticket||m.rec?"pointer":"default",transition:"background .8s",boxShadow:isHl?"inset 4px 0 0 "+T.green:"none"}}
                  onMouseEnter={e=>{if(!isHl)e.currentTarget.style.background="rgba(201,149,107,.06)";}}
                  onMouseLeave={e=>{if(!isHl)e.currentTarget.style.background=isP?"rgba(241,196,15,.05)":idx%2===0?"rgba(255,255,255,.01)":"transparent";}}>
                  {user.rol==="admin"&&<td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a",textAlign:"center"}} onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selMovs.includes(m.id)} onChange={e=>{if(e.target.checked)setSelMovs([...selMovs,m.id]);else setSelMovs(selMovs.filter(x=>x!==m.id));}} style={{cursor:"pointer",width:16,height:16,accentColor:T.gold}}/></td>}
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a",color:T.dim,fontSize:10,whiteSpace:"nowrap"}}>{idx+1}</td>
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a",color:T.muted,whiteSpace:"nowrap",fontSize:11}}>{fd(m.fecha)}</td>
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap",overflow:"hidden"}}>
                      <span style={{fontWeight:600,fontSize:12,overflow:"hidden",textOverflow:"ellipsis"}}>{m.desc}</span>
                      {(m.cat&&m.cat!=="Caja Chica")&&<span style={{fontSize:10,color:T.dim,flexShrink:0}}>· {m.cat}</span>}
                      {m.ticket&&<span style={{fontSize:10,color:T.blue,flexShrink:0}}>📷</span>}
                    </div>
                  </td>
                  {D&&<td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a",color:T.muted,fontSize:11,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.prov||"-"}</td>}
                  {D&&<td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a",fontSize:11,maxWidth:130,whiteSpace:"nowrap"}} title="Click para cambiar la obra"><select value={m.obra||""} onClick={e=>e.stopPropagation()} onChange={e=>{
                    const nueva=e.target.value;
                    if(nueva===m.obra)return;
                    // Solo permite obras del catálogo. Si es "" queda como "sin obra"
                    setMovs(prev=>prev.map(x=>x.id===m.id?{...x,obra:nueva}:x));
                    show("✓ Obra actualizada: "+(nueva||"sin obra"));
                  }} style={{background:m.obra?"transparent":"rgba(255,213,79,.06)",border:"1px solid transparent",color:m.obra?T.gold:T.yellow,fontSize:11,cursor:"pointer",width:"100%",padding:"1px 2px",fontWeight:m.obra?400:600,outline:"none"}} onMouseEnter={e=>e.target.style.border="1px solid "+T.gold+"44"} onMouseLeave={e=>e.target.style.border="1px solid transparent"}>
                    <option value="" style={{background:"#1a1a1a"}}>— sin obra —</option>
                    {obras.slice().sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(o=><option key={o.id} value={o.nombre} style={{background:"#1a1a1a"}}>{o.nombre}</option>)}
                    {/* Si el mov tiene una obra que ya no existe en obras[], la mostramos como "fantasma" para no perderla */}
                    {m.obra&&!obras.some(o=>normSearch(o.nombre)===normSearch(m.obra))&&<option value={m.obra} style={{background:"#2a1a1a",color:T.red}}>⚠️ {m.obra} (fantasma)</option>}
                  </select></td>}
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a",textAlign:"center"}}>
                    {isP&&user.rol==="admin"?<div style={{display:"flex",gap:2,justifyContent:"center"}}>
                      <button onClick={e=>{e.stopPropagation();setCaja(caja.map(x=>x.id===m.cajaId?{...x,status:"aprobado"}:x));show("✓");}} style={{background:"#0a2e0a",color:T.green,border:"none",borderRadius:3,padding:"1px 5px",fontSize:10,cursor:"pointer",fontWeight:700}}>✓</button>
                      <button onClick={e=>{e.stopPropagation();setCaja(caja.map(x=>x.id===m.cajaId?{...x,status:"rechazado"}:x));show("✗");}} style={{background:"#2a0a0a",color:T.red,border:"none",borderRadius:3,padding:"1px 5px",fontSize:10,cursor:"pointer",fontWeight:700}}>✗</button>
                    </div>:<Badge s={m.status}/>}
                  </td>
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a",textAlign:"right",fontWeight:700,color:m.t==="ing"?T.green:T.dim,whiteSpace:"nowrap",fontSize:12}}>{m.t==="ing"?$(m.monto):""}</td>
                  <td style={{padding:"3px 6px",borderRight:"1px solid #2a2a2a",textAlign:"right",fontWeight:700,color:m.t!=="ing"?T.red:T.dim,whiteSpace:"nowrap",fontSize:12}}>{m.t!=="ing"?$(m.monto):""}</td>
                  {D&&<td style={{padding:"8px 12px",borderRight:"1px solid #2a2a2a",color:T.muted,fontSize:11,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.user?<span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:18,height:18,borderRadius:9,background:T.blue+"22",color:T.blue,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800}}>{m.user.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)}</span><span>{m.user.split(" ")[0]}</span></span>:<span style={{color:T.dim}}>—</span>}</td>}
                  {user.rol==="admin"&&<td style={{padding:"6px 8px",textAlign:"center"}}>
                    <div style={{display:"flex",gap:2,justifyContent:"center"}}>
                      <button onClick={e=>{e.stopPropagation();om("editMov",m);}} style={{background:"rgba(255,255,255,.06)",border:"none",color:T.yellow,cursor:"pointer",fontSize:11,padding:"3px 6px",borderRadius:4}}>✏️</button>
                      <button onClick={e=>{e.stopPropagation();if(confirm("¿Eliminar?\n\nIrá a la Papelera, puedes recuperarlo por 30 días.")){if(m.t==="caja"){const cajaItem=caja.find(x=>x.id===m.cajaId);if(cajaItem)enviarAPapelera("caja",cajaItem);setCaja(caja.filter(x=>x.id!==m.cajaId));}else{const movItem=movs.find(x=>"m"+x.id===m.id);if(movItem)enviarAPapelera("mov",movItem);setMovs(movs.filter(x=>"m"+x.id!==m.id));}show("🗑 A papelera");}}} style={{background:"rgba(231,76,60,.1)",border:"none",color:T.red,cursor:"pointer",fontSize:11,padding:"3px 6px",borderRadius:4}}>🗑</button>
                    </div>
                  </td>}
                </tr>;})}
              </tbody>
              <tfoot>
                <tr style={{background:"#1a1a1a",borderTop:"2px solid #444"}}>
                  <td colSpan={user.rol==="admin"?(D?6:4):(D?5:3)} style={{padding:"10px 12px",fontSize:11,fontWeight:700,color:T.gold}}>TOTAL ({finFilt.length} movimientos)</td>
                  <td style={{padding:"10px 12px",textAlign:"center",borderLeft:"1px solid #333"}}></td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:800,color:T.green,fontSize:13,borderLeft:"1px solid #333"}}>{$(finIng)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:800,color:T.red,fontSize:13,borderLeft:"1px solid #333"}}>{$(finEgr)}</td>
                  {D&&<td style={{borderLeft:"1px solid #333"}}></td>}
                  {user.rol==="admin"&&<td></td>}
                </tr>
                <tr style={{background:"#111"}}>
                  <td colSpan={user.rol==="admin"?(D?6:4):(D?5:3)} style={{padding:"8px 12px",fontSize:11,color:T.muted}}>Balance neto</td>
                  <td style={{borderLeft:"1px solid #333"}}></td>
                  <td colSpan={2} style={{padding:"8px 12px",textAlign:"right",fontWeight:800,fontSize:14,color:finIng-finEgr>=0?T.green:T.red,borderLeft:"1px solid #333"}}>{$(finIng-finEgr)}</td>
                  {D&&<td style={{borderLeft:"1px solid #333"}}></td>}
                  {user.rol==="admin"&&<td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
    </div>}

    {(sec==="finanzas"&&subTab==="caja"||sec==="cajachica")&&(()=>{
      const now=new Date();const day=now.getDay()||7;const monDate=new Date(now);monDate.setDate(now.getDate()-(day-1));const monStr=monDate.toISOString().slice(0,10);
      const cajaWeek=caja.filter(c=>{const cf=c.fecha||"";return cf>=monStr&&c.status!=="rechazado";});
      const cajaWeekTotal=cajaWeek.reduce((s,c)=>s+c.monto,0);
      const presupuesto=5000;
      const resta=presupuesto-cajaWeekTotal;
      // Agrupar por semana
      const weeks={};caja.filter(c=>c.status!=="rechazado").forEach(c=>{const d2=new Date(c.fecha+"T12:00:00");const dy=d2.getDay()||7;const mn=new Date(d2);mn.setDate(d2.getDate()-(dy-1));const wk=mn.toISOString().slice(0,10);if(!weeks[wk])weeks[wk]=[];weeks[wk].push(c);});
      const wkKeys=Object.keys(weeks).sort().reverse();
      return <div>
        <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr 1fr":"1fr 1fr",gap:8,marginBottom:10}}>
          <Card><Stat label="Total Caja Chica" value={$(tCaja)} color={T.orange}/></Card>
          <Card style={{background:"rgba(201,149,107,.06)",borderColor:"rgba(201,149,107,.15)"}}><Stat label="Esta Semana" value={$(cajaWeekTotal)} color={T.gold}/></Card>
          <Card><Stat label={"Presupuesto $"+presupuesto.toLocaleString()} value={$(resta)} color={resta>=0?T.green:T.red}/><Bar v={cajaWeekTotal} mx={presupuesto} c={cajaWeekTotal>presupuesto?T.red:T.green} h={4}/></Card>
          {cajaPend>0&&<Card style={{borderColor:T.yellow+"33"}}><Stat label="Por Aprobar" value={cajaPend} color={T.yellow}/></Card>}
        </div>
        <button style={{...sB,marginBottom:10,marginTop:0,maxWidth:300}} onClick={()=>om("addCj")}>+ Gasto</button>
        {/* TABLA COMPACTA TIPO EXCEL */}
        {caja.length>0?<div style={{borderRadius:8,border:"1px solid #333",overflow:"hidden",fontSize:12}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:D?720:480}}>
              <thead>
                <tr style={{background:"#1a1a1a",borderBottom:"2px solid #444"}}>
                  <SortTh col="fecha" label="Fecha" sort={sortCaja} setSort={setSortCaja} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:90}}/>
                  <SortTh col="concepto" label="Concepto" sort={sortCaja} setSort={setSortCaja} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,borderRight:"1px solid #333"}}/>
                  {D&&<SortTh col="resp" label="Resp" sort={sortCaja} setSort={setSortCaja} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:100}}/>}
                  {D&&<SortTh col="obra" label="Obra" sort={sortCaja} setSort={setSortCaja} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:130}}/>}
                  <SortTh col="status" label="Status" sort={sortCaja} setSort={setSortCaja} style={{padding:"8px 10px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:80}}/>
                  <SortTh col="monto" label="Monto" sort={sortCaja} setSort={setSortCaja} style={{padding:"8px 10px",textAlign:"right",fontSize:9,fontWeight:700,color:T.orange,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:100}}/>
                  {user.rol==="admin"&&<th style={{padding:"8px 10px",textAlign:"center",fontSize:9,fontWeight:700,color:T.muted,width:90}}></th>}
                </tr>
              </thead>
              <tbody>
                {wkKeys.map(wk=>{const items=[...weeks[wk]].sort((a,b)=>cmpVal(a[sortCaja.col],b[sortCaja.col],sortCaja.dir));const wkTot=items.reduce((s,c)=>s+c.monto,0);const colSpan=D?(user.rol==="admin"?7:6):(user.rol==="admin"?5:4);return [
                  <tr key={wk+"-h"} style={{background:"rgba(201,149,107,.06)",borderBottom:"1px solid #2a2a2a"}}>
                    <td colSpan={colSpan-1} style={{padding:"5px 10px",fontSize:10,fontWeight:700,color:T.gold,letterSpacing:.5,textTransform:"uppercase"}}>📅 Semana del {fd(wk)} <span style={{color:T.muted,fontWeight:500,marginLeft:6}}>({items.length} gasto{items.length!==1?"s":""})</span></td>
                    <td style={{padding:"5px 10px",textAlign:"right",fontSize:11,fontWeight:800,color:T.orange,whiteSpace:"nowrap"}}>{$(wkTot)}</td>
                  </tr>,
                  ...items.map((c,idx)=>{const isP=c.status==="pendiente";return <tr key={c.id}
                    onClick={()=>{if(c.ticket)om("verTicket",c);}}
                    style={{background:isP?"rgba(241,196,15,.05)":idx%2===0?"rgba(255,255,255,.01)":"transparent",borderBottom:"1px solid #2a2a2a",cursor:c.ticket?"pointer":"default"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(201,149,107,.06)"}
                    onMouseLeave={e=>e.currentTarget.style.background=isP?"rgba(241,196,15,.05)":idx%2===0?"rgba(255,255,255,.01)":"transparent"}>
                    <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",color:T.muted,whiteSpace:"nowrap",fontSize:11}}>{fd(c.fecha)}</td>
                    <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontWeight:600,fontSize:12}}>{c.concepto}</span>
                        {c.ticket&&<span style={{fontSize:10,color:T.blue}} title="Tiene ticket">📷</span>}
                      </div>
                    </td>
                    {D&&<td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",color:T.muted,fontSize:11,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.resp?<span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:18,height:18,borderRadius:9,background:T.orange+"22",color:T.orange,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800}}>{c.resp.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)}</span><span>{c.resp.split(" ")[0]}</span></span>:<span style={{color:T.dim}}>—</span>}</td>}
                    {D&&<td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",fontSize:11,maxWidth:130,whiteSpace:"nowrap"}} title="Click para cambiar la obra"><select value={c.obra||""} onClick={e=>e.stopPropagation()} onChange={e=>{
                      const nueva=e.target.value;
                      if(nueva===c.obra)return;
                      setCaja(prev=>prev.map(x=>x.id===c.id?{...x,obra:nueva}:x));
                      show("✓ Obra actualizada: "+(nueva||"sin obra"));
                    }} style={{background:c.obra?"transparent":"rgba(255,213,79,.06)",border:"1px solid transparent",color:c.obra&&c.obra!=="General"?T.gold:T.dim,fontSize:11,cursor:"pointer",width:"100%",padding:"1px 2px",outline:"none"}} onMouseEnter={e=>e.target.style.border="1px solid "+T.gold+"44"} onMouseLeave={e=>e.target.style.border="1px solid transparent"}>
                      <option value="" style={{background:"#1a1a1a"}}>— sin obra —</option>
                      <option value="General" style={{background:"#1a1a1a"}}>General</option>
                      {obras.slice().sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(o=><option key={o.id} value={o.nombre} style={{background:"#1a1a1a"}}>{o.nombre}</option>)}
                      {c.obra&&c.obra!=="General"&&!obras.some(o=>normSearch(o.nombre)===normSearch(c.obra))&&<option value={c.obra} style={{background:"#2a1a1a",color:T.red}}>⚠️ {c.obra} (fantasma)</option>}
                    </select></td>}
                    <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",textAlign:"center"}}>
                      {isP&&user.rol==="admin"?<div style={{display:"flex",gap:2,justifyContent:"center"}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>{setCaja(caja.map(x=>x.id===c.id?{...x,status:"aprobado"}:x));show("✓");}} style={{background:"#0a2e0a",color:T.green,border:"none",borderRadius:4,padding:"2px 6px",fontSize:10,cursor:"pointer",fontWeight:700}} title="Aprobar">✓</button>
                        <button onClick={()=>{setCaja(caja.map(x=>x.id===c.id?{...x,status:"rechazado"}:x));show("✗");}} style={{background:"#2a0a0a",color:T.red,border:"none",borderRadius:4,padding:"2px 6px",fontSize:10,cursor:"pointer",fontWeight:700}} title="Rechazar">✗</button>
                      </div>:<Badge s={c.status||"aprobado"}/>}
                    </td>
                    <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",textAlign:"right",fontWeight:800,color:T.orange,whiteSpace:"nowrap",fontSize:13}}>{$(c.monto)}</td>
                    {user.rol==="admin"&&<td style={{padding:"4px 6px",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                      <div style={{display:"flex",gap:2,justifyContent:"center"}}>
                        <button onClick={()=>om("editCj",c)} style={{background:"rgba(255,255,255,.06)",border:"none",color:T.yellow,cursor:"pointer",fontSize:11,padding:"3px 6px",borderRadius:4}} title="Editar">✏️</button>
                        <button onClick={()=>{if(confirm("¿Eliminar este gasto?\n\nIrá a la Papelera 30 días.")){enviarAPapelera("caja",c);setCaja(caja.filter(x=>x.id!==c.id));show("🗑 A papelera");}}} style={{background:"rgba(231,76,60,.1)",border:"none",color:T.red,cursor:"pointer",fontSize:11,padding:"3px 6px",borderRadius:4}} title="Eliminar">🗑</button>
                      </div>
                    </td>}
                  </tr>;})
                ];})}
              </tbody>
              <tfoot>
                <tr style={{background:"#1a1a1a",borderTop:"2px solid #444"}}>
                  <td colSpan={D?(user.rol==="admin"?5:4):(user.rol==="admin"?3:2)} style={{padding:"8px 10px",fontSize:11,fontWeight:700,color:T.gold}}>TOTAL ({caja.filter(c=>c.status!=="rechazado").length} gastos)</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,color:T.orange,fontSize:13,borderLeft:"1px solid #333"}}>{$(tCaja)}</td>
                  {user.rol==="admin"&&<td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>:<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin gastos registrados</div></Card>}
      </div>;
    })()}

    {sec==="taller"&&subTab==="catalogo"&&<div><div style={{fontSize:12,fontWeight:700,color:T.gold,marginBottom:8}}>Catálogo ({catalogo.length} productos)</div>{cats.map(cat=><div key={cat} style={{marginBottom:12}}><div style={{fontSize:11,color:T.gold,fontWeight:700,borderBottom:"1px solid "+T.border,paddingBottom:3,marginBottom:4}}>{cat}</div><div style={{display:"grid",gridTemplateColumns:G,gap:6}}>{catalogo.filter(c=>c.cat===cat).map(item=><Card key={item.id}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12}}><b style={{color:T.gold}}>{item.id}</b> {item.desc}</span><span style={{fontWeight:700}}>{$(item.precio)}</span></div></Card>)}</div></div>)}</div>}

    {sec==="taller"&&subTab==="precios"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:14,fontWeight:800,color:T.gold}}>💰 Precios Unitarios para IA</div>
          <div style={{fontSize:11,color:T.muted}}>La IA usa estos precios cuando cotizas con planos. Mantenlos actualizados a tu realidad.</div>
        </div>
        <button style={{...sB,maxWidth:180,marginTop:0,background:T.gold,color:"#000"}} onClick={()=>om("addPrec")}>+ Precio Unitario</button>
      </div>
      {[...new Set(preciosUnit.map(p=>p.cat))].sort().map(catName=>{
        const items=preciosUnit.filter(p=>p.cat===catName);
        return <div key={catName} style={{marginBottom:14}}>
          <div style={{fontSize:11,color:T.gold,fontWeight:700,borderBottom:"1px solid "+T.border,paddingBottom:4,marginBottom:6}}>{catName}</div>
          <div style={{display:"grid",gridTemplateColumns:G,gap:6}}>{items.map(p=> <Card key={p.id} style={{padding:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{p.desc}</div>
                {p.notas&&<div style={{fontSize:10,color:T.muted,marginTop:2}}>{p.notas}</div>}
              </div>
              <div style={{textAlign:"right",minWidth:90}}>
                <div style={{fontWeight:800,color:T.gold,fontSize:14}}>${p.precio.toLocaleString()}</div>
                <div style={{fontSize:10,color:T.muted}}>por {p.unidad}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:4,marginTop:8}}>
              <button onClick={()=>om("editPrec",p)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+T.border,background:"transparent",color:T.yellow,fontSize:10,cursor:"pointer"}}>✏️ Editar</button>
              <button onClick={()=>{if(confirm("¿Eliminar "+p.desc+"?"))setPreciosUnit(prev=>prev.filter(x=>x.id!==p.id));}} style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+T.red+"33",background:"transparent",color:T.red,fontSize:10,cursor:"pointer"}}>🗑</button>
            </div>
          </Card>)}</div>
        </div>;
      })}
      {preciosUnit.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin precios unitarios. Agrega uno para que la IA empiece a cotizar.</div></Card>}
    </div>}
    {sec==="clis"&&!sub&&(()=>{
      const seen=new Set();
      const clisUniq=clis.filter(c=>{const k=normName(c.nombre);if(!k||seen.has(k))return false;seen.add(k);return true;});
      const rows=clisUniq.map(c=>{
        const cn=normName(c.nombre);
        const cOb=obras.filter(o=>normName(o.cliente||"")===cn);
        const cPag=movs.filter(m=>m.ing>0&&cOb.some(o=>sameObra(o.nombre,m.obra))).reduce((s,m)=>s+m.ing,0);
        const cTot=cOb.reduce((s,o)=>s+(o.cotizado||0),0);
        const cMov=movs.filter(m=>cOb.some(o=>sameObra(o.nombre,m.obra))).length+caja.filter(x=>cOb.some(o=>sameObra(o.nombre,x.obra))).length;
        // Obras "reales" = ya autorizadas (no cotización ni cancelada). Es cliente real si tiene una obra real
        // o si no tiene obras (cliente capturado a mano). Los que SOLO tienen cotización viven en Cotizaciones.
        const realObras=cOb.filter(o=>o.fase&&o.fase!=="cotizacion"&&o.fase!=="cancelado");
        const esReal=realObras.length>0||cOb.length===0;
        return {c,cOb,cPag,resta:cTot-cPag,esReal,hasMov:(cMov>0||cPag>0||realObras.length>0)};
      });
      rows.sort((a,b)=>{if(a.hasMov!==b.hasMov)return a.hasMov?-1:1;if(b.cPag!==a.cPag)return b.cPag-a.cPag;return a.c.nombre.localeCompare(b.c.nombre,"es");});
      const visibles=rows.filter(r=>r.esReal);
      const prospectos=rows.length-visibles.length;
      const conMov=visibles.filter(r=>r.hasMov),sinMov=visibles.filter(r=>!r.hasMov);
      const borrarCli=(r)=>{const{c,cOb}=r;if(cOb.length>0){if(!confirm("⚠️ "+c.nombre+" tiene "+cOb.length+" obra(s) vinculadas.\n\nLas obras NO se borran, solo quedan sin cliente.\n\n¿Borrar el cliente?"))return;}else if(!confirm("¿Borrar a "+c.nombre+"?"))return;setClis(prev=>prev.filter(x=>x.id!==c.id));show("🗑 Cliente borrado");};
      const fila=(r)=>{const{c,cOb,cPag,resta}=r;return <Card key={c.id} onClick={()=>setSub(c)} style={{cursor:"pointer",display:"flex",alignItems:"center",gap:10,padding:"12px 14px"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:15,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.nombre}</div>
          <div style={{fontSize:11,color:T.muted,marginTop:2}}>{cOb.length>0?cOb.length+" obra"+(cOb.length>1?"s":""):"Sin obras"}{cPag>0&&<span> · Cobrado <b style={{color:T.green}}>{$(cPag)}</b></span>}{resta>0&&<span> · Resta <b style={{color:T.yellow}}>{$(resta)}</b></span>}</div>
          {(c.tel||c.email)&&<div style={{fontSize:10,color:T.dim,marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.tel}{c.tel&&c.email?" · ":""}{c.email}</div>}
        </div>
        {user.rol==="admin"&&<button onClick={e=>{e.stopPropagation();borrarCli(r);}} title="Borrar cliente" style={{background:"rgba(231,76,60,.1)",border:"1px solid "+T.red+"33",color:T.red,borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>🗑 Borrar</button>}
        <span style={{color:T.dim,fontSize:20}}>›</span>
      </Card>;};
      return <div>
        <button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300}} onClick={()=>om("addCli")}>+ Cliente</button>
        {clis.length!==clisUniq.length&&<button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300,background:"#2a2000",color:T.yellow,border:"1px solid "+T.yellow+"33"}} onClick={()=>{const merged=[];const map={};clis.forEach(c=>{const k=normName(c.nombre);if(!k)return;if(!map[k]){map[k]={...c};merged.push(map[k]);}else{if(c.tel&&!map[k].tel)map[k].tel=c.tel;if(c.email&&!map[k].email)map[k].email=c.email;if(c.dir&&!map[k].dir)map[k].dir=c.dir;}});setClis(merged);show("Clientes duplicados fusionados ✓");}}>🔄 Fusionar {clis.length-clisUniq.length} duplicado(s)</button>}
        {clisUniq.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin clientes</div></Card>}
        {prospectos>0&&<div onClick={()=>go("cotizaciones")} style={{cursor:"pointer",fontSize:11,color:T.muted,background:"rgba(255,183,77,.06)",border:"1px solid "+T.yellow+"22",borderRadius:8,padding:"8px 12px",marginBottom:8}}>📋 {prospectos} {prospectos===1?"prospecto está":"prospectos están"} en cotización (aún no son clientes) → velos en <b style={{color:T.yellow}}>Cotizaciones</b></div>}
        {visibles.length===0&&clisUniq.length>0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Todavía no hay clientes reales. Autoriza una cotización para que pase a Clientes.</div></Card>}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>{conMov.map(fila)}</div>
        {sinMov.length>0&&<div style={{marginTop:16}}>
          <div style={{fontSize:10,color:T.dim,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>— Sin movimiento aún ({sinMov.length}) —</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>{sinMov.map(fila)}</div>
        </div>}
      </div>;
    })()}

    {sec==="clis"&&sub&&<div style={{maxWidth:800}}>
      <button onClick={()=>{setSub(null);setCliObraTab(null);}} style={{background:"none",border:"none",color:T.gold,cursor:"pointer",fontSize:13,padding:0,marginBottom:12}}>← Clientes</button>
      {(()=>{const c=sub;const cn=normName(c.nombre);const cOb=obras.filter(o=>normName(o.cliente||"")===cn);const cPag=movs.filter(m=>m.ing>0&&cOb.some(o=>sameObra(o.nombre,m.obra))).reduce((s,m)=>s+m.ing,0);const cTot=cOb.reduce((s,o)=>s+(o.cotizado||0),0);
      const cGas=movs.filter(m=>m.egr>0&&cOb.some(o=>sameObra(o.nombre,m.obra))).reduce((s,m)=>s+m.egr,0)+caja.filter(x=>x.status!=="rechazado"&&cOb.some(o=>sameObra(o.nombre,x.obra))).reduce((s,x)=>s+x.monto,0);
      const cUtil=cPag-cGas;
      const selOb=cliObraTab?cOb.find(o=>o.id===cliObraTab):null;
      return <div>
        <Card><div style={{fontSize:22,fontWeight:800,marginBottom:4}}>{c.nombre}</div><div style={{fontSize:12,color:T.muted}}>{c.tel&&"📱 "+c.tel}{c.email&&" · "+c.email}</div>{c.dir&&<div style={{fontSize:12,color:T.muted}}>📍 {c.dir}</div>}</Card>
        <div style={{display:"flex",gap:4,marginBottom:10,overflowX:"auto",paddingBottom:2}}>
          <button onClick={()=>setCliObraTab(null)} style={{padding:"8px 16px",borderRadius:20,border:!cliObraTab?"2px solid "+T.gold:"1px solid "+T.border,background:!cliObraTab?T.gold+"18":"transparent",color:!cliObraTab?T.gold:T.muted,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>📊 Resumen Total</button>
          {cOb.map(o=><button key={o.id} onClick={()=>setCliObraTab(o.id)} style={{padding:"8px 16px",borderRadius:20,border:cliObraTab===o.id?"2px solid "+FCC[o.fase]:"1px solid "+T.border,background:cliObraTab===o.id?FCC[o.fase]+"18":"transparent",color:cliObraTab===o.id?FCC[o.fase]:T.muted,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>🏗️ {o.nombre}</button>)}
        </div>

        {!cliObraTab&&<div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
            <Card style={{background:"rgba(201,149,107,.06)",borderColor:"rgba(201,149,107,.15)"}}><Stat label="Cotizado Total" value={$(cTot)} color={T.gold}/></Card>
            <Card style={{background:"rgba(76,175,80,.06)",borderColor:"rgba(76,175,80,.15)"}}><Stat label="Pagado Total" value={$(cPag)} color={T.green}/></Card>
            <Card style={{background:cTot-cPag>0?"rgba(255,215,84,.06)":"rgba(76,175,80,.06)",borderColor:cTot-cPag>0?"rgba(255,215,84,.15)":"rgba(76,175,80,.15)"}}><Stat label="Resta Total" value={$(cTot-cPag)} color={cTot-cPag>0?T.yellow:T.green}/></Card>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
            <Card style={{background:"rgba(239,83,80,.06)",borderColor:"rgba(239,83,80,.15)"}}><Stat label="Gastado en sus obras" value={$(cGas)} color={T.red}/></Card>
            <Card style={{background:cUtil>=0?"rgba(76,175,80,.06)":"rgba(239,83,80,.06)",borderColor:cUtil>=0?"rgba(76,175,80,.15)":"rgba(239,83,80,.15)"}}><Stat label="Utilidad (cobrado − gastado)" value={$(cUtil)} color={cUtil>=0?T.green:T.red}/></Card>
          </div>
          <Card><div style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}><span style={{color:T.muted}}>Pagado total: {$(cPag)}</span><span style={{color:T.gold,fontWeight:700}}>de {$(cTot)}</span></div><Bar v={cPag} mx={cTot} c={T.green} h={8}/><div style={{textAlign:"right",fontSize:10,color:T.muted,marginTop:3}}>{pc(cPag,cTot)}% cobrado</div></div></Card>
          <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,margin:"10px 0 8px"}}>Obras ({cOb.length})</div>
          <div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{cOb.map(ob=>{const obPag=movs.filter(m=>m.ing>0&&sameObra(m.obra,ob.nombre)).reduce((s,m)=>s+m.ing,0);const obGas=movs.filter(m=>m.egr>0&&sameObra(m.obra,ob.nombre)).reduce((s,m)=>s+m.egr,0)+caja.filter(x=>x.status!=="rechazado"&&sameObra(x.obra,ob.nombre)).reduce((s,x)=>s+x.monto,0);return <Card key={ob.id} onClick={()=>setCliObraTab(ob.id)} style={{cursor:"pointer"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><div><div style={{fontWeight:700,fontSize:14}}>{ob.nombre}</div><span style={{fontSize:10,background:FCC[ob.fase]+"33",color:FCC[ob.fase],padding:"2px 8px",borderRadius:8,fontWeight:700}}>{FASES[ob.fase]}</span></div><div style={{textAlign:"right"}}><div style={{fontWeight:800,color:T.gold}}>{$(ob.cotizado)}</div></div></div>
            <Bar v={obPag} mx={ob.cotizado} c={T.green} h={4}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:4,marginTop:8}}>
              <div><div style={{fontSize:8,color:T.muted}}>COTIZADO</div><div style={{fontWeight:700,color:T.gold,fontSize:12}}>{$(ob.cotizado)}</div></div>
              <div><div style={{fontSize:8,color:T.muted}}>PAGADO</div><div style={{fontWeight:700,color:T.green,fontSize:12}}>{$(obPag)}</div></div>
              <div><div style={{fontSize:8,color:T.muted}}>GASTADO</div><div style={{fontWeight:700,color:T.red,fontSize:12}}>{$(obGas)}</div></div>
              <div><div style={{fontSize:8,color:T.muted}}>RESTA</div><div style={{fontWeight:700,color:ob.cotizado-obPag>0?T.yellow:T.green,fontSize:12}}>{$(ob.cotizado-obPag)}</div></div>
            </div>
            {(ob.inicio||ob.entrega)&&<div style={{display:"flex",gap:12,marginTop:6,fontSize:10,color:T.dim}}>
              {ob.inicio&&<span>📅 Inicio: {fd(ob.inicio)}</span>}{ob.entrega&&<span>📅 Entrega: {fd(ob.entrega)}</span>}
            </div>}
          </Card>})}</div>
          {(()=>{const allPagos=movs.filter(m=>m.ing>0&&cOb.some(o=>sameObra(o.nombre,m.obra))).sort((a,b)=>b.fecha>a.fecha?1:-1);return allPagos.length>0?<div style={{marginTop:10}}><div style={{fontSize:10,color:T.green,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Historial de Pagos</div>{allPagos.map((p,i)=><Card key={i}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:600}}>{p.desc}</div><div style={{fontSize:10,color:T.dim}}>{fd(p.fecha)} · {p.obra}</div></div><span style={{fontWeight:800,color:T.green}}>{$(p.ing)}</span></div></Card>)}</div>:null;})()}
        </div>}

        {selOb&&(()=>{const ob=selOb;const pagos=movs.filter(m=>m.ing>0&&sameObra(m.obra,ob.nombre)).sort((a,b)=>a.fecha>b.fecha?1:-1);const obPag=pagos.reduce((s,m)=>s+m.ing,0);const est=ob.estimaciones||[{nombre:"Anticipo 60%",pct:60,fecha:""},{nombre:"Avance 20%",pct:20,fecha:""},{nombre:"Entrega 20%",pct:20,fecha:""}];let acum=0;const estData=est.map(e=>{const monto=Math.round(ob.cotizado*(e.pct/100));const prev=acum;acum+=monto;const pagadoEst=Math.min(monto,Math.max(0,obPag-prev));const falta=monto-pagadoEst;return {...e,monto,pagadoEst,falta,cumplido:pagadoEst>=monto};});return <div>
          <Card style={{padding:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div><div style={{fontWeight:800,fontSize:17}}>{ob.nombre}</div><span style={{fontSize:10,background:FCC[ob.fase]+"33",color:FCC[ob.fase],padding:"3px 10px",borderRadius:8,fontWeight:700}}>{FASES[ob.fase]}</span></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:9,color:T.muted}}>MONTO PACTADO</div><div style={{fontSize:20,fontWeight:800,color:T.gold}}>{$(ob.cotizado)}</div></div>
            </div>
            <Bar v={obPag} mx={ob.cotizado} c={T.green} h={6}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginTop:4,marginBottom:14}}><span style={{color:T.muted}}>Pagado: {$(obPag)} ({pc(obPag,ob.cotizado)}%)</span><span style={{color:obPag<ob.cotizado?T.yellow:T.green,fontWeight:700}}>Resta: {$(ob.cotizado-obPag)}</span></div>
            <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Esquema de Pagos</div>
            {estData.map((e,i)=><div key={i} style={{background:e.cumplido?"rgba(76,175,80,.06)":"rgba(255,255,255,.025)",border:"1px solid "+(e.cumplido?"rgba(76,175,80,.15)":T.border),borderRadius:10,padding:12,marginBottom:6}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:16}}>{e.cumplido?"✅":"⏳"}</span><div><div style={{fontWeight:700,fontSize:13}}>{e.nombre}</div><div style={{fontSize:10,color:T.muted}}>Debe dar: <span style={{color:T.gold,fontWeight:700}}>{$(e.monto)}</span></div></div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:9,color:T.muted}}>FECHA PROGRAMADA</div><input type="date" value={e.fecha||""} onChange={ev=>{const newEst=[...est];newEst[i]={...newEst[i],fecha:ev.target.value};const up={...ob,estimaciones:newEst};setObras(obras.map(o=>o.id===ob.id?up:o));setSub({...sub});}} style={{background:"rgba(255,255,255,.05)",border:"1px solid "+T.border,borderRadius:6,color:T.text,padding:"4px 8px",fontSize:11}}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                <div style={{textAlign:"center",padding:6,background:"rgba(255,255,255,.03)",borderRadius:6}}><div style={{fontSize:8,color:T.muted}}>DEBE DAR</div><div style={{fontWeight:800,color:T.gold,fontSize:14}}>{$(e.monto)}</div></div>
                <div style={{textAlign:"center",padding:6,background:"rgba(76,175,80,.06)",borderRadius:6}}><div style={{fontSize:8,color:T.muted}}>HA DADO</div><div style={{fontWeight:800,color:T.green,fontSize:14}}>{$(e.pagadoEst)}</div></div>
                <div style={{textAlign:"center",padding:6,background:e.falta>0?"rgba(255,215,84,.06)":"rgba(76,175,80,.06)",borderRadius:6}}><div style={{fontSize:8,color:T.muted}}>FALTA</div><div style={{fontWeight:800,color:e.falta>0?T.yellow:T.green,fontSize:14}}>{$(e.falta)}</div></div>
              </div>
            </div>)}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
              <div><div style={{fontSize:9,color:T.muted,marginBottom:3}}>FECHA INICIO</div><input type="date" value={ob.inicio||""} onChange={e=>{const up={...ob,inicio:e.target.value};setObras(obras.map(o=>o.id===ob.id?up:o));setSub({...sub});}} style={{...sI,padding:"8px 10px",fontSize:12}}/></div>
              <div><div style={{fontSize:9,color:T.muted,marginBottom:3}}>FECHA ENTREGA</div><input type="date" value={ob.entrega||""} onChange={e=>{const up={...ob,entrega:e.target.value};setObras(obras.map(o=>o.id===ob.id?up:o));setSub({...sub});}} style={{...sI,padding:"8px 10px",fontSize:12}}/></div>
            </div>
            {pagos.length>0&&<div style={{marginTop:12,paddingTop:10,borderTop:"1px solid "+T.border}}><div style={{fontSize:10,color:T.green,fontWeight:700,marginBottom:6}}>PAGOS RECIBIDOS</div>{pagos.map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.04)",fontSize:12}}><div><span style={{fontWeight:600}}>{p.desc}</span><span style={{color:T.dim,marginLeft:8}}>{fd(p.fecha)}</span></div><span style={{fontWeight:800,color:T.green}}>{$(p.ing)}</span></div>)}</div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:10}}>
              <button onClick={()=>go("obras",ob)} style={{padding:"10px",borderRadius:8,border:"1px solid "+T.gold+"33",background:"rgba(201,149,107,.06)",color:T.gold,fontSize:11,fontWeight:700,cursor:"pointer"}}>🏗️ Ver Obra</button>
              <button onClick={()=>openPdfCli({cli:c,ob,estData,pagos,obPag})} style={{padding:"10px",borderRadius:8,border:"1px solid "+T.green+"33",background:"rgba(76,175,80,.06)",color:T.green,fontSize:11,fontWeight:700,cursor:"pointer"}}>📄 PDF Estado de Cuenta</button>
            </div>
          </Card>
        </div>;})()}

        {cOb.length===0&&<Card style={{textAlign:"center",padding:20,borderColor:T.yellow+"22"}}><div style={{color:T.yellow,marginBottom:6}}>⚠️ Sin obras vinculadas</div><div style={{fontSize:11,color:T.muted}}>El nombre del cliente debe coincidir con el campo "Cliente" en la obra</div></Card>}
      </div>;})()}
    </div>}




    {sec==="docs_sec"&&(()=>{
      const tipos=[{k:"todo",l:"Todos",c:T.gold},{k:"recibo",l:"🧾 Recibos",c:T.green},{k:"cotizacion",l:"📄 Cotizaciones",c:T.gold},{k:"estado_cuenta",l:"👤 Edos. Cuenta",c:T.teal}];
      const filtDocs=documentos.filter(d=>{if(docFilt!=="todo"&&d.tipo!==docFilt)return false;if(!docVerTodo&&d.vigente===false)return false;if(docBusq){const q=docBusq.toLowerCase();if(!d.titulo.toLowerCase().includes(q)&&!d.cliente.toLowerCase().includes(q)&&!d.obra.toLowerCase().includes(q))return false;}return true;}).sort((a,b)=>b.fecha>a.fecha?1:b.fecha<a.fecha?-1:(b.id>a.id?1:-1));
      const obrasConDocs=[...new Set(documentos.map(d=>d.obra).filter(Boolean))].sort();
      const vigentes=documentos.filter(d=>d.vigente!==false);
      const openDoc=(d)=>{if(d.tipo==="recibo"&&d.data){om("vRec",d.data);}else if(d.tipo==="cotizacion"&&d.data?.obraId){const ob2=obras.find(o=>o.id===d.data.obraId);if(ob2)om("pdfCot",ob2);}else if(d.tipo==="estado_cuenta"&&d.data?.obraId){const ob2=obras.find(o=>o.id===d.data.obraId);const cli2=d.data.cliId?clis.find(c=>c.id===d.data.cliId):null;if(ob2&&cli2){const pagos2=movs.filter(m=>m.ing>0&&m.obra===ob2.nombre).sort((a,b2)=>a.fecha>b2.fecha?1:-1);const obPag2=pagos2.reduce((s,m)=>s+m.ing,0);const est2=ob2.estimaciones||[{nombre:"Anticipo 60%",pct:60,fecha:""},{nombre:"Avance 20%",pct:20,fecha:""},{nombre:"Entrega 20%",pct:20,fecha:""}];let ac2=0;const estData2=est2.map(e=>{const mt=Math.round(ob2.cotizado*(e.pct/100));const pv=ac2;ac2+=mt;const pe=Math.min(mt,Math.max(0,obPag2-pv));return{...e,monto:mt,pagadoEst:pe,falta:mt-pe,cumplido:pe>=mt};});om("pdfCli",{cli:cli2,ob:ob2,estData:estData2,pagos:pagos2,obPag:obPag2});}}};
      return <div>
        <div style={{fontSize:18,fontWeight:800,marginBottom:12}}>📁 Documentos</div>
        <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr 1fr":"1fr 1fr",gap:8,marginBottom:10}}>
          <Card><Stat label="Vigentes" value={vigentes.length} color={T.gold}/></Card>
          <Card><Stat label="🧾 Recibos" value={documentos.filter(d=>d.tipo==="recibo").length} color={T.green}/></Card>
          <Card><Stat label="📄 Cotizaciones" value={documentos.filter(d=>d.tipo==="cotizacion").length} color={T.gold}/></Card>
          <Card><Stat label="👤 Edos. Cuenta" value={documentos.filter(d=>d.tipo==="estado_cuenta").length} color={T.teal}/></Card>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>{tipos.map(t=><button key={t.k} onClick={()=>setDocFilt(t.k)} style={{padding:"6px 14px",borderRadius:20,border:docFilt===t.k?"2px solid "+t.c:"1px solid "+T.border,background:docFilt===t.k?t.c+"18":"transparent",color:docFilt===t.k?t.c:T.muted,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{t.l}</button>)}
          <button onClick={()=>setDocVerTodo(!docVerTodo)} style={{padding:"6px 14px",borderRadius:20,border:"1px solid "+(docVerTodo?T.purple:T.border),background:docVerTodo?T.purple+"18":"transparent",color:docVerTodo?T.purple:T.muted,fontSize:11,fontWeight:700,cursor:"pointer",marginLeft:4}}>{docVerTodo?"📚 Historial completo":"📌 Solo vigentes"}</button>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          <input style={{...sI,flex:1,padding:"8px 12px",fontSize:12}} placeholder="🔍 Buscar por nombre, cliente u obra..." value={docBusq} onChange={e=>setDocBusq(e.target.value)}/>
          {docBusq&&<button onClick={()=>setDocBusq("")} style={{background:"rgba(255,255,255,.06)",border:"1px solid "+T.border,color:T.muted,borderRadius:8,padding:"8px 12px",fontSize:11,cursor:"pointer"}}>✗</button>}
        </div>
        {filtDocs.length===0&&<Card style={{textAlign:"center",padding:24}}><div style={{color:T.muted}}>Sin documentos{docFilt!=="todo"||docBusq?" con ese filtro":". Genera un PDF de cotización, recibo o estado de cuenta para verlos aquí."}</div></Card>}
        {obrasConDocs.filter(ob=>filtDocs.some(d=>d.obra===ob)).map(ob=>{const obDocs=filtDocs.filter(d=>d.obra===ob);const obCli=obDocs.find(d=>d.cliente)?.cliente||"";return <div key={ob} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"2px solid "+T.border,marginBottom:6}}>
            <div><span style={{fontSize:11,fontWeight:700,color:T.gold}}>🏗️ {ob}</span>{obCli&&<span style={{fontSize:10,color:T.muted,marginLeft:8}}>· {obCli}</span>}</div>
            <span style={{fontSize:10,color:T.muted}}>{obDocs.length} doc(s)</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:G,gap:6}}>{obDocs.map(d=><Card key={d.id} onClick={()=>openDoc(d)} style={{cursor:"pointer",padding:12,borderColor:d.vigente!==false?"rgba(201,149,107,.12)":"transparent",opacity:d.vigente===false?.6:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:8,flex:1}}>
                <span style={{fontSize:20,marginTop:2}}>{d.tipo==="recibo"?"🧾":d.tipo==="cotizacion"?"📄":"👤"}</span>
                <div><div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}><span style={{fontWeight:700,fontSize:13}}>{d.titulo}</span>{d.vigente!==false&&<span style={{fontSize:8,background:"rgba(76,175,80,.15)",color:T.green,padding:"2px 6px",borderRadius:6,fontWeight:700}}>VIGENTE</span>}{d.vigente===false&&<span style={{fontSize:8,background:"rgba(255,255,255,.06)",color:T.dim,padding:"2px 6px",borderRadius:6}}>v{d.version||"?"}</span>}</div><div style={{fontSize:10,color:T.muted,marginTop:2}}>{fd(d.fecha)}{d.hora&&" "+d.hora}{d.user&&" · "+d.user}</div>{d.cliente&&<div style={{fontSize:10,color:T.muted}}>👤 {d.cliente}</div>}</div>
              </div>
              {d.monto>0&&<span style={{fontWeight:800,color:d.tipo==="recibo"?T.green:d.tipo==="estado_cuenta"?T.teal:T.gold,fontSize:14}}>{$(d.monto)}</span>}
            </div>
          </Card>)}</div>
        </div>})}
        {filtDocs.filter(d=>!d.obra).length>0&&<div><div style={{fontSize:10,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Sin obra asignada</div><div style={{display:"grid",gridTemplateColumns:G,gap:6}}>{filtDocs.filter(d=>!d.obra).map(d=><Card key={d.id} onClick={()=>openDoc(d)} style={{cursor:"pointer",padding:12}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:20}}>{d.tipo==="recibo"?"🧾":"📄"}</span><div><div style={{fontWeight:700,fontSize:13}}>{d.titulo}</div><div style={{fontSize:10,color:T.muted}}>{fd(d.fecha)}{d.hora&&" "+d.hora}</div></div></div>{d.monto>0&&<span style={{fontWeight:800,color:T.green}}>{$(d.monto)}</span>}</div></Card>)}</div></div>}
      </div>;})()}

    {sec==="auditoria"&&<div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:18,fontWeight:800}}>🔬 Auditoría del sistema</div>
        <div style={{fontSize:11,color:T.muted,marginTop:2}}>Detecta y arregla inconsistencias en tus datos: obras duplicadas, variantes de nombre, fantasmas.</div>
      </div>
      {/* Banner urgente: Resincronizar con la nube */}
      <div onClick={()=>om("resincronizar")} style={{background:"linear-gradient(135deg,rgba(66,165,245,.12),rgba(171,71,188,.08))",border:"1px solid "+T.blue+"55",borderRadius:10,padding:"12px 16px",marginBottom:14,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:13,color:T.blue,fontWeight:800}}>🔄 ¿Te falta algo? ¿Cosas que borras reaparecen?</div>
          <div style={{fontSize:11,color:T.muted,marginTop:3}}>Click aquí para comparar lo que tienes local vs lo que hay en la nube y recuperar registros perdidos.</div>
        </div>
        <span style={{color:T.blue,fontSize:20,fontWeight:800}}>→</span>
      </div>
      {/* BOTÓN NUEVO: Normalizar nombres de obras (fuzzy match automático) */}
      <div onClick={()=>om("normalizarObras")} style={{background:"linear-gradient(135deg,rgba(76,175,80,.15),rgba(201,149,107,.08))",border:"2px solid "+T.green+"77",borderRadius:10,padding:"14px 18px",marginBottom:10,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,boxShadow:"0 2px 12px rgba(76,175,80,.15)"}}>
        <div>
          <div style={{fontSize:14,color:T.green,fontWeight:800}}>🪄 1. Normalizar nombres de obras EN MOVS <span style={{background:T.green+"33",color:T.green,fontSize:9,padding:"2px 6px",borderRadius:6,marginLeft:4}}>PASO 1</span></div>
          <div style={{fontSize:11,color:T.muted,marginTop:3}}>Detecta variantes de nombre en tus movimientos (CORAL/coral) y las reemplaza con la versión oficial.</div>
        </div>
        <span style={{color:T.green,fontSize:20,fontWeight:800}}>→</span>
      </div>
      {/* BOTÓN NUEVO: Fusionar obras duplicadas EN EL CATÁLOGO */}
      <div onClick={()=>om("fusionarDuplicadasCatalogo")} style={{background:"linear-gradient(135deg,rgba(171,71,188,.15),rgba(66,165,245,.08))",border:"2px solid "+T.purple+"77",borderRadius:10,padding:"14px 18px",marginBottom:14,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,boxShadow:"0 2px 12px rgba(171,71,188,.15)"}}>
        <div>
          <div style={{fontSize:14,color:T.purple,fontWeight:800}}>🔗 2. Fusionar obras DUPLICADAS del catálogo <span style={{background:T.purple+"33",color:T.purple,fontSize:9,padding:"2px 6px",borderRadius:6,marginLeft:4}}>PASO 2</span></div>
          <div style={{fontSize:11,color:T.muted,marginTop:3}}>Detecta obras REPETIDAS en tu catálogo (ej. "JACARANDA 29 #1" y "JACARANDA 29 #1 (copia)") y las junta en una sola.</div>
        </div>
        <span style={{color:T.purple,fontSize:20,fontWeight:800}}>→</span>
      </div>
      <AuditoriaSistemaView obras={obras} movs={movs} caja={caja}
        onCrearObraFantasma={(nombreFantasma)=>{
          // Calcular ingresos cobrados (suma) y egresos gastados (suma) de ese nombre
          const k=normSearch(nombreFantasma);
          const cob=movs.filter(m=>m.ing>0&&normSearch(m.obra||"")===k).reduce((s,m)=>s+m.ing,0);
          const gas=movs.filter(m=>m.egr>0&&normSearch(m.obra||"")===k).reduce((s,m)=>s+m.egr,0)+caja.filter(c=>normSearch(c.obra||"")===k&&c.status!=="rechazado").reduce((s,c)=>s+c.monto,0);
          // Prompt para cliente y cotizado
          const cliente=prompt("👷 Cliente para '"+nombreFantasma+"' (opcional, puedes dejar vacío):","")||"";
          const cotizadoStr=prompt("💰 Monto cotizado para '"+nombreFantasma+"' (opcional, puedes dejar 0 si no sabes):",String(Math.max(cob,gas)));
          const cotizado=Number(String(cotizadoStr).replace(/[^0-9.]/g,""))||0;
          // Crear la obra con fase "produccion" para que aparezca en Obras inmediatamente
          const nuevaObra={
            id:"OB"+Date.now()+Math.random().toString(36).slice(2,5),
            nombre:nombreFantasma,
            cliente:cliente,
            status:"en_proceso",
            fase:"produccion",
            cotizado:cotizado,
            subtotal:cotizado,
            conIva:false,
            egreso:0,
            avance:cotizado>0?Math.min(100,Math.round((cob/cotizado)*100)):0,
            partidas:[],
            extras:[],
            pagos:[],
            docs:[],
            bitacora:[],
            creadoPor:user.nombre,
            creadoFecha:td(),
            creadoDesdeFantasma:true
          };
          setObras(prev=>[...prev,nuevaObra]);
          _lastWrite.current["obras"]=Date.now()+15000;
          show("✨ Obra '"+nombreFantasma+"' creada con sus "+(cob>0||gas>0?"$"+Math.round(cob).toLocaleString()+" cobrado / $"+Math.round(gas).toLocaleString()+" gastado":"movs")+". Aparece en Obras.");
        }}
        onNormalizar={()=>{
          // 1. Normalizar TODOS los nombres de obra en movs/caja al nombre canónico (de obras[] si existe)
          let nMovs=0,nCaja=0;
          const newMovs=movs.map(m=>{if(!m.obra)return m;const real=obras.find(o=>normSearch(o.nombre)===normSearch(m.obra));if(real&&real.nombre!==m.obra){nMovs++;return{...m,obra:real.nombre};}return m;});
          const newCaja=caja.map(c=>{if(!c.obra)return c;const real=obras.find(o=>normSearch(o.nombre)===normSearch(c.obra));if(real&&real.nombre!==c.obra){nCaja++;return{...c,obra:real.nombre};}return c;});
          // 2. Eliminar obras duplicadas (deja la más completa)
          const seen={};const newObras=[];
          obras.forEach(o=>{const k=normSearch(o.nombre);if(!seen[k]){seen[k]=o;newObras.push(o);}else{
            // Fusionar: sumar cotizado, preservar el más rico
            const idx=newObras.findIndex(x=>normSearch(x.nombre)===k);
            const ex=newObras[idx];
            newObras[idx]={...ex,cotizado:(ex.cotizado||0)+(o.cotizado||0),partidas:[...(ex.partidas||[]),...(o.partidas||[])],pagos:[...(ex.pagos||[]),...(o.pagos||[])],extras:[...(ex.extras||[]),...(o.extras||[])]};
          }});
          const nObrasFusionadas=obras.length-newObras.length;
          setMovs(newMovs);setCaja(newCaja);setObras(newObras);
          _lastWrite.current["obras"]=Date.now()+15000;
          _lastWrite.current["movs"]=Date.now()+15000;
          _lastWrite.current["caja"]=Date.now()+15000;
          show("🪄 Limpieza: "+(nMovs+nCaja)+" movs normalizados, "+nObrasFusionadas+" obras duplicadas fusionadas");
        }}
        onEliminarObrasDup={(obrasDup)=>{
          // Fusiona N obras duplicadas en una sola (la primera por id menor)
          const principal=obrasDup.sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0];
          const aEliminar=obrasDup.filter(o=>o.id!==principal.id);
          const idsAEliminar=new Set(aEliminar.map(o=>o.id));
          const sumaCot=aEliminar.reduce((s,o)=>s+(o.cotizado||0),0);
          const newObras=obras.filter(o=>!idsAEliminar.has(o.id)).map(o=>o.id===principal.id?{...o,cotizado:(o.cotizado||0)+sumaCot}:o);
          setObras(newObras);
          _lastWrite.current["obras"]=Date.now()+15000;
          show("🔗 "+aEliminar.length+" copias de '"+principal.nombre+"' fusionadas");
        }}
        onFusionarVariantes={(key,canonico)=>{
          let nMovs=0,nCaja=0;
          const newMovs=movs.map(m=>{if(m.obra&&normSearch(m.obra)===key&&m.obra!==canonico){nMovs++;return{...m,obra:canonico};}return m;});
          const newCaja=caja.map(c=>{if(c.obra&&normSearch(c.obra)===key&&c.obra!==canonico){nCaja++;return{...c,obra:canonico};}return c;});
          setMovs(newMovs);setCaja(newCaja);
          _lastWrite.current["movs"]=Date.now()+15000;
          _lastWrite.current["caja"]=Date.now()+15000;
          show("✓ "+(nMovs+nCaja)+" movs unificados a '"+canonico+"'");
        }}
      />
    </div>}
    {sec==="papelera"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:18,fontWeight:800}}>🗑 Papelera <span style={{color:T.muted,fontWeight:500,fontSize:13}}>· {papelera.length}</span></div>
          <div style={{fontSize:11,color:T.muted,marginTop:2}}>Los registros borrados se guardan 30 días. Puedes recuperarlos antes.</div>
        </div>
        {papelera.length>0&&user.rol==="admin"&&<button onClick={()=>{if(confirm("¿Vaciar TODA la papelera? Esto borra "+papelera.length+" registro(s) PERMANENTEMENTE."))setPapelera([]);}} style={{padding:"8px 14px",borderRadius:8,border:"1px solid "+T.red+"55",background:"rgba(231,76,60,.08)",color:T.red,fontWeight:700,fontSize:12,cursor:"pointer"}}>🚨 Vaciar papelera</button>}
      </div>
      {papelera.length===0?<Card style={{textAlign:"center",padding:30}}><div style={{fontSize:32,marginBottom:8}}>✨</div><div style={{color:T.muted}}>La papelera está vacía</div></Card>:<div style={{borderRadius:8,border:"1px solid #333",overflow:"hidden",fontSize:12}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:D?700:480}}>
            <thead>
              <tr style={{background:"#1a1a1a",borderBottom:"2px solid #444"}}>
                <th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:80}}>Tipo</th>
                <th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,borderRight:"1px solid #333"}}>Descripción</th>
                {D&&<th style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:120}}>Borrado por</th>}
                <th style={{padding:"8px 10px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",borderRight:"1px solid #333",width:130}}>Fecha</th>
                <th style={{padding:"8px 10px",textAlign:"center",fontSize:9,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.6,whiteSpace:"nowrap",width:130}}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {[...papelera].sort((a,b)=>b.ts-a.ts).map((p,idx)=>{const tipoBadge={obra:["🏗 Obra",T.blue],mov:["💰 Movimiento",T.green],caja:["🧾 Caja",T.orange],recibo:["📄 Recibo",T.purple]}[p.tipo]||["📎 Item",T.muted];const dias=Math.floor((Date.now()-p.ts)/(24*60*60*1000));const diasRestantes=30-dias;return <tr key={p.id} style={{background:idx%2===0?"rgba(255,255,255,.01)":"transparent",borderBottom:"1px solid #2a2a2a"}}>
                <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a"}}><span style={{display:"inline-block",padding:"2px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:tipoBadge[1]+"22",color:tipoBadge[1]}}>{tipoBadge[0]}</span></td>
                <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",fontWeight:600}}>{p.descripcion}</td>
                {D&&<td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",fontSize:11,color:T.muted}}>{p.user}</td>}
                <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",fontSize:10,textAlign:"center"}}>
                  <div style={{color:T.muted}}>{fd(new Date(p.ts).toISOString().slice(0,10))}</div>
                  <div style={{color:diasRestantes<7?T.red:diasRestantes<15?T.yellow:T.muted,fontSize:9,fontWeight:700}}>Caduca en {diasRestantes}d</div>
                </td>
                <td style={{padding:"4px 8px",textAlign:"center"}}>
                  <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                    <button onClick={()=>{if(confirm("¿Restaurar '"+p.descripcion+"'?"))restaurarDePapelera(p);}} style={{background:"rgba(76,175,80,.12)",border:"1px solid "+T.green+"55",color:T.green,cursor:"pointer",fontSize:10,padding:"4px 8px",borderRadius:5,fontWeight:700}} title="Recuperar">↶ Recuperar</button>
                    {user.rol==="admin"&&<button onClick={()=>{if(confirm("¿Borrar PERMANENTEMENTE '"+p.descripcion+"'?"))setPapelera(prev=>prev.filter(x=>x.id!==p.id));}} style={{background:"rgba(231,76,60,.1)",border:"none",color:T.red,cursor:"pointer",fontSize:11,padding:"3px 6px",borderRadius:4}} title="Borrar definitivamente">🗑</button>}
                  </div>
                </td>
              </tr>;})}
            </tbody>
          </table>
        </div>
      </div>}
    </div>}

    {sec==="usuarios"&&<div>
      <button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300}} onClick={()=>om("addUser")}>+ Agregar Usuario</button>
      <div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{users.filter(u=>u.rol!=="cliente").map(u=> <Card key={u.id} style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:40,height:40,borderRadius:20,background:ROLES[u.rol].color+"22",color:ROLES[u.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13}}>{u.avatar}</div><div style={{flex:1}}><div style={{fontWeight:700}}>{u.nombre}</div><div style={{fontSize:10,color:ROLES[u.rol].color}}>{ROLES[u.rol].icon} {ROLES[u.rol].nombre}</div><div style={{fontSize:10,color:u.pin?T.green:T.muted,marginTop:2}}>{u.pin?"🔒 PIN: ••••":"🔓 Sin PIN"}</div></div><div style={{display:"flex",gap:4}}><button onClick={()=>om("setPin",u)} style={{background:"#1a1a2a",color:T.blue,border:"1px solid #2a2a4a",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>{u.pin?"Cambiar":"+ PIN"}</button>{u.id!==1&&(confirmDel===u.id?<div style={{display:"flex",gap:4}}><button onClick={()=>{setUsers(prev=>prev.filter(x=>x.id!==u.id));setConfirmDel(null);show("Eliminado");}} style={{background:T.red,color:"#fff",border:"none",borderRadius:6,padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer"}}>Sí</button><button onClick={()=>setConfirmDel(null)} style={{background:"#333",color:"#aaa",border:"none",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>No</button></div>:<button onClick={()=>setConfirmDel(u.id)} style={{background:"#2a1111",color:T.red,border:"1px solid #3a1a1a",borderRadius:6,padding:"4px 10px",fontSize:10,cursor:"pointer"}}>🗑</button>)}</div></Card>)}</div>
      {users.filter(u=>u.rol==="cliente").length>0&&<div style={{marginTop:14}}><div style={{fontSize:10,color:T.teal,fontWeight:700,marginBottom:8}}>CLIENTES</div><div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{users.filter(u=>u.rol==="cliente").map(u=> <Card key={u.id} style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:40,height:40,borderRadius:20,background:T.teal+"22",color:T.teal,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13}}>{u.avatar}</div><div style={{flex:1}}><div style={{fontWeight:700}}>{u.nombre}</div><div style={{fontSize:10,color:T.teal}}>{obras.find(o=>o.id===u.proyectoId)?.nombre||"Sin proyecto"}</div><div style={{fontSize:10,color:u.pin?T.green:T.muted,marginTop:2}}>{u.pin?"🔒 PIN":"🔓 Sin PIN"}</div></div><div style={{display:"flex",gap:4}}><button onClick={()=>om("setPin",u)} style={{background:"#1a1a2a",color:T.blue,border:"1px solid #2a2a4a",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>{u.pin?"Cambiar":"+ PIN"}</button>{confirmDel===u.id?<div style={{display:"flex",gap:4}}><button onClick={()=>{setUsers(prev=>prev.filter(x=>x.id!==u.id));setConfirmDel(null);show("Eliminado");}} style={{background:T.red,color:"#fff",border:"none",borderRadius:6,padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer"}}>Sí</button><button onClick={()=>setConfirmDel(null)} style={{background:"#333",color:"#aaa",border:"none",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>No</button></div>:<button onClick={()=>setConfirmDel(u.id)} style={{background:"#2a1111",color:T.red,border:"1px solid #3a1a1a",borderRadius:6,padding:"4px 10px",fontSize:10,cursor:"pointer"}}>🗑</button>}</div></Card>)}</div></div>}
    </div>}

    {sec==="ia"&&<div style={{display:"flex",flexDirection:"column",height:D?"calc(100vh - 40px)":"calc(100vh - 130px)",maxWidth:700}}>
      <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Asistente IA — Ensamble Villarreal</div>
      <div ref={chatRef} style={{flex:1,overflowY:"auto",marginBottom:8,padding:4}}>
        {chatMsgs.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",marginBottom:8}}>
          <div style={{maxWidth:"85%",padding:"10px 14px",borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",background:m.role==="user"?"rgba(201,149,107,.15)":"rgba(255,255,255,.04)",border:"1px solid "+(m.role==="user"?"rgba(201,149,107,.2)":T.border),fontSize:13,lineHeight:1.5,whiteSpace:"pre-wrap"}}>
            {m.role==="assistant"&&<div style={{fontSize:9,color:T.gold,fontWeight:700,marginBottom:4}}>🤖 ASISTENTE</div>}
            {m.content}
          </div>
        </div>)}
        {chatLoading&&<div style={{display:"flex",justifyContent:"flex-start",marginBottom:8}}><div style={{padding:"10px 14px",borderRadius:"14px 14px 14px 4px",background:"rgba(255,255,255,.04)",border:"1px solid "+T.border,fontSize:13,color:T.muted}}>🤖 Pensando...</div></div>}
      </div>
      <div style={{display:"flex",gap:8}}><input style={{...sI,flex:1}} value={chatIn} onChange={e=>setChatIn(e.target.value)} placeholder="Escribe tu mensaje..." onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}}/><button onClick={sendChat} disabled={chatLoading||!chatIn.trim()} style={{padding:"12px 20px",borderRadius:10,border:"none",background:chatIn.trim()?"linear-gradient(135deg,#c9956b,#a07850)":"#222",color:chatIn.trim()?"#fff":"#555",fontWeight:700,cursor:chatIn.trim()?"pointer":"default",fontSize:16,minWidth:50}}>➤</button></div>
    </div>}
  </div>;

  // ═══ MODALS ═══
  const modals= <div>
    {/* === TOUR DE BIENVENIDA === */}
    {tourStep>=0&&tourStep<tourSteps.length&&(()=>{const t=tourSteps[tourStep];return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:6000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{maxWidth:480,width:"100%",background:"linear-gradient(135deg,#1a1a1a,#0f0f0f)",border:"1px solid "+T.gold+"33",borderRadius:16,padding:24,boxShadow:"0 20px 60px rgba(0,0,0,.6)"}}>
        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{fontSize:48,marginBottom:8}}>{t.icon}</div>
          <div style={{fontSize:18,fontWeight:800,color:T.gold,marginBottom:6}}>{t.titulo}</div>
          <div style={{fontSize:13,color:T.text,lineHeight:1.6}}>{t.texto}</div>
        </div>
        {/* Dots de progreso */}
        <div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:18}}>
          {tourSteps.map((_,i)=><span key={i} style={{width:8,height:8,borderRadius:4,background:i===tourStep?T.gold:i<tourStep?T.gold+"66":T.dim}}/>)}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={cerrarTour} style={{flex:1,padding:"12px",borderRadius:8,border:"1px solid "+T.border,background:"transparent",color:T.muted,fontSize:12,cursor:"pointer"}}>Saltar tour</button>
          {tourStep>0&&<button onClick={()=>setTourStep(tourStep-1)} style={{padding:"12px 20px",borderRadius:8,border:"1px solid "+T.border,background:"transparent",color:T.muted,fontSize:12,cursor:"pointer"}}>← Atrás</button>}
          <button onClick={()=>tourStep<tourSteps.length-1?setTourStep(tourStep+1):cerrarTour()} style={{flex:2,padding:"12px",borderRadius:8,border:"none",background:"linear-gradient(135deg,"+T.gold+","+T.orange+")",color:"#fff",fontWeight:800,fontSize:13,cursor:"pointer"}}>{tourStep<tourSteps.length-1?"Siguiente →":"¡Empezar! ✓"}</button>
        </div>
      </div>
    </div>;})()}
    {/* === BÚSQUEDA GLOBAL (Ctrl+K) === */}
    {searchOpen&&(()=>{
      const q=normSearch(searchQ);
      const matches=q.length<2?{obras:[],clientes:[],provs:[],movs:[]}:{
        obras:obras.filter(o=>normSearch(o.nombre).includes(q)||normSearch(o.cliente||"").includes(q)).slice(0,8),
        clientes:clis.filter(c=>normSearch(c.nombre).includes(q)||normSearch(c.tel||"").includes(q)||normSearch(c.email||"").includes(q)).slice(0,5),
        provs:provs.filter(p=>normSearch(p.nombre).includes(q)).slice(0,5),
        movs:[...movs,...caja.map(c=>({...c,desc:c.concepto,monto:c.monto}))].filter(m=>normSearch(m.desc||"").includes(q)||normSearch(m.prov||"").includes(q)).slice(0,8)
      };
      const total=matches.obras.length+matches.clientes.length+matches.provs.length+matches.movs.length;
      return <div onClick={()=>{setSearchOpen(false);setSearchQ("");}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:5000,display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:60}}>
        <div onClick={e=>e.stopPropagation()} style={{width:"95%",maxWidth:600,background:"#1a1a1a",border:"1px solid "+T.border,borderRadius:12,boxShadow:"0 20px 60px rgba(0,0,0,.6)",overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18}}>🔍</span>
            <input autoFocus value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Buscar obras, clientes, proveedores, movimientos..." style={{flex:1,background:"transparent",border:"none",color:T.text,fontSize:15,outline:"none"}}/>
            <button onClick={()=>{setSearchOpen(false);setSearchQ("");}} style={{background:"rgba(255,255,255,.05)",border:"none",color:T.muted,padding:"4px 10px",borderRadius:6,fontSize:11,cursor:"pointer"}}>ESC</button>
          </div>
          <div style={{maxHeight:"60vh",overflowY:"auto",padding:8}}>
            {q.length<2?<div style={{padding:30,textAlign:"center",color:T.muted,fontSize:12}}>Escribe al menos 2 letras para buscar...</div>:
            total===0?<div style={{padding:30,textAlign:"center",color:T.muted,fontSize:12}}>Sin resultados para "<b style={{color:T.text}}>{searchQ}</b>"</div>:<>
              {matches.obras.length>0&&<div style={{marginBottom:6}}>
                <div style={{fontSize:9,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,padding:"6px 10px"}}>🏗 Obras ({matches.obras.length})</div>
                {matches.obras.map(o=><div key={o.id} onClick={()=>{setSec("obras");setSub(o);setSearchOpen(false);setSearchQ("");}} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",cursor:"pointer",borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.background="rgba(201,149,107,.08)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div><div style={{fontSize:13,fontWeight:600}}>{o.nombre}</div><div style={{fontSize:10,color:T.muted}}>{o.cliente||"sin cliente"} · {FASES[o.fase]||o.fase}</div></div>
                  <div style={{color:T.gold,fontWeight:700,fontSize:12}}>{$(o.cotizado)}</div>
                </div>)}
              </div>}
              {matches.clientes.length>0&&<div style={{marginBottom:6}}>
                <div style={{fontSize:9,color:T.teal,fontWeight:700,textTransform:"uppercase",letterSpacing:1,padding:"6px 10px"}}>👤 Clientes ({matches.clientes.length})</div>
                {matches.clientes.map(c=><div key={c.id} onClick={()=>{setSec("clis");setSearchOpen(false);setSearchQ("");}} style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",cursor:"pointer",borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.background="rgba(38,166,154,.08)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div><div style={{fontSize:13,fontWeight:600}}>{c.nombre}</div><div style={{fontSize:10,color:T.muted}}>{c.tel||""} {c.email?" · "+c.email:""}</div></div>
                </div>)}
              </div>}
              {matches.provs.length>0&&<div style={{marginBottom:6}}>
                <div style={{fontSize:9,color:T.orange,fontWeight:700,textTransform:"uppercase",letterSpacing:1,padding:"6px 10px"}}>🏪 Proveedores ({matches.provs.length})</div>
                {matches.provs.map(p=><div key={p.id} onClick={()=>{setSec("taller");setSubTab("provs");setSearchOpen(false);setSearchQ("");}} style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",cursor:"pointer",borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,152,0,.08)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div><div style={{fontSize:13,fontWeight:600}}>{p.nombre}</div><div style={{fontSize:10,color:T.muted}}>{p.material||""}</div></div>
                </div>)}
              </div>}
              {matches.movs.length>0&&<div>
                <div style={{fontSize:9,color:T.blue,fontWeight:700,textTransform:"uppercase",letterSpacing:1,padding:"6px 10px"}}>💰 Movimientos ({matches.movs.length})</div>
                {matches.movs.map((m,i)=><div key={i} onClick={()=>{setSec("finanzas");setFBusq(searchQ);setSearchOpen(false);setSearchQ("");}} style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",cursor:"pointer",borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.background="rgba(66,165,245,.08)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.desc}</div><div style={{fontSize:10,color:T.muted}}>{fd(m.fecha)} · {m.prov||m.resp||""} · {m.obra||"general"}</div></div>
                  <div style={{fontWeight:700,fontSize:12,color:m.ing>0?T.green:T.red,whiteSpace:"nowrap"}}>{m.ing>0?"+":""}{$(m.monto||m.ing||m.egr||0)}</div>
                </div>)}
              </div>}
            </>}
          </div>
        </div>
      </div>;
    })()}
    {modal==="cat"&&<ModalW title="Catálogo" onClose={cm}>{cats.map(cat=> <div key={cat} style={{marginBottom:12}}><div style={{fontSize:11,color:T.gold,fontWeight:700,borderBottom:"1px solid "+T.border,paddingBottom:3,marginBottom:4}}>{cat}</div>{catalogo.filter(c=>c.cat===cat).map(item=> <div key={item.id} onClick={()=>{addCotP(item);show(item.id+" +");}} style={{display:"flex",justifyContent:"space-between",padding:"10px 8px",borderBottom:"1px solid "+T.border,cursor:"pointer"}}><span><b style={{color:T.gold}}>{item.id}</b> {item.desc}</span><span style={{color:T.muted}}>{$(item.precio)} <span style={{color:T.green}}>+</span></span></div>)}</div>)}</ModalW>}
        {modal==="addNom"&&<ModalW title="Nuevo Pago Fijo" onClose={cm}><div><Fl l="Nombre"><input style={sI} id="nomNom" placeholder="Ej: Nómina Erik"/></Fl><Fl l="Monto"><input type="number" style={sI} id="nomMon"/></Fl><Fl l="Frecuencia"><select style={sI} id="nomFreq"><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></Fl><Fl l="Tipo"><select style={sI} id="nomTipo"><option value="Nómina">Nómina</option><option value="Renta">Renta</option><option value="Servicios">Servicios</option><option value="IMSS">IMSS</option><option value="Destajo">Destajo</option><option value="Otro">Otro</option></select></Fl><button style={sB} onClick={()=>{const n=document.getElementById("nomNom").value;const m=Number(document.getElementById("nomMon").value);const f=document.getElementById("nomFreq").value;const t=document.getElementById("nomTipo").value;if(n&&m>0){setNominas(prev=>[...prev,{id:"N"+Date.now(),nombre:n,monto:m,frecuencia:f,tipo:t}]);cm();show("Pago fijo creado");}}}>Guardar</button></div></ModalW>}
    {modal==="addOb"&&<ModalW title="Nueva Obra" onClose={cm}><ObraForm clientes={clis} onNewCli={nombre=>ensureCli(nombre)} onSave={o=>{setObras(prev=>[...prev,{...o,id:"OB"+_rid(),egreso:0,extras:[],pagos:[],docs:[],bitacora:[],creadoPor:user.nombre,creadoFecha:td()}]);cm();show("Obra ✓");}}/></ModalW>}
    {modal==="delMasivo"&&<ModalW title={"⚠ Eliminar "+selMovs.length+" movimientos"} onClose={cm}><div>
      <div style={{background:"rgba(231,76,60,.1)",border:"1px solid "+T.red+"55",borderRadius:8,padding:14,marginBottom:12}}>
        <div style={{color:T.red,fontWeight:800,marginBottom:8,fontSize:14}}>🗑 Esta acción es irreversible</div>
        <div style={{color:T.muted,fontSize:12,lineHeight:1.5}}>Se eliminarán <span style={{color:T.red,fontWeight:700}}>{selMovs.length}</span> movimientos de los <span style={{color:T.gold,fontWeight:700}}>{finFilt.length}</span> filtrados.<br/><br/>Los proveedores, clientes y obras NO se borran — solo los movimientos seleccionados.</div>
      </div>
      {(()=>{const movIds=selMovs.filter(id=>id.startsWith("m"));const cajaIds=selMovs.filter(id=>id.startsWith("c"));const totIng=finFilt.filter(m=>selMovs.includes(m.id)&&m.t==="ing").reduce((s,m)=>s+m.monto,0);const totEgr=finFilt.filter(m=>selMovs.includes(m.id)&&m.t!=="ing").reduce((s,m)=>s+m.monto,0);return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12,fontSize:11}}><div style={{textAlign:"center",padding:8,background:"rgba(255,255,255,.04)",borderRadius:6}}><div style={{color:T.muted,fontSize:9,fontWeight:700}}>MOVS</div><div style={{color:T.gold,fontWeight:800,fontSize:14}}>{movIds.length}</div></div><div style={{textAlign:"center",padding:8,background:"rgba(255,255,255,.04)",borderRadius:6}}><div style={{color:T.muted,fontSize:9,fontWeight:700}}>CAJA CHICA</div><div style={{color:T.orange,fontWeight:800,fontSize:14}}>{cajaIds.length}</div></div><div style={{textAlign:"center",padding:8,background:"rgba(255,255,255,.04)",borderRadius:6}}><div style={{color:T.muted,fontSize:9,fontWeight:700}}>IMPACTO</div><div style={{color:totEgr>=totIng?T.red:T.green,fontWeight:800,fontSize:14}}>{$(totEgr-totIng)}</div></div></div>;})()}
      <Fl l='Para confirmar, escribe la palabra "BORRAR"'>
        <input style={{...sI,fontSize:14,fontWeight:700,letterSpacing:2,textAlign:"center"}} value={delConfText} onChange={e=>setDelConfText(e.target.value)} placeholder="BORRAR" autoFocus/>
      </Fl>
      <button style={{...sB,background:delConfText==="BORRAR"?T.red:"rgba(231,76,60,.2)",color:"#fff",opacity:delConfText==="BORRAR"?1:.5,cursor:delConfText==="BORRAR"?"pointer":"not-allowed",marginTop:8}} disabled={delConfText!=="BORRAR"} onClick={()=>{
        if(delConfText!=="BORRAR")return;
        const movIds=selMovs.filter(id=>id.startsWith("m")).map(id=>parseInt(id.slice(1)));
        const cajaIds=selMovs.filter(id=>id.startsWith("c")).map(id=>parseInt(id.slice(1)));
        if(movIds.length>0)setMovs(movs.filter(x=>!movIds.includes(x.id)));
        if(cajaIds.length>0)setCaja(caja.filter(x=>!cajaIds.includes(x.id)));
        const n=selMovs.length;
        setSelMovs([]);
        setDelConfText("");
        cm();
        show("🗑 "+n+" movimiento(s) eliminados");
      }}>🗑 Eliminar {selMovs.length} movimiento(s)</button>
      <button style={{...sB,background:"rgba(255,255,255,.06)",color:T.muted,marginTop:6}} onClick={()=>{cm();setDelConfText("");}}>Cancelar</button>
    </div></ModalW>}
    {modal==="editMov"&&md&&<ModalW title="Editar Movimiento" onClose={cm}><div><Fl l="Concepto"><input style={sI} defaultValue={md.desc} id="emDesc"/></Fl><Fl l="Monto"><input type="number" style={sI} defaultValue={md.monto} id="emMonto"/></Fl><Fl l="Proveedor / Cliente"><input style={sI} defaultValue={md.prov||""} id="emProv"/></Fl><Fl l="Obra"><select style={sI} defaultValue={md.obra||""} id="emObra"><option value="">Sin obra</option>{obras.map(o=><option key={o.id} value={o.nombre}>{o.nombre}</option>)}</select></Fl><Fl l="Categoría"><input style={sI} defaultValue={md.cat||""} id="emCat" placeholder="Material, Nómina, etc."/></Fl><button style={{...sB,marginTop:8}} onClick={()=>{const nd=document.getElementById("emDesc").value;const nm=Number(document.getElementById("emMonto").value);const np=document.getElementById("emProv").value;const no=document.getElementById("emObra").value;const nc=document.getElementById("emCat").value;if(md.t==="caja"){setCaja(caja.map(x=>x.id===md.cajaId?{...x,concepto:nd||x.concepto,monto:nm||x.monto,obra:no,resp:np||x.resp}:x));}else{setMovs(movs.map(x=>{if("m"+x.id===md.id){return {...x,desc:nd||x.desc,ing:md.t==="ing"?(nm||x.ing):0,egr:md.t!=="ing"?(nm||x.egr):0,prov:np,obra:no,cat:nc};}return x;}));}cm();show("Actualizado ✓");}}>💾 Guardar Cambios</button><button style={{...sB,background:"#2a0a0a",color:T.red,border:"1px solid "+T.red+"33"}} onClick={()=>{if(confirm("¿Eliminar este movimiento?")){if(md.t==="caja"){setCaja(caja.filter(x=>x.id!==md.cajaId));}else{setMovs(movs.filter(x=>"m"+x.id!==md.id));}cm();show("Eliminado");}}}> 🗑 Eliminar Movimiento</button></div></ModalW>}
    {modal==="delOb"&&md&&<ModalW title="Eliminar Proyecto" onClose={cm}><DelObraForm obra={md} obras={obras} movs={movs} caja={caja} onDone={async(accion,destino)=>{
      const k=normSearch(md.nombre);
      let nMovs=0,nCaja=0;
      let newMovs=movs,newCaja=caja;
      if(accion==="reasignar"&&destino){
        newMovs=movs.map(m=>{if(normSearch(m.obra||"")===k){nMovs++;return{...m,obra:destino};}return m;});
        newCaja=caja.map(c=>{if(normSearch(c.obra||"")===k){nCaja++;return{...c,obra:destino};}return c;});
      }else if(accion==="general"){
        newMovs=movs.map(m=>{if(normSearch(m.obra||"")===k){nMovs++;return{...m,obra:""};}return m;});
        newCaja=caja.map(c=>{if(normSearch(c.obra||"")===k){nCaja++;return{...c,obra:""};}return c;});
      }else if(accion==="borrar"){
        // Mandar movs y caja a papelera antes de borrar
        movs.forEach(m=>{if(normSearch(m.obra||"")===k){enviarAPapelera("mov",m);nMovs++;}});
        caja.forEach(c=>{if(normSearch(c.obra||"")===k){enviarAPapelera("caja",c);nCaja++;}});
        newMovs=movs.filter(m=>normSearch(m.obra||"")!==k);
        newCaja=caja.filter(c=>normSearch(c.obra||"")!==k);
      }
      // Aplicar cambios (en orden: primero movs/caja, luego obra)
      if(accion!=="solo")setMovs(newMovs);
      if(accion!=="solo")setCaja(newCaja);
      // Mandar la obra a papelera
      enviarAPapelera("obra",md);
      const newObras=obras.filter(o=>o.id!==md.id);
      setObras(newObras);
      // Bloquear sync por 30s y forzar push directo
      _lastWrite.current["obras"]=Date.now()+15000;
      setSub(null);cm();
      const msgs={reasignar:"✓ Eliminada · "+nMovs+"+"+nCaja+" movs reasignados a "+destino,general:"✓ Eliminada · "+nMovs+"+"+nCaja+" movs → General",borrar:"🗑 Eliminada · "+nMovs+"+"+nCaja+" movs BORRADOS",solo:"👻 Eliminada · movs quedan como fantasma"};
      show(msgs[accion]);
    }}/></ModalW>}
    {modal==="apikey"&&<ModalW title="🔑 API Key Claude" onClose={cm}>
      <div style={{fontSize:12,color:T.muted,marginBottom:12}}>Para usar el escáner de cotizaciones, tickets y el chat IA necesitas una API Key de Anthropic.</div>
      <div style={{fontSize:11,color:T.muted,marginBottom:12,padding:10,background:"rgba(255,255,255,.03)",borderRadius:8}}>1. Ve a <span style={{color:T.gold}}>console.anthropic.com</span><br/>2. Crea una cuenta o inicia sesión<br/>3. Ve a API Keys → Create Key<br/>4. Copia la clave y pégala aquí abajo</div>
      <Fl l="API Key"><input style={{...sI,fontFamily:"monospace",fontSize:11}} type="password" defaultValue={getApiKey()} placeholder="sk-ant-..." id="apikey-input"/></Fl>
      <button style={{...sB,background:T.green}} onClick={()=>{const v=document.getElementById("apikey-input").value.trim();if(v){localStorage.setItem("ev_apikey",v);show("🔑 API Key guardada");cm();}else{localStorage.removeItem("ev_apikey");show("API Key eliminada");cm();}}}>💾 Guardar</button>
      <div style={{fontSize:10,color:T.dim,marginTop:8,textAlign:"center"}}>La clave se guarda solo en tu dispositivo</div>
    </ModalW>}
    {modal==="importPreview"&&md&&<ModalW title={"Importar "+md.length+" movimientos"} onClose={cm}>
      <div style={{maxHeight:300,overflowY:"auto",marginBottom:12}}>
        {md.slice(0,20).map((m,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid "+T.border,fontSize:12}}>
          <div><div style={{fontWeight:600}}>{m.desc}</div><div style={{fontSize:10,color:T.dim}}>{m.fecha} · {m.obra} · {m.prov}</div></div>
          <span style={{fontWeight:800,color:m.ing>0?T.green:T.red,whiteSpace:"nowrap"}}>{m.ing>0?"+"+$(m.ing):"-"+$(m.egr)}</span>
        </div>)}
        {md.length>20&&<div style={{textAlign:"center",padding:8,color:T.muted,fontSize:11}}>... y {md.length-20} más</div>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,padding:10,background:"rgba(255,255,255,.03)",borderRadius:8,marginBottom:12}}>
        <div><div style={{fontSize:9,color:T.muted}}>INGRESOS</div><div style={{fontWeight:800,color:T.green}}>{$(md.reduce((s,m)=>s+m.ing,0))}</div></div>
        <div><div style={{fontSize:9,color:T.muted}}>EGRESOS</div><div style={{fontWeight:800,color:T.red}}>{$(md.reduce((s,m)=>s+m.egr,0))}</div></div>
        <div><div style={{fontSize:9,color:T.muted}}>TOTAL MOVS</div><div style={{fontWeight:800}}>{md.length}</div></div>
      </div>
      <button style={{...sB,background:T.green}} onClick={()=>{const _base=_nextNumId(movs);const newMovs=md.map((m,i)=>({...m,id:_base+i,status:"aprobado",user:user.nombre}));setMovs(prev=>[...prev,...newMovs]);cm();show("✅ "+md.length+" movimientos importados");}}>✅ Confirmar Importación</button>
      <button style={{...sB,background:"transparent",color:T.muted,border:"1px solid "+T.border}} onClick={cm}>Cancelar</button>
    </ModalW>}
    {modal==="addIng"&&<ModalW title="Registrar Ingreso" onClose={cm}><IngForm obras={obras} movs={movs} clis={clis} onSave={m=>{const rid=genRec(m);const newId=_nextNumId(movs);setMovs(prev=>[...prev,{...m,id:newId,user:user.nombre}]);highlightNew("m"+newId);try{saveDoc("recibo","Recibo "+rid,m.prov,m.obra,m.ing,{id:rid,fecha:m.fecha,cliente:m.prov,concepto:m.desc,monto:m.ing,obra:m.obra});}catch{}cm();om("vRec",{id:rid,fecha:m.fecha,cliente:m.prov,concepto:m.desc,monto:m.ing,obra:m.obra});}}/></ModalW>}
    {modal==="addEgr"&&<ModalW title="Egreso" onClose={cm}><EgrForm obras={obras} provs={provs} onNewProv={nombre=>{setProvs(prev=>[...prev,{id:"P"+_rid(),nombre,contacto:"",tel:"",material:"",credito:0,total:0,calif:3}]);}} onSave={m=>{const newId=_nextNumId(movs);setMovs(prev=>[...prev,{...m,id:newId,user:user.nombre}]);highlightNew("m"+newId);cm();show("✓ Egreso registrado");}}/></ModalW>}
    {modal==="addCj"&&<ModalW title="Gasto Caja Chica" onClose={cm}><CajaForm users={users} obras={obras} onSave={c=>{setCaja(prev=>[...prev,{...c,id:_nextNumId(prev),status:user.rol==="admin"?"aprobado":"pendiente"}]);cm();show(user.rol==="admin"?"Gasto registrado":"Enviado para aprobación");}}/></ModalW>}
    {modal==="editCj"&&md&&<ModalW title="Editar Gasto" onClose={cm}><div><Fl l="Concepto"><input style={sI} defaultValue={md.concepto} id="editCjConc"/></Fl><Fl l="Monto"><input type="number" style={sI} defaultValue={md.monto} id="editCjMonto"/></Fl><Fl l="Obra"><select style={sI} defaultValue={md.obra} id="editCjObra"><option value="">Seleccionar obra</option>{obras.map(o=><option key={o.id} value={o.nombre}>{o.nombre}</option>)}<option value="General">General</option></select></Fl><Fl l="Responsable"><input style={sI} defaultValue={md.resp} id="editCjResp"/></Fl><button style={{...sB,marginTop:8}} onClick={()=>{const nc=document.getElementById("editCjConc").value;const nm=Number(document.getElementById("editCjMonto").value);const no=document.getElementById("editCjObra").value;const nr=document.getElementById("editCjResp").value;setCaja(caja.map(x=>x.id===md.id?{...x,concepto:nc||x.concepto,monto:nm||x.monto,obra:no||x.obra,resp:nr||x.resp}:x));cm();show("Gasto actualizado ✓");}}>💾 Guardar Cambios</button>{md.status==="pendiente"&&user.rol==="admin"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}><button style={{...sB,background:"#0a2e0a",color:T.green,marginTop:0}} onClick={()=>{const nc=document.getElementById("editCjConc").value;const nm=Number(document.getElementById("editCjMonto").value);const no=document.getElementById("editCjObra").value;setCaja(caja.map(x=>x.id===md.id?{...x,concepto:nc||x.concepto,monto:nm||x.monto,obra:no||x.obra,status:"aprobado"}:x));cm();show("Aprobado ✓");}}>✓ Aprobar</button><button style={{...sB,background:"#2a0a0a",color:T.red,marginTop:0}} onClick={()=>{setCaja(caja.map(x=>x.id===md.id?{...x,status:"rechazado"}:x));cm();show("Rechazado");}}>✕ Rechazar</button></div>}</div></ModalW>}
    {modal==="addDoc"&&sub&&<ModalW title="Documento" onClose={cm}><DocForm onSave={d=>{const up={...sub,docs:[...(sub.docs||[]),{...d,id:(sub.docs?.length||0)+1,fecha:td(),size:"—"}]};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);cm();show("✓");}}/></ModalW>}
    {modal==="addCli"&&<ModalW title="Cliente" onClose={cm}><ClienteForm onSave={c=>{const nn=normName(c.nombre);if(!nn){show("Pon un nombre válido");return;}if(clis.some(x=>normName(x.nombre)===nn)){show("Este cliente ya existe");return;}setClis(prev=>[...prev,{...c,nombre:c.nombre.trim(),id:"C"+_rid()}]);cm();show("✓");}}/></ModalW>}
    {modal==="addInv"&&<ModalW title="Material" onClose={cm}><InvForm onSave={i=>{setInv(prev=>[...prev,{...i,id:"I"+_rid()}]);cm();show("✓");}}/></ModalW>}
    {modal==="addPrec"&&<ModalW title="💰 Nuevo Precio Unitario" onClose={cm}><div>
      <Fl l="Categoría"><select style={sI} id="pCat" defaultValue="Cocinas">{ALL_CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></Fl>
      <Fl l="Descripción"><input style={sI} id="pDesc" placeholder="Ej: Cocina integral acabado madera"/></Fl>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8}}>
        <Fl l="Precio ($)"><input type="number" style={sI} id="pPrec" placeholder="3500"/></Fl>
        <Fl l="Unidad"><select style={sI} id="pUni" defaultValue="ml"><option value="ml">ml (metro lineal)</option><option value="m2">m² (metro cuadrado)</option><option value="pza">pza (pieza)</option></select></Fl>
      </div>
      <Fl l="Notas (opcional)"><input style={sI} id="pNot" placeholder="Detalles del acabado"/></Fl>
      <button style={sB} onClick={()=>{const cat=document.getElementById("pCat").value;const desc=document.getElementById("pDesc").value;const prec=Number(document.getElementById("pPrec").value);const uni=document.getElementById("pUni").value;const not=document.getElementById("pNot").value;if(desc&&prec>0){setPreciosUnit(prev=>[...prev,{id:"PU"+Date.now(),cat,desc,precio:prec,unidad:uni,notas:not}]);cm();show("Precio agregado ✓");}else alert("Llena descripción y precio");}}>Guardar</button>
    </div></ModalW>}
    {modal==="editPrec"&&md&&<ModalW title="✏️ Editar Precio" onClose={cm}><div>
      <Fl l="Categoría"><select style={sI} defaultValue={md.cat} id="epCat">{ALL_CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></Fl>
      <Fl l="Descripción"><input style={sI} defaultValue={md.desc} id="epDesc"/></Fl>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8}}>
        <Fl l="Precio ($)"><input type="number" style={sI} defaultValue={md.precio} id="epPrec"/></Fl>
        <Fl l="Unidad"><select style={sI} defaultValue={md.unidad} id="epUni"><option value="ml">ml</option><option value="m2">m²</option><option value="pza">pza</option></select></Fl>
      </div>
      <Fl l="Notas"><input style={sI} defaultValue={md.notas||""} id="epNot"/></Fl>
      <button style={{...sB,marginTop:8}} onClick={()=>{const cat=document.getElementById("epCat").value;const desc=document.getElementById("epDesc").value;const prec=Number(document.getElementById("epPrec").value);const uni=document.getElementById("epUni").value;const not=document.getElementById("epNot").value;setPreciosUnit(prev=>prev.map(x=>x.id===md.id?{...x,cat,desc,precio:prec,unidad:uni,notas:not}:x));cm();show("Actualizado ✓");}}>💾 Guardar</button>
    </div></ModalW>}
    {modal==="addProv"&&<ModalW title="Proveedor" onClose={cm}><ProvForm onSave={p=>{setProvs(prev=>[...prev,{...p,id:"P"+_rid()}]);cm();show("✓");}}/></ModalW>}
    {modal==="menuImportar"&&<ModalW title="📥 Opciones de Importación" onClose={cm}>
      <div style={{display:"grid",gap:8}}>
        <button onClick={()=>{cm();setTimeout(()=>om("syncGoogleSheets"),50);}} style={{padding:"14px 16px",borderRadius:10,border:"2px solid "+T.green+"77",background:"linear-gradient(135deg,rgba(76,175,80,.15),rgba(66,165,245,.08))",color:T.text,fontSize:13,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,boxShadow:"0 0 12px rgba(76,175,80,.15)"}}>
          <span style={{fontSize:22}}>📊</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,color:T.green}}>Sync Google Sheets <span style={{background:T.green+"22",color:T.green,fontSize:9,padding:"2px 6px",borderRadius:6,marginLeft:4}}>NUEVO</span></div>
            <div style={{fontSize:11,color:T.muted,marginTop:2}}>Lee directo del Sheet del taller — el equipo carga ahí, tú importas en 1 clic</div>
          </div>
          <span style={{color:T.muted}}>›</span>
        </button>
        <button onClick={()=>{cm();setTimeout(()=>om("importarViernes"),50);}} style={{padding:"14px 16px",borderRadius:10,border:"1px solid "+T.gold+"44",background:"linear-gradient(135deg,rgba(201,149,107,.10),rgba(201,149,107,.04))",color:T.text,fontSize:13,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:22}}>📅</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,color:T.gold}}>Viernes del Taller</div>
            <div style={{fontSize:11,color:T.muted,marginTop:2}}>Sube las 3 tablas que te manda el taller (Ingresos + Gastos + Nómina)</div>
          </div>
          <span style={{color:T.muted}}>›</span>
        </button>
        <button onClick={()=>{cm();setTimeout(()=>om("importarMasivo",{tipo:"ing"}),50);}} style={{padding:"14px 16px",borderRadius:10,border:"1px solid "+T.green+"33",background:"rgba(76,175,80,.05)",color:T.text,fontSize:13,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:22}}>📈</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,color:T.green}}>Solo Ingresos</div>
            <div style={{fontSize:11,color:T.muted,marginTop:2}}>Importa una lista solo de ingresos desde Excel, foto o CSV</div>
          </div>
          <span style={{color:T.muted}}>›</span>
        </button>
        <button onClick={()=>{cm();setTimeout(()=>om("importarMasivo",{tipo:"egr"}),50);}} style={{padding:"14px 16px",borderRadius:10,border:"1px solid "+T.red+"33",background:"rgba(231,76,60,.05)",color:T.text,fontSize:13,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:22}}>📉</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,color:T.red}}>Solo Gastos</div>
            <div style={{fontSize:11,color:T.muted,marginTop:2}}>Importa una lista solo de gastos desde Excel, foto o CSV</div>
          </div>
          <span style={{color:T.muted}}>›</span>
        </button>
        {movs.some(m=>m.importadoEl||m.loteImport||m.importadoViernes)&&<>
          <div style={{height:1,background:T.border,margin:"4px 0"}}/>
          <button onClick={()=>{cm();setTimeout(()=>om("historialImports"),50);}} style={{padding:"14px 16px",borderRadius:10,border:"1px solid "+T.blue+"33",background:"rgba(66,165,245,.05)",color:T.text,fontSize:13,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:22}}>🕐</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,color:T.blue}}>Historial / Deshacer</div>
              <div style={{fontSize:11,color:T.muted,marginTop:2}}>Ver importaciones anteriores y deshacer si te equivocaste</div>
            </div>
            <span style={{color:T.muted}}>›</span>
          </button>
        </>}
      </div>
    </ModalW>}
    {modal==="resincronizar"&&<ModalW title="🔄 Resincronizar con la Nube" onClose={cm}>
      <ResincronizarView obras={obras} movs={movs} caja={caja} onAplicarNube={(nube)=>{
        setObras(nube.obras||[]);
        setMovs(nube.movs||[]);
        setCaja(nube.caja||[]);
        if(nube.rec)setRecibos(nube.rec);
        _lastWrite.current["obras"]=Date.now()+15000;
        _lastWrite.current["movs"]=Date.now()+15000;
        _lastWrite.current["caja"]=Date.now()+15000;
        cm();
        show("✓ Datos sincronizados desde la nube");
      }}/>
    </ModalW>}
    {modal==="historialImports"&&<ModalW title="📥 Historial de Importaciones" onClose={cm}>
      <HistorialImportacionesView movs={movs}
        onDeshacer={(movsDelLote)=>{
          movsDelLote.forEach(m=>enviarAPapelera("mov",m,m.desc+" (deshacer import)"));
          const idsBorrar=new Set(movsDelLote.map(m=>m.id));
          const newMovs=movs.filter(m=>!idsBorrar.has(m.id));
          setMovs(newMovs);
          _lastWrite.current["movs"]=Date.now()+15000;
          try{localStorage.removeItem("ev_ultimoLote");}catch{}
          show("⬅️ "+movsDelLote.length+" movs en la Papelera");
        }}
        onBorrarDuplicados={(movsDup)=>{
          movsDup.forEach(m=>enviarAPapelera("mov",m,m.desc+" (duplicado importado)"));
          const idsBorrar=new Set(movsDup.map(m=>m.id));
          const newMovs=movs.filter(m=>!idsBorrar.has(m.id));
          setMovs(newMovs);
          _lastWrite.current["movs"]=Date.now()+15000;
          show("🗑 "+movsDup.length+" duplicados en la Papelera");
        }}
      />
    </ModalW>}
    {modal==="importarViernes"&&<ModalW title="📅 Importar Viernes del Taller" onClose={cm}>
      <ImportadorViernesForm obras={obras} movs={movs} onImport={items=>{
        const baseId=movs.length;
        const loteId="viernes-"+Date.now();
        const nuevos=items.map((it,i)=>({
          fecha:it.fecha||td(),
          desc:it.desc,
          prov:it.prov||"",
          obra:it.obra||"",
          cat:it.cat||(it.tipo==="ing"?"":"Material"),
          ing:it.tipo==="ing"?Number(it.monto):0,
          egr:it.tipo==="egr"?Number(it.monto):0,
          user:user.nombre,
          id:baseId+i+1,
          importadoEl:td(),
          importadoViernes:true,
          loteImport:loteId
        }));
        setMovs(prev=>[...prev,...nuevos]);
        nuevos.forEach(n=>highlightNew("m"+n.id));
        // Guardar info del último lote para poder deshacer
        try{localStorage.setItem("ev_ultimoLote",JSON.stringify({loteId,timestamp:Date.now(),tipo:"Viernes del Taller",count:nuevos.length,user:user.nombre}));}catch{}
        cm();
        const nIng=items.filter(it=>it.tipo==="ing").length;
        const nEgr=items.filter(it=>it.tipo==="egr").length;
        show("✓ Viernes importado: "+nIng+" ingresos + "+nEgr+" egresos (puedes deshacer desde Finanzas)");
      }}/>
    </ModalW>}
    {modal==="importarMasivo"&&<ModalW title={"📊 Importar masivo · "+(md?.tipo==="ing"?"Ingresos":"Egresos")} onClose={cm}>
      <ImportadorMasivoForm tipo={md?.tipo||"egr"} obras={obras} onImport={items=>{
        const tipo=md?.tipo||"egr";
        const loteId=tipo+"-"+Date.now();
        const baseId=movs.length;
        const nuevos=items.map((it,i)=>({
          fecha:it.fecha||td(),
          desc:it.desc,
          prov:it.prov||"",
          obra:it.obra||"",
          // Respeta la categoría del pegado si viene (ej: "Nómina"), sino default
          cat:it.cat||(tipo==="ing"?"":"Material"),
          ing:tipo==="ing"?Number(it.monto):0,
          egr:tipo==="ing"?0:Number(it.monto),
          monto:Number(it.monto), // ← para compat con vistas que leen m.monto
          user:user.nombre,
          status:"aprobado",
          id:baseId+i+1,
          importadoEl:td(),
          loteImport:loteId
        }));
        setMovs(prev=>[...prev,...nuevos]);
        nuevos.forEach(n=>highlightNew("m"+n.id));
        try{localStorage.setItem("ev_ultimoLote",JSON.stringify({loteId,timestamp:Date.now(),tipo:tipo==="ing"?"Ingresos masivos":"Gastos masivos",count:nuevos.length,user:user.nombre}));}catch{}
        cm();
        show("✓ "+items.length+" "+(tipo==="ing"?"ingresos":"egresos")+" importados (puedes deshacer)");
      }}/>
    </ModalW>}
    {modal==="obrasSimilares"&&<ModalW title="🔗 Detectar y Fusionar Obras Similares" onClose={cm}>
      <ObrasSimilaresView obras={obras} movs={movs} caja={caja} onFusionar={(destino,fusionar)=>{
        // 1. Reasignar TODOS los movs/caja de cada obra fusionada al destino
        let nMovs=0,nCaja=0;
        let newMovs=movs,newCaja=caja;
        fusionar.forEach(o=>{
          const k=normSearch(o.nombre);
          newMovs=newMovs.map(m=>{if(normSearch(m.obra||"")===k){nMovs++;return{...m,obra:destino.nombre};}return m;});
          newCaja=newCaja.map(c=>{if(normSearch(c.obra||"")===k){nCaja++;return{...c,obra:destino.nombre};}return c;});
        });
        setMovs(newMovs);setCaja(newCaja);
        // 2. Eliminar las obras secundarias del array de obras (solo las que no sean fantasmas — los fantasmas no están en obras[])
        const idsAEliminar=new Set(fusionar.filter(o=>!o.isFantasma).map(o=>o.id));
        if(idsAEliminar.size>0){
          // 3. Sumar los presupuestos al destino si tienen
          const sumaCotizado=fusionar.filter(o=>!o.isFantasma).reduce((s,o)=>s+(o.cotizado||0),0);
          const newObras=obras.filter(o=>!idsAEliminar.has(o.id)).map(o=>{
            if(o.id===destino.id&&sumaCotizado>0){
              return {...o,cotizado:(o.cotizado||0)+sumaCotizado,modificadoPor:user.nombre,modificadoFecha:td()};
            }
            return o;
          });
          setObras(newObras);
        }
        _lastWrite.current["obras"]=Date.now()+15000;
        _lastWrite.current["movs"]=Date.now()+15000;
        _lastWrite.current["caja"]=Date.now()+15000;
        show("🔗 "+(fusionar.length)+" obras fusionadas en '"+destino.nombre+"' · "+(nMovs+nCaja)+" movs reasignados");
      }}/>
    </ModalW>}
    {modal==="analisisDesfase"&&<ModalW title="🔍 Análisis de Desfase Financiero" onClose={cm}>
      <AnalisisDesfaseView movs={movs} caja={caja} obras={obras} setMovs={setMovs} setCaja={setCaja} setObras={setObras} show={show} cm={cm}/>
    </ModalW>}
    {modal==="fusionarObras"&&<ModalW title="🔀 Fusionar obras" onClose={cm}>
      <FusionarObrasForm
        finObras={finObras}
        obras={obras}
        countMovs={obraNombre=>{
          const k=normSearch(obraNombre);
          const m1=movs.filter(m=>normSearch(m.obra||"")===k).length;
          const c1=caja.filter(c=>normSearch(c.obra||"")===k).length;
          return m1+c1;
        }}
        onFuse={(origen,destino)=>{
          const k=normSearch(origen);
          let nMovs=0,nCaja=0;
          const newMovs=movs.map(m=>{if(normSearch(m.obra||"")===k){nMovs++;return{...m,obra:destino};}return m;});
          const newCaja=caja.map(c=>{if(normSearch(c.obra||"")===k){nCaja++;return{...c,obra:destino};}return c;});
          setMovs(newMovs);
          setCaja(newCaja);
          cm();
          show("🔀 "+nMovs+" mov + "+nCaja+" caja reasignados a "+(destino||"General"));
        }}
      />
    </ModalW>}
    {modal==="syncGoogleSheets"&&<ModalW title="📊 Sync Google Sheets" onClose={cm}>
      <GoogleSheetsSyncForm
        obras={obras}
        movs={movs}
        setMovs={setMovs}
        enviarAPapelera={enviarAPapelera}
        user={user}
        td={td}
        show={show}
        cm={cm}
        _lastWrite={_lastWrite}
      />
    </ModalW>}
    {modal==="prorratear"&&<ModalW title="🧮 Prorratear gasto fijo" onClose={cm}>
      <ProrratearGastoForm
        obras={obras}
        movs={movs}
        setMovs={setMovs}
        enviarAPapelera={enviarAPapelera}
        user={user}
        td={td}
        show={show}
        cm={cm}
        _lastWrite={_lastWrite}
      />
    </ModalW>}
    {modal==="fusionarDuplicadasCatalogo"&&<ModalW title="🔗 Fusionar obras duplicadas del catálogo" onClose={cm}>
      {(()=>{
        // Encuentra grupos de obras con nombres similares (mismo nombre base)
        const cleanLettersOnly=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z]/g,"");
        const nums=s=>{const m=String(s||"").match(/\d+/g);return m?m.sort().join(","):"";};
        // Quitar sufijos como "(copia)", "(2)", " copy"
        const cleanForCompare=s=>{
          let x=String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
          x=x.replace(/\(copia\d*\)/g,"").replace(/\(copy\d*\)/g,"").replace(/\(\d+\)/g,"").replace(/copia\d*/gi,"").replace(/copy\d*/gi,"");
          return x.replace(/[^a-z0-9]/g,"");
        };
        // Agrupar por cleanForCompare
        const grupos=new Map();
        obras.forEach(o=>{
          const k=cleanForCompare(o.nombre);
          if(!k)return;
          if(!grupos.has(k))grupos.set(k,[]);
          grupos.get(k).push(o);
        });
        // Filtrar solo grupos con 2+ obras
        const duplicados=[...grupos.values()].filter(g=>g.length>=2);
        // Ordenar cada grupo: prioridad = obra con más movs / mayor cotizado
        duplicados.forEach(g=>{
          g.forEach(o=>{
            o._movs=movs.filter(m=>m.obra===o.nombre).length+caja.filter(c=>c.obra===o.nombre).length;
            o._cotizado=o.cotizado||0;
          });
          g.sort((a,b)=>b._movs-a._movs||b._cotizado-a._cotizado||a.nombre.localeCompare(b.nombre));
        });
        return <div>
          <div style={{background:"rgba(171,71,188,.08)",border:"1px solid "+T.purple+"44",borderRadius:8,padding:12,marginBottom:12,fontSize:11,color:T.muted,lineHeight:1.5}}>
            <div style={{color:T.purple,fontWeight:700,marginBottom:4,fontSize:12}}>🔗 ¿Cómo funciona?</div>
            Encontré <b>{duplicados.length}</b> grupo(s) de obras duplicadas en tu catálogo. Para cada grupo, la de más arriba (con más movs / cotizado más alto) queda como la "PRINCIPAL" y las demás se fusionan en ella:
            <ul style={{margin:"6px 0 0",paddingLeft:20,lineHeight:1.6}}>
              <li>Todos los movs y caja chica de las duplicadas se pasan a la principal</li>
              <li>Las obras duplicadas se mandan a Papelera (recuperables 30 días)</li>
              <li>Los datos (cliente, cotizado, docs) de la principal se mantienen</li>
            </ul>
          </div>
          {duplicados.length===0?<div style={{padding:30,textAlign:"center",color:T.green,fontSize:14}}>✅ ¡Sin duplicadas! Tu catálogo está limpio.</div>:<>
            <div style={{maxHeight:380,overflowY:"auto",border:"1px solid "+T.border,borderRadius:8,marginBottom:10}}>
              {duplicados.map((grupo,gi)=><div key={gi} style={{padding:10,borderBottom:"1px solid #2a2a2a"}}>
                <div style={{fontSize:11,color:T.purple,fontWeight:700,marginBottom:6}}>GRUPO {gi+1} — {grupo.length} obras similares</div>
                {grupo.map((o,i)=><div key={o.id} style={{padding:"6px 8px",background:i===0?"rgba(76,175,80,.08)":"rgba(255,152,0,.05)",border:"1px solid "+(i===0?T.green+"33":T.orange+"33"),borderRadius:6,marginBottom:4,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:4}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,color:i===0?T.green:T.orange,fontSize:12}}>{i===0?"✅ PRINCIPAL":"🗑 Se fusiona"} · {o.nombre}</div>
                    <div style={{fontSize:10,color:T.muted}}>{o.cliente||"sin cliente"} · Cotizado {$(o._cotizado)} · {o._movs} movs</div>
                  </div>
                </div>)}
              </div>)}
            </div>
            <button onClick={()=>{
              if(!confirm("¿FUSIONAR "+duplicados.length+" grupo(s) de obras duplicadas?\n\nLa primera de cada grupo (más movs) queda como PRINCIPAL.\nLas demás se mandan a Papelera y sus movs se transfieren.\n\nNo se pueden deshacer las transferencias, pero puedes recuperar las obras de Papelera.")) return;
              let obrasBorradas=0, movsTransferidos=0, cajaTransferidos=0;
              let newObras=[...obras];
              let newMovs=[...movs];
              let newCaja=[...caja];
              duplicados.forEach(grupo=>{
                const principal=grupo[0];
                const secundarias=grupo.slice(1);
                secundarias.forEach(sec=>{
                  // Transferir movs
                  newMovs=newMovs.map(m=>{
                    if(m.obra===sec.nombre){movsTransferidos++;return {...m,obra:principal.nombre};}
                    return m;
                  });
                  // Transferir caja
                  newCaja=newCaja.map(c=>{
                    if(c.obra===sec.nombre){cajaTransferidos++;return {...c,obra:principal.nombre};}
                    return c;
                  });
                  // Mandar a papelera
                  enviarAPapelera("obra",sec,"Fusionada con "+principal.nombre);
                  newObras=newObras.filter(o=>o.id!==sec.id);
                  obrasBorradas++;
                });
              });
              setObras(newObras);
              setMovs(newMovs);
              setCaja(newCaja);
              _lastWrite.current["obras"]=Date.now()+30000;
              _lastWrite.current["movs"]=Date.now()+30000;
              _lastWrite.current["caja"]=Date.now()+30000;
              show("🔗 "+obrasBorradas+" obras fusionadas · "+(movsTransferidos+cajaTransferidos)+" registros transferidos");
              cm();
            }} style={{...sB,background:T.purple,fontSize:14,fontWeight:800}}>🔗 Fusionar todos los grupos</button>
          </>}
        </div>;
      })()}
    </ModalW>}
    {modal==="normalizarObras"&&<ModalW title="🪄 Normalizar nombres de obras" onClose={cm}>
      {(()=>{
        // Función de similitud: quita todo lo no-alfanumérico y compara
        const cleanForMatch=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g,"");
        // Solo letras (sin números): para matchear JACARANDAS con JACARANDA 29
        const cleanLettersOnly=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z]/g,"");
        // Prefijo común entre dos strings
        const commonPrefix=(a,b)=>{let i=0;while(i<Math.min(a.length,b.length)&&a[i]===b[i])i++;return i;};
        // Recopilar todas las variantes actuales en movs y caja
        const variantesMap=new Map();
        movs.forEach(m=>{if(m.obra&&m.obra.trim()){const k=m.obra.trim();variantesMap.set(k,(variantesMap.get(k)||0)+1);}});
        caja.forEach(c=>{if(c.obra&&c.obra.trim()&&c.obra!=="General"){const k=c.obra.trim();variantesMap.set(k,(variantesMap.get(k)||0)+1);}});
        // Para cada variante que NO exista EXACTA en obras[], buscar la mejor coincidencia
        const propuestas=[];
        variantesMap.forEach((count,nombreVariante)=>{
          const existeExacta=obras.some(o=>o.nombre===nombreVariante);
          if(existeExacta)return;
          const cleanV=cleanForMatch(nombreVariante);
          const lettersV=cleanLettersOnly(nombreVariante);
          let best=null;
          let bestScore=0;
          for(const o of obras){
            const cleanO=cleanForMatch(o.nombre);
            const lettersO=cleanLettersOnly(o.nombre);
            let score=0; let razon="";
            // Match 1 (100pts): idénticos sin símbolos → "CORAL#39" = "CORAL #39"
            if(cleanV===cleanO){score=100;razon="idénticos sin símbolos";}
            // Match 2 (95pts): letras idénticas → "JACARANDAS" ≈ "JACARANDA" (misma raíz de letras)
            //   ojo: solo si las letras (sin números) son muy similares
            else if(lettersV&&lettersO){
              const prefLet=commonPrefix(lettersV,lettersO);
              const minLetLen=Math.min(lettersV.length,lettersO.length);
              const maxLetLen=Math.max(lettersV.length,lettersO.length);
              // Prefijo común >= 60% de la más larga Y >= 5 chars → match seguro
              if(prefLet>=5&&prefLet/maxLetLen>=0.6){
                score=95-Math.round((1-prefLet/maxLetLen)*10);
                razon="mismo nombre base ("+prefLet+" letras iguales)";
              }
              // Uno contiene al otro Y >= 5 chars → match
              else if(minLetLen>=5&&(lettersO.includes(lettersV)||lettersV.includes(lettersO))){
                score=85;razon="una está contenida en la otra";
              }
              // Prefijo común >= 5 chars aunque sea menos del 60%
              else if(prefLet>=5){
                score=70+prefLet;razon=prefLet+" letras iguales al inicio";
              }
            }
            if(score>bestScore){bestScore=score;best={obra:o,confianza:score>=90?"alta":score>=75?"media":"baja",razon,score};}
          }
          propuestas.push({variante:nombreVariante,count,sugerido:best});
        });
        propuestas.sort((a,b)=>b.count-a.count);
        const conMatch=propuestas.filter(p=>p.sugerido);
        const sinMatch=propuestas.filter(p=>!p.sugerido);
        return <div>
          <div style={{background:"rgba(76,175,80,.08)",border:"1px solid "+T.green+"44",borderRadius:8,padding:12,marginBottom:12,fontSize:11,color:T.muted,lineHeight:1.5}}>
            <div style={{color:T.green,fontWeight:700,marginBottom:4,fontSize:12}}>✨ Cómo funciona</div>
            Encontré <b>{propuestas.length}</b> nombres de obra en tus movimientos que NO coinciden exactamente con tu catálogo. Debajo la propuesta: reemplazar cada variante con la obra oficial. Revisa, quita las que no quieras, y aplica todo con 1 click.
          </div>
          {propuestas.length===0?<div style={{padding:30,textAlign:"center",color:T.green,fontSize:14}}>✅ ¡Todo limpio! Todos los movs usan nombres exactos del catálogo.</div>:<>
            <div style={{fontSize:11,color:T.gold,fontWeight:700,textTransform:"uppercase",marginBottom:6,letterSpacing:1}}>📋 {propuestas.length} variante(s) detectadas — puedes cambiar la sugerencia con el dropdown</div>
            <div style={{maxHeight:340,overflowY:"auto",border:"1px solid "+T.border,borderRadius:8,marginBottom:10}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead style={{position:"sticky",top:0,background:"#1a1a1a",zIndex:1}}><tr>
                  <th style={{padding:6,textAlign:"center",color:T.gold,fontSize:10,width:30}}>✓</th>
                  <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:10}}>VARIANTE ACTUAL</th>
                  <th style={{padding:6,textAlign:"center",color:T.gold,fontSize:10,width:20}}>→</th>
                  <th style={{padding:6,textAlign:"left",color:T.gold,fontSize:10}}>CAMBIAR A (elige del catálogo)</th>
                  <th style={{padding:6,textAlign:"right",color:T.gold,fontSize:10,width:60}}>#MOVS</th>
                </tr></thead>
                <tbody>
                  {propuestas.map((p,i)=>{
                    const suggestedName=p.sugerido?p.sugerido.obra.nombre:"";
                    const bgColor=p.sugerido?(p.sugerido.confianza==="alta"?"rgba(76,175,80,.05)":p.sugerido.confianza==="media"?"rgba(255,213,79,.05)":"rgba(255,152,0,.05)"):"rgba(231,76,60,.05)";
                    return <tr key={p.variante} style={{background:bgColor,borderBottom:"1px solid #2a2a2a"}}>
                      <td style={{padding:5,textAlign:"center"}}><input type="checkbox" defaultChecked={!!p.sugerido} data-variante={p.variante} className="norm-check" id={"chk-"+i}/></td>
                      <td style={{padding:5,color:T.red}}>⚠️ {p.variante}<div style={{fontSize:9,color:T.muted,fontWeight:400}}>{p.sugerido?p.sugerido.razon:"sin sugerencia automática"}</div></td>
                      <td style={{padding:5,textAlign:"center",color:T.muted}}>→</td>
                      <td style={{padding:5}}>
                        <select defaultValue={suggestedName} id={"sel-"+i} data-variante={p.variante} className="norm-select" style={{background:"rgba(255,255,255,.04)",border:"1px solid "+T.border,color:suggestedName?T.green:T.yellow,fontSize:11,padding:"4px 8px",width:"100%",cursor:"pointer",fontWeight:700,borderRadius:4}}>
                          <option value="" style={{background:"#1a1a1a"}}>— NO cambiar (déjala como fantasma) —</option>
                          {obras.slice().sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(o=><option key={o.id} value={o.nombre} style={{background:"#1a1a1a"}}>{o.nombre}{o.cliente?" — "+o.cliente:""}</option>)}
                        </select>
                      </td>
                      <td style={{padding:5,textAlign:"right",fontWeight:700}}>{p.count}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            <div style={{padding:"8px 10px",background:"rgba(66,165,245,.06)",border:"1px solid "+T.blue+"33",borderRadius:7,fontSize:10,color:T.muted,marginBottom:8,lineHeight:1.5}}>
              💡 <b>Fondos de color:</b> 🟢 verde = match seguro · 🟡 amarillo = match probable · 🟠 naranja = revisa · 🔴 rojo = sin sugerencia<br/>
              <b>Cambia el destino con el dropdown</b> si quieres reasignar a otra obra distinta a la sugerida.
            </div>
            <button onClick={()=>{
              const checks=document.querySelectorAll(".norm-check");
              const cambios=[];
              checks.forEach((chk,i)=>{
                if(!chk.checked)return;
                const sel=document.getElementById("sel-"+i.toString().replace("chk-",""));
                // usar el id del propio checkbox para encontrar el select
                const idx=chk.id.replace("chk-","");
                const selEl=document.getElementById("sel-"+idx);
                if(!selEl||!selEl.value)return;
                cambios.push({de:chk.dataset.variante,a:selEl.value});
              });
              if(cambios.length===0){show("⚠️ No hay nada para cambiar (destildaste todos o dejaste sin destino)");return;}
              let totalMovs=0,totalCaja=0;
              const nuevosMovs=movs.map(m=>{
                const c=cambios.find(x=>x.de===m.obra);
                if(c){totalMovs++;return {...m,obra:c.a};}
                return m;
              });
              const nuevosCaja=caja.map(c2=>{
                const c=cambios.find(x=>x.de===c2.obra);
                if(c){totalCaja++;return {...c2,obra:c.a};}
                return c2;
              });
              if(!confirm("¿NORMALIZAR "+cambios.length+" variante(s)?\n\nSe cambiarán:\n• "+totalMovs+" movimientos\n• "+totalCaja+" gastos de caja chica\n\nPrimeros 5:\n"+cambios.slice(0,5).map(c=>"  '"+c.de+"' → '"+c.a+"'").join("\n"))) return;
              setMovs(nuevosMovs);
              setCaja(nuevosCaja);
              _lastWrite.current["movs"]=Date.now()+30000;
              _lastWrite.current["caja"]=Date.now()+30000;
              show("🪄 "+cambios.length+" variantes normalizadas · "+(totalMovs+totalCaja)+" registros actualizados");
              cm();
            }} style={{...sB,background:T.green,fontSize:14,fontWeight:800}}>🪄 Aplicar cambios seleccionados</button>
          </>}
        </div>;
      })()}
    </ModalW>}
    {modal==="addUser"&&<ModalW title="Usuario" onClose={cm}><UserForm obras={obras} onSave={u=>{setUsers(prev=>[...prev,{...u,id:Math.max(...prev.map(x=>x.id))+1}]);cm();show("Usuario ✓");}}/></ModalW>}
    {modal==="setPin"&&md&&<ModalW title={"🔒 PIN de "+md.nombre} onClose={cm}><div style={{textAlign:"center"}}><div style={{fontSize:13,color:T.muted,marginBottom:14}}>{md.pin?"Cambiar PIN actual":"Crear PIN de 4 dígitos"}</div><input type="number" id="newPinInput" defaultValue="" placeholder="0000" style={{...sI,textAlign:"center",fontSize:28,fontWeight:800,letterSpacing:12,maxWidth:200,margin:"0 auto"}} maxLength={4}/><button style={sB} onClick={()=>{const v=document.getElementById("newPinInput").value;if(v.length===4){setUsers(users.map(u=>u.id===md.id?{...u,pin:v}:u));cm();show("PIN asignado 🔒");}else show("Debe ser de 4 dígitos");}}>Guardar PIN</button>{md.pin&&<button style={{...sB,background:"#2a1111",color:T.red,border:"1px solid #3a1a1a"}} onClick={()=>{setUsers(users.map(u=>u.id===md.id?{...u,pin:""}:u));cm();show("PIN eliminado 🔓");}}>Quitar PIN</button>}</div></ModalW>}
    {modal==="vRec"&&md&&<ModalW title={"Recibo "+md.id} onClose={cm}><div><div id="reciboForPrint"><ReciboView data={md}/></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}><button style={{...sB,background:"#0a2e0a",color:T.green,marginTop:0}} onClick={()=>{const el=document.getElementById("reciboForPrint");const w2=window.open("","","width=600,height=500");w2.document.write("<html><head><title>Recibo "+md.id+"</title><style>body{font-family:Arial,sans-serif;margin:0;padding:20px;color:#222}@media print{body{padding:10px}}</style></head><body>"+el.innerHTML+"</body></html>");w2.document.close();w2.print();}}>🖨️ Imprimir / PDF</button><button style={{...sB,background:"#1a1a2a",color:T.blue,marginTop:0}} onClick={()=>{const txt="*RECIBO "+md.id+"*%0A%0ACliente: "+encodeURIComponent(md.cliente||"")+" %0AConcepto: "+encodeURIComponent(md.concepto||"")+" %0AObra: "+encodeURIComponent(md.obra||"")+" %0A*Monto: "+encodeURIComponent($(md.monto))+"*%0A%0A_Ensamble Villarreal_%0ACarpintería Arquitectónica%0ATel: 449 181 4651";window.open("https://wa.me/?text="+txt);}}>📲 Enviar WhatsApp</button></div></div></ModalW>}
    {modal==="verTicket"&&md&&<ModalW title={"🧾 "+md.concepto} onClose={cm}><div style={{textAlign:"center"}}>{md.ticket&&<img src={md.ticket} style={{maxWidth:"100%",borderRadius:10,marginBottom:12}} alt="Ticket"/>}<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,textAlign:"left"}}><div><div style={{fontSize:10,color:T.muted}}>CONCEPTO</div><div style={{fontWeight:700}}>{md.concepto}</div></div><div><div style={{fontSize:10,color:T.muted}}>MONTO</div><div style={{fontWeight:800,color:T.orange,fontSize:20}}>{$(md.monto)}</div></div><div><div style={{fontSize:10,color:T.muted}}>FECHA</div><div>{fd(md.fecha)}</div></div><div><div style={{fontSize:10,color:T.muted}}>RESPONSABLE</div><div>{md.resp}</div></div></div></div></ModalW>}
    {modal==="recC"&&md&&<ModalW title="Recibo" onClose={cm}><ReciboView data={md}/></ModalW>}
    {modal==="solEx"&&<ModalW title="Extra" onClose={cm}><ExtraForm onSave={e=>{cm();show("Enviado");}}/></ModalW>}
    {modal==="pdfCli"&&md&&<div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"flex-start",justifyContent:"center",overflowY:"auto",padding:16}} onClick={cm}><div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:700,margin:"20px auto"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><button onClick={()=>{const el=document.getElementById("pdfCli");const w2=window.open("","","width=800,height=600");w2.document.write("<html><head><title>Estado de Cuenta "+md.ob.nombre+"</title><style>body{font-family:Arial,sans-serif;color:#222;margin:0;padding:30px}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #ddd}th{background:#1B5E20;color:#fff;font-size:11px}.r{text-align:right}.b{font-weight:700}@media print{body{padding:20px}}</style></head><body>"+el.innerHTML+"</body></html>");w2.document.close();w2.print();}} style={{...sB,maxWidth:200,marginTop:0,background:T.green,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>🖨️ Imprimir / PDF</button><div style={{display:"flex",gap:6}}><button onClick={()=>{const txt="*ESTADO DE CUENTA*%0A"+encodeURIComponent(md.ob.nombre)+"%0ACliente: "+encodeURIComponent(md.cli.nombre)+"%0A%0AMonto pactado: "+encodeURIComponent($(md.ob.cotizado))+"%0APagado: "+encodeURIComponent($(md.obPag))+"%0AResta: "+encodeURIComponent($(md.ob.cotizado-md.obPag))+"%0A%0A"+md.estData.map(e=>encodeURIComponent(e.nombre+": "+$(e.monto)+" - "+(e.cumplido?"Pagado":"Falta "+$(e.falta)))).join("%0A")+"%0A%0A_Ensamble Villarreal_%0ATel: 449 181 4651";window.open("https://wa.me/"+(md.cli.tel?md.cli.tel.replace(/\D/g,""):"")+"?text="+txt);}} style={{...sB,maxWidth:180,marginTop:0,background:"#1a3a1a",color:T.green,border:"1px solid "+T.green+"33"}}>📲 WhatsApp</button><button onClick={cm} style={{background:"#333",border:"none",color:"#aaa",borderRadius:20,width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button></div></div>
      <div id="pdfCli" style={{background:"#fff",color:"#222",borderRadius:8,padding:30,fontFamily:"Arial,sans-serif"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",borderBottom:"3px solid #1B5E20",paddingBottom:16,marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}><img src={LOGO_IMG} style={{width:55,height:55,borderRadius:10,objectFit:"cover"}} alt=""/><div><div style={{fontSize:22,fontWeight:800,color:"#1B5E20",letterSpacing:1}}>ENSAMBLE VILLARREAL</div><div style={{fontSize:11,color:"#666"}}>CARPINTERÍA ARQUITECTÓNICA</div><div style={{fontSize:10,color:"#999",marginTop:4}}>Circuito Los Sauces 136, Aguascalientes · Tel: 449 181 4651</div></div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:800,color:"#1B5E20"}}>ESTADO DE CUENTA</div><div style={{fontSize:12,color:"#666",marginTop:4}}>Fecha: {fd(td())}</div></div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",padding:"12px 16px",background:"#f5f5f5",borderRadius:6,marginBottom:16}}>
          <div><div style={{fontSize:10,color:"#999",fontWeight:700}}>CLIENTE</div><div style={{fontSize:16,fontWeight:700}}>{md.cli.nombre}</div>{md.cli.tel&&<div style={{fontSize:11,color:"#666"}}>Tel: {md.cli.tel}</div>}</div>
          <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#999",fontWeight:700}}>PROYECTO</div><div style={{fontSize:16,fontWeight:700}}>{md.ob.nombre}</div><div style={{fontSize:11,color:"#666"}}>{FASES[md.ob.fase]||md.ob.fase}</div></div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",padding:"14px 16px",background:"#E8F5E9",borderRadius:6,marginBottom:16}}>
          <div style={{textAlign:"center",flex:1}}><div style={{fontSize:10,color:"#2E7D32",fontWeight:700}}>MONTO PACTADO</div><div style={{fontSize:22,fontWeight:800,color:"#1B5E20"}}>{$(md.ob.cotizado)}</div></div>
          <div style={{textAlign:"center",flex:1}}><div style={{fontSize:10,color:"#2E7D32",fontWeight:700}}>PAGADO</div><div style={{fontSize:22,fontWeight:800,color:"#2E7D32"}}>{$(md.obPag)}</div></div>
          <div style={{textAlign:"center",flex:1}}><div style={{fontSize:10,color:md.ob.cotizado-md.obPag>0?"#E65100":"#2E7D32",fontWeight:700}}>RESTA</div><div style={{fontSize:22,fontWeight:800,color:md.ob.cotizado-md.obPag>0?"#E65100":"#2E7D32"}}>{$(md.ob.cotizado-md.obPag)}</div></div>
        </div>
        <div style={{marginBottom:16}}><div style={{fontSize:12,fontWeight:700,color:"#1B5E20",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>Esquema de Pagos</div>
          <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr style={{background:"#1B5E20"}}><th style={{padding:10,color:"#fff",fontSize:11,textAlign:"left"}}>Concepto</th><th style={{padding:10,color:"#fff",fontSize:11,textAlign:"right"}}>Debe Dar</th><th style={{padding:10,color:"#fff",fontSize:11,textAlign:"right"}}>Ha Dado</th><th style={{padding:10,color:"#fff",fontSize:11,textAlign:"right"}}>Falta</th><th style={{padding:10,color:"#fff",fontSize:11,textAlign:"center"}}>Fecha</th><th style={{padding:10,color:"#fff",fontSize:11,textAlign:"center"}}>Status</th></tr></thead><tbody>{md.estData.map((e,i)=><tr key={i} style={{background:i%2===0?"#fff":"#fafafa"}}><td style={{padding:10,fontSize:12,fontWeight:600}}>{e.nombre}</td><td style={{padding:10,fontSize:12,textAlign:"right",fontWeight:700}}>{$(e.monto)}</td><td style={{padding:10,fontSize:12,textAlign:"right",color:"#2E7D32",fontWeight:700}}>{$(e.pagadoEst)}</td><td style={{padding:10,fontSize:12,textAlign:"right",color:e.falta>0?"#E65100":"#2E7D32",fontWeight:700}}>{$(e.falta)}</td><td style={{padding:10,fontSize:12,textAlign:"center"}}>{e.fecha?fd(e.fecha):"Por definir"}</td><td style={{padding:10,fontSize:12,textAlign:"center"}}><span style={{background:e.cumplido?"#E8F5E9":"#FFF3E0",color:e.cumplido?"#2E7D32":"#E65100",padding:"3px 10px",borderRadius:10,fontWeight:700,fontSize:10}}>{e.cumplido?"✓ Pagado":"Pendiente"}</span></td></tr>)}</tbody></table>
        </div>
        {md.pagos.length>0&&<div style={{marginBottom:16}}><div style={{fontSize:12,fontWeight:700,color:"#1B5E20",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>Pagos Recibidos</div><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr style={{background:"#1B5E20"}}><th style={{padding:8,color:"#fff",fontSize:11,textAlign:"left"}}>Fecha</th><th style={{padding:8,color:"#fff",fontSize:11,textAlign:"left"}}>Concepto</th><th style={{padding:8,color:"#fff",fontSize:11,textAlign:"right"}}>Monto</th></tr></thead><tbody>{md.pagos.map((p,i)=><tr key={i} style={{background:i%2===0?"#fff":"#fafafa"}}><td style={{padding:8,fontSize:12}}>{fd(p.fecha)}</td><td style={{padding:8,fontSize:12}}>{p.desc}</td><td style={{padding:8,fontSize:12,textAlign:"right",fontWeight:700,color:"#2E7D32"}}>{$(p.ing)}</td></tr>)}<tr style={{borderTop:"2px solid #1B5E20"}}><td colSpan={2} style={{padding:10,fontWeight:800,fontSize:13}}>TOTAL PAGADO</td><td style={{padding:10,textAlign:"right",fontWeight:800,fontSize:16,color:"#1B5E20"}}>{$(md.obPag)}</td></tr></tbody></table></div>}
        <div style={{display:"flex",justifyContent:"space-between",padding:"12px 16px",background:"#f5f5f5",borderRadius:6,marginBottom:16}}>
          <div><div style={{fontSize:10,color:"#999",fontWeight:700}}>FECHA INICIO</div><div style={{fontSize:13,fontWeight:700}}>{md.ob.inicio?fd(md.ob.inicio):"Por definir"}</div></div>
          <div><div style={{fontSize:10,color:"#999",fontWeight:700}}>FECHA ENTREGA</div><div style={{fontSize:13,fontWeight:700}}>{md.ob.entrega?fd(md.ob.entrega):"Por definir"}</div></div>
          <div><div style={{fontSize:10,color:"#999",fontWeight:700}}>AVANCE</div><div style={{fontSize:13,fontWeight:700}}>{md.ob.avance||0}%</div></div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:30,paddingTop:20}}><div style={{textAlign:"center",width:"40%",borderTop:"1px solid #999",paddingTop:8,fontSize:11,color:"#999"}}>Firma cliente</div><div style={{textAlign:"center",width:"40%",borderTop:"1px solid #999",paddingTop:8,fontSize:11,color:"#999"}}>Ensamble Villarreal</div></div>
        <div style={{textAlign:"center",marginTop:20,fontSize:9,color:"#bbb",fontStyle:"italic"}}>— Donde la madera encuentra su forma —</div>
      </div></div></div>}
    {modal==="pdfCot"&&md&&<div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"flex-start",justifyContent:"center",overflowY:"auto",padding:16}} onClick={cm}><div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:700,margin:"20px auto"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><button onClick={()=>{const el=document.getElementById("pdfCot");const w2=window.open("","","width=800,height=600");w2.document.write("<html><head><title>Cotización "+md.nombre+"</title><style>body{font-family:Arial,sans-serif;color:#222;margin:0;padding:30px}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #ddd}th{background:#1B5E20;color:#fff;font-size:12px}td{font-size:12px}.r{text-align:right}.b{font-weight:700}.gold{color:#8B6914}@media print{body{padding:20px}}</style></head><body>"+el.innerHTML+"</body></html>");w2.document.close();w2.print();}} style={{...sB,maxWidth:200,marginTop:0,background:T.green,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>🖨️ Imprimir / PDF</button><button onClick={cm} style={{background:"#333",border:"none",color:"#aaa",borderRadius:20,width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button></div>
      <div id="pdfCot" style={{background:"#fff",color:"#222",borderRadius:8,padding:30,fontFamily:"Arial,sans-serif"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",borderBottom:"3px solid #1B5E20",paddingBottom:16,marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}><img src={LOGO_IMG} style={{width:55,height:55,borderRadius:10,objectFit:"cover"}} alt=""/><div><div style={{fontSize:22,fontWeight:800,color:"#1B5E20",letterSpacing:1}}>ENSAMBLE VILLARREAL</div><div style={{fontSize:11,color:"#666",marginTop:2}}>CARPINTERÍA ARQUITECTÓNICA</div><div style={{fontSize:10,color:"#999",marginTop:4}}>Circuito Los Sauces 136, Aguascalientes, Ags.</div><div style={{fontSize:10,color:"#999"}}>Tel: 449 181 4651</div></div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:"#1B5E20"}}>COTIZACIÓN</div><div style={{fontSize:12,color:"#666",marginTop:4}}>Fecha: {fd(td())}</div><div style={{fontSize:12,color:"#666"}}>Ref: {md.id}</div></div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:20,padding:"12px 16px",background:"#f5f5f5",borderRadius:6}}>
          <div><div style={{fontSize:10,color:"#999",textTransform:"uppercase",fontWeight:700}}>Cliente</div><div style={{fontSize:14,fontWeight:700}}>{md.cliente||"—"}</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#999",textTransform:"uppercase",fontWeight:700}}>Proyecto</div><div style={{fontSize:14,fontWeight:700}}>{md.nombre}</div></div>
        </div>
        {(md.partidas||[]).length>0&&<div><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr style={{background:"#1B5E20"}}><th style={{padding:"10px",color:"#fff",fontSize:11,textAlign:"left",width:40}}>#</th><th style={{padding:"10px",color:"#fff",fontSize:11,textAlign:"left"}}>Concepto</th><th style={{padding:"10px",color:"#fff",fontSize:11,textAlign:"center",width:50}}>Cant.</th><th style={{padding:"10px",color:"#fff",fontSize:11,textAlign:"right",width:100}}>P. Unit.</th><th style={{padding:"10px",color:"#fff",fontSize:11,textAlign:"right",width:100}}>Importe</th></tr></thead><tbody>{md.partidas.map((p,i)=> <tr key={i} style={{borderBottom:"1px solid #e0e0e0",background:i%2===0?"#fff":"#fafafa"}}><td style={{padding:"8px 10px",fontSize:12,color:"#999"}}>{i+1}</td><td style={{padding:"8px 10px",fontSize:12,fontWeight:600}}>{p.desc}</td><td style={{padding:"8px 10px",fontSize:12,textAlign:"center"}}>{p.cant}</td><td style={{padding:"8px 10px",fontSize:12,textAlign:"right"}}>{$(p.precio)}</td><td style={{padding:"8px 10px",fontSize:12,textAlign:"right",fontWeight:700}}>{$(p.precio*p.cant)}</td></tr>)}</tbody></table>
          <div style={{marginTop:16,display:"flex",justifyContent:"flex-end"}}><div style={{width:250}}>
            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13}}><span style={{color:"#666"}}>Subtotal</span><span>{$(md.subtotal||md.partidas.reduce((s,p)=>s+p.precio*p.cant,0))}</span></div>
            {md.conIva!==false&&<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13,borderBottom:"1px solid #ddd"}}><span style={{color:"#666"}}>IVA 16%</span><span>{$((md.subtotal||md.partidas.reduce((s,p)=>s+p.precio*p.cant,0))*.16)}</span></div>}
            <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",fontSize:20,fontWeight:800,color:"#1B5E20"}}><span>TOTAL</span><span>{$(md.cotizado)}</span></div>
          </div></div>
        </div>}
        <div style={{marginTop:30,padding:"16px",background:"#f9f9f9",borderRadius:6,fontSize:11,color:"#888"}}><div style={{fontWeight:700,color:"#666",marginBottom:6}}>Condiciones de Pago</div><div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><div style={{textAlign:"center",flex:1,padding:8,background:"#fff",borderRadius:6,margin:"0 3px"}}><div style={{fontSize:9,color:"#999",fontWeight:700}}>ANTICIPO</div><div style={{fontSize:16,fontWeight:800,color:"#1B5E20"}}>60%</div><div style={{fontSize:10,color:"#666"}}>{$(Math.round((md.cotizado||0)*.6))}</div></div><div style={{textAlign:"center",flex:1,padding:8,background:"#fff",borderRadius:6,margin:"0 3px"}}><div style={{fontSize:9,color:"#999",fontWeight:700}}>SOBRE AVANCE</div><div style={{fontSize:16,fontWeight:800,color:"#1565C0"}}>20%</div><div style={{fontSize:10,color:"#666"}}>{$(Math.round((md.cotizado||0)*.2))}</div></div><div style={{textAlign:"center",flex:1,padding:8,background:"#fff",borderRadius:6,margin:"0 3px"}}><div style={{fontSize:9,color:"#999",fontWeight:700}}>AL ENTREGAR</div><div style={{fontSize:16,fontWeight:800,color:"#2E7D32"}}>20%</div><div style={{fontSize:10,color:"#666"}}>{$(Math.round((md.cotizado||0)*.2))}</div></div></div><div>• Vigencia: 15 días</div><div>• Precios en pesos mexicanos (MXN)</div></div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:40,paddingTop:20}}><div style={{textAlign:"center",width:"40%",borderTop:"1px solid #999",paddingTop:8,fontSize:11,color:"#999"}}>Firma cliente</div><div style={{textAlign:"center",width:"40%",borderTop:"1px solid #999",paddingTop:8,fontSize:11,color:"#999"}}>Ensamble Villarreal</div></div>
        <div style={{textAlign:"center",marginTop:30,fontSize:9,color:"#bbb",fontStyle:"italic"}}>— Donde la madera encuentra su forma —</div>
      </div></div></div>}
  </div>;
  // ═══ DESKTOP: Sidebar + Content ═══
  if(D) return <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",display:"flex",fontSize:13}}>
    <div style={{width:220,minWidth:220,background:"#111",borderRight:"1px solid "+T.border,display:"flex",flexDirection:"column",height:"100vh",position:"sticky",top:0}}>
      <div style={{padding:"16px 14px 10px"}}><BrandFull size="small" color={T.gold}/></div>
      <div style={{padding:"3px 14px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}><span style={{fontSize:10,color:role.color,fontWeight:700}}>{role.icon} {role.nombre}</span><div style={{display:"flex",alignItems:"center",gap:6}}>{saveStatus.state!=="idle"&&<span style={{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:8,background:saveStatus.state==="saving"?"rgba(66,165,245,.15)":saveStatus.state==="saved"?"rgba(76,175,80,.15)":"rgba(231,76,60,.18)",color:saveStatus.state==="saving"?T.blue:saveStatus.state==="saved"?T.green:T.red,whiteSpace:"nowrap",maxWidth:130,overflow:"hidden",textOverflow:"ellipsis"}} title={saveStatus.err||""}>{saveStatus.msg}</span>}{CLOUD&&<span style={{fontSize:9,color:_syncOk?T.green:T.yellow,cursor:"pointer"}} onClick={()=>location.reload()} title={_syncOk?"Nube OK - clic para actualizar":"Verificando..."}>{_syncOk?"☁️":"⏳"}</span>}</div></div>
      <div style={{padding:"0 10px 8px"}}><button onClick={()=>setSearchOpen(true)} style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid "+T.border,background:"rgba(255,255,255,.03)",color:T.muted,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:8,justifyContent:"space-between"}}>
        <span>🔍 Buscar...</span>
        <span style={{fontSize:9,color:T.dim,padding:"1px 4px",border:"1px solid "+T.dim,borderRadius:3}}>Ctrl+K</span>
      </button></div>
      <div style={{flex:1,overflowY:"auto",padding:"0 6px"}}>{NAV_GRPS.map(g=>{const items=allNav.filter(n=>n.grp===g.id);if(!items.length)return null;return <div key={g.id} style={{marginBottom:8}}><div style={{fontSize:9,color:T.dim,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,padding:"8px 12px 2px"}}>{g.label}</div>{items.map(n=> <button key={n.key} onClick={()=>go(n.key)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 12px",background:sec===n.key?"#1a1a1a":"transparent",border:"none",color:sec===n.key?T.gold:"#999",cursor:"pointer",fontSize:13,fontWeight:sec===n.key?700:400,textAlign:"left",borderRadius:8,marginBottom:1}}><span style={{fontSize:14,width:20,textAlign:"center"}}>{n.icon}</span><span>{n.label}</span></button>)}</div>;})}</div>
      <div style={{padding:10,borderTop:"1px solid "+T.border}}><button onClick={()=>setUser(null)} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"10px 12px",background:"transparent",border:"none",color:T.red,cursor:"pointer",fontSize:13,borderRadius:8}}>🚪 Cerrar sesión</button></div>
    </div>
    <div style={{flex:1,overflowY:"auto",minHeight:"100vh"}}>{content}</div>
    {modals}
    {toast&&<div style={{position:"fixed",top:20,right:20,background:"#1a3a1a",color:T.green,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:700,zIndex:2000}}>{toast}</div>}
  </div>;
  // ═══ MOBILE: Header + Content + Bottom Nav ═══
  return <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",fontSize:13}}>
    <div style={{padding:"10px 16px",background:"#111",borderBottom:"1px solid "+T.border,position:"sticky",top:0,zIndex:100,display:"flex",justifyContent:"space-between",alignItems:"center"}}><BrandFull size="small" color={T.gold}/><div style={{display:"flex",alignItems:"center",gap:8}}><button onClick={()=>setSearchOpen(true)} style={{background:"rgba(255,255,255,.06)",border:"1px solid "+T.border,color:T.muted,width:32,height:32,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,cursor:"pointer"}} title="Buscar (Ctrl+K)">🔍</button>{pendientesCount>0&&<span onClick={()=>{DB.reintentarPendientes().then(()=>{setPendientesCount(_getPendienteCount());show("Reintentado");});}} style={{fontSize:10,fontWeight:800,padding:"3px 8px",borderRadius:10,background:"rgba(255,152,0,.18)",color:T.orange,whiteSpace:"nowrap",cursor:"pointer"}} title="Cambios sin sincronizar — click para reintentar">⏳ {pendientesCount} pend.</span>}{saveStatus.state!=="idle"&&<span style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:10,background:saveStatus.state==="saving"?"rgba(66,165,245,.15)":saveStatus.state==="saved"?"rgba(76,175,80,.15)":"rgba(231,76,60,.18)",color:saveStatus.state==="saving"?T.blue:saveStatus.state==="saved"?T.green:T.red,whiteSpace:"nowrap",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis"}} title={saveStatus.err||""}>{saveStatus.msg}</span>}{CLOUD&&<span onClick={()=>location.reload()} style={{fontSize:11,color:_syncOk?T.green:T.yellow,cursor:"pointer"}} title={_syncOk?"Nube OK":"Verificando"}>{_syncOk?"☁️":"⏳"}</span>}{pendA>0&&<div onClick={()=>go("auth")} style={{background:T.yellow,color:"#111",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:800,cursor:"pointer"}}>{pendA}</div>}<div onClick={()=>setUser(null)} style={{width:28,height:28,borderRadius:14,background:role.color+"22",color:role.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,cursor:"pointer"}}>{user.avatar}</div></div></div>
    {content}
    {modals}
    {toast&&<div style={{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"#1a3a1a",color:T.green,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:700,zIndex:2000}}>{toast}</div>}
    {/* FAB Registro Rápido (móvil) */}
    {!moreOpen&&can("money")&&<div style={{position:"fixed",bottom:navVisible?72:16,right:16,zIndex:250,transition:"bottom .25s ease"}}>
      <button onClick={()=>om("addEgr")} style={{width:54,height:54,borderRadius:27,border:"none",background:"linear-gradient(135deg,"+T.gold+","+T.orange+")",color:"#fff",fontSize:24,fontWeight:800,cursor:"pointer",boxShadow:"0 6px 20px rgba(201,149,107,.4)",display:"flex",alignItems:"center",justifyContent:"center"}} title="Registro rápido de egreso">+</button>
    </div>}
    {moreOpen&&<div style={{position:"fixed",bottom:56,left:0,right:0,zIndex:200,display:"flex",justifyContent:"center"}} onClick={()=>setMoreOpen(false)}><div onClick={e=>e.stopPropagation()} style={{background:"#1a1a1a",border:"1px solid "+T.border,borderRadius:14,padding:8,maxWidth:380,width:"92%",boxShadow:"0 -4px 20px rgba(0,0,0,.5)",maxHeight:"60vh",overflowY:"auto"}}>
      <button onClick={()=>{setSearchOpen(true);setMoreOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 14px",background:"rgba(255,255,255,.04)",border:"1px solid "+T.border,color:T.gold,cursor:"pointer",fontSize:13,textAlign:"left",borderRadius:8,marginBottom:8,fontWeight:700}}><span>🔍</span>Buscar...<span style={{marginLeft:"auto",fontSize:9,color:T.dim,padding:"2px 5px",border:"1px solid "+T.dim,borderRadius:3}}>Ctrl+K</span></button>
      {NAV_GRPS.map(g=>{const items=allNav.slice(4).filter(n=>n.grp===g.id);if(!items.length)return null;return <div key={g.id} style={{marginBottom:8}}>
        <div style={{fontSize:9,color:T.dim,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,padding:"6px 10px 2px"}}>{g.label}</div>
        {items.map(i=> <button key={i.key} onClick={()=>{go(i.key);setMoreOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 14px",background:sec===i.key?"#252525":"transparent",border:"none",color:sec===i.key?T.gold:"#bbb",cursor:"pointer",fontSize:13,textAlign:"left",borderRadius:8}}><span>{i.icon}</span>{i.label}</button>)}
      </div>;})}
      <button onClick={()=>{setUser(null);setMoreOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 14px",background:"transparent",border:"none",color:T.red,cursor:"pointer",fontSize:13,borderRadius:8,borderTop:"1px solid "+T.border,marginTop:4}}>🚪 Cerrar sesión</button>
    </div></div>}
    <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:300,background:"#111",borderTop:"1px solid "+T.border,display:"flex",justifyContent:"center",transform:navVisible?"translateY(0)":"translateY(110%)",transition:"transform .25s ease"}}><div style={{display:"flex",maxWidth:900,width:"100%"}}>{mobT.map(t=> <button key={t.key} onClick={()=>{if(t.key==="_more"){setMoreOpen(!moreOpen);return;}go(t.key);setMoreOpen(false);}} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:(t.key==="_more"?moreOpen:sec===t.key)?T.gold:T.dim}}><span style={{fontSize:18}}>{t.icon}</span><span style={{fontSize:8,fontWeight:600}}>{t.label}</span></button>)}</div></div>
  </div>;
}

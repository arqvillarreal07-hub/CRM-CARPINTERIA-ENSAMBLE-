import { useState, useEffect, useRef } from "react";

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
    const headers={'apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY,'Content-Type':'application/json'};
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
      try{
        // Leer TODAS las filas con esta key, ordenadas por updated_at desc para tomar la más reciente
        const r=await fetch(SUPA_URL+'/rest/v1/ev_data?key=eq.'+k+'&select=value,updated_at&order=updated_at.desc.nullslast',{headers:{'apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY}});
        if(r.ok){
          const j=await r.json();
          if(Array.isArray(j)&&j.length>0){
            cloudVal=j[0].value;
            _syncOk=true;
            // Si hay duplicados en Supabase, limpiar (deja solo el más reciente)
            if(j.length>1){
              console.warn('DB.get: '+k+' tiene '+j.length+' filas duplicadas en Supabase. Limpiando...');
              const headers={'apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY,'Content-Type':'application/json'};
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
// === Helpers globales para matching robusto ===
const normName=s=>{if(!s)return"";return s.toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();};
const sameObra=(a,b)=>{const na=(a||"").toString().trim().toLowerCase().replace(/\s+/g," ");const nb=(b||"").toString().trim().toLowerCase().replace(/\s+/g," ");return na===nb;};
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
// Helper: obras válidas como DESTINO de fusión/reasignación (en proceso, autorizada, etc.) — NO cotizaciones, NO canceladas, NO entregadas
const obrasDestinoValidas=(obras,excludeId)=>{
  return obras.filter(o=>{
    if(excludeId&&o.id===excludeId)return false;
    if(!o.fase)return false;
    if(o.fase==="cotizacion"||o.fase==="cancelado"||o.fase==="entregado")return false;
    return true;
  });
};
// Devuelve obras similares (comparten al menos 1 token significativo) excluyendo match exacto
const findSimilarObras=(nombre,obras,excludeId)=>{
  const tgt=obraTokens(nombre);if(tgt.length===0)return [];
  const tgtNorm=normSearch(nombre);
  return obras.filter(o=>{
    if(excludeId&&o.id===excludeId)return false;
    if(normSearch(o.nombre)===tgtNorm)return false;
    const oTok=obraTokens(o.nombre);
    return tgt.some(t=>oTok.includes(t));
  });
};
// Agrupa lista de obras por similitud — devuelve [[obra1,obra2,...], [obra3], ...]
const agruparObrasSimilares=(obras)=>{
  const grupos=[];const usados=new Set();
  obras.forEach(o=>{
    if(usados.has(o.id))return;
    const tok=obraTokens(o.nombre);
    if(tok.length===0){grupos.push([o]);usados.add(o.id);return;}
    const grupo=[o];usados.add(o.id);
    obras.forEach(o2=>{
      if(usados.has(o2.id))return;
      const tok2=obraTokens(o2.nombre);
      if(tok.some(t=>tok2.includes(t))){grupo.push(o2);usados.add(o2.id);}
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
function EgrForm({obras,provs,onSave,onNewProv}){const[f,sf]=useState({fecha:td(),prov:"",desc:"",egr:"",obra:"",cat:"Material"});const exists=provs.some(p=>p.nombre.toLowerCase()===f.prov.toLowerCase());return <div><Fl l="Proveedor"><input list="prov-list" style={sI} value={f.prov} onChange={e=>sf({...f,prov:e.target.value})} placeholder="Seleccionar o escribir nuevo"/><datalist id="prov-list">{provs.map(p=> <option key={p.id} value={p.nombre}/>)}</datalist>{f.prov&&!exists&&<div style={{fontSize:10,color:T.orange,marginTop:3}}>⚡ Nuevo proveedor — se creará automáticamente</div>}</Fl><Fl l="Descripción"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.egr} onChange={e=>sf({...f,egr:e.target.value})}/></Fl><Fl l="Obra"><ObrasSelect value={f.obra} obras={obras} allowGeneral onChange={e=>sf({...f,obra:e.target.value})} placeholder="Seleccionar obra"/></Fl><button style={{...sB,background:T.red,color:"#fff",marginTop:12}} onClick={()=>{const m=Number(f.egr);if(f.desc&&m>0){if(f.prov&&!exists&&onNewProv)onNewProv(f.prov);onSave({...f,egr:m,ing:0});}}}>Registrar Egreso</button></div>;}
const getApiKey=()=>localStorage.getItem('ev_apikey')||"";
const callAI=async(messages,max_tokens=1000,system)=>{const key=getApiKey();if(!key)throw new Error("NO_KEY");const body={model:"claude-sonnet-4-20250514",max_tokens,messages};if(system)body.system=system;const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify(body)});if(!r.ok){const t=await r.text().catch(()=>"");throw new Error("API "+r.status+": "+t.slice(0,200));}return r.json();};
function CajaForm({onSave,users,obras}){const[f,sf]=useState({fecha:td(),concepto:"",monto:"",resp:"Taller",obra:"",ticket:""});const[scanning,setScanning]=useState(false);const scanTicket=async(file)=>{setScanning(true);try{const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej("err");r.readAsDataURL(file);});sf(prev=>({...prev,ticket:"data:"+(file.type||"image/jpeg")+";base64,"+b64}));const data=await callAI([{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:b64}},{type:"text",text:'Este es un ticket/recibo de compra. Extrae: concepto (qué se compró, resumido), monto total. Responde SOLO JSON sin markdown: {"concepto":"x","monto":0}'}]}],500);const text=data.content?.map(i=>i.text||"").join("")||"{}";const info=JSON.parse(text.replace(/```json|```/g,"").trim());if(info.concepto)sf(prev=>({...prev,concepto:info.concepto,monto:String(info.monto||"")}));}catch(e){if(e.message==="NO_KEY")alert("Configura tu API Key en ⚙️ Más → API Key Claude");else console.warn("Scan error:",e);}setScanning(false);};return <div><div style={{marginBottom:12}}><label style={{display:"block",padding:16,border:"2px dashed "+(scanning?T.blue:f.ticket?T.green:T.border),borderRadius:10,textAlign:"center",cursor:scanning?"wait":"pointer",background:scanning?"#0a1a33":f.ticket?"#0a1a0a":"#111"}}><input type="file" accept="image/*,.pdf,application/pdf" style={{display:"none"}} onChange={async e=>{const raw=e.target.files[0];if(!raw)return;try{const f=await compressImage(raw);scanTicket(f);}catch(err){alert(err.message);}}}/>{scanning?<div style={{color:T.blue,fontWeight:700}}>🔄 Leyendo ticket...</div>:f.ticket?<div><img src={f.ticket} style={{maxHeight:120,borderRadius:8,marginBottom:6}} alt=""/><div style={{fontSize:10,color:T.green,fontWeight:700}}>✅ Ticket cargado</div></div>:<div><div style={{fontSize:24}}>🧾</div><div style={{color:T.gold,fontWeight:700,fontSize:12}}>Escanear Ticket</div><div style={{fontSize:10,color:T.muted}}>📷 Cámara · 🖼️ Galería · 📄 PDF</div></div>}</label></div><Fl l="Concepto"><input style={sI} value={f.concepto} onChange={e=>sf({...f,concepto:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.monto} onChange={e=>sf({...f,monto:e.target.value})}/></Fl><Fl l="Responsable"><select style={sI} value={f.resp} onChange={e=>sf({...f,resp:e.target.value})}>{users.map(u=> <option key={u.id} value={u.nombre}>{u.nombre}</option>)}</select></Fl><Fl l="Obra"><ObrasSelect value={f.obra} obras={obras||[]} allowGeneral onChange={e=>sf({...f,obra:e.target.value})} placeholder="Seleccionar obra"/></Fl><button style={{...sB,marginTop:12}} onClick={()=>{if(f.concepto&&Number(f.monto)>0&&f.obra)onSave({...f,monto:Number(f.monto)});else if(!f.obra)alert("Selecciona una obra");}}>Guardar</button></div>;}
function ExtraForm({onSave}){const[f,sf]=useState({desc:"",monto:""});return <div><Fl l="Descripción"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.monto} onChange={e=>sf({...f,monto:e.target.value})}/></Fl><button style={{...sB,background:T.orange}} onClick={()=>{const m=Number(f.monto);if(f.desc&&m>0)onSave({desc:f.desc,monto:m});}}>Enviar</button></div>;}
function ClienteForm({onSave}){const[f,sf]=useState({nombre:"",tel:"",email:"",dir:""});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Teléfono"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl><Fl l="Email"><input style={sI} value={f.email} onChange={e=>sf({...f,email:e.target.value})}/></Fl></div><Fl l="Dirección"><input style={sI} value={f.dir} onChange={e=>sf({...f,dir:e.target.value})}/></Fl><button style={sB} onClick={()=>f.nombre&&onSave(f)}>Guardar</button></div>;}
function DocForm({onSave}){const[f,sf]=useState({nombre:"",tipo:"plano",ext:"PDF"});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><Fl l="Tipo"><select style={sI} value={f.tipo} onChange={e=>sf({...f,tipo:e.target.value})}><option value="plano">Plano</option><option value="render">Render</option><option value="contrato">Contrato</option><option value="avance">Avance</option></select></Fl><button style={sB} onClick={()=>f.nombre&&onSave(f)}>Subir</button></div>;}
function BitacoraForm({onSave}){const[n,sN]=useState("");return <div style={{marginTop:8}}><Fl l="Nota"><textarea style={{...sI,minHeight:60}} value={n} onChange={e=>sN(e.target.value)} placeholder="Escribe una nota..."/></Fl><button style={{...sB,opacity:n.trim()?1:.5}} onClick={()=>{if(n.trim()){onSave(n);sN("");}}}>{n.trim()?"📝 Agregar Nota":"Escribe algo arriba..."}</button></div>;}
function InvForm({onSave}){const[f,sf]=useState({nombre:"",cat:"Madera",unidad:"Hoja",stock:"",minimo:"",precio:""});return <div><Fl l="Material"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}><Fl l="Stock"><input type="number" style={sI} value={f.stock} onChange={e=>sf({...f,stock:e.target.value})}/></Fl><Fl l="Mín"><input type="number" style={sI} value={f.minimo} onChange={e=>sf({...f,minimo:e.target.value})}/></Fl><Fl l="Precio"><input type="number" style={sI} value={f.precio} onChange={e=>sf({...f,precio:e.target.value})}/></Fl></div><button style={sB} onClick={()=>{if(f.nombre)onSave({...f,stock:Number(f.stock)||0,minimo:Number(f.minimo)||0,precio:Number(f.precio)||0});}}>Guardar</button></div>;}
function ProvForm({onSave}){const[f,sf]=useState({nombre:"",contacto:"",tel:"",material:"",credito:"",calif:3});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Contacto"><input style={sI} value={f.contacto} onChange={e=>sf({...f,contacto:e.target.value})}/></Fl><Fl l="Tel"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl></div><Fl l="Material"><input style={sI} value={f.material} onChange={e=>sf({...f,material:e.target.value})}/></Fl><button style={sB} onClick={()=>f.nombre&&onSave({...f,credito:Number(f.credito)||0,total:0})}>Guardar</button></div>;}
function UserForm({onSave,obras}){const[f,sf]=useState({nombre:"",rol:"taller",tel:"",proyectoId:"",pin:""});const av=f.nombre?f.nombre.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2):"??";return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><Fl l="Rol"><select style={sI} value={f.rol} onChange={e=>sf({...f,rol:e.target.value})}>{Object.entries(ROLES).map(([k,r])=> <option key={k} value={k}>{r.icon} {r.nombre}</option>)}</select></Fl>{f.rol==="cliente"&&<Fl l="Proyecto"><select style={sI} value={f.proyectoId} onChange={e=>sf({...f,proyectoId:e.target.value})}><option value="">Seleccionar</option>{obras.map(o=> <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></Fl>}<Fl l="PIN (4 dígitos)"><input type="number" style={{...sI,letterSpacing:8,textAlign:"center",fontSize:20,fontWeight:800}} value={f.pin} onChange={e=>{const v=e.target.value.slice(0,4);sf({...f,pin:v});}} placeholder="••••" maxLength={4}/></Fl><Fl l="Tel"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl><div style={{display:"flex",alignItems:"center",gap:10,margin:"10px 0"}}><div style={{width:44,height:44,borderRadius:22,background:ROLES[f.rol].color+"22",color:ROLES[f.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:15}}>{av}</div><div><div style={{fontWeight:700}}>{f.nombre||"Nombre"}</div><div style={{fontSize:10,color:ROLES[f.rol].color}}>{ROLES[f.rol].icon} {ROLES[f.rol].nombre}</div></div></div><button style={sB} onClick={()=>{if(f.nombre&&f.pin.length===4)onSave({...f,avatar:av,user:f.nombre.toLowerCase().split(" ")[0]});else if(!f.nombre)alert("Pon un nombre");else alert("El PIN debe ser de 4 dígitos");}}> + Agregar</button></div>;}
function CustomItemForm({onAdd,existingCats}){const[d,sD]=useState("");const[p,sP]=useState("");const[cat,sCat]=useState("Muebles");return <div><div style={{fontSize:11,color:T.gold,fontWeight:700,marginBottom:6}}>MUEBLE PERSONALIZADO</div><Fl l="Categoría"><select style={sI} value={cat} onChange={e=>sCat(e.target.value)}>{(existingCats||ALL_CATS).map(c=><option key={c} value={c}>{c}</option>)}</select></Fl><Fl l="Descripción"><input style={sI} value={d} onChange={e=>sD(e.target.value)} placeholder="Ej: Mueble TV 2.4m"/></Fl><Fl l="Precio"><input type="number" style={sI} value={p} onChange={e=>sP(e.target.value)}/></Fl><button style={{...sB,background:"#1a2a1a",color:T.green,border:"1px solid #2a4a2a33"}} onClick={()=>{const pr=Number(p);if(d&&pr>0){onAdd({id:"C-"+Date.now(),cat,desc:d,precio:pr,cant:1});sD("");sP("");}}}> + Agregar al catálogo y cotización</button></div>;}
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
    // Función para parsear fecha "22/5/26" → "2026-05-22"
    const parseDate=(s)=>{if(!s)return td();s=String(s).trim();if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);if(m){const d=m[1].padStart(2,"0");const mo=m[2].padStart(2,"0");let y=m[3];if(y.length===2)y="20"+y;return y+"-"+mo+"-"+d;}return s;};
    // Función para parsear monto "1,381.77" → 1381.77
    const parseMonto=(s)=>{if(!s)return 0;return Number(String(s).replace(/[^0-9.-]/g,""))||0;};
    // Match obra con fuzzy
    const matchObra=(nombre)=>{if(!nombre)return "";const n=normSearch(nombre);const exact=obras.find(o=>normSearch(o.nombre)===n);if(exact)return exact.nombre;const part=obras.find(o=>normSearch(o.nombre).includes(n)||n.includes(normSearch(o.nombre)));return part?part.nombre:nombre;};
    const items=[];
    for(let i=startIdx;i<lineas.length;i++){
      const celdas=lineas[i].split(sep).map(c=>c.trim().replace(/^"|"$/g,""));
      if(celdas.every(c=>!c))continue;
      const desc=colDesc>=0?celdas[colDesc]:celdas.find(c=>c.length>5&&isNaN(Number(c)))||"";
      const fecha=colFecha>=0?parseDate(celdas[colFecha]):td();
      const obraStr=colObra>=0?celdas[colObra]:"";
      const obra=matchObra(obraStr);
      const monto=colMonto>=0?parseMonto(celdas[colMonto]):parseMonto(celdas[celdas.length-1]);
      if(monto>0&&desc){
        items.push({fecha,desc,obra,monto,obraOrig:obraStr,obraMatch:obraStr&&obra===obraStr?"exacto":obraStr&&obras.find(o=>normSearch(o.nombre).includes(normSearch(obraStr))||normSearch(obraStr).includes(normSearch(o.nombre)))?"fuzzy":obraStr?"sin-match":""});
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
  const sameObra3=(a,b)=>{const na=(a||"").toString().trim().toLowerCase().replace(/\s+/g," ");const nb=(b||"").toString().trim().toLowerCase().replace(/\s+/g," ");return na===nb;};
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
  if(grupos.length===0)return <div style={{textAlign:"center",padding:30,color:T.muted}}>✅ No se detectaron obras similares — todo limpio!</div>;
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
  const sameObra=(a,b)=>{const na=(a||"").toString().trim().toLowerCase().replace(/\s+/g," ");const nb=(b||"").toString().trim().toLowerCase().replace(/\s+/g," ");return na===nb;};
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
function AnalisisDesfaseView({movs,caja,obras,setMovs,setCaja,show,cm}){
  const [reasignarFrom,setReasignarFrom]=useState(null);
  const [reasignarTo,setReasignarTo]=useState("");
  const sameObra2=(a,b)=>{const na=(a||"").toString().trim().toLowerCase().replace(/\s+/g," ");const nb=(b||"").toString().trim().toLowerCase().replace(/\s+/g," ");return na===nb;};
  const doReasignar=(origen,destino)=>{
    const newMovs=movs.map(m=>{if(sameObra2(m.obra,origen)){return{...m,obra:destino};}return m;});
    const newCaja=caja.map(c=>{if(sameObra2(c.obra,origen)){return{...c,obra:destino};}return c;});
    const nM=movs.filter(m=>sameObra2(m.obra,origen)).length;
    const nC=caja.filter(c=>sameObra2(c.obra,origen)).length;
    setMovs(newMovs);setCaja(newCaja);
    setReasignarFrom(null);setReasignarTo("");
    if(show)show("✓ "+(nM+nC)+" movs reasignados a "+(destino||"General"));
  };
  // Construir mapa: por cada "obra" string en movs/caja, sumar ingresos y egresos
  const sameObra=(a,b)=>{const na=(a||"").toString().trim().toLowerCase().replace(/\s+/g," ");const nb=(b||"").toString().trim().toLowerCase().replace(/\s+/g," ");return na===nb;};
  const obrasNorm=new Set(obras.map(o=>(o.nombre||"").trim().toLowerCase().replace(/\s+/g," ")));
  const map={};
  movs.forEach(m=>{
    const k=(m.obra||"").trim()||"__GENERAL__";
    if(!map[k])map[k]={nombre:k==="__GENERAL__"?"📂 General (sin obra)":m.obra,ing:0,egr:0,cot:0,cat:{},isFantasma:false};
    if(m.ing>0)map[k].ing+=m.ing;
    if(m.egr>0){map[k].egr+=m.egr;const c=m.cat||"Sin cat";map[k].cat[c]=(map[k].cat[c]||0)+m.egr;}
  });
  caja.filter(c=>c.status!=="rechazado").forEach(c=>{
    const k=(c.obra||"").trim()||"__GENERAL__";
    if(!map[k])map[k]={nombre:k==="__GENERAL__"?"📂 General (sin obra)":c.obra,ing:0,egr:0,cot:0,cat:{},isFantasma:false};
    map[k].egr+=c.monto;
    map[k].cat["Caja Chica"]=(map[k].cat["Caja Chica"]||0)+c.monto;
  });
  // Marcar cotización y fantasma
  Object.values(map).forEach(o=>{
    if(o.nombre==="📂 General (sin obra)"){o.isFantasma=false;o.tipo="general";return;}
    const obraReal=obras.find(x=>sameObra(x.nombre,o.nombre));
    if(obraReal){o.cot=obraReal.cotizado||0;o.fase=obraReal.fase;o.isFantasma=false;o.tipo="obra";}
    else{o.isFantasma=true;o.tipo="fantasma";}
  });
  // Calcular diferencia
  const lista=Object.values(map).map(o=>{
    const dif=o.ing-o.egr;
    const cobPct=o.cot?Math.round((o.ing/o.cot)*100):0;
    const gasPct=o.cot?Math.round((o.egr/o.cot)*100):0;
    const desfase=gasPct-cobPct; // si es positivo, gastaste más % de lo cobrado
    let status="ok";
    if(dif<0)status="perdida"; // gastaste más que cobraste
    else if(o.cot&&desfase>20)status="descapitalizado"; // vas atrasado en cobranza
    return {...o,dif,cobPct,gasPct,desfase,status};
  }).sort((a,b)=>a.dif-b.dif); // peor primero
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
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
          <thead>
            <tr style={{background:"#1a1a1a",borderBottom:"2px solid #444"}}>
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
              return [<tr key={idx} style={{background:idx%2===0?"rgba(255,255,255,.01)":"transparent",borderBottom:isOpen?"none":"1px solid #2a2a2a"}}>
                <td style={{padding:"6px",textAlign:"center",borderRight:"1px solid #2a2a2a"}} title={o.status}>
                  <span style={{display:"inline-block",width:10,height:10,borderRadius:5,background:sem}}/>
                </td>
                <td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a"}}>
                  <div style={{fontWeight:600,fontSize:12}}>{o.nombre} {o.isFantasma&&<span style={{fontSize:9,color:T.purple,marginLeft:4}}>👻 fantasma</span>}</div>
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
                <td colSpan={6} style={{padding:"10px 14px"}}>
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
              <td colSpan={2} style={{padding:"8px 10px",fontSize:11,fontWeight:700,color:T.gold}}>TOTAL ({lista.length})</td>
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
      <div>👻 <b style={{color:T.purple}}>Fantasma</b>: tiene movimientos pero la obra ya no existe en tu sistema. Fusiónala con una obra activa.</div>
      <div>🟢 <b style={{color:T.green}}>OK</b>: cobranza al día y rentable.</div>
    </div>
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

export default function App(){
  const[w,setW]=useState(typeof window!=="undefined"?window.innerWidth:400);
  useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  const D=w>=860;const G=D?"1fr 1fr":"1fr";
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
  useEffect(()=>{(async()=>{
    if(CLOUD)setSyncStatus("Conectando a la nube...");
    const d={obras:await DB.get('obras',[]),movs:await DB.get('movs',[]),caja:await DB.get('caja',[]),auts:await DB.get('auts',[]),rec:await DB.get('rec',[]),inv:await DB.get('inv',INV_INIT),clis:await DB.get('clis',[]),cont:await DB.get('cont',[]),provs:await DB.get('provs',PROVS_INIT),users:await DB.get('users',USERS_SEED),catalogo:await DB.get('catalogo',CATALOGO_INIT),nominas:await DB.get('nominas',[]),documentos:await DB.get('documentos',[]),preciosUnit:await DB.get('preciosUnit',PRECIOS_INIT),papelera:await DB.get('papelera',[])};
    if(CLOUD)setSyncStatus(_syncOk?"☁️ Nube sincronizada":"⚠️ Usando datos locales");
    // Reintenta pendientes al cargar
    if(CLOUD){DB.reintentarPendientes().then(ok=>{if(ok>0)console.log("✓ "+ok+" pendientes sincronizados al cargar");});}
    // Datos ya viven en Supabase — no se tocan al actualizar el código
    if(!d.nominas||d.nominas.length===0)d.nominas=[{id:"N01",nombre:"Nómina Carpintería",monto:15000,frecuencia:"semanal",tipo:"Nómina"},{id:"N02",nombre:"Renta Carpintería",monto:11000,frecuencia:"mensual",tipo:"Renta"},{id:"N05",nombre:"IMSS",monto:16563,frecuencia:"mensual",tipo:"IMSS"},{id:"N06",nombre:"Luz Carpintería",monto:2500,frecuencia:"mensual",tipo:"Servicios"},{id:"N07",nombre:"Caja Chica Carpintería",monto:5000,frecuencia:"semanal",tipo:"Caja chica"},{id:"N08",nombre:"Francisco — Carpintero",monto:4000,frecuencia:"semanal",tipo:"Nómina"},{id:"N09",nombre:"Erik — Carpintero",monto:4000,frecuencia:"semanal",tipo:"Nómina"},{id:"N10",nombre:"Héctor — Carpintero",monto:3500,frecuencia:"semanal",tipo:"Nómina"},{id:"N11",nombre:"Barnizador",monto:3500,frecuencia:"semanal",tipo:"Nómina"}];

    // Fix duplicate obra IDs
    const seenIds=new Set();d.obras=d.obras.map(o=>{if(seenIds.has(o.id)){return{...o,id:"OB"+Date.now()+Math.random().toString(36).slice(2,6)};}seenIds.add(o.id);return o;});
    setObrasR(d.obras);setMovsR(d.movs);setCajaR(d.caja);setAutsR(d.auts);setRecR(d.rec);setInvR(d.inv);setClisR(d.clis);setContR(d.cont);setProvsR(d.provs);setUsersR(d.users);setCatalogoR(d.catalogo);if(d.nominas)setNominasR(d.nominas);if(d.documentos)setDocumentosR(d.documentos);if(d.preciosUnit)setPreciosUnitR(d.preciosUnit);
    // Auto-purge papelera >30 días
    const now=Date.now();const pap=(d.papelera||[]).filter(p=>now-(p.ts||0)<30*24*60*60*1000);
    setPapeleraR(pap);
    if(pap.length<(d.papelera||[]).length)DB.set('papelera',pap);
    // Save fixed obras back if duplicates were found
    if(seenIds.size<d.obras.length)DB.set('obras',d.obras);
    setLoading(false);})();},[]);
  // Auto-sync cada 30s — compara por HASH (no por longitud) para detectar modificaciones
  const _lastWrite=useRef({});
  const _lastHash=useRef({});
  useEffect(()=>{if(!CLOUD)return;const iv=setInterval(async()=>{try{
    // Reintentar pendientes ANTES de leer (los pendientes son la verdad local)
    await DB.reintentarPendientes();
    const keys=[['obras',setObrasR],['movs',setMovsR],['caja',setCajaR],['rec',setRecR],['users',setUsersR],['nominas',setNominasR],['inv',setInvR],['clis',setClisR],['provs',setProvsR],['catalogo',setCatalogoR],['auts',setAutsR],['documentos',setDocumentosR]];const now=Date.now();for(const[k,setter]of keys){
    // Cooldown extendido a 60s tras escritura local — protege modificaciones
    if(_lastWrite.current[k]&&now-_lastWrite.current[k]<60000)continue;
    const r=await fetch(SUPA_URL+'/rest/v1/ev_data?key=eq.'+k+'&select=value',{headers:{'apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY}});
    if(!r.ok)continue;
    const j=await r.json();if(!Array.isArray(j)||j.length===0)continue;
    const cloud=j[0].value;
    const local=JSON.parse(localStorage.getItem('ev_'+k)||'[]');
    const cH=_hash(cloud),lH=_hash(local);
    if(cH===lH)continue; // Idénticos: nada que hacer
    // Distintos: si fue cambio LOCAL reciente (lastWrite<60s pero >=60s ya skipped arriba), no llegamos aquí
    // Si llegamos aquí, NO hubo cambio local reciente → la nube tiene una versión más fresca (otro usuario)
    // O nuestra escritura falló: comparar tamaño JSON para preferir el más rico
    const cStr=JSON.stringify(cloud),lStr=JSON.stringify(local);
    if(cStr.length>=lStr.length){
      // Nube tiene igual o más datos: actualizar local
      const lite=k==='caja'&&Array.isArray(cloud)?cloud.map(c=>c.ticket&&c.ticket.length>500?{...c,ticket:'[nube]'}:c):cloud;
      setter(cloud);
      try{localStorage.setItem('ev_'+k,JSON.stringify(lite));}catch{}
      _lastHash.current[k]=cH;
    }else{
      // Local tiene más datos pero la nube no los tiene: empujar local a nube
      DB.push(k,local);
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
  const sendChat=async()=>{if(!chatIn.trim()||chatLoading)return;const msg=chatIn.trim();setChatIn("");const newMsgs=[...chatMsgs,{role:"user",content:msg}];setChatMsgs(newMsgs);setChatLoading(true);try{const key=getApiKey();if(!key)throw new Error("NO_KEY");const ctx="Eres el asistente IA de Ensamble Villarreal, carpintería arquitectónica en Aguascalientes. Datos: "+obras.length+" obras, "+clis.length+" clientes, balance: "+$(tIng-tEgr)+". Responde en español, breve y útil.";const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:ctx,messages:newMsgs.map(m=>({role:m.role,content:m.content}))})});const data=await r.json();const reply=data.content?.map(i=>i.text||"").join("")||"Error";setChatMsgs(prev=>[...prev,{role:"assistant",content:reply}]);}catch(e){setChatMsgs(prev=>[...prev,{role:"assistant",content:e.message==="NO_KEY"?"⚠️ Configura tu API Key en Más → 🔑 API Key IA":"Error: "+e.message}]);}setChatLoading(false);setTimeout(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},100);};
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
  const tEgrO=obras.reduce((s,o)=>s+o.egreso,0);
  const pendA=auts.filter(a=>a.status==="pendiente").length;
  const lowS=inv.filter(i=>i.stock<=i.minimo);
  const oAct=obras.filter(o=>o.fase&&o.fase!=="cotizacion"&&o.fase!=="entregado"&&o.fase!=="cancelado");
  const cotsPend=obras.filter(o=>o.fase==="cotizacion").length;
  const subCot=cotP.reduce((s,p)=>s+p.precio*p.cant,0);
  const totCot=conIva?subCot*1.16:subCot;
  const addCotP=item=>{const ex=cotP.find(p=>p.id===item.id);if(ex)setCotP(cotP.map(p=>p.id===item.id?{...p,cant:p.cant+1}:p));else setCotP([...cotP,{...item,cant:1}]);};
  const genRec=m=>{const id="R-"+String(recibos.length+1).padStart(3,"0");setRecibos(prev=>[...prev,{id,fecha:m.fecha,cliente:m.prov,concepto:m.desc,monto:m.ing,obra:m.obra}]);return id;};
  const saveDoc=(tipo,titulo,cliente,obra,monto,data)=>{const id="D-"+Date.now();setDocumentos(prev=>{const updated=prev.map(d=>(d.tipo===tipo&&d.obra===obra&&d.vigente)?{...d,vigente:false}:d);return[...updated,{id,tipo,titulo,cliente:cliente||"",obra:obra||"",monto:monto||0,fecha:td(),hora:new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),user:user?.nombre||"",data,vigente:true,version:(prev.filter(d=>d.tipo===tipo&&d.obra===obra).length)+1}];});return id;};
  const openPdfCot=(o)=>{om("pdfCot",o);try{saveDoc("cotizacion","Cotización "+o.nombre,o.cliente,o.nombre,o.cotizado,{obraId:o.id});}catch{}};
  const openPdfCli=(data)=>{om("pdfCli",data);try{saveDoc("estado_cuenta","Estado de Cuenta "+data.ob.nombre,data.cli.nombre,data.ob.nombre,data.ob.cotizado,{obraId:data.ob.id,cliId:data.cli.id});}catch{}};
  const ensureCli=(nombre)=>{if(!nombre)return;const n=nombre.trim();const nn=normName(n);if(!nn)return;setClis(prev=>{if(prev.some(c=>normName(c.nombre)===nn))return prev;return[...prev,{id:"C"+Date.now(),nombre:n,tel:"",email:"",dir:""}];});};
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
  allNav.push({key:"papelera",icon:"🗑",label:"Papelera"+(papelera.length>0?" ("+papelera.length+")":""),grp:"sys"});
  const NAV_GRPS=[{id:"neg",label:"NEGOCIO"},{id:"fin",label:"FINANZAS"},{id:"tal",label:"TALLER"},{id:"sys",label:"SISTEMA"}];
  const mobT=allNav.slice(0,4);if(allNav.length>4)mobT.push({key:"_more",icon:"☰",label:"Más"});

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
      <div style={{textAlign:"center",marginBottom:28,display:"flex",flexDirection:"column",alignItems:"center"}}><BrandFull size="big" sub="Carpintería Arquitectónica"/><div style={{fontSize:9,color:T.dim,marginTop:8,fontStyle:"italic"}}>— Donde la madera encuentra su forma —</div>{CLOUD&&<div style={{marginTop:6,fontSize:10,color:_syncOk?T.green:T.yellow}}>{_syncOk?"☁️ Nube sincronizada":"⏳ Verificando nube..."}</div>}</div>
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
        {/* DISECCIÓN MENSUAL */}
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:11,color:T.gold,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>📊 Disección · 12 meses</div>
            <div style={{display:"flex",gap:10,fontSize:10}}>
              <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,background:T.green,borderRadius:2,display:"inline-block"}}/>Ingresos</span>
              <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,background:"#e91e63",borderRadius:2,display:"inline-block"}}/>Egresos</span>
            </div>
          </div>
          <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}><div style={{minWidth:520}}><MonthlyBars data={monthly}/></div></div>
        </Card>
        {/* DONUT + OBRAS */}
        <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr":"1fr",gap:8}}>
          <Card>
            <div style={{fontSize:11,color:T.gold,fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>🥧 A dónde va el dinero</div>
            {catData.length>0?<div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{flex:"0 0 auto"}}><Donut data={catData} size={D?160:130} thickness={20} centerLabel={"100%"} centerSub="gasto"/></div>
              <div style={{flex:"1 1 140px",display:"grid",gap:4}}>
                {catData.map((c,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,padding:"3px 0"}}>
                  <span style={{display:"flex",alignItems:"center",gap:6,color:T.text}}><span style={{width:9,height:9,background:c.color,borderRadius:2}}/>{c.label}</span>
                  <span style={{color:T.muted,fontWeight:700}}>{Math.round((c.value/totCat)*100)}%</span>
                </div>)}
              </div>
            </div>:<div style={{textAlign:"center",padding:30,color:T.muted}}>Sin datos de gasto aún</div>}
          </Card>
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:11,color:T.gold,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>🏗️ Obras activas · {obrasRich.length}</div>
              <button onClick={()=>go("obras")} style={{background:"transparent",border:"none",color:T.muted,fontSize:10,cursor:"pointer"}}>Ver todas →</button>
            </div>
            {obrasRich.length>0?<div style={{display:"grid",gap:8}}>{obrasRich.slice(0,5).map(o=><div key={o.id} onClick={()=>go("obras",o)} style={{padding:10,background:"rgba(255,255,255,.02)",border:"1px solid "+T.border,borderLeft:"3px solid "+o.sem,borderRadius:8,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontWeight:700,fontSize:12,flex:1}}>{o.nombre}</div>
                <span style={{fontSize:9,background:FCC[o.fase]+"33",color:FCC[o.fase],padding:"2px 6px",borderRadius:6,fontWeight:700}}>{FASES[o.fase]}</span>
              </div>
              <div style={{fontSize:10,color:T.muted,marginBottom:6}}>{o.cliente} · {$(o.cotizado)}</div>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <div style={{flex:1}}>
                  <Bar v={o.avance||0} mx={100} c={FCC[o.fase]} h={5}/>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:T.muted,marginTop:3}}>
                    <span>Avance {o.avance||0}%</span>
                    <span style={{color:o.margen>=0?T.green:T.red,fontWeight:700}}>Margen {$(o.margen)} ({Math.round(o.margenPct)}%)</span>
                  </div>
                </div>
              </div>
            </div>)}</div>:<div style={{textAlign:"center",padding:20,color:T.muted}}>Sin proyectos activos</div>}
          </Card>
        </div>
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
          ensureCli(cotNom);
          if(editObraId){
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
                          const r=await fetch(SUPA_URL+'/rest/v1/ev_data',{method:'POST',headers:{'apikey':SUPA_KEY,'Authorization':'Bearer '+SUPA_KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},body:JSON.stringify({key:"obras",value:newObras})});
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
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {(()=>{const gruposCount=agruparObrasSimilares([...obras,...[...new Set([...movs.map(m=>m.obra),...caja.map(c=>c.obra)])].filter(n=>n&&!obras.some(o=>normSearch(o.nombre)===normSearch(n))).map((n,i)=>({id:"F-"+i,nombre:n,cotizado:0,isFantasma:true}))]).length;return gruposCount>0?<button onClick={()=>om("obrasSimilares")} style={{padding:"8px 14px",borderRadius:8,border:"1px solid "+T.purple+"55",background:"rgba(171,71,188,.08)",color:T.purple,fontWeight:700,fontSize:12,cursor:"pointer"}}>🔗 Detectar duplicadas <span style={{background:T.yellow+"33",color:T.yellow,padding:"1px 6px",borderRadius:6,fontSize:10,marginLeft:4}}>{gruposCount}</span></button>:null;})()}
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

      <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr 1fr":"1fr 1fr",gap:6,marginBottom:8}}><button style={{...sB,background:"rgba(38,166,154,.08)",color:T.teal,border:"1px solid "+T.teal+"33",marginTop:0}} onClick={()=>{if(sub.cliente){const cn=sub.cliente.toLowerCase();let cli=clis.find(c=>c.nombre.toLowerCase()===cn);if(!cli){cli={id:"C"+Date.now(),nombre:sub.cliente,tel:"",email:"",dir:""};ensureCli(sub.cliente);cli=clis.find(c2=>c2.nombre.toLowerCase()===sub.cliente.toLowerCase())||cli;}go("clis",cli);}else{show("Esta obra no tiene cliente asignado");}}}>👤 Estado de Cuenta</button><button style={{...sB,background:"#1a1510",color:T.gold,border:"1px solid "+T.gold+"44",marginTop:0}} onClick={()=>{setCotP(sub.partidas||[]);setCotNom(sub.cliente||"");setCotEmp(sub.nombre||"");setConIva(sub.conIva!==false);setEditObraId(sub.id);setSub(null);go("cot");}}>📝 Editar Cotización</button><button style={{...sB,background:"#0a1a0a",color:T.green,border:"1px solid "+T.green+"44",marginTop:0}} onClick={()=>openPdfCot(sub)}>📄 Generar PDF</button><button style={{...sB,background:"#1a1a2a",color:T.blue,border:"1px solid "+T.blue+"33",marginTop:0}} onClick={()=>{const dup={...sub,id:"OB"+Date.now(),nombre:sub.nombre+" (copia)",fase:"cotizacion",status:"cotizado",avance:0,partidas:(sub.partidas||[]).map(p=>({...p,id:"C-"+Date.now()+"-"+Math.random().toString(36).slice(2,6)})),extras:[],pagos:[],docs:[],bitacora:[]};setObras(prev=>[...prev,dup]);show("Duplicada como cotización ✓");go("cotizaciones");}}>📋 Duplicar</button><button style={{...sB,background:"#1a0a0a",color:T.red,border:"1px solid "+T.red+"33",marginTop:0}} onClick={()=>om("delOb",sub)}>🗑 Eliminar</button></div>

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
      <div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{nominas.map(n=> <Card key={n.id}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontWeight:700,fontSize:14}}>{n.nombre}</div><div style={{fontSize:10,color:T.muted}}>{n.tipo} · {n.frecuencia}</div></div><div style={{textAlign:"right"}}><div style={{fontWeight:800,color:T.orange,fontSize:16}}>{$(n.monto)}</div><div style={{display:"flex",gap:4,marginTop:4,justifyContent:"flex-end"}}><button onClick={()=>{const m={fecha:td(),prov:n.nombre,desc:n.nombre,ing:0,egr:n.monto,obra:"CARPINTERIA",cat:n.tipo,user:user.nombre,id:movs.length+1};setMovs(prev=>[...prev,m]);show(n.nombre+" registrado");}} style={{background:"#1a1a0a",color:T.yellow,border:"1px solid "+T.yellow+"33",borderRadius:6,padding:"4px 10px",fontSize:10,cursor:"pointer",fontWeight:700}}>💸 Pagar</button><button onClick={()=>{setNominas(prev=>prev.filter(x=>x.id!==n.id));show("Eliminado");}} style={{background:"#2a0a0a",color:T.red,border:"1px solid "+T.red+"33",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>🗑</button></div></div></div></Card>)}</div>
      {nominas.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin pagos fijos</div></Card>}
      <div style={{marginTop:16,fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Historial de Nóminas</div>
      <div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{movs.filter(m=>["Nómina","Renta","IMSS","Destajo"].includes(m.cat)).slice().reverse().map(m=> <Card key={m.id}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:600}}>{m.desc}</div><div style={{fontSize:10,color:T.dim}}>{fd(m.fecha)} · {m.cat}</div></div><span style={{fontWeight:700,color:T.red}}>{$(m.egr)}</span></div></Card>)}</div>
    </div>}

    {sec==="taller"&&<div style={{display:"flex",gap:4,marginBottom:12}}>{[{k:"inv",l:"Inventario"},{k:"provs",l:"Proveedores"},{k:"catalogo",l:"Catálogo"},{k:"precios",l:"💰 Precios Unitarios"}].map(t=><button key={t.k} onClick={()=>setSubTab(t.k)} style={{padding:"8px 14px",borderRadius:10,border:subTab===t.k?"2px solid "+T.gold:"1px solid "+T.border,background:subTab===t.k?"#1a1510":"transparent",color:subTab===t.k?T.gold:T.muted,cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{t.l}</button>)}</div>}
    {sec==="taller"&&subTab==="inv"&&<div><button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300}} onClick={()=>om("addInv")}>+ Material</button><div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{inv.sort((a,b)=>(a.stock<=a.minimo?0:1)-(b.stock<=b.minimo?0:1)).map(it=> <Card key={it.id} style={{borderLeft:it.stock<=it.minimo?"3px solid "+T.red:"none"}}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:700}}>{it.nombre}</div><div style={{fontSize:10,color:T.dim}}>{it.cat} · {$(it.precio)}/{it.unidad}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:it.stock<=it.minimo?T.red:T.green}}>{it.stock}</div><div style={{fontSize:9,color:T.muted}}>min:{it.minimo}</div></div></div><Bar v={it.stock} mx={it.minimo*3} c={it.stock<=it.minimo?T.red:T.green}/></Card>)}</div></div>}

    {sec==="taller"&&subTab==="provs"&&<div><button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300}} onClick={()=>om("addProv")}>+ Proveedor</button><div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{provs.map(p=>{const pMvs=movs.filter(m=>m.egr>0&&m.prov===p.nombre);const pTot=pMvs.reduce((s,m)=>s+m.egr,0);const pObs=[...new Set(pMvs.map(m=>m.obra).filter(Boolean))];return <Card key={p.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><div><div style={{fontWeight:700}}>{p.nombre}</div><div style={{fontSize:11,color:T.muted}}>{p.contacto}{p.tel&&" · "+p.tel}</div></div><div style={{textAlign:"right"}}><div style={{fontWeight:800,color:T.red}}>{$(pTot)}</div><div style={{fontSize:9,color:T.muted}}>{pMvs.length} compras</div></div></div><div style={{fontSize:11,color:T.muted}}>{p.material} · {[...Array(p.calif||0)].map((_,i)=><span key={i}>⭐</span>)}</div>{pObs.length>0&&<div style={{marginTop:6,paddingTop:6,borderTop:"1px solid "+T.border,display:"flex",flexWrap:"wrap",gap:4}}>{pObs.map(o=><span key={o} style={{fontSize:9,background:T.gold+"15",color:T.gold,padding:"2px 6px",borderRadius:6}}>{o}</span>)}</div>}{p.credito>0&&<div style={{fontSize:10,color:T.blue,marginTop:4}}>Crédito: {p.credito} días</div>}</Card>})}</div></div>}


    {sec==="finanzas"&&<div>
        <div style={{display:"grid",gridTemplateColumns:D?"1fr 1fr 1fr 1fr":"1fr 1fr",gap:8,marginBottom:10}}>
          <Card style={{background:"rgba(76,175,80,.06)",borderColor:"rgba(76,175,80,.15)"}}><Stat label="Ingresos" value={$(finIng)} color={T.green}/></Card>
          <Card style={{background:"rgba(231,76,60,.06)",borderColor:"rgba(231,76,60,.15)"}}><Stat label="Egresos" value={$(finEgr)} color={T.red}/></Card>
          <Card onClick={()=>finIng-finEgr<0?om("analisisDesfase"):null} style={{cursor:finIng-finEgr<0?"pointer":"default",background:finIng-finEgr<0?"rgba(231,76,60,.08)":undefined,borderColor:finIng-finEgr<0?T.red+"33":undefined}}>
            <Stat label={finIng-finEgr<0?"🔍 Balance (click para analizar)":"Balance"} value={$(finIng-finEgr)} color={finIng-finEgr>=0?T.green:T.red}/>
          </Card>
          <Card><Stat label="Movimientos" value={finFilt.length}/></Card>
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
          <button style={{padding:"10px 14px",borderRadius:8,border:"1px solid "+T.green+"44",background:"rgba(76,175,80,.08)",color:T.green,fontWeight:700,fontSize:12,cursor:"pointer"}} onClick={()=>om("importarMasivo",{tipo:"ing"})} title="Importar lista de ingresos desde Excel/foto/CSV">📊 Importar Ingresos</button>
          <button style={{padding:"10px 14px",borderRadius:8,border:"1px solid "+T.red+"44",background:"rgba(231,76,60,.08)",color:T.red,fontWeight:700,fontSize:12,cursor:"pointer"}} onClick={()=>om("importarMasivo",{tipo:"egr"})} title="Importar lista de gastos desde Excel/foto/CSV">📊 Importar Gastos</button>
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
          <button onClick={()=>{const y=new Date().getFullYear();setFDesde(y+"-01-01");setFHasta(y+"-12-31");}} style={{background:"rgba(201,149,107,.08)",border:"1px solid "+T.gold+"33",color:T.gold,borderRadius:8,padding:"6px 12px",fontSize:10,cursor:"pointer",fontWeight:700}}>Este año</button>
          <button onClick={()=>{const y=new Date().getFullYear()-1;setFDesde(y+"-01-01");setFHasta(y+"-12-31");}} style={{background:"rgba(255,255,255,.04)",border:"1px solid "+T.border,color:T.muted,borderRadius:8,padding:"6px 12px",fontSize:10,cursor:"pointer"}}>Año pasado</button>
          <button onClick={()=>{const d=new Date();const m=String(d.getMonth()+1).padStart(2,"0");const y=d.getFullYear();const last=new Date(y,d.getMonth()+1,0).getDate();setFDesde(y+"-"+m+"-01");setFHasta(y+"-"+m+"-"+String(last).padStart(2,"0"));}} style={{background:"rgba(255,255,255,.04)",border:"1px solid "+T.border,color:T.muted,borderRadius:8,padding:"6px 12px",fontSize:10,cursor:"pointer"}}>Este mes</button>
        </div>
        {user.rol==="admin"&&selMovs.length>0&&<div style={{background:"rgba(231,76,60,.12)",border:"1px solid "+T.red+"66",borderRadius:8,padding:"10px 14px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <span style={{color:T.red,fontWeight:700,fontSize:12}}>🗑 {selMovs.length} seleccionado(s) de {finFilt.length} filtrados</span>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setSelMovs([])} style={{background:"rgba(255,255,255,.06)",border:"none",color:T.muted,borderRadius:6,padding:"6px 12px",fontSize:11,cursor:"pointer",fontWeight:700}}>Limpiar selección</button>
            <button onClick={()=>{setDelConfText("");om("delMasivo");}} style={{background:T.red,border:"none",color:"#fff",borderRadius:6,padding:"6px 14px",fontSize:11,cursor:"pointer",fontWeight:800}}>🗑 Eliminar {selMovs.length}</button>
          </div>
        </div>}
        <div style={{borderRadius:8,border:"1px solid #333",overflow:"hidden",fontSize:12}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:D?700:500}}>
              <thead>
                <tr style={{background:"#1a1a1a",borderBottom:"2px solid #444"}}>
                  {user.rol==="admin"&&<th style={{padding:"10px 8px",textAlign:"center",fontSize:10,fontWeight:700,color:T.gold,borderRight:"1px solid #333",width:36}}><input type="checkbox" checked={finFilt.length>0&&selMovs.length===finFilt.length} onChange={e=>setSelMovs(e.target.checked?finFilt.map(m=>m.id):[])} style={{cursor:"pointer",width:16,height:16,accentColor:T.gold}} title="Seleccionar todos los visibles"/></th>}
                  <th style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap",borderRight:"1px solid #333",width:50}}>#</th>
                  <SortTh col="fecha" label="Fecha" sort={sortFin} setSort={setSortFin} style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap",borderRight:"1px solid #333",width:90}}/>
                  <SortTh col="desc" label="Concepto" sort={sortFin} setSort={setSortFin} style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.8,borderRight:"1px solid #333"}}/>
                  {D&&<SortTh col="prov" label="Proveedor / Cliente" sort={sortFin} setSort={setSortFin} style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap",borderRight:"1px solid #333",width:130}}/>}
                  {D&&<SortTh col="obra" label="Obra" sort={sortFin} setSort={setSortFin} style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap",borderRight:"1px solid #333",width:130}}/>}
                  <SortTh col="status" label="Status" sort={sortFin} setSort={setSortFin} style={{padding:"10px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap",borderRight:"1px solid #333",width:80}}/>
                  <SortTh col="monto" label="Ingreso" sort={sortFin} setSort={setSortFin} style={{padding:"10px 12px",textAlign:"right",fontSize:10,fontWeight:700,color:T.green,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap",borderRight:"1px solid #333",width:110}}/>
                  <SortTh col="monto" label="Egreso" sort={sortFin} setSort={setSortFin} style={{padding:"10px 12px",textAlign:"right",fontSize:10,fontWeight:700,color:T.red,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap",borderRight:"1px solid #333",width:110}}/>
                  {D&&<SortTh col="user" label="Usuario" sort={sortFin} setSort={setSortFin} style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap",borderRight:"1px solid #333",width:100}}/>}
                  {user.rol==="admin"&&<th style={{padding:"10px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,width:70}}></th>}
                </tr>
              </thead>
              <tbody>
                {finFilt.length===0&&<tr><td colSpan={D?(user.rol==="admin"?10:9):(user.rol==="admin"?6:5)} style={{padding:30,textAlign:"center",color:T.dim}}>Sin resultados</td></tr>}
                {[...finFilt].sort((a,b)=>cmpVal(a[sortFin.col],b[sortFin.col],sortFin.dir)).map((m,idx)=>{const isP=m.status==="pendiente"&&m.t==="caja";const isHl=highlightedIds.has(m.id);return <tr key={m.id}
                  onClick={()=>{if(m.ticket)om("verTicket",m);if(m.rec)om("vRec",recibos.find(r=>r.id===m.rec));}}
                  style={{background:isHl?"rgba(76,175,80,.18)":isP?"rgba(241,196,15,.05)":idx%2===0?"rgba(255,255,255,.01)":"transparent",borderBottom:"1px solid #2a2a2a",cursor:m.ticket||m.rec?"pointer":"default",transition:"background .8s",boxShadow:isHl?"inset 4px 0 0 "+T.green:"none"}}
                  onMouseEnter={e=>{if(!isHl)e.currentTarget.style.background="rgba(201,149,107,.06)";}}
                  onMouseLeave={e=>{if(!isHl)e.currentTarget.style.background=isP?"rgba(241,196,15,.05)":idx%2===0?"rgba(255,255,255,.01)":"transparent";}}>
                  {user.rol==="admin"&&<td style={{padding:"6px 8px",borderRight:"1px solid #2a2a2a",textAlign:"center"}} onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selMovs.includes(m.id)} onChange={e=>{if(e.target.checked)setSelMovs([...selMovs,m.id]);else setSelMovs(selMovs.filter(x=>x!==m.id));}} style={{cursor:"pointer",width:16,height:16,accentColor:T.gold}}/></td>}
                  <td style={{padding:"8px 12px",borderRight:"1px solid #2a2a2a",color:T.dim,fontSize:10,whiteSpace:"nowrap"}}>{idx+1}</td>
                  <td style={{padding:"8px 12px",borderRight:"1px solid #2a2a2a",color:T.muted,whiteSpace:"nowrap",fontSize:11}}>{fd(m.fecha)}</td>
                  <td style={{padding:"8px 12px",borderRight:"1px solid #2a2a2a"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:9,fontWeight:800,color:m.t==="ing"?T.green:T.red,background:m.t==="ing"?"rgba(76,175,80,.12)":"rgba(231,76,60,.12)",padding:"2px 6px",borderRadius:4,whiteSpace:"nowrap"}}>{m.t==="ing"?"ING":m.t==="caja"?"CAJA":"EGR"}</span>
                      <div><div style={{fontWeight:600}}>{m.desc}</div>{(m.cat&&m.cat!=="Caja Chica")&&<div style={{fontSize:9,color:T.dim}}>{m.cat}</div>}</div>
                      {m.ticket&&<span style={{fontSize:10,color:T.blue}}>📷</span>}
                    </div>
                  </td>
                  {D&&<td style={{padding:"8px 12px",borderRight:"1px solid #2a2a2a",color:T.muted,fontSize:11,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.prov||"-"}</td>}
                  {D&&<td style={{padding:"8px 12px",borderRight:"1px solid #2a2a2a",fontSize:11,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><span style={{color:m.obra?T.gold:T.dim}}>{m.obra||"-"}</span></td>}
                  <td style={{padding:"8px 12px",borderRight:"1px solid #2a2a2a",textAlign:"center"}}>
                    {isP&&user.rol==="admin"?<div style={{display:"flex",gap:2,justifyContent:"center"}}>
                      <button onClick={e=>{e.stopPropagation();setCaja(caja.map(x=>x.id===m.cajaId?{...x,status:"aprobado"}:x));show("✓");}} style={{background:"#0a2e0a",color:T.green,border:"none",borderRadius:4,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>✓</button>
                      <button onClick={e=>{e.stopPropagation();setCaja(caja.map(x=>x.id===m.cajaId?{...x,status:"rechazado"}:x));show("✗");}} style={{background:"#2a0a0a",color:T.red,border:"none",borderRadius:4,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>✗</button>
                    </div>:<Badge s={m.status}/>}
                  </td>
                  <td style={{padding:"8px 12px",borderRight:"1px solid #2a2a2a",textAlign:"right",fontWeight:700,color:m.t==="ing"?T.green:T.dim,whiteSpace:"nowrap"}}>{m.t==="ing"?$(m.monto):""}</td>
                  <td style={{padding:"8px 12px",borderRight:"1px solid #2a2a2a",textAlign:"right",fontWeight:700,color:m.t!=="ing"?T.red:T.dim,whiteSpace:"nowrap"}}>{m.t!=="ing"?$(m.monto):""}</td>
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
                    {D&&<td style={{padding:"6px 10px",borderRight:"1px solid #2a2a2a",fontSize:11,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><span style={{color:c.obra&&c.obra!=="General"?T.gold:T.dim}}>{c.obra||"—"}</span></td>}
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
    {sec==="clis"&&!sub&&(()=>{const seen=new Set();const clisUniq=clis.filter(c=>{const k=normName(c.nombre);if(!k||seen.has(k))return false;seen.add(k);return true;});return <div><button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300}} onClick={()=>om("addCli")}>+ Cliente</button>{clis.length!==clisUniq.length&&<button style={{...sB,marginBottom:8,marginTop:0,maxWidth:300,background:"#2a2000",color:T.yellow,border:"1px solid "+T.yellow+"33"}} onClick={()=>{const merged=[];const map={};clis.forEach(c=>{const k=normName(c.nombre);if(!k)return;if(!map[k]){map[k]={...c};merged.push(map[k]);}else{if(c.tel&&!map[k].tel)map[k].tel=c.tel;if(c.email&&!map[k].email)map[k].email=c.email;if(c.dir&&!map[k].dir)map[k].dir=c.dir;}});setClis(merged);show("Clientes duplicados fusionados ✓");}}>🔄 Fusionar {clis.length-clisUniq.length} duplicado(s)</button>}<div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{clisUniq.map(c=>{const cn=normName(c.nombre);const cOb=obras.filter(o=>normName(o.cliente||"")===cn);const cPag=movs.filter(m=>m.ing>0&&cOb.some(o=>sameObra(o.nombre,m.obra))).reduce((s,m)=>s+m.ing,0);const cTot=cOb.reduce((s,o)=>s+(o.cotizado||0),0);return <Card key={c.id} onClick={()=>setSub(c)} style={{cursor:"pointer"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4,alignItems:"flex-start"}}><div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>{c.nombre}</div>{cOb.length>0&&<span style={{fontSize:10,color:T.gold,fontWeight:700}}>{cOb.length} obra(s)</span>}</div>{user.rol==="admin"&&<button onClick={e=>{e.stopPropagation();if(cOb.length>0){if(!confirm("⚠️ "+c.nombre+" tiene "+cOb.length+" obra(s) vinculadas.\n\nSi lo borras, las obras quedarán sin cliente (pero NO se borran).\n\n¿Continuar?"))return;}else{if(!confirm("¿Eliminar a "+c.nombre+"?"))return;}setClis(prev=>prev.filter(x=>x.id!==c.id));show("🗑 Cliente eliminado");}} style={{background:"rgba(231,76,60,.1)",border:"1px solid "+T.red+"33",color:T.red,borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer",marginLeft:6}}>🗑</button>}</div><div style={{fontSize:11,color:T.muted}}>{c.tel&&c.tel}{c.email&&" · "+c.email}</div>{c.dir&&<div style={{fontSize:11,color:T.muted}}>📍 {c.dir}</div>}{cOb.length>0&&<div style={{marginTop:6,paddingTop:6,borderTop:"1px solid "+T.border}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}><div><div style={{fontSize:9,color:T.muted}}>COTIZADO</div><div style={{fontWeight:700,color:T.gold,fontSize:13}}>{$(cTot)}</div></div><div><div style={{fontSize:9,color:T.muted}}>PAGADO</div><div style={{fontWeight:700,color:T.green,fontSize:13}}>{$(cPag)}</div></div><div><div style={{fontSize:9,color:T.muted}}>RESTA</div><div style={{fontWeight:700,color:cTot-cPag>0?T.yellow:T.green,fontSize:13}}>{$(cTot-cPag)}</div></div></div>{cOb.map(o=><div key={o.id} style={{fontSize:10,color:T.muted,marginTop:3}}>{o.nombre} · <span style={{color:FCC[o.fase]||T.muted}}>{FASES[o.fase]||o.fase}</span></div>)}</div>}</Card>})}</div>{clisUniq.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin clientes</div></Card>}</div>})()}

    {sec==="clis"&&sub&&<div style={{maxWidth:800}}>
      <button onClick={()=>{setSub(null);setCliObraTab(null);}} style={{background:"none",border:"none",color:T.gold,cursor:"pointer",fontSize:13,padding:0,marginBottom:12}}>← Clientes</button>
      {(()=>{const c=sub;const cn=normName(c.nombre);const cOb=obras.filter(o=>normName(o.cliente||"")===cn);const cPag=movs.filter(m=>m.ing>0&&cOb.some(o=>sameObra(o.nombre,m.obra))).reduce((s,m)=>s+m.ing,0);const cTot=cOb.reduce((s,o)=>s+(o.cotizado||0),0);
      const selOb=cliObraTab?cOb.find(o=>o.id===cliObraTab):null;
      return <div>
        <Card><div style={{fontSize:22,fontWeight:800,marginBottom:4}}>{c.nombre}</div><div style={{fontSize:12,color:T.muted}}>{c.tel&&"📱 "+c.tel}{c.email&&" · "+c.email}</div>{c.dir&&<div style={{fontSize:12,color:T.muted}}>📍 {c.dir}</div>}</Card>
        <div style={{display:"flex",gap:4,marginBottom:10,overflowX:"auto",paddingBottom:2}}>
          <button onClick={()=>setCliObraTab(null)} style={{padding:"8px 16px",borderRadius:20,border:!cliObraTab?"2px solid "+T.gold:"1px solid "+T.border,background:!cliObraTab?T.gold+"18":"transparent",color:!cliObraTab?T.gold:T.muted,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>📊 Resumen Total</button>
          {cOb.map(o=><button key={o.id} onClick={()=>setCliObraTab(o.id)} style={{padding:"8px 16px",borderRadius:20,border:cliObraTab===o.id?"2px solid "+FCC[o.fase]:"1px solid "+T.border,background:cliObraTab===o.id?FCC[o.fase]+"18":"transparent",color:cliObraTab===o.id?FCC[o.fase]:T.muted,fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>🏗️ {o.nombre}</button>)}
        </div>

        {!cliObraTab&&<div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
            <Card style={{background:"rgba(201,149,107,.06)",borderColor:"rgba(201,149,107,.15)"}}><Stat label="Cotizado Total" value={$(cTot)} color={T.gold}/></Card>
            <Card style={{background:"rgba(76,175,80,.06)",borderColor:"rgba(76,175,80,.15)"}}><Stat label="Pagado Total" value={$(cPag)} color={T.green}/></Card>
            <Card style={{background:cTot-cPag>0?"rgba(255,215,84,.06)":"rgba(76,175,80,.06)",borderColor:cTot-cPag>0?"rgba(255,215,84,.15)":"rgba(76,175,80,.15)"}}><Stat label="Resta Total" value={$(cTot-cPag)} color={cTot-cPag>0?T.yellow:T.green}/></Card>
          </div>
          <Card><div style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}><span style={{color:T.muted}}>Pagado total: {$(cPag)}</span><span style={{color:T.gold,fontWeight:700}}>de {$(cTot)}</span></div><Bar v={cPag} mx={cTot} c={T.green} h={8}/><div style={{textAlign:"right",fontSize:10,color:T.muted,marginTop:3}}>{pc(cPag,cTot)}% cobrado</div></div></Card>
          <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,margin:"10px 0 8px"}}>Obras ({cOb.length})</div>
          <div style={{display:"grid",gridTemplateColumns:G,gap:8}}>{cOb.map(ob=>{const obPag=movs.filter(m=>m.ing>0&&sameObra(m.obra,ob.nombre)).reduce((s,m)=>s+m.ing,0);return <Card key={ob.id} onClick={()=>setCliObraTab(ob.id)} style={{cursor:"pointer"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><div><div style={{fontWeight:700,fontSize:14}}>{ob.nombre}</div><span style={{fontSize:10,background:FCC[ob.fase]+"33",color:FCC[ob.fase],padding:"2px 8px",borderRadius:8,fontWeight:700}}>{FASES[ob.fase]}</span></div><div style={{textAlign:"right"}}><div style={{fontWeight:800,color:T.gold}}>{$(ob.cotizado)}</div></div></div>
            <Bar v={obPag} mx={ob.cotizado} c={T.green} h={4}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginTop:8}}>
              <div><div style={{fontSize:8,color:T.muted}}>COTIZADO</div><div style={{fontWeight:700,color:T.gold,fontSize:12}}>{$(ob.cotizado)}</div></div>
              <div><div style={{fontSize:8,color:T.muted}}>PAGADO</div><div style={{fontWeight:700,color:T.green,fontSize:12}}>{$(obPag)}</div></div>
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
    {modal==="addOb"&&<ModalW title="Nueva Obra" onClose={cm}><ObraForm clientes={clis} onNewCli={nombre=>ensureCli(nombre)} onSave={o=>{setObras(prev=>[...prev,{...o,id:"OB"+String(prev.length+1).padStart(2,"0"),egreso:0,extras:[],pagos:[],docs:[],bitacora:[],creadoPor:user.nombre,creadoFecha:td()}]);cm();show("Obra ✓");}}/></ModalW>}
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
      <button style={{...sB,background:T.green}} onClick={()=>{const newMovs=md.map((m,i)=>({...m,id:movs.length+i+1,status:"aprobado",user:user.nombre}));setMovs(prev=>[...prev,...newMovs]);cm();show("✅ "+md.length+" movimientos importados");}}>✅ Confirmar Importación</button>
      <button style={{...sB,background:"transparent",color:T.muted,border:"1px solid "+T.border}} onClick={cm}>Cancelar</button>
    </ModalW>}
    {modal==="addIng"&&<ModalW title="Registrar Ingreso" onClose={cm}><IngForm obras={obras} movs={movs} clis={clis} onSave={m=>{const rid=genRec(m);const newId=movs.length+1;setMovs(prev=>[...prev,{...m,id:newId,user:user.nombre}]);highlightNew("m"+newId);try{saveDoc("recibo","Recibo "+rid,m.prov,m.obra,m.ing,{id:rid,fecha:m.fecha,cliente:m.prov,concepto:m.desc,monto:m.ing,obra:m.obra});}catch{}cm();om("vRec",{id:rid,fecha:m.fecha,cliente:m.prov,concepto:m.desc,monto:m.ing,obra:m.obra});}}/></ModalW>}
    {modal==="addEgr"&&<ModalW title="Egreso" onClose={cm}><EgrForm obras={obras} provs={provs} onNewProv={nombre=>{setProvs(prev=>[...prev,{id:"P"+String(prev.length+1).padStart(2,"0"),nombre,contacto:"",tel:"",material:"",credito:0,total:0,calif:3}]);}} onSave={m=>{const newId=movs.length+1;setMovs(prev=>[...prev,{...m,id:newId,user:user.nombre}]);highlightNew("m"+newId);cm();show("✓ Egreso registrado");}}/></ModalW>}
    {modal==="addCj"&&<ModalW title="Gasto Caja Chica" onClose={cm}><CajaForm users={users} obras={obras} onSave={c=>{setCaja(prev=>[...prev,{...c,id:prev.length+1,status:user.rol==="admin"?"aprobado":"pendiente"}]);cm();show(user.rol==="admin"?"Gasto registrado":"Enviado para aprobación");}}/></ModalW>}
    {modal==="editCj"&&md&&<ModalW title="Editar Gasto" onClose={cm}><div><Fl l="Concepto"><input style={sI} defaultValue={md.concepto} id="editCjConc"/></Fl><Fl l="Monto"><input type="number" style={sI} defaultValue={md.monto} id="editCjMonto"/></Fl><Fl l="Obra"><select style={sI} defaultValue={md.obra} id="editCjObra"><option value="">Seleccionar obra</option>{obras.map(o=><option key={o.id} value={o.nombre}>{o.nombre}</option>)}<option value="General">General</option></select></Fl><Fl l="Responsable"><input style={sI} defaultValue={md.resp} id="editCjResp"/></Fl><button style={{...sB,marginTop:8}} onClick={()=>{const nc=document.getElementById("editCjConc").value;const nm=Number(document.getElementById("editCjMonto").value);const no=document.getElementById("editCjObra").value;const nr=document.getElementById("editCjResp").value;setCaja(caja.map(x=>x.id===md.id?{...x,concepto:nc||x.concepto,monto:nm||x.monto,obra:no||x.obra,resp:nr||x.resp}:x));cm();show("Gasto actualizado ✓");}}>💾 Guardar Cambios</button>{md.status==="pendiente"&&user.rol==="admin"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}><button style={{...sB,background:"#0a2e0a",color:T.green,marginTop:0}} onClick={()=>{const nc=document.getElementById("editCjConc").value;const nm=Number(document.getElementById("editCjMonto").value);const no=document.getElementById("editCjObra").value;setCaja(caja.map(x=>x.id===md.id?{...x,concepto:nc||x.concepto,monto:nm||x.monto,obra:no||x.obra,status:"aprobado"}:x));cm();show("Aprobado ✓");}}>✓ Aprobar</button><button style={{...sB,background:"#2a0a0a",color:T.red,marginTop:0}} onClick={()=>{setCaja(caja.map(x=>x.id===md.id?{...x,status:"rechazado"}:x));cm();show("Rechazado");}}>✕ Rechazar</button></div>}</div></ModalW>}
    {modal==="addDoc"&&sub&&<ModalW title="Documento" onClose={cm}><DocForm onSave={d=>{const up={...sub,docs:[...(sub.docs||[]),{...d,id:(sub.docs?.length||0)+1,fecha:td(),size:"—"}]};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);cm();show("✓");}}/></ModalW>}
    {modal==="addCli"&&<ModalW title="Cliente" onClose={cm}><ClienteForm onSave={c=>{const nn=normName(c.nombre);if(!nn){show("Pon un nombre válido");return;}if(clis.some(x=>normName(x.nombre)===nn)){show("Este cliente ya existe");return;}setClis(prev=>[...prev,{...c,nombre:c.nombre.trim(),id:"C"+Date.now()}]);cm();show("✓");}}/></ModalW>}
    {modal==="addInv"&&<ModalW title="Material" onClose={cm}><InvForm onSave={i=>{setInv(prev=>[...prev,{...i,id:"I"+String(prev.length+1)}]);cm();show("✓");}}/></ModalW>}
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
    {modal==="addProv"&&<ModalW title="Proveedor" onClose={cm}><ProvForm onSave={p=>{setProvs(prev=>[...prev,{...p,id:"P"+String(prev.length+1).padStart(2,"0")}]);cm();show("✓");}}/></ModalW>}
    {modal==="importarMasivo"&&<ModalW title={"📊 Importar masivo · "+(md?.tipo==="ing"?"Ingresos":"Egresos")} onClose={cm}>
      <ImportadorMasivoForm tipo={md?.tipo||"egr"} obras={obras} onImport={items=>{
        const tipo=md?.tipo||"egr";
        const nuevos=items.map((it,i)=>({
          fecha:it.fecha||td(),
          desc:it.desc,
          prov:it.prov||"",
          obra:it.obra||"",
          cat:tipo==="ing"?"":"Material",
          ing:tipo==="ing"?Number(it.monto):0,
          egr:tipo==="ing"?0:Number(it.monto),
          user:user.nombre,
          importadoEl:td()
        }));
        const baseId=movs.length;
        setMovs(prev=>[...prev,...nuevos.map((m,i)=>({...m,id:baseId+i+1}))]);
        // Highlight todos los nuevos
        nuevos.forEach((_,i)=>highlightNew("m"+(baseId+i+1)));
        cm();
        show("✓ "+items.length+" "+(tipo==="ing"?"ingresos":"egresos")+" importados");
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
      <AnalisisDesfaseView movs={movs} caja={caja} obras={obras} setMovs={setMovs} setCaja={setCaja} show={show} cm={cm}/>
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

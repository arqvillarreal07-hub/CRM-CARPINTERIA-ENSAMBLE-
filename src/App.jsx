import { useState } from "react";

/* ═══════════════════════════════════════════════════════════
   ENSAMBLE VILLARREAL — SISTEMA DE GESTIÓN INTEGRAL v5
   Carpintería Arquitectónica
   5 Roles: Admin · Caja Chica · Taller · Supervisión · Portal Cliente
   Gestión de usuarios · Cotizador IA · Datos persistentes
   ═══════════════════════════════════════════════════════════ */

const T={bg:"#0b0b0b",card:"#141414",border:"#1e1e1e",gold:"#c9956b",green:"#4CAF50",red:"#ef5350",blue:"#42A5F5",orange:"#FF9800",purple:"#AB47BC",teal:"#26A69A",yellow:"#FFD54F",text:"#e8e0d8",muted:"#777",dim:"#444"};

const Logo=({size=32,color="#c9956b"})=> <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="94" height="94" rx="2" stroke={color} strokeWidth="3.5"/><line x1="8" y1="92" x2="50" y2="8" stroke={color} strokeWidth="3"/><line x1="8" y1="50" x2="50" y2="50" stroke={color} strokeWidth="3"/><path d="M50 8 L50 50 L92 50" stroke={color} strokeWidth="3" fill="none"/><path d="M50 8 A42 42 0 0 1 92 50" stroke={color} strokeWidth="3" fill="none"/><line x1="29" y1="50" x2="29" y2="92" stroke={color} strokeWidth="3"/></svg>;

const BrandFull=({color=T.gold,sub="",size="normal"})=> <div style={{display:"flex",alignItems:"center",gap:size==="small"?8:10}}><Logo size={size==="small"?26:size==="big"?44:32} color={color}/><div><div style={{fontSize:size==="small"?12:size==="big"?20:15,fontWeight:800,color,letterSpacing:0,lineHeight:1.15}}><span style={{fontWeight:800}}>ENSAMBLE</span>{size!=="small"&&<br/>}{size==="small"?" ":""}<span style={{fontWeight:400,opacity:.75}}>VILLARREAL</span></div>{sub&&<div style={{fontSize:size==="big"?10:8,color:T.dim,textTransform:"uppercase",letterSpacing:size==="big"?2.5:1,marginTop:1}}>{sub}</div>}</div></div>;

const ROLES={
  admin:{nombre:"Administrador",icon:"👑",color:T.gold,permisos:["dash","cot","obras","money","inv","caja","cont","clis","provs","cal","anal","auth","recibos","usuarios","docs","extras"]},
  cajachica:{nombre:"Caja Chica",icon:"🧾",color:T.green,permisos:["caja","recibos","inv"]},
  taller:{nombre:"Taller",icon:"🔨",color:T.orange,permisos:["obras_ver","caja","inv","docs"]},
  supervisor:{nombre:"Supervisión",icon:"👁",color:T.purple,permisos:["dash","cot","obras","money","caja","provs","anal","auth","docs","recibos"]},
  cliente:{nombre:"Portal Cliente",icon:"🏠",color:T.teal,permisos:["portal"]},
};

// ─── SOLO ADMIN POR DEFAULT ──────────────────────────────────
const USERS_SEED=[{id:1,nombre:"Miguel Villarreal",user:"miguel",rol:"admin",avatar:"MV",tel:"4491814651"}];

// ─── TODO VACÍO EXCEPTO PROVEEDORES E INVENTARIO ─────────────
const OBRAS_INIT=[];
const CLIS_INIT=[];
const CONT_INIT=[];
const MOVS_INIT=[];
const CAJA_INIT=[];
const AUTS_INIT=[];

const PROVS_INIT=[
  {id:"P01",nombre:"Carp. La Sierra",contacto:"Sr. Rivera",tel:"449-100-0001",material:"Mano de obra",credito:0,total:106332,calif:5},
  {id:"P02",nombre:"Maderería Los Bosques",contacto:"Ing. López",tel:"449-100-0002",material:"Madera, triplay",credito:30,total:85876,calif:4},
  {id:"P03",nombre:"Tlapantli",contacto:"Lic. García",tel:"449-100-0003",material:"Tableros MDF",credito:30,total:82817,calif:4},
  {id:"P04",nombre:"Maderrajes",contacto:"Sra. Pérez",tel:"449-100-0004",material:"Herrajes",credito:15,total:45960,calif:5},
  {id:"P05",nombre:"Kimura",contacto:"Kimura S.",tel:"449-100-0007",material:"Herrajes especiales",credito:15,total:12679,calif:4},
  {id:"P06",nombre:"Ferretería Varias",contacto:"",tel:"",material:"Ferretería gral",credito:0,total:59935,calif:3},
];

const INV_INIT=[
  {id:"I01",nombre:"Triplay 18mm",cat:"Madera",unidad:"Hoja",stock:24,minimo:10,precio:890,prov:"Los Bosques"},
  {id:"I02",nombre:"MDF 15mm blanco",cat:"Tableros",unidad:"Hoja",stock:18,minimo:8,precio:720,prov:"Tlapantli"},
  {id:"I03",nombre:"MDF 15mm maple",cat:"Tableros",unidad:"Hoja",stock:6,minimo:8,precio:780,prov:"Tlapantli"},
  {id:"I04",nombre:"Bisagra soft-close",cat:"Herrajes",unidad:"Par",stock:45,minimo:20,precio:185,prov:"Maderrajes"},
  {id:"I05",nombre:"Corredera 45cm",cat:"Herrajes",unidad:"Par",stock:30,minimo:15,precio:220,prov:"Maderrajes"},
  {id:"I06",nombre:"Jaladera 128mm",cat:"Herrajes",unidad:"Pza",stock:52,minimo:20,precio:95,prov:"Kimura"},
  {id:"I07",nombre:"Tornillo 2in",cat:"Ferretería",unidad:"Caja",stock:8,minimo:5,precio:120,prov:"Ferretería"},
  {id:"I08",nombre:"Pegamento 19L",cat:"Adhesivos",unidad:"Cubeta",stock:3,minimo:2,precio:650,prov:"Ferretería"},
  {id:"I09",nombre:"Lija 220",cat:"Abrasivos",unidad:"Pza",stock:40,minimo:30,precio:18,prov:"Ferretería"},
  {id:"I10",nombre:"Barniz mate 4L",cat:"Acabados",unidad:"Galón",stock:5,minimo:3,precio:480,prov:"Ferretería"},
  {id:"I11",nombre:"Melamina blanca",cat:"Tableros",unidad:"Hoja",stock:12,minimo:6,precio:620,prov:"Tlapantli"},
  {id:"I12",nombre:"Riel push-open",cat:"Herrajes",unidad:"Par",stock:8,minimo:10,precio:350,prov:"Kimura"},
];

const CATALOGO=[{id:"M-01",cat:"Muebles",desc:"Centro entretenimiento",precio:29800},{id:"M-02",cat:"Muebles",desc:"Mueble auxiliar sala",precio:21180},{id:"M-03",cat:"Muebles",desc:"Mesa de centro",precio:12500},{id:"M-05",cat:"Muebles",desc:"Isla de cocina",precio:30900},{id:"M-06",cat:"Muebles",desc:"Mueble bar",precio:11400},{id:"M-07",cat:"Muebles",desc:"Escritorio ejecutivo",precio:28800},{id:"M-10",cat:"Muebles",desc:"Cabecera king",precio:11860},{id:"M-12",cat:"Muebles",desc:"Vestidor walk-in",precio:24680},{id:"LB01",cat:"Libreros",desc:"Librero piso a techo",precio:84200},{id:"LB02",cat:"Libreros",desc:"Librero empotrado",precio:18500},{id:"CL01",cat:"Closets",desc:"Closet principal 3m",precio:64200},{id:"CL02",cat:"Closets",desc:"Closet secundario",precio:41100},{id:"CL03",cat:"Closets",desc:"Closet infantil",precio:45200},{id:"PT01",cat:"Puertas",desc:"Puerta principal maciza",precio:92000},{id:"PT02",cat:"Puertas",desc:"Puerta interior",precio:8800},{id:"CO01",cat:"Cocinas",desc:"Cocina integral 3m",precio:85000},{id:"CO02",cat:"Cocinas",desc:"Cocina integral 4m+",precio:115000},{id:"ES01",cat:"Escaleras",desc:"Escalera c/herrería",precio:115500},{id:"MB03",cat:"Baño",desc:"Mueble baño doble",precio:7800}];

const $=n=>n==null?"$0":"$"+Math.round(n).toLocaleString("es-MX");
const fd=d=>{if(!d)return "—";try{return new Date(d+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"2-digit"});}catch{return d;}};
const pc=(a,b)=>b?Math.round((a/b)*100):0;
const td=()=>new Date().toISOString().slice(0,10);
const cats=[...new Set(CATALOGO.map(c=>c.cat))];
const DOC_IC={plano:"📐",render:"🖼️",contrato:"📄",avance:"📸",otro:"📎"};
const FASES={cotizacion:"Cotización",diseno:"Diseño",produccion:"Producción",instalacion:"Instalación",entregado:"Entregado"};
const FC={cotizacion:"#FFB74D",diseno:"#64B5F6",produccion:"#FF9800",instalacion:"#66BB6A",entregado:"#78909C"};

const Badge=({s})=>{const m={cotizado:["Cotizado","#332200","#FFB74D"],en_proceso:["En Proceso","#0a2e0a","#66BB6A"],completado:["Completado","#0a1a33","#64B5F6"],pendiente:["Pendiente","#332b00","#FFD54F"],aprobado:["Aprobado","#0a2e0a","#66BB6A"],aprobada:["Aprobada","#0a2e0a","#66BB6A"],rechazada:["Rechazada","#330a0a","#ef5350"],vigente:["Vigente","#0a2e0a","#66BB6A"]};const[l,bg,c]=m[s]||[s,"#222","#999"];return <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,background:bg,color:c}}>{l}</span>;};
const Bar=({v,mx,c=T.gold,h=5})=> <div style={{background:"#222",borderRadius:3,height:h,width:"100%"}}><div style={{width:`${Math.min(100,pc(v,mx||1))}%`,height:"100%",background:c,borderRadius:3,transition:"width .3s"}}/></div>;
const Card=({children,style,onClick})=> <div onClick={onClick} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:14,marginBottom:8,cursor:onClick?"pointer":"default",...style}}>{children}</div>;
const Stat=({label,value,color,small})=> <div><div style={{fontSize:small?8:9,color:T.muted,textTransform:"uppercase",letterSpacing:.5}}>{label}</div><div style={{fontSize:small?14:18,fontWeight:800,color:color||T.text}}>{value}</div></div>;
const sI={width:"100%",padding:"11px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"#1a1a1a",color:"#ddd",fontSize:14,outline:"none",boxSizing:"border-box"};
const sB={padding:"13px",borderRadius:10,border:"none",background:T.gold,color:"#111",fontWeight:800,fontSize:14,cursor:"pointer",width:"100%",marginTop:8};

function ModalW({title,onClose,children}){return <div style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center",background:"rgba(0,0,0,.7)"}} onClick={onClose}><div onClick={e=>e.stopPropagation()} style={{background:"#151515",borderRadius:"14px 14px 0 0",width:"100%",maxWidth:600,maxHeight:"88vh",overflow:"auto",paddingBottom:24}}><div style={{width:36,height:4,background:"#444",borderRadius:2,margin:"8px auto 0"}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px 6px"}}><span style={{fontWeight:700,color:T.gold,fontSize:15}}>{title}</span><button onClick={onClose} style={{background:"#222",border:"none",color:"#888",cursor:"pointer",fontSize:14,borderRadius:20,width:28,height:28}}>✕</button></div><div style={{padding:"4px 16px 0"}}>{children}</div></div></div>;}
function Fl({l,children}){return <div style={{marginBottom:10}}><label style={{display:"block",fontSize:10,color:T.muted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{l}</label>{children}</div>;}

function ReciboView({data}){return <div style={{background:"#fefcf9",color:"#222",borderRadius:8,padding:20,fontFamily:"Georgia,serif"}}><div style={{display:"flex",justifyContent:"space-between",borderBottom:"3px solid #1B5E20",paddingBottom:12,marginBottom:14}}><div><div style={{fontSize:16,fontWeight:800,color:"#1B5E20"}}>ENSAMBLE VILLARREAL</div><div style={{fontSize:9,color:"#888"}}>CARPINTERÍA ARQUITECTÓNICA</div><div style={{fontSize:9,color:"#bbb"}}>Circuito Los Sauces 136, Ags · 449 181 4651</div></div><div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:700,color:"#1B5E20"}}>RECIBO</div><div style={{fontSize:16,fontWeight:800,color:"#1B5E20"}}>{data.recibo||data.id}</div></div></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,marginBottom:14}}><div><span style={{color:"#999",fontSize:10}}>FECHA</span><div>{fd(data.fecha)}</div></div><div><span style={{color:"#999",fontSize:10}}>CLIENTE</span><div style={{fontWeight:600}}>{data.cliente||data.prov||"—"}</div></div></div><div style={{background:"#E8F5E9",borderRadius:8,padding:"14px 18px",textAlign:"center"}}><div style={{fontSize:10,color:"#2E7D32",textTransform:"uppercase"}}>Monto Recibido</div><div style={{fontSize:28,fontWeight:800,color:"#1B5E20"}}>{$(data.monto||data.ing||0)}</div></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginTop:20,paddingTop:14,borderTop:"1px dashed #ccc"}}><div style={{textAlign:"center",borderTop:"1px solid #999",paddingTop:6,fontSize:10,color:"#999"}}>Firma cliente</div><div style={{textAlign:"center",borderTop:"1px solid #999",paddingTop:6,fontSize:10,color:"#999"}}>Firma Villarreal</div></div></div>;}

function ObraForm({onSave,clientes}){const[f,sf]=useState({nombre:"",cliente:"",cotizado:"",inicio:td(),entrega:"",fase:"cotizacion"});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><Fl l="Cliente"><select style={sI} value={f.cliente} onChange={e=>sf({...f,cliente:e.target.value})}><option value="">Seleccionar</option>{clientes.map(c=> <option key={c.id} value={c.nombre}>{c.nombre}</option>)}</select></Fl><Fl l="Monto"><input type="number" style={sI} value={f.cotizado} onChange={e=>sf({...f,cotizado:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Inicio"><input type="date" style={sI} value={f.inicio} onChange={e=>sf({...f,inicio:e.target.value})}/></Fl><Fl l="Entrega"><input type="date" style={sI} value={f.entrega} onChange={e=>sf({...f,entrega:e.target.value})}/></Fl></div><button style={sB} onClick={()=>f.nombre&&onSave({...f,cotizado:Number(f.cotizado)||0,status:"cotizado",avance:0})}>Guardar</button></div>;}
function IngForm({obras,onSave}){const[f,sf]=useState({fecha:td(),prov:"",desc:"",ing:"",obra:"",pago:"TRANSFERENCIA"});return <div><Fl l="Fecha"><input type="date" style={sI} value={f.fecha} onChange={e=>sf({...f,fecha:e.target.value})}/></Fl><Fl l="Recibido de"><input style={sI} value={f.prov} onChange={e=>sf({...f,prov:e.target.value})}/></Fl><Fl l="Concepto"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.ing} onChange={e=>sf({...f,ing:e.target.value})}/></Fl><Fl l="Obra"><select style={sI} value={f.obra} onChange={e=>sf({...f,obra:e.target.value})}><option value="">Seleccionar</option>{obras.map(o=> <option key={o.id} value={o.nombre}>{o.nombre}</option>)}</select></Fl><button style={{...sB,background:T.green}} onClick={()=>{const m=Number(f.ing);if(f.desc&&m>0)onSave({...f,ing:m,egr:0,cat:"Pago Cliente"});}}>💰 Registrar + Recibo</button></div>;}
function EgrForm({obras,provs,onSave}){const[f,sf]=useState({fecha:td(),prov:"",desc:"",egr:"",obra:"",cat:"Material",pago:"EFECTIVO"});return <div><Fl l="Proveedor"><select style={sI} value={f.prov} onChange={e=>sf({...f,prov:e.target.value})}><option value="">Seleccionar</option>{provs.map(p=> <option key={p.id} value={p.nombre}>{p.nombre}</option>)}</select></Fl><Fl l="Descripción"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.egr} onChange={e=>sf({...f,egr:e.target.value})}/></Fl><Fl l="Categoría"><select style={sI} value={f.cat} onChange={e=>sf({...f,cat:e.target.value})}>{["Material","Herrajes","Mano Obra","Subcontrato","Nómina","Servicios","Otro"].map(c=> <option key={c}>{c}</option>)}</select></Fl><Fl l="Obra"><select style={sI} value={f.obra} onChange={e=>sf({...f,obra:e.target.value})}><option value="">General</option>{obras.map(o=> <option key={o.id} value={o.nombre}>{o.nombre}</option>)}</select></Fl><button style={{...sB,background:T.red,color:"#fff"}} onClick={()=>{const m=Number(f.egr);if(f.desc&&m>0)onSave({...f,egr:m,ing:0});}}>Registrar Egreso</button></div>;}
function CajaForm({onSave,users}){const[f,sf]=useState({fecha:td(),concepto:"",monto:"",resp:"Taller",obra:"General"});return <div><Fl l="Concepto"><input style={sI} value={f.concepto} onChange={e=>sf({...f,concepto:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.monto} onChange={e=>sf({...f,monto:e.target.value})}/></Fl><Fl l="Responsable"><select style={sI} value={f.resp} onChange={e=>sf({...f,resp:e.target.value})}>{users.map(u=> <option key={u.id} value={u.nombre}>{u.nombre}</option>)}</select></Fl><Fl l="Obra"><input style={sI} value={f.obra} onChange={e=>sf({...f,obra:e.target.value})}/></Fl><button style={sB} onClick={()=>{if(f.concepto&&Number(f.monto)>0)onSave({...f,monto:Number(f.monto)});}}>Guardar</button></div>;}
function DocForm({onSave}){const[f,sf]=useState({nombre:"",tipo:"plano",ext:"PDF"});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><Fl l="Tipo"><select style={sI} value={f.tipo} onChange={e=>sf({...f,tipo:e.target.value})}><option value="plano">📐 Plano</option><option value="render">🖼️ Render</option><option value="contrato">📄 Contrato</option><option value="avance">📸 Avance</option></select></Fl><button style={sB} onClick={()=>f.nombre&&onSave(f)}>📤 Subir</button></div>;}
function ExtraForm({onSave}){const[f,sf]=useState({desc:"",monto:""});return <div><Fl l="Descripción"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.monto} onChange={e=>sf({...f,monto:e.target.value})}/></Fl><button style={{...sB,background:T.orange}} onClick={()=>{const m=Number(f.monto);if(f.desc&&m>0)onSave({desc:f.desc,monto:m});}}>Enviar</button></div>;}
function ClienteForm({onSave}){const[f,sf]=useState({nombre:"",tel:"",email:"",dir:"",notas:""});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Teléfono"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl><Fl l="Email"><input style={sI} value={f.email} onChange={e=>sf({...f,email:e.target.value})}/></Fl></div><Fl l="Dirección"><input style={sI} value={f.dir} onChange={e=>sf({...f,dir:e.target.value})}/></Fl><button style={sB} onClick={()=>f.nombre&&onSave(f)}>Guardar</button></div>;}
function BitacoraForm({onSave}){const[n,sN]=useState("");return <div><Fl l="Nota"><textarea style={{...sI,minHeight:60}} value={n} onChange={e=>sN(e.target.value)}/></Fl><button style={sB} onClick={()=>{if(n.trim()){onSave(n);sN("");}}}>Agregar</button></div>;}
function InvForm({onSave}){const[f,sf]=useState({nombre:"",cat:"Madera",unidad:"Hoja",stock:"",minimo:"",precio:""});return <div><Fl l="Material"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}><Fl l="Stock"><input type="number" style={sI} value={f.stock} onChange={e=>sf({...f,stock:e.target.value})}/></Fl><Fl l="Mínimo"><input type="number" style={sI} value={f.minimo} onChange={e=>sf({...f,minimo:e.target.value})}/></Fl><Fl l="Precio"><input type="number" style={sI} value={f.precio} onChange={e=>sf({...f,precio:e.target.value})}/></Fl></div><button style={sB} onClick={()=>{if(f.nombre)onSave({...f,stock:Number(f.stock)||0,minimo:Number(f.minimo)||0,precio:Number(f.precio)||0});}}>Guardar</button></div>;}
function CustomItemForm({onAdd}){const[d,sD]=useState("");const[p,sP]=useState("");return <div><div style={{fontSize:11,color:T.gold,fontWeight:700,marginBottom:6}}>✏️ MUEBLE PERSONALIZADO</div><Fl l="Descripción"><input style={sI} value={d} onChange={e=>sD(e.target.value)} placeholder="Ej: Mueble TV puertas corredizas 2.4m"/></Fl><Fl l="Precio"><input type="number" style={sI} value={p} onChange={e=>sP(e.target.value)}/></Fl><button style={{...sB,background:"#1a2a1a",color:T.green,border:"1px solid #2a4a2a33"}} onClick={()=>{const pr=Number(p);if(d&&pr>0){onAdd({id:"C-"+Date.now(),cat:"Personalizado",desc:d,precio:pr,cant:1});sD("");sP("");}}}> + Agregar</button></div>;}
function ProvForm({onSave}){const[f,sf]=useState({nombre:"",contacto:"",tel:"",material:"",credito:"",calif:3});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Contacto"><input style={sI} value={f.contacto} onChange={e=>sf({...f,contacto:e.target.value})}/></Fl><Fl l="Teléfono"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl></div><Fl l="Material"><input style={sI} value={f.material} onChange={e=>sf({...f,material:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Días crédito"><input type="number" style={sI} value={f.credito} onChange={e=>sf({...f,credito:e.target.value})}/></Fl><Fl l="Calificación (1-5)"><select style={sI} value={f.calif} onChange={e=>sf({...f,calif:Number(e.target.value)})}>{[1,2,3,4,5].map(n=> <option key={n} value={n}>{n} ⭐</option>)}</select></Fl></div><button style={sB} onClick={()=>f.nombre&&onSave({...f,credito:Number(f.credito)||0,total:0})}>Guardar</button></div>;}

// ─── FORM NUEVO USUARIO ──────────────────────────────────────
function UserForm({onSave,obras}){const[f,sf]=useState({nombre:"",rol:"taller",tel:"",proyectoId:""});const av=f.nombre?f.nombre.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2):"??";return <div>
  <Fl l="Nombre completo"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})} placeholder="Nombre y apellido"/></Fl>
  <Fl l="Rol"><select style={sI} value={f.rol} onChange={e=>sf({...f,rol:e.target.value})}>{Object.entries(ROLES).map(([k,r])=> <option key={k} value={k}>{r.icon} {r.nombre}</option>)}</select></Fl>
  {f.rol==="cliente"&&<Fl l="Proyecto asignado"><select style={sI} value={f.proyectoId} onChange={e=>sf({...f,proyectoId:e.target.value})}><option value="">Seleccionar obra</option>{obras.map(o=> <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></Fl>}
  <Fl l="Teléfono (opcional)"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl>
  <div style={{display:"flex",alignItems:"center",gap:10,margin:"10px 0"}}><div style={{width:44,height:44,borderRadius:22,background:ROLES[f.rol].color+"22",color:ROLES[f.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:15}}>{av}</div><div><div style={{fontWeight:700,color:T.text}}>{f.nombre||"Nombre"}</div><div style={{fontSize:10,color:ROLES[f.rol].color}}>{ROLES[f.rol].icon} {ROLES[f.rol].nombre}</div></div></div>
  <button style={sB} onClick={()=>{if(f.nombre){onSave({...f,avatar:av,user:f.nombre.toLowerCase().split(" ")[0]});}}}> + Agregar Usuario</button>
</div>;}

export default function App(){
  const[user,setUser]=useState(null);
  const[sec,setSec]=useState("dash");
  const[sub,setSub]=useState(null);
  const[modal,setModal]=useState(null);
  const[md,setMd]=useState(null);
  const[moreOpen,setMoreOpen]=useState(false);
  const LS={get:(k,d)=>{try{const v=localStorage.getItem("ev_"+k);return v?JSON.parse(v):d;}catch{return d;}},set:(k,v)=>{try{localStorage.setItem("ev_"+k,JSON.stringify(v));}catch{}}};
  const[obras,setObrasR]=useState(()=>LS.get("obras",OBRAS_INIT));
  const[movs,setMovsR]=useState(()=>LS.get("movs",MOVS_INIT));
  const[caja,setCajaR]=useState(()=>LS.get("caja",CAJA_INIT));
  const[auts,setAutsR]=useState(()=>LS.get("auts",AUTS_INIT));
  const[recibos,setRecR]=useState(()=>LS.get("rec",[]));
  const[inv,setInvR]=useState(()=>LS.get("inv",INV_INIT));
  const[clis,setClisR]=useState(()=>LS.get("clis",CLIS_INIT));
  const[cont,setContR]=useState(()=>LS.get("cont",CONT_INIT));
  const[provs,setProvsR]=useState(()=>LS.get("provs",PROVS_INIT));
  const[users,setUsersR]=useState(()=>LS.get("users",USERS_SEED));
  const setObras=v=>{const n=typeof v==="function"?v(obras):v;setObrasR(n);LS.set("obras",n);};
  const setMovs=v=>{const n=typeof v==="function"?v(movs):v;setMovsR(n);LS.set("movs",n);};
  const setCaja=v=>{const n=typeof v==="function"?v(caja):v;setCajaR(n);LS.set("caja",n);};
  const setAuts=v=>{const n=typeof v==="function"?v(auts):v;setAutsR(n);LS.set("auts",n);};
  const setRecibos=v=>{const n=typeof v==="function"?v(recibos):v;setRecR(n);LS.set("rec",n);};
  const setInv=v=>{const n=typeof v==="function"?v(inv):v;setInvR(n);LS.set("inv",n);};
  const setClis=v=>{const n=typeof v==="function"?v(clis):v;setClisR(n);LS.set("clis",n);};
  const setCont=v=>{const n=typeof v==="function"?v(cont):v;setContR(n);LS.set("cont",n);};
  const setProvs=v=>{const n=typeof v==="function"?v(provs):v;setProvsR(n);LS.set("provs",n);};
  const setUsers=v=>{const n=typeof v==="function"?v(users):v;setUsersR(n);LS.set("users",n);};
  const[toast,setToast]=useState(null);
  const[cliTab,setCliTab]=useState("resumen");
  const[cotP,setCotP]=useState([]);
  const[cotNom,setCotNom]=useState("");
  const[cotEmp,setCotEmp]=useState("");
  const[cotNum,setCotNum]=useState(1);
  const[scanning,setScanning]=useState(false);
  const[cotTab,setCotTab]=useState("catalogo");
  const[confirmDel,setConfirmDel]=useState(null);
  const show=msg=>{setToast(msg);setTimeout(()=>setToast(null),2500);};
  const can=p=>user&&ROLES[user.rol].permisos.includes(p);
  const om=(t,d)=>{setModal(t);setMd(d||null);};
  const cm=()=>{setModal(null);setMd(null);};
  const go=(s,d)=>{setSec(s);setSub(d||null);setMoreOpen(false);};
  const tIng=movs.filter(m=>m.ing>0).reduce((s,m)=>s+m.ing,0);
  const tEgr=movs.filter(m=>m.egr>0).reduce((s,m)=>s+m.egr,0);
  const tCaja=caja.reduce((s,c)=>s+c.monto,0);
  const tCot=obras.reduce((s,o)=>s+o.cotizado,0);
  const tEgrO=obras.reduce((s,o)=>s+o.egreso,0);
  const pendAuth=auts.filter(a=>a.status==="pendiente").length;
  const lowStock=inv.filter(i=>i.stock<=i.minimo);
  const obrasAct=obras.filter(o=>o.status==="en_proceso");
  const subCot=cotP.reduce((s,p)=>s+p.precio*p.cant,0);
  const totCot=subCot*1.16;
  const addCotP=item=>{const ex=cotP.find(p=>p.id===item.id);if(ex)setCotP(cotP.map(p=>p.id===item.id?{...p,cant:p.cant+1}:p));else setCotP([...cotP,{...item,cant:1}]);};
  const genRec=m=>{const id="R-"+String(recibos.length+1).padStart(3,"0");setRecibos(prev=>[...prev,{id,fecha:m.fecha,cliente:m.prov,concepto:m.desc,monto:m.ing,obra:m.obra}]);return id;};

  const scanPhoto=async(file)=>{
    setScanning(true);
    try{
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej("err");r.readAsDataURL(file);});
      const resp=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:b64}},{type:"text",text:"Analiza esta imagen de cotización/lista de muebles. Extrae TODOS los conceptos con precio. Responde SOLO JSON array sin markdown: [{\"desc\":\"descripción\",\"precio\":12345}]. Si no hay precios pon 0. Si no puedes leer: []"}]}]})});
      const data=await resp.json();
      const text=data.content?.map(i=>i.text||"").join("")||"[]";
      const items=JSON.parse(text.replace(/```json|```/g,"").trim());
      if(Array.isArray(items)&&items.length>0){setCotP(prev=>[...prev,...items.map((it,i)=>({id:"S-"+Date.now()+"-"+i,cat:"Escaneado",desc:it.desc||"Concepto",precio:Number(it.precio)||0,cant:1}))]);show(items.length+" conceptos ✅");}
      else show("No se encontraron conceptos");
    }catch(e){show("Error: "+e);}
    setScanning(false);
  };

  const MC=({data,color,h=40})=>{const mx=Math.max(...data,1);return <svg width="100%" height={h} viewBox={"0 0 "+data.length*20+" "+h} style={{display:"block"}}>{data.map((v,i)=> <rect key={i} x={i*20+2} y={h-((v/mx)*h)} width={16} height={(v/mx)*h||1} rx={2} fill={color} opacity={v>0?.8:.15}/>)}</svg>;};
  const mI=[0,1,2,3,4,5,6,7,8,9,10,11].map(i=>movs.filter(m=>m.ing>0&&new Date(m.fecha+"T12:00:00").getMonth()===i).reduce((s,m)=>s+m.ing,0));
  const mE=[0,1,2,3,4,5,6,7,8,9,10,11].map(i=>movs.filter(m=>m.egr>0&&new Date(m.fecha+"T12:00:00").getMonth()===i).reduce((s,m)=>s+m.egr,0));

  // ═══ LOGIN ═══
  if(!user)return (
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:28,display:"flex",flexDirection:"column",alignItems:"center"}}><BrandFull size="big" sub="Carpintería Arquitectónica"/><div style={{fontSize:9,color:T.dim,marginTop:8,fontStyle:"italic"}}>— Donde la madera encuentra su forma —</div></div>
        {users.filter(u=>u.rol!=="cliente").length>0&&<div><div style={{fontSize:11,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Equipo</div>
        {users.filter(u=>u.rol!=="cliente").map(u=> <button key={u.id} onClick={()=>{setUser(u);setSec(ROLES[u.rol].permisos[0]);}} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:T.card,border:"1px solid "+T.border,borderRadius:10,marginBottom:6,cursor:"pointer",textAlign:"left"}}><div style={{width:40,height:40,borderRadius:20,background:ROLES[u.rol].color+"22",color:ROLES[u.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13}}>{u.avatar}</div><div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:T.text}}>{u.nombre}</div><div style={{fontSize:10,color:T.muted}}>{ROLES[u.rol].icon} {ROLES[u.rol].nombre}</div></div><span style={{color:T.dim,fontSize:18}}>›</span></button>)}</div>}
        {users.filter(u=>u.rol==="cliente").length>0&&<div><div style={{fontSize:11,color:T.teal,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8,marginTop:18,paddingTop:14,borderTop:"1px solid "+T.border}}>🏠 Portal Clientes</div>
        {users.filter(u=>u.rol==="cliente").map(u=>{const ob=obras.find(o=>o.id===u.proyectoId);return <button key={u.id} onClick={()=>{setUser(u);setSec("portal");setCliTab("resumen");}} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:"#0a1a1a",border:"1px solid #1a3a3a",borderRadius:10,marginBottom:6,cursor:"pointer",textAlign:"left"}}><div style={{width:40,height:40,borderRadius:20,background:T.teal+"22",color:T.teal,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13}}>{u.avatar}</div><div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:T.text}}>{u.nombre}</div><div style={{fontSize:10,color:T.teal}}>{ob?.nombre||"Sin proyecto"}</div></div><span style={{color:T.dim,fontSize:18}}>›</span></button>;})}</div>}
      </div></div>);

  const role=ROLES[user.rol];

  // ═══ CLIENT PORTAL ═══
  if(user.rol==="cliente"){
    const ob=obras.find(o=>o.id===user.proyectoId);
    if(!ob)return <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:"#090f0d",color:T.text,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:20}}><div style={{textAlign:"center"}}><div style={{fontSize:40,marginBottom:10}}>🏗️</div><div style={{fontSize:16,fontWeight:700,marginBottom:6}}>Sin proyecto asignado</div><div style={{fontSize:12,color:T.muted,marginBottom:20}}>Pide al administrador que te asigne una obra</div><button onClick={()=>setUser(null)} style={{...sB,maxWidth:200}}>← Regresar</button></div></div>;
    const exts=ob.extras||[];const pags=ob.pagos||[];const docs=ob.docs||[];const bita=ob.bitacora||[];
    const tExt=exts.filter(e=>e.status==="aprobado").reduce((s,e)=>s+e.monto,0);const tProy=ob.cotizado+tExt;const tPag=pags.reduce((s,p)=>s+p.monto,0);const resta=tProy-tPag;
    return (<div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:"#090f0d",color:T.text,minHeight:"100vh",display:"flex",flexDirection:"column",fontSize:13,maxWidth:600,margin:"0 auto"}}>
      <div style={{padding:"12px 16px",background:"#0f1a18",borderBottom:"1px solid #1a2e2a",display:"flex",justifyContent:"space-between",alignItems:"center"}}><BrandFull size="small" color={T.teal}/><div onClick={()=>setUser(null)} style={{cursor:"pointer"}}><div style={{width:28,height:28,borderRadius:14,background:T.teal+"22",color:T.teal,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800}}>{user.avatar}</div></div></div>
      <div style={{padding:"14px 16px",background:"#0f1a18"}}><div style={{fontSize:20,fontWeight:800}}>{ob.nombre}</div><div style={{display:"flex",gap:8,alignItems:"center",marginTop:4}}><Badge s={ob.status}/><span style={{fontSize:11,color:T.teal}}>Entrega: {fd(ob.entrega)}</span></div><div style={{marginTop:8}}><Bar v={ob.avance} mx={100} c={T.teal} h={6}/><div style={{fontSize:10,color:T.muted,textAlign:"right"}}>{ob.avance}%</div></div></div>
      <div style={{flex:1,padding:"8px 12px 80px",overflowY:"auto"}}>
        {cliTab==="resumen"&&<div><Card><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><Stat label="Presupuesto" value={$(ob.cotizado)} color={T.gold}/><Stat label="Extras" value={$(tExt)} color={T.orange}/><Stat label="Total" value={$(tProy)}/><Stat label="Pagado" value={$(tPag)} color={T.green}/></div><div style={{marginTop:10}}><Bar v={tPag} mx={tProy} c={T.teal}/><div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginTop:4}}><span style={{color:T.muted}}>{pc(tPag,tProy)}%</span><span style={{color:resta>0?T.yellow:T.green,fontWeight:700}}>Resta: {$(resta)}</span></div></div></Card>{bita.length>0&&<Card><div style={{fontSize:10,color:T.teal,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Bitácora</div>{bita.slice(-3).reverse().map(b=> <div key={b.id} style={{padding:"6px 0",borderBottom:"1px solid #0a1a18",fontSize:12}}><div style={{fontWeight:600}}>{b.nota}</div><div style={{fontSize:10,color:T.muted}}>{fd(b.fecha)}</div></div>)}</Card>}</div>}
        {cliTab==="docs"&&<div>{docs.map(d=> <Card key={d.id} style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:20}}>{DOC_IC[d.tipo]}</span><div><div style={{fontWeight:600}}>{d.nombre}</div><div style={{fontSize:10,color:T.dim}}>{d.ext} · {fd(d.fecha)}</div></div></Card>)}{docs.length===0&&<div style={{color:T.dim,textAlign:"center",padding:20}}>Sin documentos</div>}</div>}
        {cliTab==="pagos"&&<div><Card><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}><Stat label="Total" value={$(tProy)} small/><Stat label="Pagado" value={$(tPag)} color={T.green} small/><Stat label="Resta" value={$(resta)} color={resta>0?T.yellow:T.green} small/></div></Card>{pags.map(p=> <Card key={p.id} onClick={()=>om("recC",{...p,cliente:ob.cliente,obra:ob.nombre})}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:600}}>{p.concepto}</div><div style={{fontSize:10,color:T.dim}}>{fd(p.fecha)}</div></div><div style={{fontWeight:800,color:T.green}}>{$(p.monto)}</div></div></Card>)}</div>}
        {cliTab==="extras"&&<div>{exts.map(e=> <Card key={e.id}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:700}}>{e.desc}</span><Badge s={e.status}/></div><div style={{display:"flex",justifyContent:"space-between",marginTop:4}}><span style={{fontSize:11,color:T.muted}}>{fd(e.fecha)}</span><span style={{fontWeight:800,color:T.orange}}>{$(e.monto)}</span></div></Card>)}<button style={{...sB,background:T.orange+"22",color:T.orange,border:"1px solid "+T.orange+"44"}} onClick={()=>om("solEx")}>➕ Solicitar Extra</button></div>}
      </div>
      {modal==="recC"&&md&&<ModalW title="Recibo" onClose={cm}><ReciboView data={md}/></ModalW>}
      {modal==="solEx"&&<ModalW title="Solicitar Extra" onClose={cm}><ExtraForm onSave={e=>{const up={...ob,extras:[...(ob.extras||[]),{...e,id:(ob.extras?.length||0)+1,status:"pendiente",fecha:td()}]};setObras(obras.map(o=>o.id===ob.id?up:o));cm();show("Extra enviado ✓");}}/></ModalW>}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:300,background:"#0f1a18",borderTop:"1px solid #1a2e2a",display:"flex",justifyContent:"center"}}><div style={{display:"flex",maxWidth:600,width:"100%"}}>{[{k:"resumen",i:"📊",l:"Resumen"},{k:"docs",i:"📐",l:"Planos"},{k:"pagos",i:"💰",l:"Pagos"},{k:"extras",i:"➕",l:"Extras"}].map(t=> <button key={t.k} onClick={()=>setCliTab(t.k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:cliTab===t.k?T.teal:T.dim}}><span style={{fontSize:18}}>{t.i}</span><span style={{fontSize:8,fontWeight:600}}>{t.l}</span></button>)}<button onClick={()=>setUser(null)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:T.red}}><span style={{fontSize:18}}>🚪</span><span style={{fontSize:8,fontWeight:600}}>Salir</span></button></div></div>
      {toast&&<div style={{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"#1a3a2a",color:T.green,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:700,zIndex:2000}}>{toast}</div>}
    </div>);
  }

  // ═══ TABS ═══
  const bT=[];
  if(can("dash"))bT.push({key:"dash",icon:"📊",label:"Inicio"});
  if(can("cot"))bT.push({key:"cot",icon:"📝",label:"Cotizar"});
  if(can("obras")||can("obras_ver"))bT.push({key:"obras",icon:"🏗️",label:"Obras"});
  if(can("money"))bT.push({key:"money",icon:"💰",label:"Finanzas"});
  if(can("caja")&&!can("money"))bT.push({key:"caja",icon:"🧾",label:"Caja"});
  const mItems=[];
  if(can("inv"))mItems.push({key:"inv",icon:"📦",label:"Inventario"});
  if(can("caja")&&can("money"))mItems.push({key:"caja",icon:"🧾",label:"Caja Chica"});
  if(can("cont"))mItems.push({key:"cont",icon:"📄",label:"Contratos"});
  if(can("clis"))mItems.push({key:"clis",icon:"👤",label:"Clientes"});
  if(can("provs"))mItems.push({key:"provs",icon:"🚚",label:"Proveedores"});
  if(can("cal"))mItems.push({key:"cal",icon:"📅",label:"Calendario"});
  if(can("anal"))mItems.push({key:"anal",icon:"📈",label:"Análisis"});
  if(can("auth"))mItems.push({key:"auth",icon:"✅",label:"Autorizaciones"+(pendAuth>0?" ("+pendAuth+")":"")});
  if(can("recibos"))mItems.push({key:"recibos",icon:"🧾",label:"Recibos"});
  if(can("usuarios"))mItems.push({key:"usuarios",icon:"👥",label:"Usuarios"});
  const tabs=[...bT.slice(0,4)];if(mItems.length>0)tabs.push({key:"more",icon:"☰",label:"Más"});

  return (<div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",display:"flex",flexDirection:"column",fontSize:13,maxWidth:600,margin:"0 auto"}}>
    <div style={{padding:"10px 16px",background:"#111",borderBottom:"1px solid "+T.border,position:"sticky",top:0,zIndex:100,display:"flex",justifyContent:"space-between",alignItems:"center"}}><BrandFull size="small" color={T.gold}/><div style={{display:"flex",alignItems:"center",gap:8}}>{pendAuth>0&&can("auth")&&<div onClick={()=>go("auth")} style={{background:T.yellow,color:"#111",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:800,cursor:"pointer"}}>{pendAuth}</div>}{lowStock.length>0&&can("inv")&&<div onClick={()=>go("inv")} style={{background:T.red,color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:800,cursor:"pointer"}}>⚠{lowStock.length}</div>}<div onClick={()=>setUser(null)} style={{width:28,height:28,borderRadius:14,background:role.color+"22",color:role.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,cursor:"pointer"}}>{user.avatar}</div></div></div>
    <div style={{padding:"3px 16px 6px",display:"flex",alignItems:"center",gap:6,background:"#111"}}><span style={{fontSize:11}}>{role.icon}</span><span style={{fontSize:10,color:role.color,fontWeight:700}}>{role.nombre}</span></div>

    <div style={{flex:1,padding:"6px 12px 80px",overflowY:"auto"}}>
      {sec==="dash"&&<div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}><Card onClick={()=>go("obras")}><Stat label="Obras Activas" value={obrasAct.length} color={T.green}/></Card><Card><Stat label="Margen" value={$(tCot-tEgrO)} color={tCot-tEgrO>=0?T.green:T.red}/></Card></div>
        {pendAuth>0&&<div onClick={()=>go("auth")} style={{background:"#2a2000",border:"1px solid #FFD54F33",borderRadius:10,padding:"10px 14px",marginBottom:8,cursor:"pointer"}}><span style={{fontWeight:700,color:T.yellow}}>🔔 {pendAuth} autorización(es)</span></div>}
        {lowStock.length>0&&<div onClick={()=>go("inv")} style={{background:"#2a0000",border:"1px solid #ef535033",borderRadius:10,padding:"10px 14px",marginBottom:8,cursor:"pointer"}}><span style={{fontWeight:700,color:T.red}}>📦 Stock bajo: {lowStock.map(i=>i.nombre).join(", ")}</span></div>}
        {movs.length>0&&<Card><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>Ingresos vs Egresos</div><MC data={mI} color={T.green}/><MC data={mE} color={T.red} h={25}/></Card>}
        {obrasAct.length>0&&<Card><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Obras Activas</div>{obrasAct.map(o=> <div key={o.id} onClick={()=>go("obras",o)} style={{padding:"10px 0",borderBottom:"1px solid "+T.border,cursor:"pointer"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontWeight:700}}>{o.nombre}</span><span style={{fontSize:10,background:FC[o.fase]+"33",color:FC[o.fase],padding:"1px 6px",borderRadius:8,fontWeight:700}}>{FASES[o.fase]}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.muted,marginBottom:3}}><span>{o.cliente}</span><span>{o.avance}%</span></div><Bar v={o.avance} mx={100} c={FC[o.fase]}/></div>)}</Card>}
        {obras.length===0&&movs.length===0&&<Card style={{textAlign:"center",padding:30}}><div style={{fontSize:32,marginBottom:8}}>🚀</div><div style={{fontWeight:700,fontSize:16,marginBottom:4}}>¡Bienvenido!</div><div style={{color:T.muted,fontSize:12}}>Sistema limpio. Empieza creando una obra o cotización.</div></Card>}
      </div>}

      {sec==="cot"&&<div>
        <Card><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}><input style={sI} placeholder="Nombre cliente" value={cotNom} onChange={e=>setCotNom(e.target.value)}/><input style={sI} placeholder="Empresa / Obra" value={cotEmp} onChange={e=>setCotEmp(e.target.value)}/></div></Card>
        <div style={{display:"flex",gap:4,marginBottom:8}}>{[{k:"catalogo",i:"📦",l:"Catálogo"},{k:"libre",i:"✏️",l:"Escribir"},{k:"foto",i:"📷",l:"Escanear"}].map(t=> <button key={t.k} onClick={()=>setCotTab(t.k)} style={{flex:1,padding:"10px 6px",borderRadius:8,border:cotTab===t.k?"2px solid "+T.gold:"1px solid "+T.border,background:cotTab===t.k?"#1a1510":T.card,color:cotTab===t.k?T.gold:T.muted,cursor:"pointer",fontSize:11,fontWeight:700}}><div style={{fontSize:16}}>{t.i}</div>{t.l}</button>)}</div>
        {cotTab==="catalogo"&&<button onClick={()=>om("cat")} style={{...sB,background:"#222",color:T.gold,border:"1px solid "+T.border,marginTop:0,marginBottom:8}}>📦 Abrir catálogo</button>}
        {cotTab==="libre"&&<Card><CustomItemForm onAdd={item=>{setCotP(prev=>[...prev,item]);show("Agregado ✓");}}/></Card>}
        {cotTab==="foto"&&<Card><div style={{fontSize:11,color:T.blue,fontWeight:700,marginBottom:8}}>📷 ESCANEAR COTIZACIÓN</div><div style={{fontSize:12,color:T.muted,marginBottom:10}}>Sube foto de cotización escrita a mano o impresa. La IA detecta conceptos y precios.</div><label style={{display:"block",padding:20,border:"2px dashed "+(scanning?T.blue:T.border),borderRadius:10,textAlign:"center",cursor:scanning?"wait":"pointer",background:scanning?"#0a1a33":"#111"}}><input type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>{if(e.target.files[0])scanPhoto(e.target.files[0]);}}/>{scanning?<div><div style={{fontSize:24}}>🔄</div><div style={{color:T.blue,fontWeight:700}}>Analizando con IA...</div></div>:<div><div style={{fontSize:32}}>📸</div><div style={{color:T.gold,fontWeight:700}}>Tomar foto o seleccionar</div><div style={{fontSize:11,color:T.muted,marginTop:4}}>JPG, PNG</div></div>}</label></Card>}
        {cotP.length>0&&<Card>
          <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Partidas ({cotP.length})</div>
          {cotP.map((p,i)=> <div key={p.id+"-"+i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid "+T.border}}><div style={{flex:1}}><div style={{fontSize:12}}>{p.cat!=="Personalizado"&&p.cat!=="Escaneado"&&<b style={{color:T.gold}}>{p.id} </b>}{p.desc}</div>{(p.cat==="Personalizado"||p.cat==="Escaneado")&&<span style={{fontSize:9,background:p.cat==="Escaneado"?"#0a1a33":"#1a2a1a",color:p.cat==="Escaneado"?T.blue:T.green,padding:"1px 5px",borderRadius:4}}>{p.cat==="Escaneado"?"📷":"✏️"} {p.cat}</span>}<div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}><button onClick={()=>setCotP(cotP.map((x,j)=>j===i?{...x,cant:Math.max(1,x.cant-1)}:x))} style={{background:"#222",border:"1px solid #444",color:"#ccc",borderRadius:6,width:28,height:28,cursor:"pointer"}}>−</button><span style={{fontSize:14,fontWeight:700,minWidth:20,textAlign:"center"}}>{p.cant}</span><button onClick={()=>setCotP(cotP.map((x,j)=>j===i?{...x,cant:x.cant+1}:x))} style={{background:"#222",border:"1px solid #444",color:"#ccc",borderRadius:6,width:28,height:28,cursor:"pointer"}}>+</button></div></div><div style={{textAlign:"right"}}><div style={{fontWeight:700}}>{$(p.precio*p.cant)}</div><button onClick={()=>setCotP(cotP.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:10}}>Quitar</button></div></div>)}
          <div style={{borderTop:"2px solid "+T.border,marginTop:10,paddingTop:10}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span style={{color:T.muted}}>Subtotal</span><span>{$(subCot)}</span></div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span style={{color:T.muted}}>IVA 16%</span><span>{$(subCot*.16)}</span></div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:22,fontWeight:800,color:T.gold,paddingTop:6,borderTop:"1px solid "+T.dim}}><span>TOTAL</span><span>{$(totCot)}</span></div>
          </div>
          <button style={sB} onClick={()=>{setObras(prev=>[...prev,{id:"OB"+String(prev.length+1).padStart(2,"0"),nombre:(cotEmp||cotNom||"Cot")+" #"+cotNum,cliente:cotNom,status:"cotizado",cotizado:totCot,egreso:0,fase:"cotizacion",avance:0,extras:[],pagos:[],docs:[],bitacora:[]}]);setCotNum(n=>n+1);setCotP([]);setCotNom("");setCotEmp("");show("Proyecto creado ✓");}}>💾 Guardar como proyecto</button>
        </Card>}
      </div>}

      {sec==="obras"&&!sub&&<div>{can("obras")&&<button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addOb")}>+ Nueva Obra</button>}{obras.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin obras. Crea una nueva o usa el cotizador.</div></Card>}{Object.entries(FASES).map(([k,label])=>{const list=obras.filter(o=>o.fase===k);if(!list.length)return null;return <div key={k}><div style={{fontSize:10,color:FC[k],fontWeight:700,textTransform:"uppercase",margin:"10px 0 4px"}}>{label} ({list.length})</div>{list.map(o=> <Card key={o.id} onClick={()=>setSub(o)}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontWeight:700}}>{o.nombre}</span><span style={{fontWeight:700,color:T.gold}}>{$(o.cotizado)}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.muted,marginBottom:3}}><span>{o.cliente}</span><span>{o.avance}%</span></div><Bar v={o.avance} mx={100} c={FC[o.fase]}/></Card>)}</div>;})}</div>}

      {sec==="obras"&&sub&&<div>
        <button onClick={()=>setSub(null)} style={{background:"none",border:"none",color:T.gold,cursor:"pointer",fontSize:13,padding:0,marginBottom:8}}>← Obras</button>
        <Card><div style={{fontSize:20,fontWeight:800,marginBottom:4}}>{sub.nombre}</div><div style={{display:"flex",gap:6,marginBottom:8}}><Badge s={sub.status}/><span style={{background:FC[sub.fase]+"33",color:FC[sub.fase],padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700}}>{FASES[sub.fase]}</span></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}><Stat label="Cotizado" value={$(sub.cotizado)} color={T.gold} small/><Stat label="Egresado" value={$(sub.egreso)} color={sub.egreso>sub.cotizado?T.red:T.green} small/><Stat label="Margen" value={$(sub.cotizado-sub.egreso)} color={sub.cotizado-sub.egreso>=0?T.green:T.red} small/></div><div style={{marginTop:8}}><Bar v={sub.avance} mx={100} c={FC[sub.fase]} h={6}/><div style={{fontSize:10,color:T.muted,textAlign:"right"}}>{sub.avance}% · Entrega: {fd(sub.entrega)}</div></div></Card>
        {can("docs")&&<Card><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase"}}>Documentos</span><button onClick={()=>om("addDoc")} style={{background:"#222",border:"1px solid #444",color:T.gold,borderRadius:6,padding:"3px 10px",fontSize:10,cursor:"pointer"}}>+ Subir</button></div>{(sub.docs||[]).map(d=> <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid "+T.border}}><span style={{fontSize:16}}>{DOC_IC[d.tipo]}</span><div><div style={{fontSize:12,fontWeight:600}}>{d.nombre}</div><div style={{fontSize:10,color:T.dim}}>{d.ext} · {fd(d.fecha)}</div></div></div>)}{(sub.docs||[]).length===0&&<div style={{fontSize:11,color:T.dim,textAlign:"center",padding:8}}>Sin documentos</div>}</Card>}
        <Card><div style={{fontSize:10,color:T.orange,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>Extras ({(sub.extras||[]).length})</div>{(sub.extras||[]).map(e=> <div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid "+T.border}}><div><div style={{fontSize:12}}>{e.desc}</div><div style={{fontSize:10,color:T.dim}}>{fd(e.fecha)}</div></div><div style={{textAlign:"right"}}><Badge s={e.status}/><div style={{fontSize:12,fontWeight:700,color:T.orange}}>{$(e.monto)}</div></div></div>)}</Card>
        <Card><div style={{fontSize:10,color:T.blue,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>Bitácora</div>{(sub.bitacora||[]).slice().reverse().map(b=> <div key={b.id} style={{padding:"5px 0",borderBottom:"1px solid "+T.border}}><div style={{fontSize:12}}>{b.nota}</div><div style={{fontSize:10,color:T.dim}}>{fd(b.fecha)} · {b.user}</div></div>)}<div style={{marginTop:8}}><BitacoraForm onSave={nota=>{const up={...sub,bitacora:[...(sub.bitacora||[]),{id:(sub.bitacora?.length||0)+1,fecha:td(),nota,user:user.nombre}]};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);show("Bitácora ✓");}}/></div></Card>
      </div>}

      {sec==="money"&&<div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>{[["Ingresos",$(tIng),T.green],["Egresos",$(tEgr),T.red],["Balance",$(tIng-tEgr),tIng-tEgr>=0?T.green:T.red]].map(([l,v,c])=> <Card key={l}><Stat label={l} value={v} color={c} small/></Card>)}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}><button style={{...sB,background:"#1a3a1a",color:T.green,border:"1px solid #2a4a2a",marginTop:0}} onClick={()=>om("addIng")}>+ Ingreso</button><button style={{...sB,background:"#3a1a1a",color:T.red,border:"1px solid #4a2a2a",marginTop:0}} onClick={()=>om("addEgr")}>+ Egreso</button></div>
        {movs.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin movimientos</div></Card>}
        {movs.slice().reverse().map(m=> <Card key={m.id}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:600}}>{m.desc}</div><div style={{fontSize:10,color:T.dim}}>{fd(m.fecha)} · {m.prov} · {m.obra||"General"}</div></div><span style={{fontWeight:800,color:m.ing>0?T.green:T.red}}>{m.ing>0?"+":"-"}{$(m.ing>0?m.ing:m.egr)}</span></div></Card>)}
      </div>}

      {sec==="inv"&&<div><button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addInv")}>+ Material</button>{inv.sort((a,b)=>(a.stock<=a.minimo?0:1)-(b.stock<=b.minimo?0:1)).map(it=> <Card key={it.id} style={{borderLeft:it.stock<=it.minimo?"3px solid "+T.red:"3px solid transparent"}}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:700}}>{it.nombre}</div><div style={{fontSize:10,color:T.dim}}>{it.cat} · {$(it.precio)}/{it.unidad}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:it.stock<=it.minimo?T.red:T.green}}>{it.stock}</div><div style={{fontSize:9,color:T.muted}}>min:{it.minimo}</div></div></div><Bar v={it.stock} mx={it.minimo*3} c={it.stock<=it.minimo?T.red:T.green}/></Card>)}</div>}

      {sec==="caja"&&<div><Card><Stat label="Caja Chica Total" value={$(tCaja)} color={T.orange}/></Card><button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addCj")}>+ Gasto</button>{caja.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin gastos</div></Card>}{caja.slice().reverse().map(c=> <Card key={c.id}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:600}}>{c.concepto}</div><div style={{fontSize:10,color:T.dim}}>{fd(c.fecha)} · {c.resp} · {c.obra}</div></div><span style={{fontWeight:700,color:T.orange}}>{$(c.monto)}</span></div></Card>)}</div>}

      {sec==="cont"&&<div>{cont.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin contratos</div></Card>}{cont.map(c=> <Card key={c.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontWeight:700}}>{c.obra}</span><Badge s={c.status}/></div><div style={{fontSize:11,color:T.muted}}>{c.cliente} · Anticipo {c.anticipo}%</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:6}}><Stat label="Monto" value={$(c.monto)} color={T.gold} small/><Stat label="Entrega" value={fd(c.entrega)} small/></div></Card>)}</div>}

      {sec==="clis"&&<div><button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addCli")}>+ Cliente</button>{clis.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin clientes. Agrega tu primer cliente.</div></Card>}{clis.map(c=> <Card key={c.id}><div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{c.nombre}</div><div style={{fontSize:11,color:T.muted}}>{c.tel&&"📱 "+c.tel}{c.email&&" · ✉ "+c.email}</div>{c.dir&&<div style={{fontSize:11,color:T.muted}}>📍 {c.dir}</div>}</Card>)}</div>}

      {sec==="provs"&&<div><button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addProv")}>+ Proveedor</button>{provs.map(p=> <Card key={p.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><div><div style={{fontWeight:700}}>{p.nombre}</div><div style={{fontSize:11,color:T.muted}}>{p.contacto} {p.tel&&"· "+p.tel}</div></div><span style={{fontWeight:700,color:T.gold}}>{$(p.total)}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:T.muted}}>{p.material}</span><span>{[...Array(p.calif||0)].map((_,i)=> <span key={i}>⭐</span>)}</span></div></Card>)}</div>}

      {sec==="cal"&&<div>{obras.filter(o=>o.inicio).sort((a,b)=>a.entrega>b.entrega?1:-1).map(o=> <Card key={o.id} onClick={()=>go("obras",o)}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontWeight:700}}>{o.nombre}</span><span style={{fontSize:10,background:FC[o.fase]+"33",color:FC[o.fase],padding:"1px 6px",borderRadius:8,fontWeight:700}}>{FASES[o.fase]}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.muted}}><span>{fd(o.inicio)}</span><span>→</span><span>{fd(o.entrega)}</span></div><Bar v={o.avance} mx={100} c={FC[o.fase]} h={4}/>{o.entrega&&new Date(o.entrega)<new Date()&&o.status!=="completado"&&<div style={{fontSize:10,color:T.red,fontWeight:700,marginTop:4}}>⚠ ATRASADA</div>}</Card>)}{obras.length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin obras programadas</div></Card>}</div>}

      {sec==="anal"&&<div><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Rentabilidad</div>{obras.filter(o=>o.cotizado>0).length===0&&<Card style={{textAlign:"center",padding:20}}><div style={{color:T.muted}}>Sin datos para analizar</div></Card>}{obras.filter(o=>o.cotizado>0).sort((a,b)=>(b.cotizado-b.egreso)-(a.cotizado-a.egreso)).map(o=>{const m=o.cotizado-o.egreso;const p=pc(m,o.cotizado);return <Card key={o.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontWeight:700}}>{o.nombre}</span><span style={{fontWeight:800,color:m>=0?T.green:T.red}}>{m>=0?"+":""}{$(m)}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.muted,marginBottom:3}}><span>Cot:{$(o.cotizado)}</span><span>Egr:{$(o.egreso)}</span><span style={{color:p>=20?T.green:p>=0?T.orange:T.red,fontWeight:700}}>{p}%</span></div><Bar v={o.egreso} mx={o.cotizado} c={o.egreso>o.cotizado?T.red:T.green}/></Card>;})}</div>}

      {sec==="auth"&&<div>{auts.length===0?<div style={{color:T.dim,textAlign:"center",padding:20}}>Sin solicitudes</div>:auts.slice().reverse().map(a=> <Card key={a.id} style={{borderLeft:a.status==="pendiente"?"3px solid "+T.yellow:"3px solid transparent"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontWeight:700}}>{a.desc}</span><Badge s={a.status==="pendiente"?"pendiente":a.status}/></div><div style={{fontSize:11,color:T.muted}}>{a.sol} · {fd(a.fecha)}</div><div style={{fontSize:16,fontWeight:800,color:T.gold,marginTop:4}}>{$(a.monto)}</div>{a.status==="pendiente"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}><button style={{padding:10,borderRadius:8,border:"none",background:"#1a3a1a",color:T.green,fontWeight:700,cursor:"pointer"}} onClick={()=>{setAuts(auts.map(x=>x.id===a.id?{...x,status:"aprobada"}:x));show("Aprobada ✓");}}>✓ Aprobar</button><button style={{padding:10,borderRadius:8,border:"none",background:"#3a1a1a",color:T.red,fontWeight:700,cursor:"pointer"}} onClick={()=>{setAuts(auts.map(x=>x.id===a.id?{...x,status:"rechazada"}:x));show("Rechazada");}}>✕ Rechazar</button></div>}</Card>)}</div>}

      {sec==="recibos"&&<div>{recibos.length===0?<div style={{color:T.dim,textAlign:"center",padding:20}}>Se generan al registrar ingresos</div>:recibos.slice().reverse().map(r=> <Card key={r.id} onClick={()=>om("vRec",r)}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:700,color:T.green}}>{r.id}</div><div style={{fontSize:12}}>{r.concepto}</div><div style={{fontSize:10,color:T.dim}}>{fd(r.fecha)}</div></div><span style={{fontWeight:800,color:T.green}}>{$(r.monto)}</span></div></Card>)}</div>}

      {/* ═══ USUARIOS — ADMIN CRUD ═══ */}
      {sec==="usuarios"&&<div>
        <button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addUser")}>+ Agregar Usuario</button>
        <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Equipo ({users.filter(u=>u.rol!=="cliente").length})</div>
        {users.filter(u=>u.rol!=="cliente").map(u=> <Card key={u.id} style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:40,height:40,borderRadius:20,background:ROLES[u.rol].color+"22",color:ROLES[u.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13}}>{u.avatar}</div>
          <div style={{flex:1}}><div style={{fontWeight:700}}>{u.nombre}</div><div style={{fontSize:10,color:ROLES[u.rol].color}}>{ROLES[u.rol].icon} {ROLES[u.rol].nombre}</div>{u.tel&&<div style={{fontSize:10,color:T.dim}}>📱 {u.tel}</div>}</div>
          {u.id!==1&&<div>{confirmDel===u.id?<div style={{display:"flex",gap:4}}><button onClick={()=>{setUsers(prev=>prev.filter(x=>x.id!==u.id));setConfirmDel(null);show("Eliminado");}} style={{background:T.red,color:"#fff",border:"none",borderRadius:6,padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer"}}>Sí</button><button onClick={()=>setConfirmDel(null)} style={{background:"#333",color:"#aaa",border:"none",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>No</button></div>:<button onClick={()=>setConfirmDel(u.id)} style={{background:"#2a1111",color:T.red,border:"1px solid #3a1a1a",borderRadius:6,padding:"4px 10px",fontSize:10,cursor:"pointer"}}>🗑</button>}</div>}
        </Card>)}
        {users.filter(u=>u.rol==="cliente").length>0&&<div><div style={{fontSize:10,color:T.teal,fontWeight:700,textTransform:"uppercase",marginBottom:8,marginTop:14}}>Portal Clientes ({users.filter(u=>u.rol==="cliente").length})</div>
        {users.filter(u=>u.rol==="cliente").map(u=>{const ob=obras.find(o=>o.id===u.proyectoId);return <Card key={u.id} style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:40,height:40,borderRadius:20,background:T.teal+"22",color:T.teal,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13}}>{u.avatar}</div>
          <div style={{flex:1}}><div style={{fontWeight:700}}>{u.nombre}</div><div style={{fontSize:10,color:T.teal}}>{ob?.nombre||"Sin proyecto"}</div></div>
          <div>{confirmDel===u.id?<div style={{display:"flex",gap:4}}><button onClick={()=>{setUsers(prev=>prev.filter(x=>x.id!==u.id));setConfirmDel(null);show("Eliminado");}} style={{background:T.red,color:"#fff",border:"none",borderRadius:6,padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer"}}>Sí</button><button onClick={()=>setConfirmDel(null)} style={{background:"#333",color:"#aaa",border:"none",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>No</button></div>:<button onClick={()=>setConfirmDel(u.id)} style={{background:"#2a1111",color:T.red,border:"1px solid #3a1a1a",borderRadius:6,padding:"4px 10px",fontSize:10,cursor:"pointer"}}>🗑</button>}</div>
        </Card>;})}</div>}
      </div>}
    </div>

    {modal==="cat"&&<ModalW title="Catálogo" onClose={cm}>{cats.map(cat=> <div key={cat} style={{marginBottom:12}}><div style={{fontSize:11,color:T.gold,fontWeight:700,borderBottom:"1px solid "+T.border,paddingBottom:3,marginBottom:4}}>{cat}</div>{CATALOGO.filter(c=>c.cat===cat).map(item=> <div key={item.id} onClick={()=>{addCotP(item);show(item.id+" +");}} style={{display:"flex",justifyContent:"space-between",padding:"10px 8px",borderBottom:"1px solid "+T.border,cursor:"pointer"}}><span><b style={{color:T.gold}}>{item.id}</b> {item.desc}</span><div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{color:T.muted}}>{$(item.precio)}</span><span style={{background:"#1a3a1a",color:T.green,borderRadius:20,width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>+</span></div></div>)}</div>)}</ModalW>}
    {modal==="addOb"&&<ModalW title="Nueva Obra" onClose={cm}><ObraForm clientes={clis} onSave={o=>{setObras(prev=>[...prev,{...o,id:"OB"+String(prev.length+1).padStart(2,"0"),egreso:0,extras:[],pagos:[],docs:[],bitacora:[]}]);cm();show("Obra ✓");}}/></ModalW>}
    {modal==="addIng"&&<ModalW title="Ingreso + Recibo" onClose={cm}><IngForm obras={obras} onSave={m=>{const rid=genRec(m);setMovs(prev=>[...prev,{...m,id:prev.length+1,user:user.nombre,recibo:rid}]);cm();show("Recibo "+rid+" ✓");}}/></ModalW>}
    {modal==="addEgr"&&<ModalW title="Egreso" onClose={cm}><EgrForm obras={obras} provs={provs} onSave={m=>{setMovs(prev=>[...prev,{...m,id:prev.length+1,user:user.nombre}]);cm();show("Egreso ✓");}}/></ModalW>}
    {modal==="addCj"&&<ModalW title="Caja Chica" onClose={cm}><CajaForm users={users} onSave={c=>{setCaja(prev=>[...prev,{...c,id:prev.length+1}]);cm();show("✓");}}/></ModalW>}
    {modal==="addDoc"&&sub&&<ModalW title="Subir Documento" onClose={cm}><DocForm onSave={d=>{const up={...sub,docs:[...(sub.docs||[]),{...d,id:(sub.docs?.length||0)+1,fecha:td(),size:"—"}]};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);cm();show("Documento ✓");}}/></ModalW>}
    {modal==="addCli"&&<ModalW title="Nuevo Cliente" onClose={cm}><ClienteForm onSave={c=>{setClis(prev=>[...prev,{...c,id:"C"+String(prev.length+1)}]);cm();show("Cliente ✓");}}/></ModalW>}
    {modal==="addInv"&&<ModalW title="Material" onClose={cm}><InvForm onSave={i=>{setInv(prev=>[...prev,{...i,id:"I"+String(prev.length+1)}]);cm();show("Material ✓");}}/></ModalW>}
    {modal==="addProv"&&<ModalW title="Nuevo Proveedor" onClose={cm}><ProvForm onSave={p=>{setProvs(prev=>[...prev,{...p,id:"P"+String(prev.length+1).padStart(2,"0")}]);cm();show("Proveedor ✓");}}/></ModalW>}
    {modal==="addUser"&&<ModalW title="Agregar Usuario" onClose={cm}><UserForm obras={obras} onSave={u=>{setUsers(prev=>[...prev,{...u,id:Math.max(...prev.map(x=>x.id))+1}]);cm();show("Usuario creado ✓");}}/></ModalW>}
    {modal==="vRec"&&md&&<ModalW title={md.id} onClose={cm}><ReciboView data={md}/></ModalW>}
    {modal==="recC"&&md&&<ModalW title="Recibo" onClose={cm}><ReciboView data={md}/></ModalW>}
    {modal==="solEx"&&<ModalW title="Solicitar Extra" onClose={cm}><ExtraForm onSave={e=>{cm();show("Extra enviado");}}/></ModalW>}

    {toast&&<div style={{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"#1a3a1a",color:T.green,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:700,zIndex:2000}}>{toast}</div>}

    {moreOpen&&<div style={{position:"fixed",bottom:56,left:0,right:0,zIndex:200,display:"flex",justifyContent:"center"}} onClick={()=>setMoreOpen(false)}><div onClick={e=>e.stopPropagation()} style={{background:"#1a1a1a",border:"1px solid "+T.border,borderRadius:14,padding:6,maxWidth:360,width:"90%",boxShadow:"0 -4px 20px rgba(0,0,0,.5)",maxHeight:"50vh",overflowY:"auto"}}>{mItems.map(i=> <button key={i.key} onClick={()=>go(i.key)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 14px",background:sec===i.key?"#252525":"transparent",border:"none",color:sec===i.key?T.gold:"#bbb",cursor:"pointer",fontSize:13,fontWeight:sec===i.key?700:400,textAlign:"left",borderRadius:8}}><span style={{fontSize:15}}>{i.icon}</span>{i.label}</button>)}<div style={{borderTop:"1px solid "+T.border,marginTop:4,paddingTop:4}}><button onClick={()=>{setUser(null);setMoreOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 14px",background:"transparent",border:"none",color:T.red,cursor:"pointer",fontSize:13,borderRadius:8}}>🚪 Cerrar sesión</button></div></div></div>}

    <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:300,background:"#111",borderTop:"1px solid "+T.border,display:"flex",justifyContent:"center"}}><div style={{display:"flex",maxWidth:600,width:"100%"}}>{tabs.map(t=> <button key={t.key} onClick={()=>{if(t.key==="more"){setMoreOpen(!moreOpen);return;}go(t.key);}} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:(t.key==="more"?moreOpen:sec===t.key)?T.gold:T.dim}}><span style={{fontSize:18}}>{t.icon}</span><span style={{fontSize:8,fontWeight:600}}>{t.label}</span></button>)}</div></div>
  </div>);
}

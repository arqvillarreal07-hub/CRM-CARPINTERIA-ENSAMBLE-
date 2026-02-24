import { useState } from "react";

/* ═══════════════════════════════════════════════════════════
   ENSAMBLE VILLARREAL — SISTEMA DE GESTIÓN INTEGRAL v3
   Carpintería Arquitectónica
   Dashboard · Cotizador · Obras · Finanzas · Inventario
   Contratos · Clientes · Proveedores · Calendario · Análisis
   Recibos · Autorizaciones · Portal Cliente · Roles
   ═══════════════════════════════════════════════════════════ */

// ─── THEME ───────────────────────────────────────────────────
const T={bg:"#0b0b0b",card:"#141414",border:"#1e1e1e",gold:"#c9956b",green:"#4CAF50",red:"#ef5350",blue:"#42A5F5",orange:"#FF9800",purple:"#AB47BC",teal:"#26A69A",yellow:"#FFD54F",text:"#e8e0d8",muted:"#777",dim:"#444"};

// ─── LOGO SVG ────────────────────────────────────────────────
const Logo=({size=32,color="#c9956b"})=> <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="94" height="94" rx="2" stroke={color} strokeWidth="3.5"/><line x1="8" y1="92" x2="50" y2="8" stroke={color} strokeWidth="3"/><line x1="8" y1="50" x2="50" y2="50" stroke={color} strokeWidth="3"/><path d="M50 8 L50 50 L92 50" stroke={color} strokeWidth="3" fill="none"/><path d="M50 8 A42 42 0 0 1 92 50" stroke={color} strokeWidth="3" fill="none"/><line x1="29" y1="50" x2="29" y2="92" stroke={color} strokeWidth="3"/></svg>;

const BrandFull=({color=T.gold,sub="",size="normal"})=> <div style={{display:"flex",alignItems:"center",gap:size==="small"?8:10}}><Logo size={size==="small"?26:size==="big"?44:32} color={color}/><div><div style={{fontSize:size==="small"?12:size==="big"?20:15,fontWeight:800,color,letterSpacing:0,lineHeight:1.15}}><span style={{fontWeight:800}}>ENSAMBLE</span>{size!=="small"&&<br/>}{size==="small"?" ":""}<span style={{fontWeight:400,opacity:.75}}>VILLARREAL</span></div>{sub&&<div style={{fontSize:size==="big"?10:8,color:T.dim,textTransform:"uppercase",letterSpacing:size==="big"?2.5:1,marginTop:1}}>{sub}</div>}</div></div>;

// ─── ROLES ───────────────────────────────────────────────────
const ROLES={
  admin:{nombre:"Administrador",icon:"👑",color:T.gold,permisos:["dash","cot","obras","money","inv","caja","cont","clis","provs","cal","anal","auth","recibos","usuarios","docs","extras"]},
  finanzas:{nombre:"Finanzas",icon:"💰",color:T.green,permisos:["money","caja","recibos","anal"]},
  ventas:{nombre:"Ventas",icon:"📝",color:T.blue,permisos:["cot","clis","obras_ver","docs"]},
  taller:{nombre:"Taller",icon:"🔨",color:T.orange,permisos:["obras_ver","caja","inv"]},
  supervisor:{nombre:"Supervisor",icon:"👁",color:T.purple,permisos:["dash","obras","money","caja","provs","anal","auth","docs"]},
  cliente:{nombre:"Portal Cliente",icon:"🏠",color:T.teal,permisos:["portal"]},
};

const USERS=[
  {id:1,nombre:"Miguel Villarreal",user:"miguel",rol:"admin",avatar:"MV",tel:"4491814651"},
  {id:2,nombre:"Jessica Admin",user:"jessica",rol:"finanzas",avatar:"JA",tel:""},
  {id:3,nombre:"Carlos Ventas",user:"carlos",rol:"ventas",avatar:"CV",tel:""},
  {id:4,nombre:"Francisco Taller",user:"francisco",rol:"taller",avatar:"FT",tel:""},
  {id:5,nombre:"Luis Supervisor",user:"luis",rol:"supervisor",avatar:"LS",tel:""},
  {id:6,nombre:"Laura Vega",user:"laura",rol:"cliente",avatar:"LV",proyectoId:"OB03"},
  {id:7,nombre:"Fernando Cavalia",user:"fernando",rol:"cliente",avatar:"FC",proyectoId:"OB04"},
];

// ─── OBRAS ───────────────────────────────────────────────────
const OBRAS_INIT=[
  {id:"OB01",nombre:"San Rafael",cliente:"Cliente San Rafael",clienteId:"C01",status:"completado",cotizado:732027,egreso:1056387.71,inicio:"2024-04-01",entrega:"2025-03-15",fase:"entregado",avance:100,
    extras:[],pagos:[{id:1,fecha:"2024-04-10",concepto:"Anticipo",monto:366013,recibo:"R-001"},{id:2,fecha:"2024-09-15",concepto:"Parcialidad 2",monto:366014,recibo:"R-002"}],
    docs:[{id:1,nombre:"Plano general",tipo:"plano",ext:"PDF",fecha:"2024-04-01",size:"2.4 MB"}],
    bitacora:[{id:1,fecha:"2024-04-05",nota:"Inicio de obra - trazo y corte",user:"Miguel"},{id:2,fecha:"2024-08-20",nota:"Instalación completa cocina",user:"Francisco"}]},
  {id:"OB02",nombre:"Campestre Norte",cliente:"Cliente Campestre",clienteId:"C02",status:"completado",cotizado:1290000,egreso:1430444.08,inicio:"2024-05-01",entrega:"2025-06-30",fase:"entregado",avance:100,extras:[],pagos:[],docs:[],bitacora:[]},
  {id:"OB03",nombre:"Casa Tierra Verde",cliente:"Laura Vega",clienteId:"C03",status:"en_proceso",cotizado:688700,egreso:422061,inicio:"2024-08-01",entrega:"2025-12-30",fase:"instalacion",avance:72,
    extras:[
      {id:1,desc:"Nicho iluminado sala",monto:18500,status:"aprobado",fecha:"2025-09-15"},
      {id:2,desc:"Herrajes soft-close",monto:8200,status:"aprobado",fecha:"2025-10-03"},
      {id:3,desc:"Mueble TV recámara 2",monto:22900,status:"pendiente",fecha:"2026-02-10"},
    ],
    pagos:[
      {id:1,fecha:"2024-08-05",concepto:"Anticipo 50%",monto:344350,recibo:"R-TV01"},
      {id:2,fecha:"2025-03-10",concepto:"Parcialidad 2",monto:172175,recibo:"R-TV02"},
      {id:3,fecha:"2026-02-10",concepto:"Parcialidad 3",monto:180000,recibo:"R-TV03"},
    ],
    docs:[
      {id:1,nombre:"Plano planta baja",tipo:"plano",ext:"PDF",fecha:"2024-07-20",size:"2.4 MB"},
      {id:2,nombre:"Plano planta alta",tipo:"plano",ext:"PDF",fecha:"2024-07-20",size:"2.1 MB"},
      {id:3,nombre:"Render cocina",tipo:"render",ext:"JPG",fecha:"2024-08-01",size:"4.8 MB"},
      {id:4,nombre:"Render sala",tipo:"render",ext:"JPG",fecha:"2024-08-01",size:"5.2 MB"},
      {id:5,nombre:"Render vestidor",tipo:"render",ext:"JPG",fecha:"2024-08-05",size:"3.9 MB"},
      {id:6,nombre:"Cotización firmada",tipo:"contrato",ext:"PDF",fecha:"2024-08-01",size:"890 KB"},
      {id:7,nombre:"Contrato de obra",tipo:"contrato",ext:"PDF",fecha:"2024-08-03",size:"1.2 MB"},
      {id:8,nombre:"Avance cocina 80%",tipo:"avance",ext:"JPG",fecha:"2025-11-20",size:"3.1 MB"},
    ],
    bitacora:[
      {id:1,fecha:"2024-08-10",nota:"Inicio corte tableros cocina y closets",user:"Francisco"},
      {id:2,fecha:"2025-06-15",nota:"Instalación módulos cocina completa",user:"Francisco"},
      {id:3,fecha:"2025-11-20",nota:"Closet principal terminado, falta vestidor",user:"Miguel"},
    ]},
  {id:"OB04",nombre:"Cavalia",cliente:"Fernando Cavalia",clienteId:"C04",status:"en_proceso",cotizado:293700,egreso:9885,inicio:"2025-06-01",entrega:"2026-03-30",fase:"produccion",avance:25,
    extras:[{id:1,desc:"Lambrín vestíbulo",monto:28500,status:"aprobado",fecha:"2025-07-20"}],
    pagos:[{id:1,fecha:"2026-02-18",concepto:"Anticipo 40%",monto:117480,recibo:"R-CAV01"}],
    docs:[{id:1,nombre:"Plano general",tipo:"plano",ext:"PDF",fecha:"2025-05-15",size:"3.2 MB"},{id:2,nombre:"Render lambrín",tipo:"render",ext:"JPG",fecha:"2025-06-01",size:"4.1 MB"}],
    bitacora:[{id:1,fecha:"2025-06-05",nota:"Inicio producción - corte lambrín",user:"Francisco"}]},
  {id:"OB05",nombre:"Colegio GIS",cliente:"Ana Martínez",clienteId:"C05",status:"cotizado",cotizado:372350,egreso:0,fase:"cotizacion",avance:0,extras:[],pagos:[],docs:[],bitacora:[]},
  {id:"OB06",nombre:"Casa Eden",cliente:"Cliente Eden",clienteId:"C06",status:"en_proceso",cotizado:180000,egreso:18112.29,inicio:"2025-09-01",entrega:"2026-04-30",fase:"produccion",avance:35,extras:[],pagos:[],docs:[],bitacora:[]},
  {id:"OB07",nombre:"Casa Fontana",cliente:"Cliente Fontana",clienteId:"C07",status:"en_proceso",cotizado:120000,egreso:36806,inicio:"2025-10-01",entrega:"2026-05-30",fase:"instalacion",avance:55,extras:[],pagos:[],docs:[],bitacora:[]},
  {id:"OB08",nombre:"Jalpa Doctor",cliente:"Roberto Kumaru",clienteId:"C08",status:"en_proceso",cotizado:85000,egreso:14500,inicio:"2025-11-01",entrega:"2026-06-30",fase:"diseno",avance:15,extras:[],pagos:[],docs:[],bitacora:[]},
];

// ─── CLIENTES ────────────────────────────────────────────────
const CLIS_INIT=[
  {id:"C01",nombre:"Cliente San Rafael",tel:"449-000-0001",email:"",dir:"San Rafael, Ags",notas:"Proyecto completado",obras:1,totalCot:732027},
  {id:"C02",nombre:"Cliente Campestre",tel:"449-000-0002",email:"",dir:"Campestre Norte, Ags",notas:"",obras:1,totalCot:1290000},
  {id:"C03",nombre:"Laura Vega",tel:"449-555-1234",email:"laura@email.com",dir:"Tierra Verde 204, Ags",notas:"Excelente cliente, pago puntual",obras:1,totalCot:688700},
  {id:"C04",nombre:"Fernando Cavalia",tel:"449-555-5678",email:"fernando@cavalia.mx",dir:"Cavalia Residencial, Ags",notas:"Referido por Laura Vega",obras:1,totalCot:293700},
  {id:"C05",nombre:"Ana Martínez",tel:"449-555-9012",email:"ana@gis.edu.mx",dir:"Colegio GIS, Ags",notas:"Proyecto institucional",obras:1,totalCot:372350},
  {id:"C06",nombre:"Cliente Eden",tel:"449-000-0006",email:"",dir:"Fracc. Eden, Ags",notas:"",obras:1,totalCot:180000},
  {id:"C07",nombre:"Cliente Fontana",tel:"449-000-0007",email:"",dir:"Fracc. Fontana, Ags",notas:"",obras:1,totalCot:120000},
  {id:"C08",nombre:"Roberto Kumaru",tel:"449-555-3456",email:"roberto@email.com",dir:"Jalpa, Zac",notas:"Consultorio médico",obras:1,totalCot:85000},
];

// ─── PROVEEDORES ─────────────────────────────────────────────
const PROVS_INIT=[
  {id:"P01",nombre:"Carp. La Sierra",contacto:"Sr. Rivera",tel:"449-100-0001",material:"Mano de obra",credito:0,total:106332.70,calif:5,notas:"Confiable, buena calidad"},
  {id:"P02",nombre:"Maderería Los Bosques",contacto:"Ing. López",tel:"449-100-0002",material:"Madera, triplay",credito:30,total:85876,calif:4,notas:"Buenos precios en volumen"},
  {id:"P03",nombre:"Tlapantli",contacto:"Lic. García",tel:"449-100-0003",material:"Tableros MDF",credito:30,total:82817.98,calif:4,notas:"Entrega rápida"},
  {id:"P04",nombre:"Maderrajes",contacto:"Sra. Pérez",tel:"449-100-0004",material:"Herrajes",credito:15,total:45960,calif:5,notas:"Herrajes europeos"},
  {id:"P05",nombre:"Carpimex",contacto:"Carlos M.",tel:"449-100-0005",material:"Carpintería",credito:15,total:21820,calif:3,notas:""},
  {id:"P06",nombre:"Ferretería Varias",contacto:"",tel:"",material:"Ferretería gral",credito:0,total:59935.73,calif:3,notas:""},
  {id:"P07",nombre:"Kimura",contacto:"Kimura S.",tel:"449-100-0007",material:"Herrajes especiales",credito:15,total:12679.74,calif:4,notas:"Soft-close premium"},
  {id:"P08",nombre:"Vitrohogar",contacto:"",tel:"449-100-0008",material:"Vidrios",credito:30,total:1875,calif:4,notas:""},
];

// ─── INVENTARIO ──────────────────────────────────────────────
const INV_INIT=[
  {id:"I01",nombre:"Triplay 18mm",cat:"Madera",unidad:"Hoja",stock:24,minimo:10,precio:890,prov:"Maderería Los Bosques"},
  {id:"I02",nombre:"MDF 15mm blanco",cat:"Tableros",unidad:"Hoja",stock:18,minimo:8,precio:720,prov:"Tlapantli"},
  {id:"I03",nombre:"MDF 15mm maple",cat:"Tableros",unidad:"Hoja",stock:6,minimo:8,precio:780,prov:"Tlapantli"},
  {id:"I04",nombre:"Bisagra soft-close",cat:"Herrajes",unidad:"Par",stock:45,minimo:20,precio:185,prov:"Maderrajes"},
  {id:"I05",nombre:"Corredera telescópica 45cm",cat:"Herrajes",unidad:"Par",stock:30,minimo:15,precio:220,prov:"Maderrajes"},
  {id:"I06",nombre:"Jaladera acero 128mm",cat:"Herrajes",unidad:"Pza",stock:52,minimo:20,precio:95,prov:"Kimura"},
  {id:"I07",nombre:"Tornillo 2\"",cat:"Ferretería",unidad:"Caja",stock:8,minimo:5,precio:120,prov:"Ferretería Varias"},
  {id:"I08",nombre:"Pegamento blanco 19L",cat:"Adhesivos",unidad:"Cubeta",stock:3,minimo:2,precio:650,prov:"Ferretería Varias"},
  {id:"I09",nombre:"Lija 220",cat:"Abrasivos",unidad:"Pza",stock:40,minimo:30,precio:18,prov:"Ferretería Varias"},
  {id:"I10",nombre:"Barniz mate 4L",cat:"Acabados",unidad:"Galón",stock:5,minimo:3,precio:480,prov:"Ferretería Varias"},
  {id:"I11",nombre:"Melamina blanca 16mm",cat:"Tableros",unidad:"Hoja",stock:12,minimo:6,precio:620,prov:"Tlapantli"},
  {id:"I12",nombre:"Riel cajón push-open",cat:"Herrajes",unidad:"Par",stock:8,minimo:10,precio:350,prov:"Kimura"},
  {id:"I13",nombre:"Vidrio templado 6mm",cat:"Vidrios",unidad:"m²",stock:4,minimo:2,precio:450,prov:"Vitrohogar"},
  {id:"I14",nombre:"Chapa madera roble",cat:"Madera",unidad:"Hoja",stock:10,minimo:5,precio:380,prov:"Maderería Los Bosques"},
];

// ─── CONTRATOS ───────────────────────────────────────────────
const CONT_INIT=[
  {id:"CT01",obra:"Casa Tierra Verde",cliente:"Laura Vega",monto:688700,anticipo:50,fecha:"2024-08-03",status:"vigente",pagos:3,entrega:"2025-12-30",clausulas:"Incluye materiales y mano de obra. No incluye estufa, tarja ni granito. Garantía 2 años."},
  {id:"CT02",obra:"Cavalia",cliente:"Fernando Cavalia",monto:293700,anticipo:40,fecha:"2025-06-01",status:"vigente",pagos:3,entrega:"2026-03-30",clausulas:"Incluye lambrín decorativo. Materiales premium. Garantía 2 años."},
  {id:"CT03",obra:"San Rafael",cliente:"Cliente San Rafael",monto:732027,anticipo:50,fecha:"2024-04-01",status:"completado",pagos:2,entrega:"2025-03-15",clausulas:"Proyecto completo residencial."},
  {id:"CT04",obra:"Casa Eden",cliente:"Cliente Eden",monto:180000,anticipo:40,fecha:"2025-09-01",status:"vigente",pagos:3,entrega:"2026-04-30",clausulas:"Cocina y closets. Materiales estándar plus."},
];

const MOVS_INIT=[
  {id:1,fecha:"2024-04-05",prov:"Carpintería AV",desc:"Préstamo capital",ing:150000,egr:0,obra:"Carpintería AV",cat:"Capital",pago:"EFECTIVO",user:"Miguel",recibo:"R-001"},
  {id:2,fecha:"2024-05-03",prov:"Tlapantli",desc:"Tableros MDF",ing:0,egr:28500,obra:"San Rafael",cat:"Material",pago:"TRANSFERENCIA",user:"Miguel"},
  {id:3,fecha:"2024-06-07",prov:"Carp. La Sierra",desc:"Mano obra cocina",ing:0,egr:35000,obra:"Campestre Norte",cat:"Mano Obra",pago:"EFECTIVO",user:"Miguel"},
  {id:4,fecha:"2025-12-29",prov:"Carpimex",desc:"Carpintería Cavalia",ing:0,egr:9885,obra:"Cavalia",cat:"Subcontrato",pago:"TRANSFERENCIA",user:"Jessica"},
  {id:5,fecha:"2026-01-16",prov:"Carpintería AV",desc:"Sueldos enero",ing:0,egr:18000,obra:"General",cat:"Nómina",pago:"EFECTIVO",user:"Jessica"},
  {id:6,fecha:"2026-02-10",prov:"Laura Vega",desc:"Parcialidad 3",ing:180000,egr:0,obra:"Casa Tierra Verde",cat:"Pago Cliente",pago:"TRANSFERENCIA",user:"Jessica",recibo:"R-TV03"},
  {id:7,fecha:"2026-02-18",prov:"Fernando Cavalia",desc:"Anticipo 40%",ing:117480,egr:0,obra:"Cavalia",cat:"Pago Cliente",pago:"TRANSFERENCIA",user:"Jessica",recibo:"R-CAV01"},
  {id:8,fecha:"2026-02-20",prov:"Maderería Los Bosques",desc:"Triplay y madera roble",ing:0,egr:24500,obra:"Cavalia",cat:"Material",pago:"CRÉDITO 30D",user:"Miguel"},
];

const CAJA_INIT=[
  {id:1,fecha:"2026-01-06",concepto:"Tornillos y clavos",monto:450,resp:"Taller",obra:"General"},
  {id:2,fecha:"2026-01-08",concepto:"Gasolina camioneta",monto:800,resp:"Miguel",obra:"General"},
  {id:3,fecha:"2026-01-10",concepto:"Comida instalación",monto:650,resp:"Miguel",obra:"Cavalia"},
  {id:4,fecha:"2026-01-13",concepto:"Lijas y abrasivos",monto:320,resp:"Taller",obra:"Tierra Verde"},
  {id:5,fecha:"2026-02-03",concepto:"Estopa y sellador",monto:305,resp:"Taller",obra:"General"},
  {id:6,fecha:"2026-02-15",concepto:"Brochas y rodillos",monto:180,resp:"Taller",obra:"Fontana"},
];

const AUTS_INIT=[
  {id:1,tipo:"cotizacion",desc:"Cot #25 — Colegio GIS",monto:372350,sol:"Carlos Ventas",fecha:"2026-02-15",status:"pendiente",det:"33 partidas"},
  {id:2,tipo:"extra",desc:"Extra: Mueble TV — Tierra Verde",monto:22900,sol:"Carlos Ventas",fecha:"2026-02-10",status:"pendiente",det:"Solicitado por Laura Vega"},
];

const CATALOGO=[
  {id:"M-01",cat:"Muebles",desc:"Centro entretenimiento",precio:29800},{id:"M-02",cat:"Muebles",desc:"Mueble auxiliar sala",precio:21180},{id:"M-03",cat:"Muebles",desc:"Mesa de centro",precio:12500},{id:"M-05",cat:"Muebles",desc:"Isla de cocina",precio:30900},{id:"M-06",cat:"Muebles",desc:"Mueble bar",precio:11400},{id:"M-07",cat:"Muebles",desc:"Escritorio ejecutivo",precio:28800},{id:"M-10",cat:"Muebles",desc:"Cabecera king",precio:11860},{id:"M-12",cat:"Muebles",desc:"Vestidor walk-in",precio:24680},{id:"M-16",cat:"Muebles",desc:"Mueble terraza",precio:22900},
  {id:"LB01",cat:"Libreros",desc:"Librero piso a techo",precio:84200},{id:"LB02",cat:"Libreros",desc:"Librero empotrado",precio:18500},
  {id:"CL01",cat:"Closets",desc:"Closet principal 3m",precio:64200},{id:"CL02",cat:"Closets",desc:"Closet secundario",precio:41100},{id:"CL03",cat:"Closets",desc:"Closet infantil",precio:45200},
  {id:"MB03",cat:"Baño",desc:"Mueble baño doble",precio:7800},
  {id:"PT01",cat:"Puertas",desc:"Puerta principal maciza",precio:92000},{id:"PT02",cat:"Puertas",desc:"Puerta interior",precio:8800},
  {id:"ES01",cat:"Escaleras",desc:"Escalera c/herrería",precio:115500},
  {id:"CO01",cat:"Cocinas",desc:"Cocina integral 3m",precio:85000},{id:"CO02",cat:"Cocinas",desc:"Cocina integral 4m+",precio:115000},
];

// ─── HELPERS ─────────────────────────────────────────────────
const $=n=>n==null?"$0":"$"+Math.round(n).toLocaleString("es-MX");
const fd=d=>{if(!d)return"—";try{return new Date(d+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"2-digit"});}catch{return d;}};
const pc=(a,b)=>b?Math.round((a/b)*100):0;
const td=()=>new Date().toISOString().slice(0,10);
const cats=[...new Set(CATALOGO.map(c=>c.cat))];
const DOC_IC={plano:"📐",render:"🖼️",contrato:"📄",avance:"📸",otro:"📎"};
const FASES={cotizacion:"Cotización",diseno:"Diseño",produccion:"Producción",instalacion:"Instalación",entregado:"Entregado"};
const FASES_C={cotizacion:"#FFB74D",diseno:"#64B5F6",produccion:"#FF9800",instalacion:"#66BB6A",entregado:"#78909C"};

// ─── UI COMPONENTS ───────────────────────────────────────────
const Badge=({s,label})=>{const m={cotizado:["Cotizado","#332200","#FFB74D"],en_proceso:["En Proceso","#0a2e0a","#66BB6A"],completado:["Completado","#0a1a33","#64B5F6"],pendiente:["Pendiente","#332b00","#FFD54F"],aprobado:["Aprobado","#0a2e0a","#66BB6A"],aprobada:["Aprobada","#0a2e0a","#66BB6A"],rechazada:["Rechazada","#330a0a","#ef5350"],vigente:["Vigente","#0a2e0a","#66BB6A"],bajo:["Stock Bajo","#330a0a","#ef5350"],ok:["OK","#0a2e0a","#66BB6A"]};const[l,bg,c]=m[s]||[label||s,"#222","#999"];return <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,background:bg,color:c,whiteSpace:"nowrap"}}>{l}</span>;};
const Bar=({v,mx,c=T.gold,h=5})=><div style={{background:"#222",borderRadius:3,height:h,width:"100%"}}><div style={{width:`${Math.min(100,pc(v,mx||1))}%`,height:"100%",background:c,borderRadius:3,transition:"width .3s"}}/></div>;
const Card=({children,style})=><div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:14,marginBottom:8,...style}}>{children}</div>;
const Stat=({label,value,color,small})=><div><div style={{fontSize:small?8:9,color:T.muted,textTransform:"uppercase",letterSpacing:.5}}>{label}</div><div style={{fontSize:small?14:18,fontWeight:800,color:color||T.text}}>{value}</div></div>;
const sI={width:"100%",padding:"11px 12px",borderRadius:8,border:`1px solid ${T.border}`,background:"#1a1a1a",color:"#ddd",fontSize:14,outline:"none",boxSizing:"border-box"};
const sB={padding:"13px",borderRadius:10,border:"none",background:T.gold,color:"#111",fontWeight:800,fontSize:14,cursor:"pointer",width:"100%",marginTop:8};

function ModalW({title,onClose,children}){return <div style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center",background:"rgba(0,0,0,.7)"}} onClick={onClose}><div onClick={e=>e.stopPropagation()} style={{background:"#151515",borderRadius:"14px 14px 0 0",width:"100%",maxWidth:600,maxHeight:"88vh",overflow:"auto",paddingBottom:24}}><div style={{width:36,height:4,background:"#444",borderRadius:2,margin:"8px auto 0"}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px 6px"}}><span style={{fontWeight:700,color:T.gold,fontSize:15}}>{title}</span><button onClick={onClose} style={{background:"#222",border:"none",color:"#888",cursor:"pointer",fontSize:14,borderRadius:20,width:28,height:28}}>✕</button></div><div style={{padding:"4px 16px 0"}}>{children}</div></div></div>;}
function Fl({l,children}){return <div style={{marginBottom:10}}><label style={{display:"block",fontSize:10,color:T.muted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{l}</label>{children}</div>;}

// ─── FORMS (stable, outside App) ─────────────────────────────
function ReciboView({data}){return <div style={{background:"#fefcf9",color:"#222",borderRadius:8,padding:20,fontFamily:"Georgia,serif"}}>
  <div style={{display:"flex",justifyContent:"space-between",borderBottom:"3px solid #1B5E20",paddingBottom:12,marginBottom:14}}><div><div style={{fontSize:16,fontWeight:800,color:"#1B5E20",letterSpacing:.5}}>ENSAMBLE VILLARREAL</div><div style={{fontSize:9,color:"#888"}}>CARPINTERÍA ARQUITECTÓNICA</div><div style={{fontSize:9,color:"#bbb"}}>Circuito Los Sauces 136, Ags · 449 181 4651</div><div style={{fontSize:8,color:"#ccc",fontStyle:"italic"}}>Donde la madera encuentra su forma</div></div><div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:700,color:"#1B5E20"}}>RECIBO</div><div style={{fontSize:16,fontWeight:800,color:"#1B5E20"}}>{data.recibo||data.id}</div></div></div>
  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,marginBottom:14}}><div><span style={{color:"#999",fontSize:10}}>FECHA</span><div>{fd(data.fecha)}</div></div><div><span style={{color:"#999",fontSize:10}}>CLIENTE</span><div style={{fontWeight:600}}>{data.cliente||data.prov||"—"}</div></div><div><span style={{color:"#999",fontSize:10}}>CONCEPTO</span><div>{data.concepto||data.desc||"—"}</div></div><div><span style={{color:"#999",fontSize:10}}>OBRA</span><div>{data.obra||"—"}</div></div></div>
  <div style={{background:"#E8F5E9",borderRadius:8,padding:"14px 18px",textAlign:"center",marginBottom:14}}><div style={{fontSize:10,color:"#2E7D32",textTransform:"uppercase",letterSpacing:1}}>Monto Recibido</div><div style={{fontSize:28,fontWeight:800,color:"#1B5E20"}}>{$(data.monto||data.ing||0)}</div></div>
  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginTop:20,paddingTop:14,borderTop:"1px dashed #ccc"}}><div style={{textAlign:"center",borderTop:"1px solid #999",paddingTop:6,fontSize:10,color:"#999"}}>Firma cliente</div><div style={{textAlign:"center",borderTop:"1px solid #999",paddingTop:6,fontSize:10,color:"#999"}}>Firma Villarreal</div></div>
</div>;}

function ObraForm({onSave,clientes}){const[f,sf]=useState({nombre:"",cliente:"",cotizado:"",inicio:td(),entrega:"",fase:"cotizacion"});return <div><Fl l="Nombre proyecto"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><Fl l="Cliente"><select style={sI} value={f.cliente} onChange={e=>sf({...f,cliente:e.target.value})}><option value="">Seleccionar</option>{clientes.map(c=><option key={c.id} value={c.nombre}>{c.nombre}</option>)}</select></Fl><Fl l="Monto cotizado"><input type="number" style={sI} value={f.cotizado} onChange={e=>sf({...f,cotizado:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Inicio"><input type="date" style={sI} value={f.inicio} onChange={e=>sf({...f,inicio:e.target.value})}/></Fl><Fl l="Entrega"><input type="date" style={sI} value={f.entrega} onChange={e=>sf({...f,entrega:e.target.value})}/></Fl></div><button style={sB} onClick={()=>f.nombre&&onSave({...f,cotizado:Number(f.cotizado)||0,status:"cotizado",avance:0})}>Guardar Proyecto</button></div>;}

function IngForm({obras,onSave}){const[f,sf]=useState({fecha:td(),prov:"",desc:"",ing:"",obra:"",pago:"TRANSFERENCIA"});return <div><Fl l="Fecha"><input type="date" style={sI} value={f.fecha} onChange={e=>sf({...f,fecha:e.target.value})}/></Fl><Fl l="Recibido de"><input style={sI} value={f.prov} onChange={e=>sf({...f,prov:e.target.value})} placeholder="Nombre del cliente"/></Fl><Fl l="Concepto"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})} placeholder="Anticipo, parcialidad..."/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.ing} onChange={e=>sf({...f,ing:e.target.value})}/></Fl><Fl l="Obra"><select style={sI} value={f.obra} onChange={e=>sf({...f,obra:e.target.value})}><option value="">Seleccionar</option>{obras.map(o=><option key={o.id} value={o.nombre}>{o.nombre}</option>)}</select></Fl><Fl l="Pago"><select style={sI} value={f.pago} onChange={e=>sf({...f,pago:e.target.value})}>{["TRANSFERENCIA","EFECTIVO","CHEQUE","TARJETA"].map(p=><option key={p}>{p}</option>)}</select></Fl><button style={{...sB,background:T.green}} onClick={()=>{const m=Number(f.ing);if(f.desc&&m>0)onSave({...f,ing:m,egr:0,cat:"Pago Cliente"});}}>💰 Registrar + Generar Recibo</button></div>;}

function EgrForm({obras,provs,onSave}){const[f,sf]=useState({fecha:td(),prov:"",desc:"",egr:"",obra:"",cat:"Material",pago:"EFECTIVO"});return <div><Fl l="Fecha"><input type="date" style={sI} value={f.fecha} onChange={e=>sf({...f,fecha:e.target.value})}/></Fl><Fl l="Proveedor"><select style={sI} value={f.prov} onChange={e=>sf({...f,prov:e.target.value})}><option value="">Seleccionar</option>{provs.map(p=><option key={p.id} value={p.nombre}>{p.nombre}</option>)}</select></Fl><Fl l="Descripción"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.egr} onChange={e=>sf({...f,egr:e.target.value})}/></Fl><Fl l="Categoría"><select style={sI} value={f.cat} onChange={e=>sf({...f,cat:e.target.value})}>{["Material","Herrajes","Mano Obra","Subcontrato","Nómina","Servicios","Otro"].map(c=><option key={c}>{c}</option>)}</select></Fl><Fl l="Obra"><select style={sI} value={f.obra} onChange={e=>sf({...f,obra:e.target.value})}><option value="">General</option>{obras.map(o=><option key={o.id} value={o.nombre}>{o.nombre}</option>)}</select></Fl><button style={{...sB,background:T.red,color:"#fff"}} onClick={()=>{const m=Number(f.egr);if(f.desc&&m>0)onSave({...f,egr:m,ing:0});}}>Registrar Egreso</button></div>;}

function CajaForm({onSave}){const[f,sf]=useState({fecha:td(),concepto:"",monto:"",resp:"Taller",obra:"General"});return <div><Fl l="Concepto"><input style={sI} value={f.concepto} onChange={e=>sf({...f,concepto:e.target.value})}/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.monto} onChange={e=>sf({...f,monto:e.target.value})}/></Fl><Fl l="Responsable"><select style={sI} value={f.resp} onChange={e=>sf({...f,resp:e.target.value})}>{["Miguel","Taller","Francisco","Luis"].map(r=><option key={r}>{r}</option>)}</select></Fl><Fl l="Obra"><input style={sI} value={f.obra} onChange={e=>sf({...f,obra:e.target.value})}/></Fl><button style={sB} onClick={()=>{if(f.concepto&&Number(f.monto)>0)onSave({...f,monto:Number(f.monto)});}}>Guardar</button></div>;}

function DocForm({onSave}){const[f,sf]=useState({nombre:"",tipo:"plano",ext:"PDF"});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})} placeholder="Ej: Plano cocina"/></Fl><Fl l="Tipo"><select style={sI} value={f.tipo} onChange={e=>sf({...f,tipo:e.target.value})}><option value="plano">📐 Plano</option><option value="render">🖼️ Render</option><option value="contrato">📄 Contrato</option><option value="avance">📸 Avance</option><option value="otro">📎 Otro</option></select></Fl><Fl l="Formato"><select style={sI} value={f.ext} onChange={e=>sf({...f,ext:e.target.value})}>{["PDF","JPG","PNG","DWG","SKP","XLSX"].map(x=><option key={x}>{x}</option>)}</select></Fl><button style={sB} onClick={()=>f.nombre&&onSave(f)}>📤 Subir</button></div>;}

function ExtraForm({onSave}){const[f,sf]=useState({desc:"",monto:""});return <div><Fl l="Descripción"><input style={sI} value={f.desc} onChange={e=>sf({...f,desc:e.target.value})} placeholder="Ej: Nicho iluminado"/></Fl><Fl l="Monto"><input type="number" style={sI} value={f.monto} onChange={e=>sf({...f,monto:e.target.value})}/></Fl><button style={{...sB,background:T.orange}} onClick={()=>{const m=Number(f.monto);if(f.desc&&m>0)onSave({desc:f.desc,monto:m});}}>Enviar</button></div>;}

function ClienteForm({onSave}){const[f,sf]=useState({nombre:"",tel:"",email:"",dir:"",notas:""});return <div><Fl l="Nombre"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Teléfono"><input style={sI} value={f.tel} onChange={e=>sf({...f,tel:e.target.value})}/></Fl><Fl l="Email"><input style={sI} value={f.email} onChange={e=>sf({...f,email:e.target.value})}/></Fl></div><Fl l="Dirección"><input style={sI} value={f.dir} onChange={e=>sf({...f,dir:e.target.value})}/></Fl><Fl l="Notas"><input style={sI} value={f.notas} onChange={e=>sf({...f,notas:e.target.value})}/></Fl><button style={sB} onClick={()=>f.nombre&&onSave(f)}>Guardar Cliente</button></div>;}

function BitacoraForm({onSave}){const[nota,setNota]=useState("");return <div><Fl l="Nota de bitácora"><textarea style={{...sI,minHeight:60,resize:"vertical"}} value={nota} onChange={e=>setNota(e.target.value)} placeholder="Avance, observación, incidencia..."/></Fl><button style={sB} onClick={()=>{if(nota.trim())onSave(nota);setNota("");}}>Agregar Entrada</button></div>;}

function InvForm({onSave}){const[f,sf]=useState({nombre:"",cat:"Madera",unidad:"Hoja",stock:"",minimo:"",precio:"",prov:""});return <div><Fl l="Material"><input style={sI} value={f.nombre} onChange={e=>sf({...f,nombre:e.target.value})}/></Fl><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Fl l="Categoría"><select style={sI} value={f.cat} onChange={e=>sf({...f,cat:e.target.value})}>{["Madera","Tableros","Herrajes","Ferretería","Adhesivos","Abrasivos","Acabados","Vidrios","Otro"].map(c=><option key={c}>{c}</option>)}</select></Fl><Fl l="Unidad"><select style={sI} value={f.unidad} onChange={e=>sf({...f,unidad:e.target.value})}>{["Hoja","Par","Pza","Caja","Cubeta","Galón","m²","Rollo","Kg"].map(u=><option key={u}>{u}</option>)}</select></Fl></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}><Fl l="Stock"><input type="number" style={sI} value={f.stock} onChange={e=>sf({...f,stock:e.target.value})}/></Fl><Fl l="Mínimo"><input type="number" style={sI} value={f.minimo} onChange={e=>sf({...f,minimo:e.target.value})}/></Fl><Fl l="Precio unit."><input type="number" style={sI} value={f.precio} onChange={e=>sf({...f,precio:e.target.value})}/></Fl></div><button style={sB} onClick={()=>{if(f.nombre)onSave({...f,stock:Number(f.stock)||0,minimo:Number(f.minimo)||0,precio:Number(f.precio)||0});}}>Guardar Material</button></div>;}

// ═══════════════════════════════════════════════════════════
export default function App(){
  const[user,setUser]=useState(null);
  const[sec,setSec]=useState("dash");
  const[sub,setSub]=useState(null);
  const[modal,setModal]=useState(null);
  const[md,setMd]=useState(null);
  const[moreOpen,setMoreOpen]=useState(false);

  // ─── PERSISTENT STATE (localStorage) ───
  const LS={
    get:(k,def)=>{try{const v=localStorage.getItem("ev_"+k);return v?JSON.parse(v):def;}catch{return def;}},
    set:(k,v)=>{try{localStorage.setItem("ev_"+k,JSON.stringify(v));}catch{}}
  };
  const[obras,setObrasRaw]=useState(()=>LS.get("obras",OBRAS_INIT));
  const[movs,setMovsRaw]=useState(()=>LS.get("movs",MOVS_INIT));
  const[caja,setCajaRaw]=useState(()=>LS.get("caja",CAJA_INIT));
  const[auts,setAutsRaw]=useState(()=>LS.get("auts",AUTS_INIT));
  const[recibos,setRecibosRaw]=useState(()=>LS.get("recibos",[]));
  const[inv,setInvRaw]=useState(()=>LS.get("inv",INV_INIT));
  const[clis,setClisRaw]=useState(()=>LS.get("clis",CLIS_INIT));
  const[cont,setContRaw]=useState(()=>LS.get("cont",CONT_INIT));
  const[provs,setProvsRaw]=useState(()=>LS.get("provs",PROVS_INIT));
  // Auto-save wrappers
  const setObras=v=>{const nv=typeof v==="function"?v(obras):v;setObrasRaw(nv);LS.set("obras",nv);};
  const setMovs=v=>{const nv=typeof v==="function"?v(movs):v;setMovsRaw(nv);LS.set("movs",nv);};
  const setCaja=v=>{const nv=typeof v==="function"?v(caja):v;setCajaRaw(nv);LS.set("caja",nv);};
  const setAuts=v=>{const nv=typeof v==="function"?v(auts):v;setAutsRaw(nv);LS.set("auts",nv);};
  const setRecibos=v=>{const nv=typeof v==="function"?v(recibos):v;setRecibosRaw(nv);LS.set("recibos",nv);};
  const setInv=v=>{const nv=typeof v==="function"?v(inv):v;setInvRaw(nv);LS.set("inv",nv);};
  const setClis=v=>{const nv=typeof v==="function"?v(clis):v;setClisRaw(nv);LS.set("clis",nv);};
  const setCont=v=>{const nv=typeof v==="function"?v(cont):v;setContRaw(nv);LS.set("cont",nv);};
  const setProvs=v=>{const nv=typeof v==="function"?v(provs):v;setProvsRaw(nv);LS.set("provs",nv);};

  const[toast,setToast]=useState(null);
  const[cliTab,setCliTab]=useState("resumen");
  const[cotP,setCotP]=useState([]);
  const[cotNom,setCotNom]=useState("");
  const[cotEmp,setCotEmp]=useState("");
  const[cotNum,setCotNum]=useState(26);
  const[searchQ,setSearchQ]=useState("");

  const show=msg=>{setToast(msg);setTimeout(()=>setToast(null),2500);};
  const can=p=>user&&ROLES[user.rol].permisos.includes(p);
  const om=(type,data)=>{setModal(type);setMd(data||null);};
  const cm=()=>{setModal(null);setMd(null);};
  const go=(s,d)=>{setSec(s);setSub(d||null);setMoreOpen(false);};

  // ─── COMPUTED ──────────────────────────────────────────
  const tIng=movs.filter(m=>m.ing>0).reduce((s,m)=>s+m.ing,0);
  const tEgr=movs.filter(m=>m.egr>0).reduce((s,m)=>s+m.egr,0);
  const tCaja=caja.reduce((s,c)=>s+c.monto,0);
  const tCot=obras.reduce((s,o)=>s+o.cotizado,0);
  const tEgrO=obras.reduce((s,o)=>s+o.egreso,0);
  const pendAuth=auts.filter(a=>a.status==="pendiente").length;
  const lowStock=inv.filter(i=>i.stock<=i.minimo);
  const obrasActivas=obras.filter(o=>o.status==="en_proceso");
  const subCot=cotP.reduce((s,p)=>s+p.precio*p.cant,0);
  const ivCot=subCot*0.16;
  const totCot=subCot+ivCot;
  const addCotP=item=>{const ex=cotP.find(p=>p.id===item.id);if(ex)setCotP(cotP.map(p=>p.id===item.id?{...p,cant:p.cant+1}:p));else setCotP([...cotP,{...item,cant:1}]);};
  const genRecibo=m=>{const id=`R-${String(recibos.length+100).padStart(3,"0")}`;const r={id,fecha:m.fecha,cliente:m.prov,concepto:m.desc,monto:m.ing,obra:m.obra,pago:m.pago,generadoPor:user?.nombre};setRecibos(prev=>[...prev,r]);return id;};

  // ─── MONTHLY DATA FOR CHARTS ───────────────────────────
  const months=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const monthlyIng=months.map((_,i)=>movs.filter(m=>m.ing>0&&new Date(m.fecha+"T12:00:00").getMonth()===i).reduce((s,m)=>s+m.ing,0));
  const monthlyEgr=months.map((_,i)=>movs.filter(m=>m.egr>0&&new Date(m.fecha+"T12:00:00").getMonth()===i).reduce((s,m)=>s+m.egr,0));

  // ═══ LOGIN ═══════════════════════════════════════════════
  if(!user)return(
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:28,display:"flex",flexDirection:"column",alignItems:"center"}}><BrandFull size="big" sub="Carpintería Arquitectónica"/><div style={{fontSize:9,color:T.dim,marginTop:8,fontStyle:"italic",letterSpacing:1}}>— Donde la madera encuentra su forma —</div></div>
        <div style={{fontSize:11,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Equipo</div>
        {USERS.filter(u=>u.rol!=="cliente").map(u=>
          <button key={u.id} onClick={()=>{setUser(u);setSec(ROLES[u.rol].permisos[0]);setCliTab("resumen");setSub(null);}} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:T.card,border:`1px solid ${T.border}`,borderRadius:10,marginBottom:6,cursor:"pointer",textAlign:"left"}}>
            <div style={{width:40,height:40,borderRadius:20,background:ROLES[u.rol].color+"22",color:ROLES[u.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,flexShrink:0}}>{u.avatar}</div>
            <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:T.text}}>{u.nombre}</div><div style={{fontSize:10,color:T.muted}}>{ROLES[u.rol].icon} {ROLES[u.rol].nombre}</div></div>
            <span style={{color:T.dim,fontSize:18}}>›</span>
          </button>
        )}
        <div style={{fontSize:11,color:T.teal,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8,marginTop:18,paddingTop:14,borderTop:`1px solid ${T.border}`}}>🏠 Portal Clientes</div>
        {USERS.filter(u=>u.rol==="cliente").map(u=>{
          const ob=OBRAS_INIT.find(o=>o.id===u.proyectoId);
          return <button key={u.id} onClick={()=>{setUser(u);setSec("portal");setCliTab("resumen");}} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:"#0a1a1a",border:"1px solid #1a3a3a",borderRadius:10,marginBottom:6,cursor:"pointer",textAlign:"left"}}>
            <div style={{width:40,height:40,borderRadius:20,background:T.teal+"22",color:T.teal,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,flexShrink:0}}>{u.avatar}</div>
            <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:T.text}}>{u.nombre}</div><div style={{fontSize:10,color:T.teal}}>{ob?.nombre||"Proyecto"}</div></div>
            <span style={{color:T.dim,fontSize:18}}>›</span>
          </button>;
        })}
      </div>
    </div>
  );

  const role=ROLES[user.rol];

  // ═══ CLIENT PORTAL ═══════════════════════════════════════
  if(user.rol==="cliente"){
    const ob=obras.find(o=>o.id===user.proyectoId);
    if(!ob)return <div style={{padding:40,textAlign:"center",color:T.muted}}>Proyecto no encontrado</div>;
    const extras=ob.extras||[];const pagos=ob.pagos||[];const docs=ob.docs||[];const bita=ob.bitacora||[];
    const totalExtras=extras.filter(e=>e.status==="aprobado").reduce((s,e)=>s+e.monto,0);
    const totalConExtras=ob.cotizado+totalExtras;
    const totalPagado=pagos.reduce((s,p)=>s+p.monto,0);
    const porPagar=totalConExtras-totalPagado;
    const extrasPend=extras.filter(e=>e.status==="pendiente");

    return(
      <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:"#090f0d",color:T.text,minHeight:"100vh",display:"flex",flexDirection:"column",fontSize:13,maxWidth:600,margin:"0 auto"}}>
        <div style={{padding:"12px 16px",background:"#0f1a18",borderBottom:"1px solid #1a2e2a",display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><BrandFull size="small" color={T.teal} sub="Portal del Cliente"/></div><div onClick={()=>setUser(null)} style={{cursor:"pointer",display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:10,color:T.muted}}>{user.nombre.split(" ")[0]}</span><div style={{width:28,height:28,borderRadius:14,background:T.teal+"22",color:T.teal,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800}}>{user.avatar}</div></div></div>
        <div style={{padding:"14px 16px",background:"#0f1a18"}}><div style={{fontSize:20,fontWeight:800}}>{ob.nombre}</div><div style={{display:"flex",gap:8,alignItems:"center",marginTop:4}}><Badge s={ob.status}/><span style={{fontSize:11,color:T.teal}}>Entrega: {fd(ob.entrega)}</span><span style={{background:FASES_C[ob.fase]+"33",color:FASES_C[ob.fase],padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700}}>{FASES[ob.fase]}</span></div><div style={{marginTop:8}}><div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}><span style={{color:T.muted}}>Avance</span><span style={{fontWeight:700}}>{ob.avance}%</span></div><Bar v={ob.avance} mx={100} c={T.teal} h={6}/></div></div>

        <div style={{flex:1,padding:"8px 12px 80px",overflowY:"auto"}}>
          {cliTab==="resumen"&&<div>
            <Card><div style={{fontSize:10,color:T.teal,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Resumen Financiero</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><Stat label="Presupuesto" value={$(ob.cotizado)} color={T.gold}/><Stat label="Extras aprobados" value={$(totalExtras)} color={T.orange}/><Stat label="Total proyecto" value={$(totalConExtras)}/><Stat label="Pagado" value={$(totalPagado)} color={T.green}/></div><div style={{marginTop:10}}><Bar v={totalPagado} mx={totalConExtras} c={T.teal}/><div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginTop:4}}><span style={{color:T.muted}}>{pc(totalPagado,totalConExtras)}% pagado</span><span style={{color:porPagar>0?T.yellow:T.green,fontWeight:700}}>Por pagar: {$(porPagar)}</span></div></div></Card>
            {extrasPend.length>0&&<div style={{background:"#2a2000",border:"1px solid #FFD54F33",borderRadius:10,padding:"10px 14px",marginBottom:8}}><div style={{fontWeight:700,color:T.yellow,fontSize:12}}>⏳ {extrasPend.length} extra(s) pendiente(s)</div></div>}
            <Card><div style={{fontSize:10,color:T.teal,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Bitácora reciente</div>{bita.slice(-3).reverse().map(b=><div key={b.id} style={{padding:"6px 0",borderBottom:"1px solid #0a1a18",fontSize:12}}><div style={{fontWeight:600}}>{b.nota}</div><div style={{fontSize:10,color:T.muted}}>{fd(b.fecha)} · {b.user}</div></div>)}{bita.length===0&&<div style={{color:T.dim,fontSize:12,textAlign:"center",padding:8}}>Sin entradas</div>}</Card>
          </div>}
          {cliTab==="docs"&&<div><div style={{fontSize:10,color:T.teal,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Documentos ({docs.length})</div>{["plano","render","contrato","avance","otro"].filter(t=>docs.some(d=>d.tipo===t)).map(tipo=><div key={tipo} style={{marginBottom:14}}><div style={{fontSize:11,color:T.muted,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>{DOC_IC[tipo]} {tipo}</div>{docs.filter(d=>d.tipo===tipo).map(d=><Card key={d.id} style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:44,height:44,borderRadius:8,background:"#1a2e2a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{DOC_IC[d.tipo]}</div><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{d.nombre}</div><div style={{fontSize:10,color:T.dim}}>{d.ext} · {d.size} · {fd(d.fecha)}</div></div></Card>)}</div>)}</div>}
          {cliTab==="pagos"&&<div><Card><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}><Stat label="Total" value={$(totalConExtras)} small/><Stat label="Pagado" value={$(totalPagado)} color={T.green} small/><Stat label="Resta" value={$(porPagar)} color={porPagar>0?T.yellow:T.green} small/></div></Card>{pagos.map(p=><Card key={p.id} style={{cursor:"pointer"}}><div onClick={()=>om("reciboC",{...p,cliente:ob.cliente,obra:ob.nombre})} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontWeight:600,fontSize:13}}>{p.concepto}</div><div style={{fontSize:10,color:T.dim}}>{fd(p.fecha)} · {p.recibo}</div></div><div style={{textAlign:"right"}}><div style={{fontWeight:800,color:T.green,fontSize:15}}>{$(p.monto)}</div><div style={{fontSize:9,color:T.teal}}>Ver recibo →</div></div></div></Card>)}</div>}
          {cliTab==="extras"&&<div><Card><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}><Stat label="Aprobados" value={$(totalExtras)} color={T.orange}/><Stat label="Pendientes" value={$(extrasPend.reduce((s,e)=>s+e.monto,0))} color={T.yellow}/></div></Card>{extras.map(e=><Card key={e.id}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontWeight:700}}>{e.desc}</span><Badge s={e.status}/></div><div style={{display:"flex",justifyContent:"space-between",marginTop:4}}><span style={{fontSize:11,color:T.muted}}>{fd(e.fecha)}</span><span style={{fontWeight:800,color:T.orange}}>{$(e.monto)}</span></div></Card>)}<button style={{...sB,background:T.orange+"22",color:T.orange,border:`1px solid ${T.orange}44`}} onClick={()=>om("solExtra")}>➕ Solicitar Extra</button></div>}
        </div>

        {modal==="reciboC"&&md&&<ModalW title={"Recibo "+md.recibo} onClose={cm}><ReciboView data={md}/></ModalW>}
        {modal==="solExtra"&&<ModalW title="Solicitar Extra" onClose={cm}><ExtraForm onSave={e=>{const newOb={...ob,extras:[...(ob.extras||[]),{...e,id:(ob.extras?.length||0)+1,status:"pendiente",fecha:td()}]};setObras(obras.map(o=>o.id===ob.id?newOb:o));setAuts(prev=>[...prev,{id:prev.length+1,tipo:"extra",desc:`Extra: ${e.desc} — ${ob.nombre}`,monto:e.monto,sol:user.nombre,fecha:td(),status:"pendiente",det:"Solicitado por cliente"}]);cm();show("Extra enviado ✓");}}/></ModalW>}

        <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:300,background:"#0f1a18",borderTop:"1px solid #1a2e2a",display:"flex",justifyContent:"center"}}><div style={{display:"flex",maxWidth:600,width:"100%"}}>{[{k:"resumen",i:"📊",l:"Resumen"},{k:"docs",i:"📐",l:"Planos"},{k:"pagos",i:"💰",l:"Pagos"},{k:"extras",i:"➕",l:"Extras"}].map(t=><button key={t.k} onClick={()=>setCliTab(t.k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:cliTab===t.k?T.teal:T.dim}}><span style={{fontSize:18}}>{t.i}</span><span style={{fontSize:8,fontWeight:600}}>{t.l}</span></button>)}<button onClick={()=>setUser(null)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:T.red}}><span style={{fontSize:18}}>🚪</span><span style={{fontSize:8,fontWeight:600}}>Salir</span></button></div></div>
        {toast&&<div style={{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"#1a3a2a",color:T.green,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:700,zIndex:2000}}>{toast}</div>}
      </div>
    );
  }

  // ═══ TEAM CRM ════════════════════════════════════════════
  const bTabs=[];
  if(can("dash"))bTabs.push({key:"dash",icon:"📊",label:"Inicio"});
  if(can("cot"))bTabs.push({key:"cot",icon:"📝",label:"Cotizar"});
  if(can("obras")||can("obras_ver"))bTabs.push({key:"obras",icon:"🏗️",label:"Obras"});
  if(can("money"))bTabs.push({key:"money",icon:"💰",label:"Finanzas"});
  const mItems=[];
  if(can("inv"))mItems.push({key:"inv",icon:"📦",label:"Inventario"});
  if(can("caja"))mItems.push({key:"caja",icon:"🧾",label:"Caja Chica"});
  if(can("cont"))mItems.push({key:"cont",icon:"📄",label:"Contratos"});
  if(can("clis"))mItems.push({key:"clis",icon:"👤",label:"Clientes"});
  if(can("provs"))mItems.push({key:"provs",icon:"🚚",label:"Proveedores"});
  if(can("cal"))mItems.push({key:"cal",icon:"📅",label:"Calendario"});
  if(can("anal"))mItems.push({key:"anal",icon:"📈",label:"Análisis"});
  if(can("auth"))mItems.push({key:"auth",icon:"✅",label:`Autorizaciones${pendAuth>0?` (${pendAuth})`:""}`});
  if(can("recibos"))mItems.push({key:"recibos",icon:"🧾",label:"Recibos"});
  if(can("usuarios"))mItems.push({key:"usuarios",icon:"👥",label:"Usuarios"});
  const tabs=[...bTabs.slice(0,4),{key:"more",icon:"☰",label:"Más"}];

  // Mini chart helper
  const MiniChart=({data,color,h=40})=>{const mx=Math.max(...data,1);return <svg width="100%" height={h} viewBox={`0 0 ${data.length*20} ${h}`} style={{display:"block"}}>{data.map((v,i)=><rect key={i} x={i*20+2} y={h-((v/mx)*h)} width={16} height={(v/mx)*h||1} rx={2} fill={color} opacity={v>0?.8:.15}/>)}</svg>;};

  return(
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:T.bg,color:T.text,minHeight:"100vh",display:"flex",flexDirection:"column",fontSize:13,maxWidth:600,margin:"0 auto",position:"relative"}}>
      {/* HEADER */}
      <div style={{padding:"10px 16px",background:"#111",borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,zIndex:100,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><BrandFull size="small" color={T.gold}/></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {pendAuth>0&&can("auth")&&<div onClick={()=>go("auth")} style={{background:T.yellow,color:"#111",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:800,cursor:"pointer"}}>{pendAuth}</div>}
          {lowStock.length>0&&can("inv")&&<div onClick={()=>go("inv")} style={{background:T.red,color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:800,cursor:"pointer"}}>⚠{lowStock.length}</div>}
          <div onClick={()=>setUser(null)} style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}><span style={{fontSize:10,color:T.muted}}>{user.nombre.split(" ")[0]}</span><div style={{width:28,height:28,borderRadius:14,background:role.color+"22",color:role.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800}}>{user.avatar}</div></div>
        </div>
      </div>
      <div style={{padding:"3px 16px 6px",display:"flex",alignItems:"center",gap:6,background:"#111"}}><span style={{fontSize:11}}>{role.icon}</span><span style={{fontSize:10,color:role.color,fontWeight:700}}>{role.nombre}</span></div>

      {/* CONTENT */}
      <div style={{flex:1,padding:"6px 12px 80px",overflowY:"auto"}}>

        {/* ═══ DASHBOARD ═══ */}
        {sec==="dash"&&<div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <Card style={{cursor:"pointer"}} onClick={()=>go("obras")}><Stat label="Obras Activas" value={obrasActivas.length} color={T.green}/><div style={{fontSize:10,color:T.muted,marginTop:4}}>{obras.filter(o=>o.status==="cotizado").length} cotizadas</div></Card>
            <Card style={{cursor:"pointer"}} onClick={()=>go("money")}><Stat label="Margen" value={$(tCot-tEgrO)} color={tCot-tEgrO>=0?T.green:T.red}/><div style={{fontSize:10,color:T.muted,marginTop:4}}>{pc(tCot-tEgrO,tCot)}% rentabilidad</div></Card>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
            {[["Cotizado",$(tCot),T.gold],["Egresado",$(tEgrO),T.red],["Caja",$(tCaja),T.orange]].map(([l,v,c])=><Card key={l}><Stat label={l} value={v} color={c} small/></Card>)}
          </div>
          {pendAuth>0&&<div onClick={()=>go("auth")} style={{background:"#2a2000",border:"1px solid #FFD54F33",borderRadius:10,padding:"10px 14px",marginBottom:8,cursor:"pointer"}}><span style={{fontWeight:700,color:T.yellow}}>🔔 {pendAuth} autorización(es) pendiente(s)</span></div>}
          {lowStock.length>0&&<div onClick={()=>go("inv")} style={{background:"#2a0000",border:"1px solid #ef535033",borderRadius:10,padding:"10px 14px",marginBottom:8,cursor:"pointer"}}><span style={{fontWeight:700,color:T.red}}>📦 {lowStock.length} material(es) con stock bajo</span><div style={{fontSize:10,color:"#e57373",marginTop:2}}>{lowStock.map(i=>i.nombre).join(", ")}</div></div>}
          <Card><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Ingresos vs Egresos 2026</span></div><MiniChart data={monthlyIng} color={T.green}/><MiniChart data={monthlyEgr} color={T.red} h={25}/><div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:10}}><span style={{color:T.green}}>● Ingresos</span><span style={{color:T.red}}>● Egresos</span></div></Card>
          <Card><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Obras Activas</div>{obrasActivas.map(o=><div key={o.id} onClick={()=>go("obras",o)} style={{padding:"10px 0",borderBottom:`1px solid ${T.border}`,cursor:"pointer"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}><span style={{fontWeight:700,fontSize:13}}>{o.nombre}</span><span style={{fontSize:10,background:FASES_C[o.fase]+"33",color:FASES_C[o.fase],padding:"1px 6px",borderRadius:8,fontWeight:700}}>{FASES[o.fase]}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.muted,marginBottom:3}}><span>{o.cliente}</span><span>{o.avance}%</span></div><Bar v={o.avance} mx={100} c={FASES_C[o.fase]}/></div>)}</Card>
          <Card><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Movimientos Recientes</div>{movs.slice(-4).reverse().map(m=><div key={m.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.border}`}}><div><div style={{fontSize:12,fontWeight:600}}>{m.desc}</div><div style={{fontSize:10,color:T.dim}}>{fd(m.fecha)}</div></div><span style={{fontWeight:700,color:m.ing>0?T.green:T.red}}>{m.ing>0?"+":"-"}{$(m.ing>0?m.ing:m.egr)}</span></div>)}</Card>
        </div>}

        {/* ═══ COTIZADOR ═══ */}
        {sec==="cot"&&<div>
          {user.rol==="ventas"&&<div style={{background:"#0a1a33",border:"1px solid #42A5F533",borderRadius:10,padding:"10px 14px",marginBottom:8,fontSize:11,color:T.blue}}>📋 Las cotizaciones van a autorización</div>}
          <Card><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}><input style={sI} placeholder="Nombre cliente" value={cotNom} onChange={e=>setCotNom(e.target.value)}/><input style={sI} placeholder="Empresa" value={cotEmp} onChange={e=>setCotEmp(e.target.value)}/></div></Card>
          <button onClick={()=>om("catPick")} style={{...sB,background:"#222",color:T.gold,border:`1px solid ${T.border}`,marginTop:0,marginBottom:8}}>📦 Agregar del catálogo</button>
          {cotP.length>0&&<Card>
            {cotP.map((p,i)=><div key={p.id+"-"+i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${T.border}`}}><div style={{flex:1}}><div style={{fontSize:12}}><b style={{color:T.gold}}>{p.id}</b> {p.desc}</div><div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}><button onClick={()=>setCotP(cotP.map((x,j)=>j===i?{...x,cant:Math.max(1,x.cant-1)}:x))} style={{background:"#222",border:"1px solid #444",color:"#ccc",borderRadius:6,width:28,height:28,cursor:"pointer",fontSize:16}}>−</button><span style={{fontSize:14,fontWeight:700,minWidth:20,textAlign:"center"}}>{p.cant}</span><button onClick={()=>setCotP(cotP.map((x,j)=>j===i?{...x,cant:x.cant+1}:x))} style={{background:"#222",border:"1px solid #444",color:"#ccc",borderRadius:6,width:28,height:28,cursor:"pointer",fontSize:16}}>+</button></div></div><div style={{textAlign:"right"}}><div style={{fontWeight:700}}>{$(p.precio*p.cant)}</div><button onClick={()=>setCotP(cotP.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:10}}>Quitar</button></div></div>)}
            <div style={{borderTop:`2px solid ${T.border}`,marginTop:10,paddingTop:10}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span style={{color:T.muted}}>Subtotal</span><span>{$(subCot)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span style={{color:T.muted}}>IVA 16%</span><span>{$(ivCot)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:22,fontWeight:800,color:T.gold,paddingTop:6,borderTop:`1px solid ${T.dim}`}}><span>TOTAL</span><span>{$(totCot)}</span></div>
            </div>
            {user.rol==="admin"?<button style={sB} onClick={()=>{setObras(prev=>[...prev,{id:`OB${prev.length+1}`,nombre:`${cotEmp||cotNom||"Cot"} #${cotNum}`,cliente:cotNom,status:"cotizado",cotizado:totCot,egreso:0,fase:"cotizacion",avance:0,extras:[],pagos:[],docs:[],bitacora:[]}]);setCotNum(n=>n+1);setCotP([]);setCotNom("");setCotEmp("");show("Proyecto creado ✓");}}>💾 Guardar proyecto</button>
            :<button style={{...sB,background:T.blue,color:"#fff"}} onClick={()=>{setAuts(prev=>[...prev,{id:prev.length+1,tipo:"cotizacion",desc:`Cot #${cotNum} — ${cotEmp||cotNom}`,monto:totCot,sol:user.nombre,fecha:td(),status:"pendiente",det:`${cotP.length} partidas`}]);setCotNum(n=>n+1);setCotP([]);setCotNom("");setCotEmp("");show("A autorización ✓");}}>📤 Enviar autorización</button>}
          </Card>}
        </div>}

        {/* ═══ OBRAS LIST ═══ */}
        {sec==="obras"&&!sub&&<div>
          {can("obras")&&<button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addObra")}>+ Nueva Obra</button>}
          {Object.entries(FASES).map(([k,label])=>{const list=obras.filter(o=>o.fase===k);if(!list.length)return null;return <div key={k}><div style={{fontSize:10,color:FASES_C[k],fontWeight:700,textTransform:"uppercase",letterSpacing:1,margin:"10px 0 4px"}}>{label} ({list.length})</div>{list.map(o=><Card key={o.id} style={{cursor:"pointer"}} onClick={()=>setSub(o)}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontWeight:700,fontSize:14}}>{o.nombre}</span><span style={{fontWeight:700,color:T.gold}}>{$(o.cotizado)}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.muted,marginBottom:3}}><span>{o.cliente}</span><span>{o.avance}%</span></div><Bar v={o.avance} mx={100} c={FASES_C[o.fase]}/></Card>)}</div>;})}
        </div>}

        {/* ═══ OBRA DETAIL ═══ */}
        {sec==="obras"&&sub&&<div>
          <button onClick={()=>setSub(null)} style={{background:"none",border:"none",color:T.gold,cursor:"pointer",fontSize:13,padding:0,marginBottom:8}}>← Obras</button>
          <Card><div style={{fontSize:20,fontWeight:800,marginBottom:4}}>{sub.nombre}</div><div style={{display:"flex",gap:6,marginBottom:8}}><Badge s={sub.status}/><span style={{background:FASES_C[sub.fase]+"33",color:FASES_C[sub.fase],padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700}}>{FASES[sub.fase]}</span></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}><Stat label="Cotizado" value={$(sub.cotizado)} color={T.gold} small/><Stat label="Egresado" value={$(sub.egreso)} color={sub.egreso>sub.cotizado?T.red:T.green} small/><Stat label="Margen" value={$(sub.cotizado-sub.egreso)} color={sub.cotizado-sub.egreso>=0?T.green:T.red} small/></div>
            <div style={{marginTop:8}}><div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}><span style={{color:T.muted}}>Avance</span><span style={{fontWeight:700}}>{sub.avance}%</span></div><Bar v={sub.avance} mx={100} c={FASES_C[sub.fase]} h={6}/></div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:8,fontSize:11,color:T.muted}}><span>Inicio: {fd(sub.inicio)}</span><span>Entrega: {fd(sub.entrega)}</span></div>
          </Card>
          {/* Docs */}
          {can("docs")&&<Card><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase"}}>Documentos ({(sub.docs||[]).length})</span><button onClick={()=>om("addDoc")} style={{background:"#222",border:"1px solid #444",color:T.gold,borderRadius:6,padding:"3px 10px",fontSize:10,cursor:"pointer",fontWeight:700}}>+ Subir</button></div>{(sub.docs||[]).length===0?<div style={{color:T.dim,fontSize:12,textAlign:"center",padding:8}}>Sin documentos</div>:(sub.docs||[]).map(d=><div key={d.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:`1px solid ${T.border}`}}><span style={{fontSize:16}}>{DOC_IC[d.tipo]||"📎"}</span><div style={{flex:1}}><div style={{fontSize:12,fontWeight:600}}>{d.nombre}</div><div style={{fontSize:10,color:T.dim}}>{d.ext} · {d.size} · {fd(d.fecha)}</div></div></div>)}</Card>}
          {/* Extras */}
          <Card><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:10,color:T.orange,fontWeight:700,textTransform:"uppercase"}}>Extras ({(sub.extras||[]).length})</span>{can("extras")&&<button onClick={()=>om("addExtra")} style={{background:"#222",border:"1px solid #444",color:T.orange,borderRadius:6,padding:"3px 10px",fontSize:10,cursor:"pointer",fontWeight:700}}>+ Extra</button>}</div>{(sub.extras||[]).map(e=><div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${T.border}`}}><div><div style={{fontSize:12,fontWeight:600}}>{e.desc}</div><div style={{fontSize:10,color:T.dim}}>{fd(e.fecha)}</div></div><div style={{textAlign:"right"}}><Badge s={e.status}/><div style={{fontSize:12,fontWeight:700,color:T.orange}}>{$(e.monto)}</div></div></div>)}</Card>
          {/* Bitacora */}
          <Card><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:10,color:T.blue,fontWeight:700,textTransform:"uppercase"}}>Bitácora ({(sub.bitacora||[]).length})</span></div>{(sub.bitacora||[]).slice().reverse().map(b=><div key={b.id} style={{padding:"5px 0",borderBottom:`1px solid ${T.border}`}}><div style={{fontSize:12}}>{b.nota}</div><div style={{fontSize:10,color:T.dim}}>{fd(b.fecha)} · {b.user}</div></div>)}<div style={{marginTop:8}}><BitacoraForm onSave={nota=>{const updated={...sub,bitacora:[...(sub.bitacora||[]),{id:(sub.bitacora?.length||0)+1,fecha:td(),nota,user:user.nombre}]};setObras(obras.map(o=>o.id===sub.id?updated:o));setSub(updated);show("Bitácora actualizada");}}/></div></Card>
        </div>}

        {/* ═══ FINANZAS ═══ */}
        {sec==="money"&&<div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>{[["Ingresos",$(tIng),T.green],["Egresos",$(tEgr),T.red],["Balance",$(tIng-tEgr),tIng-tEgr>=0?T.green:T.red]].map(([l,v,c])=><Card key={l}><Stat label={l} value={v} color={c} small/></Card>)}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}><button style={{...sB,background:"#1a3a1a",color:T.green,border:"1px solid #2a4a2a",marginTop:0}} onClick={()=>om("addIng")}>+ Ingreso</button><button style={{...sB,background:"#3a1a1a",color:T.red,border:"1px solid #4a2a2a",marginTop:0}} onClick={()=>om("addEgr")}>+ Egreso</button></div>
          {movs.slice().reverse().map(m=><Card key={m.id}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:600,fontSize:13}}>{m.desc}</div><div style={{fontSize:10,color:T.dim}}>{fd(m.fecha)} · {m.prov} · {m.obra||"General"}{m.cat?` · ${m.cat}`:""}{m.recibo?<span style={{color:T.green}}> · {m.recibo}</span>:""}</div></div><span style={{fontWeight:800,fontSize:15,color:m.ing>0?T.green:T.red}}>{m.ing>0?"+":"-"}{$(m.ing>0?m.ing:m.egr)}</span></div></Card>)}
        </div>}

        {/* ═══ INVENTARIO ═══ */}
        {sec==="inv"&&<div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}><Card><Stat label="Materiales" value={inv.length} small/></Card><Card><Stat label="Stock bajo" value={lowStock.length} color={lowStock.length>0?T.red:T.green} small/></Card><Card><Stat label="Valor inv." value={$(inv.reduce((s,i)=>s+i.stock*i.precio,0))} color={T.gold} small/></Card></div>
          <button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addInv")}>+ Nuevo Material</button>
          {lowStock.length>0&&<div style={{fontSize:10,color:T.red,fontWeight:700,marginBottom:6}}>⚠ STOCK BAJO</div>}
          {inv.sort((a,b)=>(a.stock<=a.minimo?0:1)-(b.stock<=b.minimo?0:1)).map(item=><Card key={item.id} style={{borderLeft:item.stock<=item.minimo?`3px solid ${T.red}`:"3px solid transparent"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontWeight:700,fontSize:13}}>{item.nombre}</div><div style={{fontSize:10,color:T.dim}}>{item.cat} · {item.prov} · {$(item.precio)}/{item.unidad}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:item.stock<=item.minimo?T.red:T.green}}>{item.stock}</div><div style={{fontSize:9,color:T.muted}}>min: {item.minimo}</div></div></div><Bar v={item.stock} mx={item.minimo*3} c={item.stock<=item.minimo?T.red:T.green}/></Card>)}
        </div>}

        {/* ═══ CAJA CHICA ═══ */}
        {sec==="caja"&&<div><Card><Stat label="Caja Chica Total" value={$(tCaja)} color={T.orange}/></Card><button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addCaja")}>+ Gasto</button>{caja.slice().reverse().map(c=><Card key={c.id}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:600}}>{c.concepto}</div><div style={{fontSize:10,color:T.dim}}>{fd(c.fecha)} · {c.resp} · {c.obra}</div></div><span style={{fontWeight:700,color:T.orange}}>{$(c.monto)}</span></div></Card>)}</div>}

        {/* ═══ CONTRATOS ═══ */}
        {sec==="cont"&&<div><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Contratos ({cont.length})</div>{cont.map(c=><Card key={c.id}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><span style={{fontWeight:700,fontSize:14}}>{c.obra}</span><Badge s={c.status}/></div><div style={{fontSize:11,color:T.muted,marginBottom:6}}>{c.cliente} · Anticipo {c.anticipo}% · {c.pagos} pagos</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><Stat label="Monto" value={$(c.monto)} color={T.gold} small/><Stat label="Entrega" value={fd(c.entrega)} small/></div>{c.clausulas&&<div style={{marginTop:8,fontSize:11,color:T.muted,borderTop:`1px solid ${T.border}`,paddingTop:6}}>{c.clausulas}</div>}</Card>)}</div>}

        {/* ═══ CLIENTES ═══ */}
        {sec==="clis"&&<div><button style={{...sB,marginBottom:8,marginTop:0}} onClick={()=>om("addCli")}>+ Nuevo Cliente</button>{clis.map(c=><Card key={c.id}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><span style={{fontWeight:700,fontSize:14}}>{c.nombre}</span><span style={{fontWeight:700,color:T.gold}}>{$(c.totalCot)}</span></div><div style={{fontSize:11,color:T.muted}}>{c.tel&&`📱 ${c.tel}`}{c.email&&` · ✉ ${c.email}`}</div><div style={{fontSize:11,color:T.muted}}>{c.dir&&`📍 ${c.dir}`}</div>{c.notas&&<div style={{fontSize:11,color:T.dim,marginTop:4,fontStyle:"italic"}}>{c.notas}</div>}</Card>)}</div>}

        {/* ═══ PROVEEDORES ═══ */}
        {sec==="provs"&&<div>{provs.map(p=><Card key={p.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><div><div style={{fontWeight:700,fontSize:14}}>{p.nombre}</div>{p.contacto&&<div style={{fontSize:11,color:T.muted}}>{p.contacto} {p.tel&&`· ${p.tel}`}</div>}</div><span style={{fontWeight:700,color:T.gold}}>{$(p.total)}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:T.muted}}>{p.material}</span><span style={{color:T.muted}}>{p.credito>0?`${p.credito}d crédito`:"Contado"}</span><span>{[...Array(p.calif||0)].map((_,i)=><span key={i}>⭐</span>)}</span></div>{p.notas&&<div style={{fontSize:10,color:T.dim,marginTop:4}}>{p.notas}</div>}</Card>)}</div>}

        {/* ═══ CALENDARIO ═══ */}
        {sec==="cal"&&<div><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Timeline de Proyectos</div>{obras.filter(o=>o.inicio).sort((a,b)=>a.entrega>b.entrega?1:-1).map(o=><Card key={o.id} style={{cursor:"pointer"}} onClick={()=>go("obras",o)}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><span style={{fontWeight:700}}>{o.nombre}</span><span style={{background:FASES_C[o.fase]+"33",color:FASES_C[o.fase],padding:"1px 6px",borderRadius:8,fontSize:10,fontWeight:700}}>{FASES[o.fase]}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.muted}}><span>{fd(o.inicio)}</span><span style={{color:T.dim}}>→</span><span>{fd(o.entrega)}</span></div><Bar v={o.avance} mx={100} c={FASES_C[o.fase]} h={4}/>{o.entrega&&new Date(o.entrega)<new Date()&&o.status!=="completado"&&<div style={{fontSize:10,color:T.red,fontWeight:700,marginTop:4}}>⚠ ATRASADA</div>}</Card>)}</div>}

        {/* ═══ ANÁLISIS ═══ */}
        {sec==="anal"&&<div>
          <div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Análisis de Rentabilidad</div>
          {obras.filter(o=>o.cotizado>0).sort((a,b)=>(b.cotizado-b.egreso)-(a.cotizado-a.egreso)).map(o=>{const margin=o.cotizado-o.egreso;const pct=pc(margin,o.cotizado);return <Card key={o.id}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontWeight:700,fontSize:13}}>{o.nombre}</span><span style={{fontWeight:800,color:margin>=0?T.green:T.red}}>{margin>=0?"+":""}{$(margin)}</span></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.muted,marginBottom:3}}><span>Cot: {$(o.cotizado)}</span><span>Egr: {$(o.egreso)}</span><span style={{color:pct>=20?T.green:pct>=0?T.orange:T.red,fontWeight:700}}>{pct}%</span></div><Bar v={o.egreso} mx={o.cotizado} c={o.egreso>o.cotizado?T.red:T.green}/></Card>;})}
          <Card><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Por Categoría de Egreso</div>{["Material","Mano Obra","Subcontrato","Nómina","Herrajes","Servicios"].map(cat=>{const total=movs.filter(m=>m.egr>0&&m.cat===cat).reduce((s,m)=>s+m.egr,0);if(!total)return null;return <div key={cat} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${T.border}`}}><span style={{fontSize:12}}>{cat}</span><span style={{fontWeight:700,color:T.red}}>{$(total)}</span></div>;})}</Card>
          <Card><div style={{fontSize:10,color:T.gold,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Top Proveedores</div>{provs.sort((a,b)=>b.total-a.total).slice(0,5).map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${T.border}`}}><span style={{fontSize:12}}>{p.nombre}</span><span style={{fontWeight:700,color:T.gold}}>{$(p.total)}</span></div>)}</Card>
        </div>}

        {/* ═══ AUTORIZACIONES ═══ */}
        {sec==="auth"&&<div>{auts.length===0?<div style={{color:T.dim,textAlign:"center",padding:20}}>Sin solicitudes</div>:auts.slice().reverse().map(a=><Card key={a.id} style={{borderLeft:a.status==="pendiente"?`3px solid ${T.yellow}`:"3px solid transparent"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><span style={{fontWeight:700,fontSize:13}}>{a.tipo==="cotizacion"?"📝":"➕"} {a.desc}</span><Badge s={a.status==="pendiente"?"pendiente":a.status}/></div><div style={{fontSize:11,color:T.muted}}>{a.sol} · {fd(a.fecha)}</div><div style={{fontSize:16,fontWeight:800,color:T.gold,marginTop:4}}>{$(a.monto)}</div><div style={{fontSize:11,color:T.dim}}>{a.det}</div>{a.status==="pendiente"&&can("auth")&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}><button style={{padding:10,borderRadius:8,border:"none",background:"#1a3a1a",color:T.green,fontWeight:700,cursor:"pointer"}} onClick={()=>{setAuts(auts.map(x=>x.id===a.id?{...x,status:"aprobada"}:x));show("Aprobada ✓");}}>✓ Aprobar</button><button style={{padding:10,borderRadius:8,border:"none",background:"#3a1a1a",color:T.red,fontWeight:700,cursor:"pointer"}} onClick={()=>{setAuts(auts.map(x=>x.id===a.id?{...x,status:"rechazada"}:x));show("Rechazada");}}>✕ Rechazar</button></div>}</Card>)}</div>}

        {/* ═══ RECIBOS ═══ */}
        {sec==="recibos"&&<div>{recibos.length===0?<div style={{color:T.dim,textAlign:"center",padding:20}}>Los recibos se generan al registrar ingresos</div>:recibos.slice().reverse().map(r=><Card key={r.id} style={{cursor:"pointer"}} onClick={()=>om("verRec",r)}><div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontWeight:700,color:T.green}}>{r.id}</div><div style={{fontSize:12}}>{r.concepto}</div><div style={{fontSize:10,color:T.dim}}>{fd(r.fecha)} · {r.cliente}</div></div><span style={{fontWeight:800,fontSize:16,color:T.green}}>{$(r.monto)}</span></div></Card>)}</div>}

        {/* ═══ USUARIOS ═══ */}
        {sec==="usuarios"&&<div>{USERS.map(u=><Card key={u.id} style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:40,height:40,borderRadius:20,background:ROLES[u.rol].color+"22",color:ROLES[u.rol].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,flexShrink:0}}>{u.avatar}</div><div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>{u.nombre}</div><div style={{fontSize:10,color:ROLES[u.rol].color}}>{ROLES[u.rol].icon} {ROLES[u.rol].nombre}</div></div></Card>)}</div>}
      </div>

      {/* ═══ MODALS ═══ */}
      {modal==="catPick"&&<ModalW title="Catálogo" onClose={cm}>{cats.map(cat=><div key={cat} style={{marginBottom:12}}><div style={{fontSize:11,color:T.gold,fontWeight:700,borderBottom:`1px solid ${T.border}`,paddingBottom:3,marginBottom:4}}>{cat}</div>{CATALOGO.filter(c=>c.cat===cat).map(item=><div key={item.id} onClick={()=>{addCotP(item);show(`${item.id} +`);}} style={{display:"flex",justifyContent:"space-between",padding:"10px 8px",borderBottom:`1px solid ${T.border}`,cursor:"pointer"}}><span><b style={{color:T.gold}}>{item.id}</b> {item.desc}</span><div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{color:T.muted,fontSize:12}}>{$(item.precio)}</span><span style={{background:"#1a3a1a",color:T.green,borderRadius:20,width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700}}>+</span></div></div>)}</div>)}</ModalW>}
      {modal==="addObra"&&<ModalW title="Nueva Obra" onClose={cm}><ObraForm clientes={clis} onSave={o=>{setObras(prev=>[...prev,{...o,id:`OB${prev.length+1}`,egreso:0,extras:[],pagos:[],docs:[],bitacora:[]}]);cm();show("Obra creada ✓");}}/></ModalW>}
      {modal==="addIng"&&<ModalW title="📥 Ingreso + Recibo" onClose={cm}><div style={{background:"#0a2e0a",border:`1px solid ${T.green}33`,borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:11,color:T.green}}>✨ Se generará recibo automático</div><IngForm obras={obras} onSave={m=>{const rId=genRecibo(m);setMovs(prev=>[...prev,{...m,id:prev.length+1,user:user.nombre,recibo:rId}]);cm();show(`Recibo ${rId} ✓`);}}/></ModalW>}
      {modal==="addEgr"&&<ModalW title="📤 Egreso" onClose={cm}><EgrForm obras={obras} provs={provs} onSave={m=>{if(user.rol!=="admin"&&m.egr>50000){setAuts(prev=>[...prev,{id:prev.length+1,tipo:"egreso",desc:m.desc,monto:m.egr,sol:user.nombre,fecha:td(),status:"pendiente",det:`Obra: ${m.obra}`}]);cm();show("A autorización");}else{setMovs(prev=>[...prev,{...m,id:prev.length+1,user:user.nombre}]);cm();show("Egreso registrado");;}}}/></ModalW>}
      {modal==="addCaja"&&<ModalW title="Caja Chica" onClose={cm}><CajaForm onSave={c=>{setCaja(prev=>[...prev,{...c,id:prev.length+1}]);cm();show("Registrado");}}/></ModalW>}
      {modal==="addDoc"&&sub&&<ModalW title="Subir Documento" onClose={cm}><DocForm onSave={d=>{const up={...sub,docs:[...(sub.docs||[]),{...d,id:(sub.docs?.length||0)+1,fecha:td(),size:"1.2 MB"}]};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);cm();show("Documento subido");}}/></ModalW>}
      {modal==="addExtra"&&sub&&<ModalW title="Agregar Extra" onClose={cm}><ExtraForm onSave={e=>{const up={...sub,extras:[...(sub.extras||[]),{...e,id:(sub.extras?.length||0)+1,status:"pendiente",fecha:td()}]};setObras(obras.map(o=>o.id===sub.id?up:o));setSub(up);cm();show("Extra agregado");}}/></ModalW>}
      {modal==="addCli"&&<ModalW title="Nuevo Cliente" onClose={cm}><ClienteForm onSave={c=>{setClis(prev=>[...prev,{...c,id:`C${prev.length+1}`,obras:0,totalCot:0}]);cm();show("Cliente guardado");}}/></ModalW>}
      {modal==="addInv"&&<ModalW title="Nuevo Material" onClose={cm}><InvForm onSave={i=>{setInv(prev=>[...prev,{...i,id:`I${prev.length+1}`}]);cm();show("Material agregado");}}/></ModalW>}
      {modal==="verRec"&&md&&<ModalW title={md.id} onClose={cm}><ReciboView data={md}/></ModalW>}
      {modal==="reciboC"&&md&&<ModalW title={"Recibo "+md.recibo} onClose={cm}><ReciboView data={md}/></ModalW>}
      {modal==="solExtra"&&<ModalW title="Solicitar Extra" onClose={cm}><ExtraForm onSave={e=>{cm();show("Extra enviado");}}/></ModalW>}

      {/* TOAST */}
      {toast&&<div style={{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"#1a3a1a",color:T.green,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:700,zIndex:2000,boxShadow:"0 4px 20px rgba(0,0,0,.5)"}}>{toast}</div>}

      {/* MORE MENU */}
      {moreOpen&&<div style={{position:"fixed",bottom:56,left:0,right:0,zIndex:200,display:"flex",justifyContent:"center"}} onClick={()=>setMoreOpen(false)}><div onClick={e=>e.stopPropagation()} style={{background:"#1a1a1a",border:`1px solid ${T.border}`,borderRadius:14,padding:6,maxWidth:360,width:"90%",boxShadow:"0 -4px 20px rgba(0,0,0,.5)",maxHeight:"50vh",overflowY:"auto"}}>{mItems.map(i=><button key={i.key} onClick={()=>go(i.key)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 14px",background:sec===i.key?"#252525":"transparent",border:"none",color:sec===i.key?T.gold:"#bbb",cursor:"pointer",fontSize:13,fontWeight:sec===i.key?700:400,textAlign:"left",borderRadius:8}}><span style={{fontSize:15}}>{i.icon}</span>{i.label}</button>)}<div style={{borderTop:`1px solid ${T.border}`,marginTop:4,paddingTop:4}}><button onClick={()=>{setUser(null);setMoreOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 14px",background:"transparent",border:"none",color:T.red,cursor:"pointer",fontSize:13,borderRadius:8}}>🚪 Cerrar sesión</button></div></div></div>}

      {/* TABS */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:300,background:"#111",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"center"}}><div style={{display:"flex",maxWidth:600,width:"100%"}}>{tabs.map(t=><button key={t.key} onClick={()=>{if(t.key==="more"){setMoreOpen(!moreOpen);return;}go(t.key);}} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:(t.key==="more"?moreOpen:sec===t.key)?T.gold:T.dim,position:"relative"}}><span style={{fontSize:18}}>{t.icon}</span><span style={{fontSize:8,fontWeight:600}}>{t.label}</span>{t.key==="more"&&(pendAuth+lowStock.length)>0&&<div style={{position:"absolute",top:4,right:"25%",width:6,height:6,borderRadius:3,background:T.yellow}}/>}</button>)}</div></div>
    </div>
  );
}

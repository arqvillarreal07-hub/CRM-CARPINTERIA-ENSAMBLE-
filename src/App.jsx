/**
 * DentalOS v2 — Backend Google Apps Script
 *
 * INSTRUCCIONES:
 * 1. Crea una hoja de Google Sheets nueva (ej. "DentalOS_DB")
 * 2. Copia el ID de la URL: docs.google.com/spreadsheets/d/[ESTE_ID]/edit
 * 3. Extensiones → Apps Script → pega TODO este archivo
 * 4. Reemplaza SHEET_ID abajo con el ID que copiaste
 * 5. Guarda (💾)
 * 6. En el dropdown de funciones, selecciona "setupSheets" y dale Run
 *    → te pedirá autorizar permisos, acepta. Esto crea las hojas y carga 897 pacientes
 * 7. Implementar → Nueva implementación
 *    Tipo: App web · Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 * 8. Copia la URL del Web App y pégala como API_URL en index.html
 */

const SHEET_ID = 'PEGA_AQUI_EL_ID_DE_TU_GOOGLE_SHEET';

// =========================================================
// ROUTING
// =========================================================
function doPost(e) {
  try {
    return handle(JSON.parse(e.postData.contents));
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
function doGet(e) {
  const action = e.parameter.action;
  const payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
  return handle({ action: action, payload: payload, user: e.parameter.user || 'anon' });
}
function handle(req) {
  try {
    const action = req.action;
    const payload = req.payload || {};
    const user = req.user || 'anon';
    let result;
    switch (action) {
      case 'setupSheets': result = setupSheets(); break;
      case 'listAll':     result = listAll(); break;
      case 'list':        result = listEntity(payload.entity); break;
      case 'create':      result = createEntity(payload.entity, payload.row, user); break;
      case 'update':      result = updateEntity(payload.entity, payload.id, payload.row, user); break;
      case 'delete':      result = deleteEntity(payload.entity, payload.id, user); break;
      case 'getConfig':   result = getConfigKey(payload.key); break;
      case 'setConfig':   result = setConfigKey(payload.key, payload.value); break;
      case 'getSlotsDisponibles': result = getSlotsDisponibles(payload.doctor_id, payload.fecha); break;
      case 'getSlotsRangoDoctor': result = getSlotsRangoDoctor(payload.doctor_id, payload.fechaInicio, payload.fechaFin); break;
      default: throw new Error('Acción desconocida: ' + action);
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, data: result })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// =========================================================
// CONFIG DE ENTIDADES
// =========================================================
const ENTITY_HEADERS = {
  pacientes: ['id','nombre','telefono','email','fecha_nac','genero','direccion','notas','ultima_visita','odontograma','created_at'],
  citas: ['id','paciente_id','fecha','hora','duracion','tratamiento_id','doctor_id','estado','notas','created_at'],
  cobros: ['id','paciente_id','cita_id','fecha','tratamiento_id','monto','metodo','concepto','folio','created_at'],
  gastos: ['id','fecha','mes','concepto','descripcion','monto','created_at'],
  config: ['key','value','updated_at']
};
const JSON_FIELDS = ['odontograma','value'];

function ss() { return SpreadsheetApp.openById(SHEET_ID); }
function getSheet(name) {
  const s = ss();
  let sh = s.getSheetByName(name);
  if (!sh) {
    sh = s.insertSheet(name);
    if (ENTITY_HEADERS[name]) { sh.appendRow(ENTITY_HEADERS[name]); sh.setFrozenRows(1); }
  }
  return sh;
}
function uid() { return Utilities.getUuid().slice(0,8); }
function nowIso() { return new Date().toISOString(); }

// =========================================================
// CRUD
// =========================================================
function rowToObj(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  JSON_FIELDS.forEach(function(f) {
    if (obj[f] && typeof obj[f] === 'string') {
      try { obj[f] = JSON.parse(obj[f]); } catch(e) {}
    }
  });
  return obj;
}

function listEntity(entity) {
  const sh = getSheet(entity);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(function(row) { return rowToObj(headers, row); });
}

function listAll() {
  return {
    pacientes: listEntity('pacientes'),
    citas: listEntity('citas'),
    cobros: listEntity('cobros'),
    gastos: listEntity('gastos'),
    config: listEntity('config')
  };
}

function stringifyJson(obj) {
  const out = {};
  Object.keys(obj).forEach(function(k) {
    let v = obj[k];
    if (JSON_FIELDS.indexOf(k) >= 0 && v !== null && v !== undefined && typeof v !== 'string') {
      v = JSON.stringify(v);
    }
    out[k] = v == null ? '' : v;
  });
  return out;
}

function createEntity(entity, row, user) {
  const sh = getSheet(entity);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const filled = stringifyJson(row);
  if (headers.indexOf('id') >= 0 && !filled.id) filled.id = uid();
  if (headers.indexOf('created_at') >= 0 && !filled.created_at) filled.created_at = nowIso();
  const newRow = headers.map(function(h) { return filled[h] !== undefined ? filled[h] : ''; });
  sh.appendRow(newRow);
  appendLog('CREATE ' + entity + ' ' + (filled.id || filled.key), user);
  return rowToObj(headers, newRow);
}

function updateEntity(entity, id, row, user) {
  const sh = getSheet(entity);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  if (idCol < 0) throw new Error('Tabla ' + entity + ' sin columna id');
  const updates = stringifyJson(row);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      Object.keys(updates).forEach(function(k) {
        const col = headers.indexOf(k);
        if (col >= 0) sh.getRange(i + 1, col + 1).setValue(updates[k]);
      });
      appendLog('UPDATE ' + entity + ' ' + id, user);
      return { ok: true, id: id };
    }
  }
  throw new Error('No encontrado: ' + id);
}

function deleteEntity(entity, id, user) {
  const sh = getSheet(entity);
  const data = sh.getDataRange().getValues();
  const idCol = data[0].indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      sh.deleteRow(i + 1);
      appendLog('DELETE ' + entity + ' ' + id, user);
      return { ok: true };
    }
  }
  throw new Error('No encontrado: ' + id);
}

// =========================================================
// CONFIG (key/value)
// =========================================================
function getConfigKey(key) {
  const all = listEntity('config');
  const found = all.filter(function(r) { return r.key === key; })[0];
  return found ? found.value : null;
}
function setConfigKey(key, value) {
  const sh = getSheet('config');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const keyCol = headers.indexOf('key');
  const valueCol = headers.indexOf('value');
  const updCol = headers.indexOf('updated_at');
  const valStr = typeof value === 'string' ? value : JSON.stringify(value);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyCol]) === String(key)) {
      sh.getRange(i + 1, valueCol + 1).setValue(valStr);
      if (updCol >= 0) sh.getRange(i + 1, updCol + 1).setValue(nowIso());
      return { ok: true };
    }
  }
  sh.appendRow([key, valStr, nowIso()]);
  return { ok: true };
}

// =========================================================
// LOG (auditoría)
// =========================================================
function appendLog(message, user) {
  try {
    const sh = getSheet('_log');
    if (sh.getLastRow() === 0) { sh.appendRow(['ts','user','message']); sh.setFrozenRows(1); }
    sh.appendRow([nowIso(), user || '?', message]);
  } catch(e) { /* ignore */ }
}

// =========================================================
// SLOTS DISPONIBLES (para el calendario y futuro bot)
// =========================================================
function getDoctorById(id) {
  const docs = getConfigKey('doctores') || [];
  return docs.filter(function(d){ return d.id === id; })[0];
}

function getBloquesParaFecha(doc, fechaStr) {
  // Devuelve los bloques [{i,f}] que aplican a esa fecha (excepción gana sobre semanal)
  const exc = (doc.excepciones || []).filter(function(e){ return e.fecha === fechaStr; })[0];
  if (exc) {
    if (exc.cerrado) return [];
    return exc.slots || [];
  }
  const fechaObj = new Date(fechaStr + 'T00:00:00');
  const dow = fechaObj.getDay(); // 0=dom, 6=sab
  const horario = doc.horario || {};
  return horario[dow] || horario[String(dow)] || [];
}

function expandBloquesAslots(bloques, slotMin) {
  const slots = [];
  bloques.forEach(function(b) {
    const piI = b.i.split(':').map(Number);
    const piF = b.f.split(':').map(Number);
    const startMin = piI[0]*60 + piI[1];
    const endMin = piF[0]*60 + piF[1];
    for (let t = startMin; t + slotMin <= endMin; t += slotMin) {
      const h = Math.floor(t/60), m = t%60;
      slots.push((h<10?'0':'')+h+':'+(m<10?'0':'')+m);
    }
  });
  return slots;
}

function getSlotsDisponibles(doctor_id, fecha) {
  const doc = getDoctorById(doctor_id);
  if (!doc) throw new Error('Doctor no encontrado: ' + doctor_id);
  const bloques = getBloquesParaFecha(doc, fecha);
  if (bloques.length === 0) return { fecha: fecha, doctor_id: doctor_id, disponibles: [], bloques: [] };
  const slotMin = 30;
  const todos = expandBloquesAslots(bloques, slotMin);
  // Restar citas existentes (no canceladas)
  const citas = listEntity('citas').filter(function(c) {
    return c.fecha === fecha && c.doctor_id === doctor_id && c.estado !== 'cancelada';
  });
  const ocupados = {};
  citas.forEach(function(c) {
    const partes = c.hora.split(':').map(Number);
    const startMin = partes[0]*60 + partes[1];
    const endMin = startMin + (Number(c.duracion) || 30);
    for (let t = startMin; t < endMin; t += slotMin) {
      const h = Math.floor(t/60), m = t%60;
      ocupados[(h<10?'0':'')+h+':'+(m<10?'0':'')+m] = true;
    }
  });
  const disponibles = todos.filter(function(s){ return !ocupados[s]; });
  return { fecha: fecha, doctor_id: doctor_id, disponibles: disponibles, bloques: bloques };
}

function getSlotsRangoDoctor(doctor_id, fechaInicio, fechaFin) {
  // Para el bot: regresa los slots libres en un rango de fechas (máx 14 días)
  const out = [];
  const start = new Date(fechaInicio + 'T00:00:00');
  const end = new Date(fechaFin + 'T00:00:00');
  const maxDays = 14;
  let count = 0;
  for (let d = new Date(start); d <= end && count < maxDays; d.setDate(d.getDate()+1), count++) {
    const fechaStr = Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Mexico_City', 'yyyy-MM-dd');
    const r = getSlotsDisponibles(doctor_id, fechaStr);
    if (r.disponibles.length > 0) out.push(r);
  }
  return out;
}

// =========================================================
// SETUP — corre esto UNA SOLA VEZ desde el editor
// =========================================================
function setupSheets() {
  const s = ss();
  // Crear/limpiar hojas con headers
  Object.keys(ENTITY_HEADERS).forEach(function(name) {
    let sh = s.getSheetByName(name);
    if (!sh) sh = s.insertSheet(name);
    sh.clear();
    sh.appendRow(ENTITY_HEADERS[name]);
    sh.setFrozenRows(1);
  });
  // Log
  let logSh = s.getSheetByName('_log');
  if (!logSh) logSh = s.insertSheet('_log');
  logSh.clear();
  logSh.appendRow(['ts','user','message']);
  logSh.setFrozenRows(1);

  const now = nowIso();
  const cfgSh = s.getSheetByName('config');

  // Tratamientos (25 reales del catálogo del consultorio, con clave + precio + costo material estimado)
  // costo_material son estimaciones promedio pediatría AGS — editables en config
  cfgSh.appendRow(['tratamientos', JSON.stringify([
    {id:'CON',   clave:'CON',   nombre:'Consulta',                 precio:800,   costo_material:40,   color:'sky',     duracion:30},
    {id:'CONRX', clave:'CONRX', nombre:'Consulta + Rx',            precio:500,   costo_material:55,   color:'sky',     duracion:30},
    {id:'REV',   clave:'REV',   nombre:'Revisión',                 precio:500,   costo_material:20,   color:'sky',     duracion:20},
    {id:'IV',    clave:'IV',    nombre:'Ionómero de vidrio',       precio:800,   costo_material:80,   color:'emerald', duracion:30},
    {id:'RES',   clave:'RES',   nombre:'Resina',                   precio:800,   costo_material:80,   color:'emerald', duracion:30},
    {id:'SF',    clave:'SF',    nombre:'Sellador / flúor',         precio:800,   costo_material:60,   color:'emerald', duracion:30},
    {id:'DUR',   clave:'DUR',   nombre:'Duraphat',                 precio:400,   costo_material:40,   color:'emerald', duracion:20},
    {id:'EXD',   clave:'EXD',   nombre:'Extracción decidua',       precio:600,   costo_material:80,   color:'amber',   duracion:30},
    {id:'EXP',   clave:'EXP',   nombre:'Extracción permanente',    precio:600,   costo_material:80,   color:'amber',   duracion:45},
    {id:'CA',    clave:'CA',    nombre:'Corona acero',             precio:1400,  costo_material:200,  color:'pink',    duracion:45},
    {id:'CAP',   clave:'CAP',   nombre:'Corona acero permanente',  precio:1800,  costo_material:300,  color:'pink',    duracion:60},
    {id:'CEL',   clave:'CEL',   nombre:'Celuloide',                precio:1500,  costo_material:250,  color:'pink',    duracion:45},
    {id:'MESP',  clave:'MESP',  nombre:'Mantenedor de espacio',    precio:2800,  costo_material:500,  color:'violet',  duracion:60},
    {id:'TXCA',  clave:'TXCA',  nombre:'Tx pulpar + corona',       precio:2800,  costo_material:350,  color:'violet',  duracion:60},
    {id:'TXRES', clave:'TXRES', nombre:'Tx pulpar + resina',       precio:2800,  costo_material:250,  color:'violet',  duracion:60},
    {id:'TXCEL', clave:'TXCEL', nombre:'Tx pulpar + celuloide',    precio:1500,  costo_material:400,  color:'violet',  duracion:60},
    {id:'TXP',   clave:'TXP',   nombre:'Tx pulpar',                precio:1400,  costo_material:150,  color:'violet',  duracion:45},
    {id:'UL',    clave:'UL',    nombre:'Ulectomía',                precio:1200,  costo_material:100,  color:'amber',   duracion:45},
    {id:'OR',    clave:'OR',    nombre:'Ortopedia / aparato',      precio:1500,  costo_material:400,  color:'violet',  duracion:45},
    {id:'CS',    clave:'CS',    nombre:'Cariestop',                precio:500,   costo_material:30,   color:'emerald', duracion:20},
    {id:'P',     clave:'P',     nombre:'Poste',                    precio:500,   costo_material:50,   color:'emerald', duracion:30},
    {id:'BANDA', clave:'BANDA', nombre:'Banda ansa',               precio:1000,  costo_material:200,  color:'violet',  duracion:45},
    {id:'LIGAS', clave:'LIGAS', nombre:'Ligas / ortodoncia',       precio:800,   costo_material:80,   color:'violet',  duracion:30},
    {id:'BIO',   clave:'BIO',   nombre:'Biopsia',                  precio:3000,  costo_material:300,  color:'red',     duracion:60},
    {id:'AG',    clave:'AG',    nombre:'Anestesia general',        precio:11800, costo_material:5500, color:'red',     duracion:180}
  ]), now]);

  // Doctores REALES con sus % de comisión (datos del Google Sheet vivo)
  // 0=dom, 1=lun, ..., 6=sab
  cfgSh.appendRow(['doctores', JSON.stringify([
    {
      id:'DR01', nombre:'Dra. Laura Vizcaíno (Dueña)', porcentaje:0, color:'amber',
      // Dueña: 0% de honorario (100% del cobro queda en consultorio)
      horario: {
        '2':[{i:'10:00',f:'14:00'}],
        '4':[{i:'10:00',f:'14:00'}]
      },
      excepciones: []
    },
    {
      id:'DR02', nombre:'Dra. Andrea', porcentaje:60, color:'sky',
      // Doctora principal — 60% para ella, 40% al consultorio
      horario: {
        '1':[{i:'15:00',f:'20:00'}],
        '2':[{i:'15:00',f:'20:00'}],
        '3':[{i:'15:00',f:'20:00'}],
        '4':[{i:'15:00',f:'20:00'}],
        '5':[{i:'15:00',f:'20:00'}],
        '6':[{i:'09:00',f:'13:00'}]
      },
      excepciones: []
    },
    {
      id:'DR03', nombre:'Dra. Pamela', porcentaje:55, color:'emerald',
      // 55% para ella, 45% al consultorio (esquema distinto)
      horario: {
        '1':[{i:'09:00',f:'14:00'}],
        '3':[{i:'09:00',f:'14:00'}]
      },
      excepciones: []
    },
    {
      id:'DR04', nombre:'Dra. Wendy', porcentaje:60, color:'violet',
      // Esporádica — 60/40 mismo esquema que Andrea
      horario: {
        '5':[{i:'09:00',f:'14:00'}]
      },
      excepciones: []
    }
  ]), now]);

  // Consultorio
  cfgSh.appendRow(['consultorio', JSON.stringify({
    nombre:'Consultorio Dental — Dra. Laura Vizcaíno',
    direccion:'Aguascalientes, Ags.',
    tel:'',
    rfc:'',
    lema:'Odontopediatría especializada',
    // Default si la doctora no tiene % específico (no debería usarse, cada doctora ya trae el suyo)
    porcentaje_doctor: 60,
    porcentaje_consultorio: 40,
    // Gastos fijos mensuales promedio (para cálculo de punto de equilibrio y utilidad real)
    gastos_fijos_mensuales: 8235
  }), now]);

  // Usuarios PIN — linkeados a cada doctora real
  cfgSh.appendRow(['usuarios', JSON.stringify([
    {pin:'0707',nombre:'Dra. Laura Vizcaíno',rol:'doctor',doctor_id:'DR01'},
    {pin:'0808',nombre:'Dra. Andrea',rol:'doctor',doctor_id:'DR02'},
    {pin:'0909',nombre:'Dra. Pamela',rol:'doctor',doctor_id:'DR03'},
    {pin:'0606',nombre:'Dra. Wendy',rol:'doctor',doctor_id:'DR04'},
    {pin:'1111',nombre:'Recepción',rol:'recepcion'},
    {pin:'9999',nombre:'Admin',rol:'admin'}
  ]), now]);

  // Conceptos de gasto (catálogo para futuro módulo de Gastos)
  cfgSh.appendRow(['conceptos_gasto', JSON.stringify([
    {id:'renta',          nombre:'Renta',              requiere_desc:false, color:'red'},
    {id:'asistente',      nombre:'Asistente',          requiere_desc:false, color:'amber'},
    {id:'contadora',      nombre:'Contadora',          requiere_desc:false, color:'amber'},
    {id:'deposito',       nombre:'Depósito',           requiere_desc:true,  color:'red'},
    {id:'laboratorio',    nombre:'Laboratorio',        requiere_desc:true,  color:'sky'},
    {id:'insumos',        nombre:'Insumos / material', requiere_desc:true,  color:'sky'},
    {id:'servicios',      nombre:'Servicios',          requiere_desc:true,  color:'emerald'},
    {id:'imprevistos',    nombre:'Imprevistos',        requiere_desc:true,  color:'red'},
    {id:'otros',          nombre:'Otros',              requiere_desc:true,  color:'sky'}
  ]), now]);

  // Pacientes (897)
  const pacSh = s.getSheetByName('pacientes');
  const headers = ENTITY_HEADERS.pacientes; // 11 cols
  const rows = PACIENTES_SEED.map(function(nombre) {
    return [Utilities.getUuid().slice(0,8), nombre, '', '', '', '', '', '', '', '{}', now];
  });
  if (rows.length > 0) {
    pacSh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return { ok: true, msg: 'Setup completo · ' + rows.length + ' pacientes cargados · 4 entradas de config inicializadas.' };
}

// =========================================================
// SEED de 897 pacientes reales del consultorio
// =========================================================
const PACIENTES_SEED = ["Alejandro Acevedo Martínez","María Inés Acosta Castro","Denni Jaziel Acosta López","Liam Yahir Acosta Ramírez","Ángela Teresa Acosta Rodríguez","Omar Franco Acosta Alvarez a","Miguel Ángel Acosta Santana","Santiago Acosta Santana","Dominic Jezrael Aguirre Dueñas","Luis Carlos Aguiñaga de la Mora","Emma Aguiñaga Rodriguez","Yadiel Aguiñaga Reyes","Osiel Isahi Aguilera Rodríguez","Renata Michelle Aguilar Floriano","Kenly Citlaly Aguilar Escobedo","Jesús Mario Alarcón García","Camila Alba Fierros","Valentina Alba Pérez","Julia Jimena Alba Rodríguez","Juan Ángel Alcantar Ornelas","Jonathan Alcantar Ornelas","Elida Alcantar Rivera","Victor Giancarlo Alejos Aranguren","Genesis Alfaro Alfaro","Mariana Alonso Guerrero","Samantha Alonso de Luna","Santiago Alvarado Macias","Pablo Alonso Alvarez Bernal","Valeria Álvarez Cardona","Martha Cristina Alvarez","Juan Pablo Alvarez Luevano","Santiago Alvarez Luevano","Bruno Matías Alvarado Barrón","Fernanda Marianella Amaya Robles","Leonardo Xavier Andrade Campos","Juan Carlos Andrés Contreras","Mateo Arrioja Tafoya","Esteban Miguel Arenas Martínez","Juan Carlos Araiza Ramírez","Luna Amelie Aragon Muñoz","Jesús Alberto Arévalo","Luciana Armendáriz Gutiérrez","David Froylan Ávila Zermeño","Isabella Ávalos Rodríguez","Dario Avila Escobar","Edgar Daniel Avila Zermeño","Allison Jashlin Badillo Esparza","Andrik Emiliano Badillo Esparza","Aiden Alexander Báez Ruiz","Ximena barajas García","Adal Gael Barajas Esquivel","Sofia Cristina Barajas Santillán","Ariana Sofia Barba Macías","Danna Sophia Barba Cortez","Renata Guadalupe Barcenas Morales","Grecia Amairani Barco Luevano","Alexi Paola Barrera Martinez","Kimberly Gabriela Barrón Martínez","María Fernanda Basañez García","Dante Erubiel Bastidos Santiago","Niza Yunuhaly Bastidas Santiago","Minerva Calipso Becerra Romero","Ashley Belmares Pizaña","María Fernanda Benítez González","Natalia Estefanía Berdin Sandoval","Nicole Bernal Santos","Diego Daniel Bernal Martínez","Matías Silem Bernabé Amaya","Florianne Zoe Bravo Castillo","Kislev Bravo Castillo","Gisellle Bravo Sánchez","José Emilio Briano Velázquez","Kenia Briones Jayme","Rafael Bueno de Anda","Ángel Armando Bustamante Jiménez","Emilio André Bustamante Jiménez","Dante Arturo Bustos García","Sebastián Haniel Cabañas Gómez","Anthony Cabrales Ponce","Iker Esau Caldera Rodríguez","Leonardo Calderón Martín","Kin Calvillo Quintero","Maya Calvillo Quintero","Anthony Guadalupe Camacho Rodríguez","Fernando Campos Amaro","Leonardo Campos Amaro","Fabio Santiago Campos Gallegos","Sofía Anahí Campos López","Jeremy Itzael Campos","Said Emmanuel Campos Rosales","Guillermo Sebastián Campos Serrano","Ana Yaretzi Cano Menelly","Samara Capuchino López","Daniel Capuchino Padilla","Santiago Cárdenas Ramírez","Dalila Cardenas Ayala","Caleb Samuel Cardenas Yáñez","Arturo Ramses Carmona Martínez","Javier Alejandro Carmona Martínez","Sebastián Carrión Rocha","Camila Carretero Dorantes","Juan Pablo Castañeda Esquivel","Ángel Mateo Castañeda Ibarra","Frida Valeria Castañeda Ibarra","Maximiliano Castañeda López","Jonathan Alejandro Castañeda Castañeda","Rene Castillo Ramírez","José Leonel Castillo Solís","Sebastián Castorena Huitrado","Darío Castorena Huitrado","Emiliano Castorena Ibarra","Abril Castro Arenas","Isaí Tadeo Castro Díaz de León","Naomi Castro Sanchez","Julio César Castro Zambrano","Santiago Cazares Salazar","Erick Alejandro Ceballos García","Gabriel Alexander Ceballos Rivera","Jessica Giselle Centeno Salazar","Victoria Cervantes Arroyo","Victoria Cervantes Reyes","Martín Santiago Cervantes Díaz","Diego Matías Cervantes Díaz","María Pía Cervantes Reyes","América Michel Charcas Hernández","Eunice Chavarría Mayora","Julián Chávez Ramírez","Paola Chiquito Díaz de León","Ana Sofía Cisneros Tavares","Allison Colin Roque","Víctor Manuel Colmenero Sánchez","Paula Contreras Barajas","Lizi Guadalupe Contreras García","Ana Isabella Contreras Muñoz","Emilie Valentina Cortes Aguilera","Elena Cortes Carranza","Angel Saul Cortes Landin","Aylin Cortes Mandujano","Sebastian Covarrubias Medina","Ashley Covarrubias Gutiérrez","Edson Israel Cruz Collazo","Gabriela Nicole Cruz Herrera","Frida Camila Cruz González","Emilio Antonio Cruz González","Emilia Cruz Quiroz","Ricardo Daniel Cruz Zamarripa","Laila Valentina Cuesta Jimenez","Mererid Betzabeth Cuevas Chávez","Eleonor Sofia Cuna Valencia","Santiago Alejandro Chávez Monreal","Eduardo Chiquito Díaz de León","Melanie Davila Martínez","Natalia Dávila Torres","Leonardo de Alva Saavedra","Jorge Vladimir de Alba Saavedra","Diana Paulina de Anda Macías","Santiago de la Cruz Rangel","Santiago de la Rosa de la Torre","Camilo de la Rosa Grimaldi","Isabella de La Rosa Grimaldi","Roxanna Janeth De la Rosa Herrera","José Maria de la Torre Zamora","Erandi Camilo de León Villanueva","Daniel de Lira Avelar","María José De Loera Escalante","Braily Yahir Delgadillo Romo","Isaac Yael Delgadillo Romo","María Guadalupe Delgado Hernández","María Belén Delgado Hernández","Renata Guadalupe Delgado Lara","Cristian de Jesús Delgado Serrano","Karla Mariel Díaz Álvarez","Mauricio Díaz Díaz de León","Carolina Montserrat Días Díaz de León","Luis Ángel Díaz Gutiérrez","Liam Leonel Díaz de León Solario","Yoltzin Díaz Hernández","Itzhae Díaz Jiménez","Evelyn Arlette Díaz de León Palomino","Luis Eduardo Díaz Sifuentes","Dayron Isaac Diosdado Roman","Fatima Constanza Domínguez Zamarripa","Abraham Cael Dos Santos Pulido","Benjamin A Dos Santos Pulido","Citlalli Judith Duran Avelar","Regina Duran Carrillo","Kevin Isaac Duran Roque","Ana Victoria Díaz Jiménez","Victoria Enríquez De Lizaola","Tadeo Enríquez Hernández","Juan Pablo Escalera Esquivel","Fernando Jacob Escalera Martínez","Jade Paulette Escalera Requenez","Helena Escobar Garcia","Alicia Esparza Corral","Amaya Romina Esparza De Lira","Alexia Ainara Esparza Estrada","Geraldine Scarlett Esparza Gámez","Said Eduardo Esparza Gámez","Dylan Emmanuel Esparza Gaytán","Karol Guadaluoe Esparza Espinoza","Brandon Jared Esquipula Ocampo","Morgan Esquivel Encina","Javier Estrada Estrada","Kendall Antonio Estrada Torres","Ian Nicolas Flores Campos","Maya Jatzibe Flores Castro","Paula Carolina Flores Díaz","Santiago Yanel Flores Gallegos","Regina Flores Jimenez","Valeria Flores Martínez","Nathaly Araceli Flores Martinez","Arturo Flores Ochoa","Paulo Flores Ochoa","Andre Leonardo Flores Rodriguez","Marian Flores Sanchez","Mariel Flores Sánchez","Michelle Flores Sánchez","Eitan Jesús Flores Zúñiga","Lya Jacqueline Frausto Mendoza","Emily Nikol Frausto Reyna","Samuel Frías Herrera","Frida Sophia García Elias","Rafael Galán González","Javier Galán González","Gael Santiago Gallardo Guerra","Mauricio Raziel Gallegos Ballin","Sebastián Gálvez Ramírez","Sofía Gamboa López","Víctor Leon Gaona Cortes","Renata Montserrat García Barrón","Eduardo Santiago García Castillo","Luis David García Cruz","Barbara Elaine García Esquivel","Mariana García Flores","Alison Victoria García González","Gisela García González","Dylan Armando García Hernández","Sofía García Hernández","José Manuel García López","Constanza Maribel García López","Íker David García López","Jaden Emmanuel García Macías","Annya Victoria García Magaña","Montserrat García Ramírez","Angela Renata García Reyes","Emilio Baudel García Reyes","Amaya García Rodríguez","Hanna Regina García Sanchez","Danna Sofia García Sanchez","Noah Leonardo García Vela","Julieta Merit García Ventura","Alejandro García Vital","Keiry Gaytán","Ana Victoria Gaytán López","Rey Salvador Gil Delgadillo","Zoé Ktharine Girón Medina","Manu Fernando Gómez Breceda","Mateo Eduardo Gómez Breceda","Kaleb Gómez Macías","Auden Gómez Macías","Victoria Esperanza Gómez Marquina","Ricardo Fabricio Gómez Moreno","Luis Jacob Gómez Ramírez","Karen Jocelyn Gómez Ramírez","Alberto Gómez Villalobos","Paula Gómez Villalobos","María Fernanda González Arellano","Dana Gabriela González Arellano","Alan González Barcenas","Leonardo G. González De Alba","Nestor Santiago González Anaya","Rene Santiago González Espinosa","Sara González Hernández","Benjamin González López","Obed Gregorio González Macías","Mariana Janeth González Mendoza","González Mendoza Belen Ariadna","González Ponce Victoria","González Romo Elsa M","González Ruiz Ángel de Jesús","González Ruiz Patricio","Goto Verá Akane","Grandes Breceda Arturo","Grajeda Breceda Emilio Alejandro","Guadarrama Calderon Christopher Gael","Guerrero Aguilar Esteban Alejandro","Guerrero Aguilar Fernando Damián","Guerrero Mendoza Genaro Sebastián","Guerrero Morales Gabriela Lizeth","Guerrero Ortiz Israel","Guerrero Palomino Ximena","Guevara Macías Lizeth Dannae","Gutierrez Esparza Mariela Lizette","Gutierrez Esparza Pablo","Gutierrez García Samantha","Gutierrez González Sophia Renata","Gutiérrez González Leonardo Gael","Gutiérrez Gutiérrez Víctor Alberto","Gutiérrez López Camila","Gutiérrez Lozano Pedro Gilberto","Gutiérrez Moreno Penelope","Gutierrez Ramírez Fátima Carolin","Gutierrez Torres Karol Melissa","Gutierrez Trinidad Renata","Gutierrez Trinidad Diego Antonio","Gutierrez aventura Hugo André","Gutierrez Ventura Ivanna Valentina","Gutierrez Villalobos Diego","Guzman Calderon Christopher Manuel","Guzman Ornelas Lorena","Guzman Torrez Keiry Victoria","Haro Ruiz Dania Estefanía","Heredia Villarreal Josef Jared","Heredia Villarreal Carol Montserrath","Herrera Bocardo Regina Arleth","Hernandez Arceo Ian Jared","Hernández Cuevas Eleni Victoria","Hernández De la Rosa Santiago","Hernandez Diaz Roberto Mateo","Hernandez Diaz Patricio","Hernández Gallegos Luis Rodolfo","Hernandez Gallegos Joaquin Jesus","Hernandez Gutierrez Julia Maria","Hernández Gutiérrez Gabriela Valentina","Hernández Floriano Aldo Mateo","Hernández Hernández Dominik","Hernández Martínez Emiliano","Hernández Martínez Andrea","Hernández Modesto Ángel Mateo","Hernández Modesto Celina","Hernandez Muro José Mateo","Hernández Ortega Oliver André","Hernández Reyes Santiago","Hernández Rivera Emma","Hernández Santillán Gabriela Angelique","Hernández Villalobos Humberto","Huerta Delgado Kenya Vanessa","Huerta Guerrero Damián","Huerta Ibáñez Ian Esteve","Huitrado Macías Dominic","Huizar González Dylan Jared","Ibarra Medina Éric Santiago","Ibarra Medina Allizon Guadalupe","Ibarra Pérez Iker Danilo","Ibarra Pérez Renata","Jaime Enríquez Nathalia Sofía","Jaime Medina Carlos Esteban","Jasso Pardo Zoé Alejandra","Jáuregui Ramírez Nelly Dayana","Jiménez Alcantar José Miguel","Jiménez Alcantar Pedro Alonso","Jiménez Jiménez Luis Armando","Jiménez Quiñones Aaliyah del Carmen","Jimenez Quiñones Aamir Sebastián","Jimenez Ramírez Francisco Alexander","Juárez de Lira Amelia","Juárez Flores Valeria Romina","Juárez Mauricio Nancy Naomi","Juárez Navarro Miguel Alexander","Juárez Tostado Mia Isabel","Juarez Gallegos Juan Pablo","Landin Arevalo Emma Lucia","Landois Zertuche Luis David","Lara Alonzo Eduardo","Lara Álvarez Juan Pablo","Lara Álvarez Karol Pavbva","Lara García Leonardo","Lara Guzmán Mauro Samuel","Lara Guzmán Carlos Tadeo","Lara Martínez José Amir","Lara Russell Sydney Shannell","Lara Russell Angel Matthew","Larios Guerrero Roxana Ahmed","Legaspi Ramírez Alexia Yamileth","Licon Lara Sheisy Hetzemany","Limón Huerta Mateo Alejandro","Llamas Acero Samara","Llamas Acero Ana Paula","Lona Jiménez Romina","Lona Jiménez Carmina","Lopez Aguilera Regina","Lopez Arenas Helena Concepcion","Lopez Arias Luis Fernando","Lopez Carrillo Efrain","Lopez Carrillo Emmanuel","Lopez Contreras Valentina","Lopez De Lara Barba Franco","Lopez de Lara Barba Regina","Lopez Escamilla Álvaro","López Esparza Geraldine Thaily","Lopez Garzon Aldo Matías","López González Melissa","López González Julia","López Lara Renata Betsabe","Lopez Lomelí Mónica Isabella","Lopez Lopez Carlos","López López Lucian Mateo","López Morales Iliana Sofía","López Navarro Mateo","López Nieto Antonio Ramses","López Oropeza María Regina","López Perea Isis Melina","López Pérez Héctor Saúl","López Rangel Máximo Raziel","López Reyes Lían André","López Romero Oscar Germán","López Romero Sara Ximena","López Solano Estefanía","López Torres Emiliano","López Torres Leonardo","López Torres María Paula","López Velasco Karla Angelica","López Villalpando Ximena","López Viscencio Renata","López Visencio Regina","Lozano Escobedo Diego Alejandro","Lucero Sánchez Jimmy Jahir","Lugo Meza Christian Arturo","Luevano Lupercio Alyson Andrea","Luevano Santana Jonathan de Jesús","Lujano Guizar Víctor","Macías Alfaro Miriam Fernanda","Macías Campos Ana Karen","Macías Córdova Hendrick Leonel","Macías Corral Zoé","Macías Durán Renata","Macías Flores Sofía Giselle","Macías Gutiérrez Ximena Alejandra","Macías Lozano Fabio Isaac","Macías Mireles Diego Alejandro","Macías Muñoz Ian Matías","Macías Regalado Emily","Macías Vargas Danna Lorena","Maho Rendón María José","Maho Rendón Fernando","Maho Rendón Ismael","Maho Rendón Andrea Isabel","Maldonado Alba Lisa Andrea","Maldonado Dávila Jordan","Maldonado Espinoza Emma Regina","Maldonado Espinoza Jennifer Alexa","Maldonado Espinoza Eva Naomi","Maldonado Juárez Luis Leonardo","Maldonado Juárez Arilu","Malo Esparza Andrea Jaqueline","Manríquez Roque Renata Ailinne","Marin Ponce Romina","Marquez Andrade Maria Elena","Martell Gutierrez Martha Elisa","Martell Ramirez Maria Paula","Martell Sanchez Joana","Martin del Campo Chinchillas Andres","Martin del Campo Chinchillas Karla Lucia","Martinez Aguilar Bianca Guadalupe","Martinez Alvarez Carlo Julian","Martínez Anaya Darío Elíam","Martínez Anaya Leonardo Dariel","Martínez Aguilar José Eduardo","Martínez Araujo César Alejandro","Martínez Arias Ivanna Yanixan","Martínez Delgado Diego Tadeo","Martínez De La Cruz Daniel Isaí","Martínez Delgado Edwin Yael","Malagon Rosales Jun","Manríquez Roque Héctor Zuriel","Martínez De la Mora Maximiliano","Martínez Díaz de León Darío Emiliano","Martínez Esparza Mauro Mateo","Martínez Esparza Victoria Isabella","Martínez Flores Stephanie","Martínez Garcia Francisco Javier","Martínez Juárez Pablo Mateo","Martínez López Carla Sofía","Martínez Mejía Jacqueline Estefanía","Martínez Muñoz Ángel Daniel","Martínez Muñoz Arami Laritza","Martínez Núñez Horlando Guadalupe","Martínez Reza Diego","Martínez Reza Emmanuel","Martínez Reza María José","Martínez Rivera Karen Sofía","Martínez Rivera Ibraham Alejandro","Martínez Santana Kendra Lineth","Martínez Santos José Manuel","Martínez Yitani Sebastián","Mata Araiza Samuel David","Maya Larios Luis Leonel","Mayoral Reyes María Isabel","Santiago Medina Héctor","Medina Gallegos Camilo Victoria","Medina Gómez Mateo Sebastián","Medina Montes Juan Alejandro","Medina Ornelas Julieta","Medina Palencia Julieta","Medina Velázquez Melany","Medrano Álvarez Lucrecia","Medrano Cervantes María Paula","Meléndez Durón Andrea","Mencias Ruiz Esparza Leonardo","Méndez García José Manuel","Méndez García Santiago","Méndez Nieto Omar de Jesús","Mendoza Mayorga Gabriel","Mercado Badillo Carlos Mercado","Mercado Caldera Luis Gerardo","Meza Arredondo Alondra","Meza Arredondo Alexa","Martínez Jiménez Marina","Maysen Emma Sophia","Meza Arredondo Andrea","Meza Muñoz Luis Fernando","Miranda Márquez Licsel Ivanna","Miranda Rangel Alejandro","Mireles García Grecia Nikole","Mojica Díaz Fátima y Ana Carol","Mojica Díaz Gabriela Janine","Monroy Espinosa Alan Manuel","Monroy Torres Mía","Montalvo Collazo María Renata","Montalvo Collazo Daniel Nicolás","Montañez Delgado Cinthya Rafaela","Montañez Muñoz Paula Sofía","Montes Acosta Juan Pablo","Montes Cortez Milton Isaac","Montes Jiménez Ángel Andrés","Montes Jiménez Roy","Montes Valdés Hiram Karin","Montiel Muñoz Aitana Aislinn","Montoya Díaz Fernando","Montoya Lozano Tadeo Martín","Montoya Marquina Dulce Alexandra","Mora Carreón Aitana Cristina","Mora Carreón Laia Sofía","Mora Cuevas Alejandra","Mora De Lizaola Cesar Humberto","Mora de Lizaola Sofía","Mora de Lizaola Aldo Alonso","Morales Contreras Salvador","Morales Contreras Matías","Morales Contreras José Luis","Morales Contreras Adrián","Morales Marín Juan Francisco","Morales Romero Ivanna","Morales Romero Bruno","Moran Acosta Mateo","Moreno Oyarzabol Ximena","Moreno Torres Miranda","Morones Lara Marian Alejandra","Muñoz Díaz Juan Pablo","Muñoz Díaz Víctor Manuel","Muñoz Gutiérrez Melanie","Muñoz Hernandez Cristopher","Muñoz Hernandez Haydee Montserrat","Muñoz Hernández Sebastián de Jesús","Muñoz Jiménez Cristopher","Muñoz Luna Julieta","Muñoz Macías Caylee","Muñoz Ramírez Dulce María","Muñoz Rodríguez Melanie Paulette","Muñoz Rodríguez María José","Muñoz Salazar Mario Alejandro","Mures Domínguez Carlos","Muro González Isaí","Muro Herrado Alberto","Muro Herrada Fernanda Elizabeth","Muro Reyes Naim Ramses","Murrieta Ramírez Dereck Mateo","Muzquiz Treviño Roberta María","Martínez Santos Santiago","Nava Valdivia Darío","Navarro Sabois Ricardo Ramses","Neri García Denise Valentina","Nevárez Barraza Ivanna","Nevárez Barraza Emmanuel","Nieto Torres Wendy Victoria","Nieves Trejo Aranza Estefanía","Noguez Martínez Alexia M","Núñez Carrera Melissa Pamela","Núñez Carrera Kirle Edit","Ochoa Miranda Carlos Daniel","Ochoa Muñoz Fernando","Ochoa Muñoz Maximiliano","Oliva Ambriz Isabela","Olvera Macías Yahir","Olvera Sosa Iván Ramiro","Olvera Vázquez Pablo","Olvera Vázquez Santiago Ismael","Olvera Vázquez Daniel","Orenday Durán Jorge Eduardo","Ornelas Gudiño Paula Renata","Ornelas Gudiño Rafael Alejandro","Ornelas Mata Zarelly Joselin","Ornelas Morales Axel Maximiliano","Ornelas Villa María José","Oropeza Aguilera Daniel","Orozco Aguiñaga Natalia Valentina","Orozco Domínguez Luisa Romina","Orozco González Violeta Guadalupe","Orozco Macías Mariana Victoria","Orozco Ramírez Luis Daniel","Orozco Ramírez Mauricio","Orozco Ramírez Ximena Sofía","Ortiz Cañeda Alejandra","Ortiz López Aranza Guadalupe","Ortiz Martínez Bruno","Ortega Barrera Mateo","Ortega Barrera Nora Diana","Ortega Barrera Pablo Eugenia","Ortega Gonzalez Ana Maria","Ovalle González Jesús Armando","Pacheco Serna Ainhoa Fernanda","Pacheco Serna Evelyn Natalia","Padilla García Luciana","Padilla Muñoz Maximiliano","Palacios Coronado Juan Carlos","Parra Ruiz Fernanda","Patiño Avendaño Luisa Mariam","Pavón Martínez Lourdes Mayela","Paz y Puente Torres Eduardo Saúl","Pedroza Góngora Ángel Mateo","Pedroza Ramírez Oscar Emilio","Peralta Montañez Erika Paola","Pereira Vega Natalia Jezabel","Pereira Vega Raúl Mateo","Pérez Adán Aldo Isaac","Pérez Basurto Axel Fernando","Pérez Gutiérrez Manuel Gerardo","Pérez Martínez Andrey","Pérez Martínez Rafael Antonio","Pérez Medina Esgary","Pérez Medina Farys","Pérez Moreno David Alejandro","Pérez Navarro Jesús Alejandro","Pérez Navarro Luis Enrique","Pérez Pérez Allison Mía","Pérez Pérez África Amaya","Pérez Prieto Rafael","Pérez Rincón Ricardo Salim","Pérez Valtierra Adrián","Pérez Valtierra José Arturo","Pérez Yáñez Rebeca","Pérez Zepeda Emma Alejandra","Pineda Moreno Juan Pablo","Pineda Moreno Fátima Valentina","Pineda Peña Mariana","Pinet Garza Pablo","Ponce García Constanza","Ponce Montoya Jaime Adrián","Preciado Salas Paula Alejandra","Puebla Aguillon José Carlos","Puga Torres Eva Yaretzi","Puga Torres Iker Yadiel","Quezada Silva Juan Pablo","Quezada Patiño Diego Gael","Quezada Reyes Pedro","Quezada Silva Matteo","Quintanar Santacruz Jesús","Ramírez Barrera Regina","Ramirez Barrera Romina","Ramírez Becerra Dayana Nicole","Ramírez De Luna Katherine Lucero","Ramirez Fernández Dario","Ramírez Garcia Anthony Gael","Ramírez Gutiérrez Maite Amayrani","Ramírez Gutierrez Melannie Valentina","Ramírez Jiménez Enrique","Ramírez Juárez Zoe Renata","Ramírez Marin Ricardo Irving","Ramírez Marín Regina","Ramírez Montoya David","Ramírez Navarro José Andrés","Ramírez Pedraza Roberto Carlos","Ramírez Sánchez Franco","Ramos Díaz Luis Javier","Ramos Martínez Edgar Rafael","Rangel Loza Ángela Isabel","Rangel Loza Gustavo Alberto","Rangel Martínez Diego Alexander","Regalado Salas Omar Emiliano","Regalado Salas Santiago Farid","Reinoso Mercado Luis Antonio","Rendón Esquivel Jimena","Rendón Esquivel Eduardo","Rentería Pérez Sergio Manuel","Rentería Pérez Mateo","Requenes Yerik Anatoly","Reyes Cervantes Erick Aaron","Reyes Elías Fernanda Yamileth","Reyes Elias Atziri Getsemani","Reyes Elias Zoe Itzayana","Reyes Hernández Fernando Mateo","Reyes Herrera Ihan Josue","Reyes Macias Sofía","Reyes Martínez Milan","Reyes Patiño Alexander","Reyes Ramos Dora Camila","Reyes Reyes Oliver Mateo","Reyes Rosas Carlos Santiago","Reynel González Alejandro","Reynel González Isabella","Reynoso Ramírez Lidia Karolaine","Rivera Cabrera Santino Tarig","Rios García Renata Valentina","Rivera Hernández Ashley Montserrat","Rios Martinez Jose Sebastián","Rivera Rodriguez Valeria Sofia","Robles Becerra Ariadne Yamileth","Robles Becerra Camila Geraldine","Robles Islas Leonel","Rocha Jara Elena","Rocha Jara Sebastián","Rodea Martínez Roberto Emilio","Rodríguez Cárdenas Ana Sofia","Rodríguez Chávez Santiago","Rodríguez De la Rosa Esteban","Rodríguez Diaz Jafet Itamar","Rodríguez Esparza Luis Santiago","Rodríguez Esparza Daleyssa","Rodríguez Esparza Brian André","Rodríguez Flores Daniela Alejandra","Rodríguez Gadea Jorge Esteban","Rodríguez García Miguel Ángel","Rodríguez Gutiérrez Eric Gadiel","Rodríguez Hernández Franco","Rodríguez Hernández Paulina Jazmín","Rodríguez Jiménez Meredith Mabell","Rodríguez Jiménez Cristian Eduardo","Rodríguez Jiménez Dana Gisell","Rodríguez Lopez Leonardo Alexander","Rodríguez L Cristia Josue","Rodríguez Mata Alan Sebastián","Rodríguez Muñoz Juan Manuel","Rodríguez Neri Zoe","Rodríguez Pedroza José María","Rodríguez Ramírez Manuel","Rodríguez Romero Jennifer","Rodríguez Romero Jaqueline","Rodríguez Santillan Nefertity","Rodríguez Serna Julieta","Rodríguez Tello Alice Cristina","Rodríguez Tello Sofía Alejandra","Rodríguez Vázquez Victoria","Rodríguez Vázquez Víctor Leonardo","Rodríguez Villalobos Hyram Elías","Rodríguez Villalobos Daniela","Rojas Ruiz Ximena Michelle","Romero Delgado Estrella Guadalupe","Romero Escobar Leonardo Gael","Romero Pedroza Dominick Alexander","Romo González Tadeo Jahel","Romo Herrera Natalia Isabella","Romo Lopez Óscar Alejandro","Romo Saucedo Michael Tadeo","Romo Segura Zoe","Romo Valtierra Victoria","Roque Colin Astrid Azul","Roqueñi Salado Martha","Rosales Balderas Rommel","Rosales Iturriaga Fátima","Rosales Rodríguez Nathalia Romanela","Rosales Solorzano Caeli Yaritza","Rosales Torres Karol Emanuel","Rosales Vázquez Jerónimo","Rosales Vázquez Maria Andrea","Ruvalcaba De Luna Juan Gerardo","Rubio Aranda Evelyn Xareni","Rubio Aranda Ethan Francisco","Rubio Caretta Gustavo","Rubio Caretta Giovanna","Rubio Medina Aaliyah","Ruiz Alfaro Iker","Ruiz Alfaro Mabel","Ruiz Cruz Martha Vanessa","Ruiz Esparza Eric","Ruiz Esparza Isaac","Ruiz Esparza Daniel","Ruiz Esparza Jade Mayte","Ruiz Esparza David","Ruiz Esparza Gómez Ana Paula","Ruiz Leos Yesenia Nataly","Ruiz Vázquez Jonathan Iván","Ruvalcaba Amezcua Leonardo David","Ruvalcaba Cruz Luis Ángel","Ruvalcaba Cruz Valentin de Jesús","Ruvalcaba Hernández Santiago","Ruvalcaba Hernández Victoria","Romo Carlos Jose Miguel","Salas Campos Miriam","Salas Cruz Alexander","Salas Muñoz Fabián Emmanuel","Salas Suarez Fabián Alejandro","Salas Tiscareño Jayden Ramses","Salazar López César Isac","Salazar Muñoz Kendra","Salgado Pérez Juan Alberto","Saldivar García Carlos Daniel","Sánchez Ávila José Isaac","Sanchez Colunga Mario","Sánchez De Alba Rodrigo","Sánchez De la Cruz Nadia Ivonne","Sánchez Gozain Abby","Sánchez Gil Roselyn","Sánchez Ibarra Ian Matías","Sánchez Montes Romina Isabela","Sánchez Morcho Erik Elías","Sánchez Rodríguez Erwin Mathias","Sánchez Rosales Esther Victoria","Sánchez Santacruz Aranza M","Sánchez Vázquez Abigail","Sánchez Ávila Enrique","Sandate Delgadillo Cristal Montserrat","Sandoval Avelar Juan Gerardo","Sandoval Escobedo Elías","Sandoval Medina Helena","Sandoval Peña Elian","Sandoval Vázquez Franco Jeshua","Santana Rubio Aime Montserrat","Santillan Arellano Aaron Alexis","Santos Gutierrez Sara Lucia","Santos Torres Alexa Guadalupe","Santoyo Sánchez Arantza Camila","Sapien Pérez Diego","Saucedo Ramírez Samantha de Rebeca","Segovia López Milan Sebastián","Seoane Zermeño Nacim","Serna Diaz José Luis","Serna Pérez Maria José","Serna Rubalcava Anthony Mateo","Silva González Rafael","Silva Torres José Carlos","Silva Sánchez Luis Armando","Silva Sánchez Camila Guadalupe","Soledad Leyva Emilio","Soledad Pérez Karol Abigail","Solis de la Cruz Zoe Adali","Solis Flores Damián Alejandro","Sosa Herrera Francisco Javier","Suarez Alonso Elisa Mariana","Sucrez Gallegos Juan Pablo","Suarez Gallegos Luis Gabriel","Shepherd Cruz Meritxell","Sánchez Rosales Paula Daniela","Tabarez Torres Jonathan Alexander","Tabarez Torres Fernanda Kaori","Tapia Diaz Katherin Aitana","Tavares Llanas Elías Francisco","Terrones López Alison","Torres Mercado Elisa Montserrat","Torres Mercado Derek Ivan","Trujillo Mora Axel Dali","Torres Monrreal Aleyda Janeth","Torres Moreno Renata","Torres Pedroza Valeria Guadalupe","Torres Ramirez Abril","Torres Ubario Karla Valentina","Valadez Arevalo Heidi Yaretzi","Valadez Valerie","Valdez Jiménez Dana Renata","Valdez Smith Mac Donald Lucia","Valencia Ruelas Maya Jatzibe","Valenzuela Miguel Angel","Vallejo Valadez Allen Decker","Valtierra Macias Ricardo Alejandro","Van Riessen González Diego","Varela Casas Regina","Varela Ramírez Ariadne Itzae","Vargas Iñiguez Ximena","Vargas Luna Juana Sarahy","Vargas Ruvalcaba Víctor Rene","Vasquez Salas Sara Renata","Varyes Barcenas Alberto Leonel","Vazquez Correa Neli Yoselin","Vazquez Moreno Paulina","Vazquez Salas Sara Renata","Vazquez Salas Debani Fernanda","Vazquez Hernández Nahum Aaron","Vázquez Jiménez América Roberta","Vázquez Mata Christian Jesús","Vega Aguilera Joaquín","Vega Aguilera Alejandro","Vega Ramírez Mónica Daniela","Velazquez Buendia Rafael Velazquez","Velazquez Parada Salvador","Velazquez Parada Ana Valme","Velazquez Parada Fátima","Veloz Macias Montserrath Guadalupe","Venegas Vargas Fernanda Sofia","Ventura Ibarra Edgar","Vera Delgadillo Kristian","Vera Delgadillo Karen","Villalobos Rangel Jonathan M","Villalpando González Ángel Eduardo","Villalpando González Xiama Yexamile","Villamil Cabrera Angel","Villamil Cabrera Cesar A","Villanueva Romero Lucio André","Valencia Ruvalcaba Marcelo","Valtierra Medrano Samara","Valtierra Medrano Isabella Sofía","Valadez Ávila Julieta","Vega Carmona Natalia Ashley","Villaseñor Hernández Rafael","Villanueva Luciano Alejandro Geremy","Andrea Isabella Jiménez Serna","Ángela Ariana Gaytán Morales","Anna Paula Reyes Hernández","Ángela Campos Guillen","Alyson Edenelly Martínez Ramírez","Ana Sofía Arreguín García","Arianna Valentina Alcalá Román","Alexa Guadalupe Heredia Andrade","Cándida Evelia Delgado Reyes","Emma Luna Márquez","Elsa Moragrega Torres","Emily Naydelin de Lira Rodríguez","Emily Arantza de la Rosa Herrera","Emilia León Zamarripa","Fátima ojedos Ruiz","Florencia González González","Frida Renata Briano López","Fernanda Arellano Galarza","Gisel Julieta García Castillo","Irma Yoselyn Morales Cruz","Itzel Nataly Martínez Ramírez","Kate Leilany Córdova Tapia","Karol Gabino Santillán","Leah Daniela Pacheco Serrano","Laila Nefertiti Becerra Romero","Luna Price Camacho","Leona Rosario Bautista","Mía Valentina Rentería Pérez","Mía Camelia Paredes Cordenas","María Fernanda Campos Guillen","Mayte Brigitte de Lira Rodríguez","María Sofía Mares Macías","Metan Sarahí Aguirre Ruiz","Mayra Nailea Plascencia Esquivias","Nila Aylin Cruz Morales","Natalia Jazmín Serrano Arriaga","Paula Sofía Núñez Herrera","Renata Guerrero Palomino","Romina Daniela Hernández Jauregui","Regina Aislinn Ramírez Gutiérrez","Renata Sofía Santiago Truieque","Susany Victoria Islas Ornelas","Sara Regina Mares Macías","Sofía Alejandra Castañeda López","Sofía Chiquito González","Sofía Huert Orozco","Sara Luna Márquez","Tairi Carolina Sánchez López","Ximena León Zamarripa","Andrés Nicolás Lara Guzmán","Ángeles Gabino Santillán","Alejandro García Hernández","Anthony Suziel Islas Ornelas","Antonio Ramírez Espinoza","Ángel Leonel Rodríguez Barba","Andrik Elíam Aguilera Rodríguez","Alberto Mayoral Reyes","Angel Ceballos García","Antonio Hernández Gallegos","Bruno Paredes Cárdenas","Amelia González Delgado","Brandon Gael Hernández Silva","Cesar Israel Núñez Torres","Diego Oliver Pinke","Daniel Emiliano González Martínez","Dominic Jezrael Aguirre","Darío Alexander López Balderas","Diego Dax Banvelos García","Franco Gael Hernández Villalobos","Íker Mateo Díaz Gutiérrez","Ismael Alejandro Ávila Sierra","Íker Rodríguez Barba","Juan Fernando Medina Muñoz","Javier Negueruela Miranda","José Andrés Ortega González","Juan Antonio Lozano González","José Jared Ríos Pérez","Joseph Mateo Escalera Mendoza","Jorge Campos Guillen","Juan Manuel Herrera T","Kerem Kinali","Luis Maximiliano Hernández Guerra","Leonardo Huerta Orozco","Luna Emiliano Ciaytein García","Leónidas Guillermo Neri Santillán","Luis Esteban Moreno Lechuga","Mario Alejandro Ocampo","Michel Maximiliano Bustos García","Mateo Guerrero Palomino","Matías Acosta Castro","Miguel Ángel Meza Muro","Patricio Hernández Díaz","Porfirio Alejandro López Quiroga","Rodrigo Hernández Jauregui","Renato Nicolás González Martínez","Ricardo Alejandro Soto Roldán","Santiago Bastidas Rodríguez","Santiago Roa Ramírez","Sebastián Hernández Rodríguez","Santiago Nicolás Miranda Ibarra","Arev Barragon Romo","Almendra Valentina Rangel Salas","Mariana Ochoa","María Paula Reynel","Isabela Floriano","Emilia Hernández","Sergio Maximo Neri","Reinaldo Lara Russel","Cristóbal Hernández","Mía Victoria Ruiz Hernández","Paul Anelre Cordero Aguirre","Ana Sofía Ruiz Medina","Ian Sánchez Gozain","Zoé P Martínez Carlin","Alberto Galarza Canché"];

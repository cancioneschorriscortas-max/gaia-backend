require('dotenv').config()
const express = require('express')
const neo4j = require('neo4j-driver')
const slugify = require('slugify')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { body, param, query, validationResult } = require('express-validator')
const rateLimit = require('express-rate-limit')
const helmet = require('helmet')
const https = require('https')
const app = express()
const PORT = 4000

// ── INICIO: constantes ───────────────────────────────
const JWT_SECRET     = process.env.JWT_SECRET
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
const CODIGO_PROFESOR = process.env.CODIGO_PROFESOR


if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET non definido no .env')
  process.exit(1)
}

const TIPOS_NODO_VALIDOS    = ['origin','galaxy','constellation','system','concept','process']
const STATUS_VALIDOS        = ['draft','validated','deprecated']
const RELEVANCIA_VALIDA     = ['high','medium','low']
const DIFICULTADE_VALIDA    = ['primary','secondary','expert']
const ROLES_VALIDOS         = ['alumno','profesor']
const TIPOS_RELACION_VALIDOS = [
  'PERTENCE_A','PARTE_DE','E_UN','INSTANCIA_DE','TRANSFORMA',
  'PRODUCE','USA','RELACIONADO_CON','SIMILAR_A','INSPIRADO_EN',
  'ANTES_DE','DESPOIS_DE'
]
const NIVEIS_USUARIO = [
  { nivel: 1,  xp: 0,    titulo: 'Explorador',     cor: '#6ee7b7' },
  { nivel: 2,  xp: 100,  titulo: 'Viaxeiro',        cor: '#6ee7b7' },
  { nivel: 3,  xp: 250,  titulo: 'Cartógrafo',      cor: '#93c5fd' },
  { nivel: 4,  xp: 500,  titulo: 'Navegante',       cor: '#93c5fd' },
  { nivel: 5,  xp: 900,  titulo: 'Astrónomo',       cor: '#c4b5fd' },
  { nivel: 6,  xp: 1400, titulo: 'Gardián',         cor: '#c4b5fd' },
  { nivel: 7,  xp: 2000, titulo: 'Sabio',           cor: '#e2b96a' },
  { nivel: 8,  xp: 2800, titulo: 'Oráculo',         cor: '#e2b96a' },
  { nivel: 9,  xp: 3800, titulo: 'Arquitecto',      cor: '#ff9f7f' },
  { nivel: 10, xp: 5000, titulo: 'Gardián de GAIA', cor: '#ffffff' },
]
// ── FIN: constantes ──────────────────────────────────
const ROLES_PERSONAXE_VALIDOS = [
  'explorador', 'sabio', 'construtor', 'coidador'
]
//Cursos
const CURSOS_VALIDOS = [
  '5prim','6prim','1eso','2eso','3eso','4eso',
  '1bach','2bach','fpbasica','fpmedio','fpsup','outro'
]
//
// ── INICIO: nomes_relacions ──────────────────────────
const NOMES_RELACIONS = {
  PERTENCE_A:      { gl: 'Pertence a',      es: 'Pertenece a',    en: 'Belongs to',
                     gl_inv: 'Contén',       es_inv: 'Contiene',   en_inv: 'Contains'        },
  PARTE_DE:        { gl: 'Parte de',        es: 'Parte de',       en: 'Part of',
                     gl_inv: 'Inclúe',       es_inv: 'Incluye',    en_inv: 'Includes'        },
  E_UN:            { gl: 'É un',            es: 'Es un',          en: 'Is a',
                     gl_inv: 'Inclúe tipo',  es_inv: 'Incluye tipo', en_inv: 'Includes type' },
  INSTANCIA_DE:    { gl: 'Instancia de',    es: 'Instancia de',   en: 'Instance of',
                     gl_inv: 'Ten instancia', es_inv: 'Tiene instancia', en_inv: 'Has instance' },
  TRANSFORMA:      { gl: 'Transforma',      es: 'Transforma',     en: 'Transforms',
                     gl_inv: 'Transformado por', es_inv: 'Transformado por', en_inv: 'Transformed by' },
  PRODUCE:         { gl: 'Produce',         es: 'Produce',        en: 'Produces',
                     gl_inv: 'Producido por', es_inv: 'Producido por', en_inv: 'Produced by' },
  USA:             { gl: 'Usa',             es: 'Usa',            en: 'Uses',
                     gl_inv: 'Usado por',    es_inv: 'Usado por',  en_inv: 'Used by'         },
  RELACIONADO_CON: { gl: 'Relacionado con', es: 'Relacionado con', en: 'Related to',
                     gl_inv: 'Relacionado con', es_inv: 'Relacionado con', en_inv: 'Related to' },
  SIMILAR_A:       { gl: 'Similar a',       es: 'Similar a',      en: 'Similar to',
                     gl_inv: 'Similar a',    es_inv: 'Similar a',  en_inv: 'Similar to'      },
  INSPIRADO_EN:    { gl: 'Inspirado en',    es: 'Inspirado en',   en: 'Inspired by',
                     gl_inv: 'Inspira',      es_inv: 'Inspira',    en_inv: 'Inspires'        },
  ANTES_DE:        { gl: 'Antes de',        es: 'Antes de',       en: 'Before',
                     gl_inv: 'Despois de',   es_inv: 'Después de', en_inv: 'After'           },
  DESPOIS_DE:      { gl: 'Despois de',      es: 'Después de',     en: 'After',
                     gl_inv: 'Antes de',     es_inv: 'Antes de',   en_inv: 'Before'          }
}
// ── FIN: nomes_relacions ─────────────────────────────

// ── INICIO: config_neo4j ─────────────────────────────
const driver = neo4j.driver(
  process.env.NEO4J_URI      || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER   || 'neo4j',
    process.env.NEO4J_PASS   || 'gaia1234'
  ),
  { encrypted: false }
)
// ── FIN: config_neo4j ────────────────────────────────


// ── INICIO: n4_num ───────────────────────────────────
// Converte un valor que pode ser Integer de Neo4j, número,
// string ou undefined a un número JS real.
const n4num = (v) => {
  if (v === null || v === undefined) return 0
  if (typeof v?.toNumber === 'function') return v.toNumber()
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
// ── FIN: n4_num ──────────────────────────────────────

// ── INICIO: helmet_e_cors ────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}))
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})
app.use(express.json({ limit: '100kb' }))
// ── FIN: helmet_e_cors ───────────────────────────────

// ── INICIO: rate_limiting ────────────────────────────
const limitXeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Demasiadas peticions. Agarda uns minutos.' },
  standardHeaders: true,
  legacyHeaders: false
})
const limitAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de autenticación.' }
})
const limitLua = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Demasiadas mensaxes a LÚA. Agarda un momento.' }
})
const limitXP = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Demasiados eventos XP.' }
})
app.use(limitXeral)
// ── FIN: rate_limiting ───────────────────────────────
// ── INICIO: limites_ia ───────────────────────────────
const LIMITES_IA = {
  lua_mensaxes_dia:    20,
  retos_dia:           25,
  lua_historial_max:   8,
  lua_mensaxes_explorador: 5
}
// ── FIN: limites_ia ──────────────────────────────────
// ── INICIO: helpers ──────────────────────────────────
const validar = (req, res) => {
  const erros = validationResult(req)
  if (!erros.isEmpty()) {
    res.status(400).json({ error: 'Datos inválidos', detalle: erros.array() })
    return false
  }
  return true
}

const calcularNivel = (xpTotal) => {
  let nivelActual = NIVEIS_USUARIO[0]
  let nivelSeguinte = NIVEIS_USUARIO[1]
  for (let i = NIVEIS_USUARIO.length - 1; i >= 0; i--) {
    if (xpTotal >= NIVEIS_USUARIO[i].xp) {
      nivelActual  = NIVEIS_USUARIO[i]
      nivelSeguinte = NIVEIS_USUARIO[i + 1] || null
      break
    }
  }
  return {
    ...nivelActual,
    xpTotal,
    xpSeguinte:  nivelSeguinte ? nivelSeguinte.xp : null,
    tituloSeguinte: nivelSeguinte ? nivelSeguinte.titulo : null,
    progreso: nivelSeguinte
      ? Math.round(((xpTotal - nivelActual.xp) / (nivelSeguinte.xp - nivelActual.xp)) * 100)
      : 100
  }
}

async function getIdiomasActivos(session) {
  const result = await session.run('MATCH (c:Config {key: "idiomas"}) RETURN c')
  if (result.records.length === 0) return ['gl', 'es', 'en']
  return JSON.parse(result.records[0].get('c').properties.value)
}
/// ── INICIO: helper_limites_ia ────────────────────────
async function verificarLimiteIA(session, userId, tipo) {
  const hoxe       = new Date().toDateString()
  const campoCount = `ia_${tipo}_count`
  const campoReset = `ia_${tipo}_reset`
  const limite     = LIMITES_IA[`${tipo}_dia`] || 20

  const result = await session.run(
    `MATCH (u:Usuario {id: $userId})
     RETURN u[$campoCount] AS count,
            u[$campoReset] AS reset`,
    { userId, campoCount, campoReset }
  )

  if (result.records.length === 0) {
    return { permitido: false, motivo: 'Usuario non atopado' }
  }

  const record   = result.records[0]
  const reset    = record.get('reset') || ''
  const rawCount = record.get('count')
  // ── INICIO: fix_bigint ───────────────────────────
  // Neo4j pode devolver BigInt — converter sempre a Number
  const count = rawCount === null || rawCount === undefined
    ? 0
    : typeof rawCount === 'object' && rawCount.toNumber
      ? rawCount.toNumber()
      : Number(rawCount)
  // ── FIN: fix_bigint ──────────────────────────────

  // Resetear contador se é un día novo
  if (reset !== hoxe) {
    await session.run(
      `MATCH (u:Usuario {id: $userId})
       SET u[$campoCount] = 0,
           u[$campoReset] = $hoxe`,
      { userId, campoCount, campoReset, hoxe }
    )
    return { permitido: true, restantes: limite - 1 }
  }

  if (count >= limite) {
    return {
      permitido: false,
      motivo:    `Límite diario alcanzado (${limite} por día)`,
      restantes: 0
    }
  }

  return { permitido: true, restantes: limite - count - 1 }
}

async function incrementarContadorIA(session, userId, tipo) {
  const campoCount = `ia_${tipo}_count`
  await session.run(
    `MATCH (u:Usuario {id: $userId})
     SET u[$campoCount] = coalesce(u[$campoCount], 0) + 1`,
    { userId, campoCount }
  )
}
// ── FIN: helper_limites_ia ───────────────────────────
// ── FIN: helpers ─────────────────────────────────────

// ── INICIO: middleware_jwt ───────────────────────────
const verificarJWT = (req, res, next) => {
  const cabeceira = req.headers['authorization']
  if (!cabeceira || !cabeceira.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token non proporcionado' })
  }
  const token = cabeceira.split(' ')[1]
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.usuario = payload
    next()
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' })
    }
    return res.status(401).json({ error: 'Token inválido' })
  }
}

const soProfesor = (req, res, next) => {
  if (req.usuario?.rol !== 'profesor' && req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso restrinxido a profesores' })
  }
  next()
}
// ── FIN: middleware_jwt ──────────────────────────────

// ── INICIO: ruta_estado ──────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'GAIA API', version: '0.8' })
})
// ── FIN: ruta_estado ─────────────────────────────────

app.post('/auth/rexistro', limitAuth, [
  body('nome')
    .trim().notEmpty().withMessage('Nome obrigatorio')
    .isLength({ min: 2, max: 60 }).withMessage('Nome entre 2 e 60 caracteres')
    .escape(),
  body('xenero')
    .optional()
    .isIn(['m', 'f']).withMessage('Xénero inválido'),
  body('contrasinal')
    .isLength({ min: 8 }).withMessage('Contrasinal mínimo 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('O contrasinal precisa maiúsculas, minúsculas e números'),
  body('centro')
    .trim().optional({ nullable: true })
    .isLength({ max: 100 }).withMessage('Centro máximo 100 caracteres')
    .escape(),
  body('curso')
    .optional()
    .isIn(CURSOS_VALIDOS).withMessage('Curso inválido'),
  body('rol')
    .optional()
    .isIn(['alumno', 'profesor']).withMessage('Rol inválido'),
  body('codigo_profesor')
    .optional().trim(),
  // ── NOVO: validación código arquitecto ──────────────
  body('codigo_arquitecto')
    .optional().trim()
  // ── FIN: validación código arquitecto ───────────────
], async (req, res) => {
  // ── INICIO: honeypot_antibot ─────────────────────────
  if (req.body.website) {
    return res.status(201).json({ ok: true, token: 'fake', usuario: {} })
  }
  // ── FIN: honeypot_antibot ────────────────────────────
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { nome, contrasinal, centro = '', rol = 'alumno', codigo_profesor } = req.body

    // ── INICIO: verificar_codigo_profesor ────────────────
    if (rol === 'profesor') {
      if (!codigo_profesor || codigo_profesor !== CODIGO_PROFESOR) {
        return res.status(403).json({ error: 'Código de profesor incorrecto' })
      }
    }
    // ── FIN: verificar_codigo_profesor ──────────────────

    // ── INICIO: verificar_codigo_arquitecto ─────────────
    // O arquitecto é un profesor con código extra
    const esArquitecto = !!(
      req.body.codigo_arquitecto &&
      req.body.codigo_arquitecto === process.env.CODIGO_ARQUITECTO
    )
    // ── FIN: verificar_codigo_arquitecto ────────────────

    const existe = await session.run(
      'MATCH (u:Usuario {nome: $nome, centro: $centro}) RETURN u',
      { nome, centro }
    )
    if (existe.records.length > 0) {
      return res.status(409).json({
        error: 'Xa existe un usuario con ese nome nese centro'
      })
    }

    const id = require('crypto').randomUUID()
    const hashContrasinal = await bcrypt.hash(contrasinal, 12)
    const agora = new Date().toISOString()

    // ── INICIO: crear_usuario_neo4j ──────────────────────
    // Campo arquitecto gardado en Neo4j
    await session.run(`
      CREATE (u:Usuario {
        id: $id, nome: $nome, centro: $centro,
        rol: $rol, contrasinal: $hashContrasinal,
        curso: $curso, xenero: $xenero,
        arquitecto: $arquitecto,
        rol_personaxe: '',
        bloque_personaxe: '',
        profesion_personaxe: '',
        xp_total: 0, xp_exploracion: 0,
        xp_conexion: 0, xp_comprension: 0,
        creado: $agora, ultimo_acceso: $agora
      })
    `, {
      id, nome, centro, rol, hashContrasinal,
      curso:       req.body.curso  || 'outro',
      xenero:      req.body.xenero || 'm',
      arquitecto:  esArquitecto,
      agora
    })
    // ── FIN: crear_usuario_neo4j ─────────────────────────

    // ── INICIO: xerar_token_rexistro ─────────────────────
    // Usar variables locais (id, nome, etc.) non u.xxx que non existe aquí
    const token = jwt.sign(
      {
        id, nome, centro, rol,
        curso:         req.body.curso  || 'outro',
        xenero:        req.body.xenero || 'm',
        rol_personaxe: '',
        arquitecto:    esArquitecto
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )
    // ── FIN: xerar_token_rexistro ────────────────────────

    res.status(201).json({
      ok: true,
      token,
      usuario: {
        id, nome, centro, rol,
        curso:         req.body.curso  || 'outro',
        xenero:        req.body.xenero || 'm',
        rol_personaxe: '',
        arquitecto:    esArquitecto,
        xp_total: 0,
        nivel: calcularNivel(0)
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_rexistro ───────────────────────────────

// ── INICIO: ruta_login ───────────────────────────────
app.post('/auth/login', limitAuth, [
  body('nome').trim().notEmpty().escape(),
  body('centro').trim().optional({ nullable: true }).escape(),
  body('contrasinal').notEmpty()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { nome, centro = '', contrasinal } = req.body

    const result = await session.run(
      'MATCH (u:Usuario {nome: $nome, centro: $centro}) RETURN u',
      { nome, centro }
    )
    if (result.records.length === 0) {
      return res.status(401).json({ error: 'Credenciais incorrectas' })
    }

    const u = result.records[0].get('u').properties
    const contrasinálCorrecta = await bcrypt.compare(contrasinal, u.contrasinal)
    if (!contrasinálCorrecta) {
      return res.status(401).json({ error: 'Credenciais incorrectas' })
    }

    await session.run(
      'MATCH (u:Usuario {id: $id}) SET u.ultimo_acceso = $agora',
      { id: u.id, agora: new Date().toISOString() }
    )

    const xpTotal = u.xp_total?.toNumber ? u.xp_total.toNumber() : (u.xp_total || 0)

    // ── INICIO: xerar_token_login ────────────────────────
    // arquitecto lido de Neo4j e incluído no JWT
    const token = jwt.sign(
      {
        id: u.id, nome: u.nome, centro: u.centro,
        rol:           u.rol,
        curso:         u.curso         || 'outro',
        xenero:        u.xenero        || 'm',
        rol_personaxe: u.rol_personaxe || '',
        arquitecto:    u.arquitecto === true || u.arquitecto === 'true'
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )
    // ── FIN: xerar_token_login ───────────────────────────

    res.json({
      ok: true,
      token,
      usuario: {
        id: u.id, nome: u.nome, centro: u.centro,
        rol:           u.rol,
        curso:         u.curso         || 'outro',
        xenero:        u.xenero        || 'm',
        rol_personaxe:       u.rol_personaxe       || '',
        bloque_personaxe:    u.bloque_personaxe     || '',
        profesion_personaxe: u.profesion_personaxe  || '',
        arquitecto: u.arquitecto === true || u.arquitecto === 'true',
        xp_total:       xpTotal,
      xp_exploracion: n4num(u.xp_exploracion),
      xp_conexion:    n4num(u.xp_conexion),
      xp_comprension: n4num(u.xp_comprension),
        nivel: calcularNivel(xpTotal)
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_login ──────────────────────────────────

// ── INICIO: ruta_perfil ──────────────────────────────
app.get('/auth/perfil', verificarJWT, async (req, res) => {
  const session = driver.session()
  try {
    const result = await session.run(
      'MATCH (u:Usuario {id: $id}) RETURN u',
      { id: req.usuario.id }
    )
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Usuario non atopado' })
    }
    const u = result.records[0].get('u').properties
    const xpTotal = u.xp_total?.toNumber ? u.xp_total.toNumber() : (u.xp_total || 0)

    res.json({
      id: u.id, nome: u.nome, centro: u.centro,
      rol: u.rol, curso: u.curso || 'outro',
      xenero: u.xenero || 'm',
      rol_personaxe:       u.rol_personaxe       || '',
      bloque_personaxe:    u.bloque_personaxe     || '',
      profesion_personaxe: u.profesion_personaxe  || '',
      // ── NOVO: arquitecto no perfil ───────────────────
      arquitecto: u.arquitecto === true || u.arquitecto === 'true',
      // ── FIN: arquitecto no perfil ────────────────────
      xp_total:       xpTotal,
     xp_exploracion: n4num(u.xp_exploracion),
     xp_conexion:    n4num(u.xp_conexion),
     xp_comprension: n4num(u.xp_comprension),
      nivel: calcularNivel(xpTotal),
      creado:        u.creado,
      ultimo_acceso: u.ultimo_acceso
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_perfil ─────────────────────────────────
// ── FIN: rutas_auth ──────────────────────────────────
// ── INICIO: ruta_actualizar_rol ──────────────────────
app.put('/usuario/rol', verificarJWT, [
  body('rol_personaxe')
    .isIn(['explorador', 'sabio', 'construtor', 'coidador', ''])
    .withMessage('Rol inválido'),
  body('bloque_personaxe')
    .optional().trim().isLength({ max: 50 }).escape(),
  body('profesion_personaxe')
    .optional().trim().isLength({ max: 50 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { rol_personaxe, bloque_personaxe = '', profesion_personaxe = '' } = req.body
    await session.run(
      `MATCH (u:Usuario {id: $id})
       SET u.rol_personaxe      = $rol_personaxe,
           u.bloque_personaxe   = $bloque_personaxe,
           u.profesion_personaxe = $profesion_personaxe`,
      { id: req.usuario.id, rol_personaxe, bloque_personaxe, profesion_personaxe }
    )
    res.json({ ok: true, rol_personaxe, bloque_personaxe, profesion_personaxe })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_actualizar_rol ─────────────────────────
// ── INICIO: rutas_xp ─────────────────────────────────
app.post('/xp', verificarJWT, limitXP, [
  body('tipo')
    .isIn(['exploracion', 'conexion', 'comprension'])
    .withMessage('Tipo XP inválido'),
  body('cantidade')
    .isInt({ min: 1, max: 100 })
    .withMessage('Cantidade XP inválida'),
  body('motivo')
    .trim().notEmpty()
    .isLength({ max: 100 })
    .escape(),
  body('nodoId')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 })
    .escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { tipo, cantidade, motivo, nodoId = null } = req.body
    const userId = req.usuario.id
    const eventoId = require('crypto').randomUUID()
    const agora = new Date().toISOString()

    // Crear evento inmutable
    await session.run(`
      MATCH (u:Usuario {id: $userId})
      CREATE (e:XPEvento {
        id: $eventoId, tipo: $tipo,
        cantidade: $cantidade, motivo: $motivo,
        nodoId: $nodoId, ts: $agora
      })
      CREATE (u)-[:GAÑOU]->(e)
      SET u.xp_total       = u.xp_total + $cantidade,
          u.xp_${tipo}     = u.xp_${tipo} + $cantidade,
          u.ultimo_acceso  = $agora
    `, { userId, eventoId, tipo, cantidade, motivo, nodoId, agora })

    // Devolver nivel actualizado
    const perfil = await session.run(
      'MATCH (u:Usuario {id: $id}) RETURN u.xp_total AS xp',
      { id: userId }
    )
    const xpNovo = perfil.records[0]?.get('xp')?.toNumber?.() ||
                   perfil.records[0]?.get('xp') || 0

    res.json({
      ok: true,
      xp_total: xpNovo,
      nivel: calcularNivel(xpNovo)
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.get('/xp/:userId/resumo', verificarJWT, async (req, res) => {
  // Só o propio usuario ou un profesor poden ver o resumo
  if (req.usuario.id !== req.params.userId && req.usuario.rol !== 'profesor') {
    return res.status(403).json({ error: 'Sen permiso' })
  }
  const session = driver.session()
  try {
    const result = await session.run(
      'MATCH (u:Usuario {id: $id}) RETURN u',
      { id: req.params.userId }
    )
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Usuario non atopado' })
    }
    const u = result.records[0].get('u').properties
    const xpTotal = u.xp_total?.toNumber?.() || u.xp_total || 0

    // Últimos 10 eventos
    const eventos = await session.run(`
      MATCH (u:Usuario {id: $id})-[:GAÑOU]->(e:XPEvento)
      RETURN e ORDER BY e.ts DESC LIMIT 10
    `, { id: req.params.userId })

    res.json({
      xp_total:       xpTotal,
     xp_exploracion: n4num(u.xp_exploracion),
    xp_conexion:    n4num(u.xp_conexion),
    xp_comprension: n4num(u.xp_comprension),
      nivel:  calcularNivel(xpTotal),
      eventos: eventos.records.map(r => r.get('e').properties)
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: rutas_xp ────────────────────────────────────
// ═══════════════════════════════════════════════════════════
// OBERÓN — Endpoints backend (Fase 1)
// ═══════════════════════════════════════════════════════════
//
// COMO USAR:
//   1. Localiza no teu index.js a sección "// ── FIN: rutas_xp ─"
//      (ou calquera punto antes de "// ── INICIO: ruta_listar_nodos ─").
//   2. Pega TODO este bloque xusto despois.
//   3. Reinicia o servidor (Ctrl+C, npm start).
//
// DEPENDE DE: nada novo. Usa o driver Neo4j e middlewares xa existentes
// (verificarJWT, validar, n4num).
// ═══════════════════════════════════════════════════════════


// ── INICIO: rutas_oberon ──────────────────────────────


// ── GET /profesions ──────────────────────────────────
// Lista todas as profesións. Pódese filtrar por rol/bloque.
// Pública: non require login.
//
// QUERY:  ?rol=explorador&bloque=emerxencias  (opcional)
// RESP:   { total: 41, profesions: [...] }
app.get('/profesions', [
  query('rol').optional().isIn(['explorador', 'sabio', 'construtor', 'coidador']),
  query('bloque').optional().trim().isLength({ max: 50 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { rol, bloque } = req.query
    let cypher = 'MATCH (p:Profesion)'
    const conds = []
    const params = {}
    if (rol)    { conds.push('p.rol = $rol');       params.rol = rol }
    if (bloque) { conds.push('p.bloque = $bloque'); params.bloque = bloque }
    if (conds.length > 0) cypher += ' WHERE ' + conds.join(' AND ')
    cypher += ' RETURN p ORDER BY p.rol, p.bloque, p.label'

    const result = await session.run(cypher, params)
    const profesions = result.records.map(r => {
      const p = r.get('p').properties
      return {
        id:                   p.id,
        rol:                  p.rol,
        bloque:               p.bloque,
        label:                p.label,
        icono:                p.icono,
        proxeccion:           p.proxeccion,
        salario_medio:        n4num(p.salario_medio),
        risco_automatizacion: p.risco_automatizacion,
        via_formativa:        p.via_formativa,
        descricion_curta_gl:  p.descricion_curta_gl,
        descricion_curta_es:  p.descricion_curta_es
      }
    })
    res.json({ total: profesions.length, profesions })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})


// ── GET /profesion/:id ───────────────────────────────
// Detalle dunha profesión + skills (con pesos) + rutas vinculadas (futuro).
// Pública.
app.get('/profesion/:id', [
  param('id').trim().isLength({ min: 1, max: 100 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const result = await session.run(
      `MATCH (p:Profesion {id: $id})
       OPTIONAL MATCH (p)-[r:NECESITA_SKILL]->(s:Skill)
       RETURN p, collect({
         id: s.id, label: s.label,
         categoria: s.categoria, icono: s.icono,
         peso: r.peso
       }) AS skills`,
      { id: req.params.id }
    )
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Profesión non atopada' })
    }
    const p = result.records[0].get('p').properties
    const skillsRaw = result.records[0].get('skills')
    // Filtrar nulos (caso sen relacións) e ordenar por peso desc
    const skills = skillsRaw
      .filter(s => s.id)
      .map(s => ({ ...s, peso: n4num(s.peso) }))
      .sort((a, b) => b.peso - a.peso)

    res.json({
      id:                   p.id,
      rol:                  p.rol,
      bloque:               p.bloque,
      label:                p.label,
      icono:                p.icono,
      proxeccion:           p.proxeccion,
      salario_medio:        n4num(p.salario_medio),
      risco_automatizacion: p.risco_automatizacion,
      via_formativa:        p.via_formativa,
      descricion_curta_gl:  p.descricion_curta_gl,
      descricion_curta_es:  p.descricion_curta_es,
      skills
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})


// ── GET /skills ──────────────────────────────────────
// Lista as 12 skills canónicas. Pública.
app.get('/skills', async (req, res) => {
  const session = driver.session()
  try {
    const result = await session.run(
      'MATCH (s:Skill) RETURN s ORDER BY s.categoria, s.label'
    )
    const skills = result.records.map(r => {
      const s = r.get('s').properties
      return {
        id:        s.id,
        label:     s.label,
        categoria: s.categoria,
        icono:     s.icono
      }
    })
    res.json({ total: skills.length, skills })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})


// ── POST /test/calcular ──────────────────────────────
// Recibe perfil de skills do usuario, devolve top profesións por afinidade.
// Pública. NON garda nada.
//
// BODY:  { perfil: { empatía: 12, creatividad: 8, ... } }
// RESP:  { top: [{ profesion: {...}, afinidade: 87 }, ...] }
app.post('/test/calcular', [
  body('perfil').isObject().withMessage('perfil debe ser un obxecto'),
  body('top').optional().isInt({ min: 1, max: 50 })
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { perfil } = req.body
    const top = req.body.top || 5

    // Normalizar perfil do usuario [0..1]
    const valores = Object.values(perfil).map(Number)
    const maxUser = Math.max(...valores, 1)
    const userNorm = {}
    Object.entries(perfil).forEach(([k, v]) => {
      userNorm[k] = Number(v) / maxUser
    })

    // Cargar todas as profesións con as súas skills
    const result = await session.run(`
      MATCH (p:Profesion)-[r:NECESITA_SKILL]->(s:Skill)
      RETURN p.id           AS id,
             p.label        AS label,
             p.icono        AS icono,
             p.rol          AS rol,
             p.bloque       AS bloque,
             p.proxeccion   AS proxeccion,
             p.risco_automatizacion AS risco,
             collect({skill: s.id, peso: r.peso}) AS skills
    `)

    const afinidades = result.records.map(rec => {
      const skills = rec.get('skills')
      let score = 0
      let pesoTotal = 0
      skills.forEach(({ skill, peso }) => {
        const pesoNum = n4num(peso)
        pesoTotal += pesoNum
        score += (userNorm[skill] || 0) * pesoNum
      })
      const afinidade = pesoTotal > 0 ? score / pesoTotal : 0
      return {
        id:         rec.get('id'),
        label:      rec.get('label'),
        icono:      rec.get('icono'),
        rol:        rec.get('rol'),
        bloque:     rec.get('bloque'),
        proxeccion: rec.get('proxeccion'),
        risco:      rec.get('risco'),
        afinidade:  Math.round(afinidade * 100)
      }
    }).sort((a, b) => b.afinidade - a.afinidade)

    res.json({
      total:      afinidades.length,
      top:        afinidades.slice(0, top),
      todas:      afinidades  // por se a UI quere mostralas todas nun details
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

 /// ═══════════════════════════════════════════════════════════
// OBERÓN — Endpoint /oberon/profesion/:id/completa (v2)
// ═══════════════════════════════════════════════════════════
//
// CAMBIOS desde a v1:
//   - Engadido campo `imaxe_escena_url` na profesión
//   - Engadido campo `icono` en cada microskill
//
// COMO USAR:
//   Se xa pegaches a v1 ao index.js, SUBSTITÚE o bloque
//   completo polo de abaixo. Despois reinicia backend.
// ═══════════════════════════════════════════════════════════


// ── GET /oberon/profesion/:id/completa ───────────────
//
// Devolve TODA a información Oberón dunha profesión:
//   - Datos básicos + epigrafe + descricion_poetica + imaxe_escena_url
//   - Skills canónicas con pesos
//   - Grupos temáticos con posicións e icones
//   - Micro-skills con icono, posición, descricións, accion_clave...
//
// PÚBLICO. Acceso por URL temporal (sen login aínda).
//
app.get('/oberon/profesion/:id/completa', [
  param('id').trim().isLength({ min: 1, max: 100 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    // ── 1. Profesión + skills canónicas (con pesos) ──
    const profResult = await session.run(
      `MATCH (p:Profesion {id: $id})
       OPTIONAL MATCH (p)-[r:NECESITA_SKILL]->(s:Skill)
       RETURN p, collect({
         id: s.id,
         label: s.label,
         categoria: s.categoria,
         icono: s.icono,
         peso: r.peso
       }) AS skills`,
      { id: req.params.id }
    )

    if (profResult.records.length === 0) {
      return res.status(404).json({ error: 'Profesión non atopada' })
    }

    const p = profResult.records[0].get('p').properties
    const skillsRaw = profResult.records[0].get('skills')
    const skills = skillsRaw
      .filter(s => s.id)
      .map(s => ({ ...s, peso: n4num(s.peso) }))
      .sort((a, b) => b.peso - a.peso)

    // ── 2. Grupos temáticos da profesión ──
    const gruposResult = await session.run(
      `MATCH (p:Profesion {id: $id})-[:TEN_GRUPO]->(g:GrupoTematico)
       RETURN g
       ORDER BY g.id`,
      { id: req.params.id }
    )

    const grupos = gruposResult.records.map(r => {
      const g = r.get('g').properties
      return {
        id: g.id,
        label_gl: g.label_gl,
        label_es: g.label_es,
        label_en: g.label_en,
        icono: g.icono,
        cor: g.cor,
        skill_canonica_dominante: g.skill_canonica_dominante,
        posicion: { x: n4num(g.posicion_x), y: n4num(g.posicion_y) }
      }
    })

    // ── 3. Micro-skills da profesión ──
    const microResult = await session.run(
      `MATCH (p:Profesion {id: $id})-[:TEN_MICROSKILL]->(m:MicroSkill)
       OPTIONAL MATCH (m)-[:CONECTADA_CON]->(m2:MicroSkill)
       RETURN m, collect(m2.id) AS conectadas
       ORDER BY m.id`,
      { id: req.params.id }
    )

    const microskills = microResult.records.map(r => {
      const m = r.get('m').properties
      return {
        id: m.id,
        label_gl: m.label_gl,
        label_es: m.label_es,
        label_en: m.label_en,
        icono: m.icono,                            // ← NOVO
        que_significa_gl: m.que_significa_gl,
        que_significa_es: m.que_significa_es,
        que_significa_en: m.que_significa_en,
        accion_clave_gl: m.accion_clave_gl,
        accion_clave_es: m.accion_clave_es,
        accion_clave_en: m.accion_clave_en,
        grupo_id: m.grupo_id,
        skill_canonica_id: m.skill_canonica_id,
        video_url: m.video_url,
        video_proveedor: m.video_proveedor,
        posicion: { x: n4num(m.posicion_x), y: n4num(m.posicion_y) },
        conectadas: r.get('conectadas').filter(Boolean)
      }
    })

    // ── 4. Resposta completa ──
    res.json({
      id: p.id,
      rol: p.rol,
      bloque: p.bloque,
      label: p.label,
      icono: p.icono,
      proxeccion: p.proxeccion,
      salario_medio: n4num(p.salario_medio),
      risco_automatizacion: p.risco_automatizacion,
      via_formativa: p.via_formativa,
      descricion_curta_gl: p.descricion_curta_gl,
      descricion_curta_es: p.descricion_curta_es,
      // Campos Oberón:
      epigrafe_gl: p.epigrafe_gl,
      epigrafe_es: p.epigrafe_es,
      epigrafe_en: p.epigrafe_en,
      descricion_poetica_gl: p.descricion_poetica_gl,
      descricion_poetica_es: p.descricion_poetica_es,
      descricion_poetica_en: p.descricion_poetica_en,
      imaxe_escena_url: p.imaxe_escena_url,        // ← NOVO
      oberon_completo: p.oberon_completo === true,
      // Estrutura:
      skills,
      grupos,
      microskills
    })

  } catch (err) {
    console.error('[oberon/profesion/completa] Erro:', err)
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})


// ── FIN: rutas_oberon ─────────────────────────────────



// ── GET /test/meu ────────────────────────────────────
// Devolve o test gardado do usuario actual (ou null se non hai).
// REQUIRE: JWT.
app.get('/test/meu', verificarJWT, async (req, res) => {
  const session = driver.session()
  try {
    const result = await session.run(
      `MATCH (u:Usuario {id: $userId})-[:FIXO_TEST]->(t:TestResult)
       RETURN t ORDER BY t.ts DESC LIMIT 1`,
      { userId: req.usuario.id }
    )
    if (result.records.length === 0) {
      return res.json({ test: null })
    }
    const t = result.records[0].get('t').properties
    res.json({
      test: {
        id:     t.id,
        perfil: JSON.parse(t.perfil),
        top:    JSON.parse(t.top),
        ts:     t.ts
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── INICIO: ruta_listar_nodos ────────────────────────
app.get('/nodos', async (req, res) => {
  const session = driver.session()
  try {
    const result = await session.run('MATCH (n:Node) RETURN n')
    const nodos = result.records.map(record => {
      const n = record.get('n').properties
      return {
        id:         n.id,
        label:      n.label_gl,
        type:       n.type     || 'concept',
        status:     n.status   || 'draft',
        relevance:  n.relevance || 'medium',
        difficulty: n.difficulty,
        autor:      n.autor    || '',
        centro:     n.centro   || ''
      }
    })
    res.json({ total: nodos.length, nodos })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_listar_nodos ───────────────────────────

// ── INICIO: ruta_obter_nodo ──────────────────────────
app.get('/nodo/:id', [
  param('id').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const result = await session.run(
      'MATCH (n:Node {id: $id}) RETURN n',
      { id: req.params.id }
    )
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Nodo non atopado' })
    }
    const n = result.records[0].get('n').properties
    const mediaResult = await session.run(
      'MATCH (n:Node {id: $id})-[:HAS_MEDIA]->(m:Media) RETURN m',
      { id: req.params.id }
    )
    const media = mediaResult.records.map(r => r.get('m').properties)
    const idiomas = await getIdiomasActivos(session)

    const labels  = {}
    const content = { primary: {}, secondary: {}, expert: {} }
    const retos   = { primary: {}, secondary: {}, expert: {} }
    idiomas.forEach(i => {
      labels[i]             = n[`label_${i}`]            || ''
      content.primary[i]    = n[`text_primary_${i}`]     || ''
      content.secondary[i]  = n[`text_secondary_${i}`]   || ''
      content.expert[i]     = n[`text_expert_${i}`]      || ''
      retos.primary[i]      = n[`reto_primary_${i}`]     || ''
      retos.secondary[i]    = n[`reto_secondary_${i}`]   || ''
      retos.expert[i]       = n[`reto_expert_${i}`]      || ''
    })

    res.json({
      id:             n.id,
      type:           n.type       || 'concept',
      status:         n.status     || 'draft',
      relevance:      n.relevance  || 'medium',
      difficulty:     n.difficulty,
      labels, content, media, retos,
      reto_bloqueado: n.reto_bloqueado !== undefined ? n.reto_bloqueado : true,
      reto_puntos:    n.reto_puntos || 10,
      idiomas,
      autor:          n.autor  || '',
      centro:         n.centro || ''
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_obter_nodo ─────────────────────────────

// ── INICIO: ruta_relacions_nodo ──────────────────────
app.get('/nodo/:id/relacions', [
  param('id').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const outResult = await session.run(
      `MATCH (a:Node {id: $id})-[r]->(b:Node)
       RETURN type(r) AS tipo, b.id AS target, b.label_gl AS label,
              properties(r) AS props, 'out' AS direccion`,
      { id: req.params.id }
    )
    const inResult = await session.run(
      `MATCH (a:Node)<-[r]-(b:Node)
       WHERE a.id = $id
       RETURN type(r) AS tipo, b.id AS target, b.label_gl AS label,
              properties(r) AS props, 'in' AS direccion`,
      { id: req.params.id }
    )
    const mapRecord = (record) => {
      const props = record.get('props')
      const tipo  = record.get('tipo')
      const nome  = NOMES_RELACIONS[tipo] || {
        gl: tipo, es: tipo, en: tipo,
        gl_inv: tipo, es_inv: tipo, en_inv: tipo
      }
      return {
        tipo, nome,
        id:        record.get('target'),
        label:     record.get('label'),
        direccion: record.get('direccion'),
        context: {
          gl: props.context_gl || null,
          es: props.context_es || null,
          en: props.context_en || null
        },
        level:    props.level    || 'primary',
        strength: props.strength || 'medium',
        existe:   true
      }
    }
    res.json({
      nodo: req.params.id,
      relacions: [
        ...outResult.records.map(mapRecord),
        ...inResult.records.map(mapRecord)
      ]
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_relacions_nodo ─────────────────────────

// ── INICIO: ruta_contexto_nodo ───────────────────────
app.get('/nodo/:id/contexto', [
  param('id').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const idiomas = await getIdiomasActivos(session)
    const result  = await session.run(
      `MATCH (n:Node {id: $id})-[:PERTENCE_A]->(s:Node)
       OPTIONAL MATCH (s)-[:PERTENCE_A]->(g:Node)
       OPTIONAL MATCH (g)-[:PERTENCE_A]->(c:Node)
       RETURN s, g, c`,
      { id: req.params.id }
    )
    const contextos = result.records.map(r => {
      const labels = (node) => {
        if (!node) return null
        const p = node.properties
        const l = { id: p.id }
        idiomas.forEach(i => { l[i] = p[`label_${i}`] || p.label_gl || '' })
        return l
      }
      return {
        system:        labels(r.get('s')),
        galaxy:        labels(r.get('g')),
        constellation: labels(r.get('c'))
      }
    })
    res.json({ nodo: req.params.id, contextos })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_contexto_nodo ──────────────────────────

// ── INICIO: ruta_journeys_nodo ───────────────────────
app.get('/nodo/:id/journeys', [
  param('id').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const idiomas = await getIdiomasActivos(session)
    const result  = await session.run(
      `MATCH (j:Journey)-[:HAS_STOP]->(n:Node {id: $id}) RETURN j`,
      { id: req.params.id }
    )
    const journeys = result.records.map(r => {
      const j     = r.get('j').properties
      const label = {}
      const description = {}
      idiomas.forEach(i => {
        label[i]       = j[`label_${i}`]       || ''
        description[i] = j[`description_${i}`] || ''
      })
      return {
        id:         j.id,
        label,
        description,
        level:      j.level,
        type:       j.type,
        status:     j.status,
        visibility: j.visibility || 'private',
        modulo:     j.modulo     || 'Xeral',
        icono:      j.icono      || '📚'
      }
    })
    res.json({ nodo: req.params.id, journeys })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_journeys_nodo ──────────────────────────

// ── INICIO: ruta_crear_nodo ──────────────────────────
app.post('/nodo', verificarJWT, [
  body('label_gl')
    .trim().notEmpty().withMessage('label_gl obrigatorio')
    .isLength({ min: 1, max: 120 }).escape(),
  body('type')
    .isIn(TIPOS_NODO_VALIDOS).withMessage('Tipo de nodo inválido'),
  body('status')
    .optional().isIn(STATUS_VALIDOS),
  body('relevance')
    .optional().isIn(RELEVANCIA_VALIDA),
  body('difficulty')
    .optional().isIn(DIFICULTADE_VALIDA),
  body('autor')
    .optional().trim().isLength({ max: 100 }).escape(),
  body('centro')
    .optional().trim().isLength({ max: 100 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const id = slugify(req.body.label_gl, {
      lower: true, strict: true, locale: 'es', replacement: '_'
    })
    const existe = await session.run(
      'MATCH (n:Node {id: $id}) RETURN n', { id }
    )
    if (existe.records.length > 0) {
      return res.status(409).json({
        error: `Xa existe un nodo con id "${id}"`, id
      })
    }

    const idiomas = await getIdiomasActivos(session)
    // Usar autor/centro do JWT se non se pasan explicitamente
    const autor  = req.body.autor  || req.usuario.nome   || ''
    const centro = req.body.centro || req.usuario.centro || ''

    let createFields = `id: $id, label: $label_gl,
                        type: $type, status: $status,
                        relevance: $relevance, difficulty: $difficulty,
                        autor: $autor, centro: $centro`
    const params = {
      id,
      label_gl:   req.body.label_gl   || '',
      type:       req.body.type       || 'concept',
      status:     req.body.status     || 'draft',
      relevance:  req.body.relevance  || 'medium',
      difficulty: req.body.difficulty || 'primary',
      autor, centro
    }
    idiomas.forEach(i => {
      createFields += `, label_${i}: $label_${i}`
      createFields += `, text_primary_${i}: $text_primary_${i}`
      createFields += `, text_secondary_${i}: $text_secondary_${i}`
      createFields += `, text_expert_${i}: $text_expert_${i}`
      params[`label_${i}`]          = req.body[`label_${i}`]          || ''
      params[`text_primary_${i}`]   = req.body[`text_primary_${i}`]   || ''
      params[`text_secondary_${i}`] = req.body[`text_secondary_${i}`] || ''
      params[`text_expert_${i}`]    = req.body[`text_expert_${i}`]    || ''
    })
    await session.run(`CREATE (n:Node { ${createFields} }) RETURN n`, params)
    res.json({ ok: true, id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_crear_nodo ─────────────────────────────

// ── INICIO: ruta_editar_nodo ─────────────────────────
app.put('/nodo/:id', verificarJWT, [
  param('id').trim().isLength({ min: 1, max: 150 }).escape(),
  body('type').optional().isIn(TIPOS_NODO_VALIDOS),
  body('status').optional().isIn(STATUS_VALIDOS),
  body('relevance').optional().isIn(RELEVANCIA_VALIDA),
  body('difficulty').optional().isIn(DIFICULTADE_VALIDA),
  body('autor').optional().trim().isLength({ max: 100 }).escape(),
  body('centro').optional().trim().isLength({ max: 100 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    // Só profesor ou admin poden cambiar status a 'validated'
    if (req.body.status === 'validated' && req.usuario.rol !== 'profesor') {
      return res.status(403).json({
        error: 'Só un profesor pode validar nodos'
      })
    }

    const idiomas = await getIdiomasActivos(session)
    const {
      type, status, relevance, difficulty,
      reto_bloqueado, reto_puntos, autor, centro
    } = req.body

    let setClause = `n.type = $type, n.status = $status,
                     n.relevance = $relevance, n.difficulty = $difficulty,
                     n.reto_bloqueado = $reto_bloqueado,
                     n.reto_puntos = $reto_puntos,
                     n.autor = $autor, n.centro = $centro`
    const params = {
      id:            req.params.id,
      type:          type       || 'concept',
      status:        status     || 'draft',
      relevance:     relevance  || 'medium',
      difficulty:    difficulty || 'primary',
      reto_bloqueado: reto_bloqueado !== undefined ? reto_bloqueado : true,
      reto_puntos:   reto_puntos || 10,
      autor:         autor  || '',
      centro:        centro || ''
    }
    idiomas.forEach(i => {
      setClause += `, n.label_${i} = $label_${i}`
      setClause += `, n.text_primary_${i} = $text_primary_${i}`
      setClause += `, n.text_secondary_${i} = $text_secondary_${i}`
      setClause += `, n.text_expert_${i} = $text_expert_${i}`
      setClause += `, n.reto_primary_${i} = $reto_primary_${i}`
      setClause += `, n.reto_secondary_${i} = $reto_secondary_${i}`
      setClause += `, n.reto_expert_${i} = $reto_expert_${i}`
      params[`label_${i}`]          = req.body[`label_${i}`]          || ''
      params[`text_primary_${i}`]   = req.body[`text_primary_${i}`]   || ''
      params[`text_secondary_${i}`] = req.body[`text_secondary_${i}`] || ''
      params[`text_expert_${i}`]    = req.body[`text_expert_${i}`]    || ''
      params[`reto_primary_${i}`]   = req.body[`reto_primary_${i}`]   || ''
      params[`reto_secondary_${i}`] = req.body[`reto_secondary_${i}`] || ''
      params[`reto_expert_${i}`]    = req.body[`reto_expert_${i}`]    || ''
    })
    await session.run(
      `MATCH (n:Node {id: $id}) SET ${setClause} RETURN n`, params
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_editar_nodo ────────────────────────────

// ── INICIO: ruta_borrar_nodo ─────────────────────────
app.delete('/nodo/:id', verificarJWT, soProfesor, [
  param('id').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const countResult = await session.run(
      `MATCH (n:Node {id: $id})-[r]-() RETURN count(r) AS total`,
      { id: req.params.id }
    )
    const totalRelacions = countResult.records[0].get('total').toNumber()
    await session.run(
      'MATCH (n:Node {id: $id}) DETACH DELETE n',
      { id: req.params.id }
    )
    res.json({ ok: true, relacionsBorradas: totalRelacions })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_borrar_nodo ────────────────────────────

// ── INICIO: ruta_media ───────────────────────────────
app.post('/nodo/:id/media', verificarJWT, [
  param('id').trim().isLength({ min: 1, max: 150 }).escape(),
  body('type').isIn(['youtube', 'link', 'pdf', 'image']).withMessage('Tipo media inválido'),
  body('url').isURL().withMessage('URL inválida'),
  body('label_gl').optional().trim().isLength({ max: 200 }).escape(),
  body('label_es').optional().trim().isLength({ max: 200 }).escape(),
  body('label_en').optional().trim().isLength({ max: 200 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { type, url, label_gl, label_es, label_en, idioma: idiomaMedia } = req.body
    const mediaId = slugify(
      `${req.params.id}_${type}_${Date.now()}`,
      { lower: true, strict: true, replacement: '_' }
    )
    await session.run(
      `MATCH (n:Node {id: $nodeId})
       CREATE (m:Media {
         id: $mediaId, type: $type, url: $url,
         label_gl: $label_gl, label_es: $label_es, label_en: $label_en,
         idioma: $idiomaMedia
       })
       CREATE (n)-[:HAS_MEDIA]->(m) RETURN m`,
      {
        nodeId: req.params.id, mediaId, type, url,
        label_gl: label_gl || '', label_es: label_es || '', label_en: label_en || '',
        idiomaMedia: idiomaMedia || 'gl'
      }
    )
    res.json({ ok: true, mediaId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.delete('/media/:mediaId', verificarJWT, soProfesor, [
  param('mediaId').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    await session.run(
      'MATCH (m:Media {id: $mediaId}) DETACH DELETE m',
      { mediaId: req.params.mediaId }
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_media ──────────────────────────────────

// ── INICIO: rutas_relacions ──────────────────────────
app.post('/relacion', verificarJWT, [
  body('source').trim().notEmpty().isLength({ max: 150 }).escape(),
  body('target').trim().notEmpty().isLength({ max: 150 }).escape(),
  body('tipo').isIn(TIPOS_RELACION_VALIDOS).withMessage('Tipo de relación inválido'),
  body('strength').optional().isIn(['high', 'medium', 'low']),
  body('level').optional().isIn(DIFICULTADE_VALIDA)
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { source, target, tipo, context_gl, context_es, context_en, level, strength } = req.body
    if (source === target) {
      return res.status(400).json({ error: 'Orixe e destino non poden ser o mesmo nodo' })
    }
    // tipo validado contra lista branca — seguro para interpolación
    await session.run(
      `MATCH (a:Node {id: $source}), (b:Node {id: $target})
       CREATE (a)-[r:${tipo} {
         context_gl: $context_gl, context_es: $context_es, context_en: $context_en,
         level: $level, strength: $strength
       }]->(b) RETURN r`,
      {
        source, target,
        context_gl: context_gl || '', context_es: context_es || '', context_en: context_en || '',
        level:    level    || 'primary',
        strength: strength || 'medium'
      }
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.delete('/relacion', verificarJWT, soProfesor, [
  body('source').trim().notEmpty().isLength({ max: 150 }).escape(),
  body('target').trim().notEmpty().isLength({ max: 150 }).escape(),
  body('tipo').isIn(TIPOS_RELACION_VALIDOS).withMessage('Tipo de relación inválido')
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { source, target, tipo } = req.body
    await session.run(
      `MATCH (a:Node {id: $source})-[r:${tipo}]->(b:Node {id: $target}) DELETE r`,
      { source, target }
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.put('/relacion', verificarJWT, soProfesor, [
  body('source').trim().notEmpty().isLength({ max: 150 }).escape(),
  body('target').trim().notEmpty().isLength({ max: 150 }).escape(),
  body('tipo').isIn(TIPOS_RELACION_VALIDOS),
  body('tipo_orixinal').isIn(TIPOS_RELACION_VALIDOS),
  body('strength').optional().isIn(['high', 'medium', 'low']),
  body('level').optional().isIn(DIFICULTADE_VALIDA)
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const {
      source, target, tipo_orixinal, tipo,
      context_gl, context_es, context_en, level, strength
    } = req.body
    await session.run(
      `MATCH (a:Node {id: $source})-[r:${tipo_orixinal}]->(b:Node {id: $target}) DELETE r`,
      { source, target }
    )
    await session.run(
      `MATCH (a:Node {id: $source}), (b:Node {id: $target})
       CREATE (a)-[r:${tipo} {
         context_gl: $context_gl, context_es: $context_es, context_en: $context_en,
         level: $level, strength: $strength
       }]->(b) RETURN r`,
      {
        source, target,
        context_gl: context_gl || '', context_es: context_es || '', context_en: context_en || '',
        level:    level    || 'primary',
        strength: strength || 'medium'
      }
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.get('/relacions', async (req, res) => {
  const session = driver.session()
  try {
    const result = await session.run(
      `MATCH (a:Node)-[r]->(b:Node)
       RETURN a.id AS source, b.id AS target,
              type(r) AS tipo, properties(r) AS props`
    )
    const relacions = result.records.map(record => {
      const props = record.get('props')
      return {
        source:     record.get('source'),
        target:     record.get('target'),
        tipo:       record.get('tipo'),
        strength:   props.strength   || 'medium',
        level:      props.level      || 'primary',
        context_gl: props.context_gl || ''
      }
    })
    res.json({ total: relacions.length, relacions })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.get('/relacions/tipos', (req, res) => {
  res.json({
    tipos: Object.entries(NOMES_RELACIONS).map(([id, nomes]) => ({ id, ...nomes }))
  })
})
// ── FIN: rutas_relacions ─────────────────────────────

// ── INICIO: rutas_journeys ───────────────────────────
app.get('/journeys', async (req, res) => {
  const session = driver.session()
  try {
    const idiomas = await getIdiomasActivos(session)
    const { level, type } = req.query
    let queryStr  = 'MATCH (j:Journey)'
    const params  = {}
    const conds   = []
    if (level && DIFICULTADE_VALIDA.includes(level)) {
      conds.push('j.level = $level'); params.level = level
    }
    if (type) {
      conds.push('j.type = $type'); params.type = type
    }
    if (conds.length > 0) queryStr += ' WHERE ' + conds.join(' AND ')
    queryStr += ' RETURN j ORDER BY j.label_gl'

    const result   = await session.run(queryStr, params)
    const journeys = result.records.map(r => {
      const j     = r.get('j').properties
      const label = {}
      const description = {}
      idiomas.forEach(i => {
        label[i]       = j[`label_${i}`]       || ''
        description[i] = j[`description_${i}`] || ''
      })
      return {
        id:         j.id,
        label, description,
        level:      j.level,
        type:       j.type,
        status:     j.status,
        visibility: j.visibility || 'private',
        modulo:     j.modulo     || 'Xeral',
        icono:      j.icono      || '📚'
      }
    })
    res.json({ total: journeys.length, journeys })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.get('/journeys/:id', [
  param('id').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const idiomas = await getIdiomasActivos(session)
    const result  = await session.run(
      `MATCH (j:Journey {id: $id})
       OPTIONAL MATCH (j)-[r:HAS_STOP]->(n:Node)
       RETURN j, n, r.order AS order ORDER BY r.order`,
      { id: req.params.id }
    )
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Ruta non atopada' })
    }
    const j     = result.records[0].get('j').properties
    const label = {}
    const description = {}
    idiomas.forEach(i => {
      label[i]       = j[`label_${i}`]       || ''
      description[i] = j[`description_${i}`] || ''
    })
    const stops = result.records
      .filter(r => r.get('n'))
      .map(r => {
        const n = r.get('n').properties
        return {
          order: r.get('order'),
          nodo:  { id: n.id, label_gl: n.label_gl, type: n.type, difficulty: n.difficulty }
        }
      })
    res.json({
      id: j.id, label, description,
      level: j.level, type: j.type,
      status: j.status, visibility: j.visibility || 'private',
      owner_id: j.owner_id || 'system',
      modulo:   j.modulo   || 'Xeral',
      icono:    j.icono    || '📚',
      stops
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.post('/journeys', verificarJWT, [
  body('label_gl').trim().notEmpty().isLength({ max: 200 }).escape(),
  body('level').optional().isIn(DIFICULTADE_VALIDA),
  body('type').optional().isIn(['educational', 'exploration', 'galicia', 'professional']),
  body('visibility').optional().isIn(['private', 'draft', 'public', 'featured']),
  body('stops').isArray({ min: 1 }).withMessage('A ruta necesita polo menos un paso'),
  body('modulo').optional().trim().isLength({ max: 100 }).escape(),
  body('icono').optional().trim().isLength({ max: 10 })
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const idiomas = await getIdiomasActivos(session)
    const { level, type, visibility, stops } = req.body

    const ids = stops.map(s => s.nodo)
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'Non pode haber nodos duplicados na ruta' })
    }
    for (const nodoId of ids) {
      const existe = await session.run(
        'MATCH (n:Node {id: $id}) RETURN n', { id: nodoId }
      )
      if (existe.records.length === 0) {
        return res.status(400).json({ error: `Nodo non existe: ${nodoId}` })
      }
    }

    const id    = slugify(req.body.label_gl, { lower: true, strict: true, locale: 'es', replacement: '_' })
    const existe = await session.run('MATCH (j:Journey {id: $id}) RETURN j', { id })
    if (existe.records.length > 0) {
      return res.status(409).json({ error: `Xa existe unha ruta con id "${id}"` })
    }

    let createFields = `id: $id, level: $level, type: $type,
                        status: "draft", visibility: $visibility,
                        owner_id: $ownerId, created_at: datetime(),
                        modulo: $modulo, icono: $icono`
    const params = {
      id,
      level:      level      || 'primary',
      type:       type       || 'educational',
      visibility: visibility || 'private',
      ownerId:    req.usuario.id,
      modulo:     req.body.modulo || 'Xeral',
      icono:      req.body.icono  || '📚'
    }
    idiomas.forEach(i => {
      createFields += `, label_${i}: $label_${i}`
      createFields += `, description_${i}: $description_${i}`
      params[`label_${i}`]       = req.body[`label_${i}`]       || ''
      params[`description_${i}`] = req.body[`description_${i}`] || ''
    })
    await session.run(`CREATE (j:Journey { ${createFields} }) RETURN j`, params)
    for (const stop of stops) {
      await session.run(
        `MATCH (j:Journey {id: $journeyId}), (n:Node {id: $nodoId})
         CREATE (j)-[:HAS_STOP {order: $order}]->(n)`,
        { journeyId: id, nodoId: stop.nodo, order: stop.order }
      )
    }
    const primeiro = [...stops].sort((a, b) => a.order - b.order)[0]
    await session.run(
      `MATCH (j:Journey {id: $journeyId}), (n:Node {id: $nodoId})
       CREATE (j)-[:STARTS_AT]->(n)`,
      { journeyId: id, nodoId: primeiro.nodo }
    )
    res.json({ ok: true, id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.put('/journeys/:id', verificarJWT, [
  param('id').trim().isLength({ min: 1, max: 150 }).escape(),
  body('level').optional().isIn(DIFICULTADE_VALIDA),
  body('type').optional().isIn(['educational', 'exploration', 'galicia', 'professional']),
  body('visibility').optional().isIn(['private', 'draft', 'public', 'featured']),
  body('status').optional().isIn(['draft', 'published', 'archived']),
  body('modulo').optional().trim().isLength({ max: 100 }).escape(),
  body('icono').optional().trim().isLength({ max: 10 })
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const idiomas = await getIdiomasActivos(session)
    const { level, type, status, visibility } = req.body
    let setClause = `j.level = $level, j.type = $type,
                     j.status = $status, j.visibility = $visibility,
                     j.modulo = $modulo, j.icono = $icono`
    const params = {
      id:         req.params.id,
      level:      level      || 'primary',
      type:       type       || 'educational',
      status:     status     || 'draft',
      visibility: visibility || 'private',
      modulo:     req.body.modulo || 'Xeral',
      icono:      req.body.icono  || '📚'
    }
    idiomas.forEach(i => {
      setClause += `, j.label_${i} = $label_${i}`
      setClause += `, j.description_${i} = $description_${i}`
      params[`label_${i}`]       = req.body[`label_${i}`]       || ''
      params[`description_${i}`] = req.body[`description_${i}`] || ''
    })
    await session.run(
      `MATCH (j:Journey {id: $id}) SET ${setClause} RETURN j`, params
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.delete('/journeys/:id', verificarJWT, soProfesor, [
  param('id').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    await session.run(
      'MATCH (j:Journey {id: $id}) DETACH DELETE j',
      { id: req.params.id }
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.put('/journeys/:id/stops', verificarJWT, [
  param('id').trim().isLength({ min: 1, max: 150 }).escape(),
  body('stops').isArray({ min: 1 })
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { stops } = req.body
    await session.run(
      `MATCH (j:Journey {id: $id})-[r:HAS_STOP|STARTS_AT]->() DELETE r`,
      { id: req.params.id }
    )
    for (const stop of stops) {
      await session.run(
        `MATCH (j:Journey {id: $journeyId}), (n:Node {id: $nodoId})
         CREATE (j)-[:HAS_STOP {order: $order}]->(n)`,
        { journeyId: req.params.id, nodoId: stop.nodo, order: stop.order }
      )
    }
    if (stops.length > 0) {
      const primeiro = [...stops].sort((a, b) => a.order - b.order)[0]
      await session.run(
        `MATCH (j:Journey {id: $journeyId}), (n:Node {id: $nodoId})
         CREATE (j)-[:STARTS_AT]->(n)`,
        { journeyId: req.params.id, nodoId: primeiro.nodo }
      )
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: rutas_journeys ──────────────────────────────

// ── INICIO: rutas_config ─────────────────────────────
app.get('/config/:key', [
  param('key').trim().isLength({ min: 1, max: 50 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const result = await session.run(
      'MATCH (c:Config {key: $key}) RETURN c',
      { key: req.params.key }
    )
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Config non atopada' })
    }
    const c = result.records[0].get('c').properties
    res.json({ key: c.key, value: JSON.parse(c.value) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.post('/config/idiomas', verificarJWT, soProfesor, [
  body('idioma')
    .trim().matches(/^[a-z]{2,3}$/).withMessage('Código de idioma inválido'),
  body('label')
    .trim().notEmpty().isLength({ max: 20 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { idioma, label } = req.body
    const result  = await session.run('MATCH (c:Config {key: "idiomas"}) RETURN c')
    const c       = result.records[0].get('c').properties
    const idiomas = JSON.parse(c.value)
    if (idiomas.includes(idioma)) {
      return res.status(409).json({ error: `O idioma "${idioma}" xa existe` })
    }
    idiomas.push(idioma)
    await session.run(
      'MATCH (c:Config {key: "idiomas"}) SET c.value = $value',
      { value: JSON.stringify(idiomas) }
    )
    await session.run(
      `MATCH (n:Node)
       SET n[$labelKey]     = coalesce(n[$labelKey], ''),
           n[$primaryKey]   = coalesce(n[$primaryKey], ''),
           n[$secondaryKey] = coalesce(n[$secondaryKey], ''),
           n[$expertKey]    = coalesce(n[$expertKey], '')`,
      {
        labelKey:     `label_${idioma}`,
        primaryKey:   `text_primary_${idioma}`,
        secondaryKey: `text_secondary_${idioma}`,
        expertKey:    `text_expert_${idioma}`
      }
    )
    res.json({ ok: true, idiomas })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: rutas_config ────────────────────────────────

// ── INICIO: ruta_import_bulk ─────────────────────────
app.post('/import', verificarJWT, soProfesor, [
  body('nodos').optional().isArray(),
  body('relacions').optional().isArray()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { nodos = [], relacions = [] } = req.body
    const resultado = {
      creados: [], erros: [], relacionsCreadas: 0, relacionsErros: []
    }

    for (const nodo of nodos) {
      if (!nodo.label_gl) {
        resultado.erros.push({ nodo, motivo: 'Falta label_gl' }); continue
      }
      try {
        const id = nodo.id || slugify(nodo.label_gl, { lower: true, strict: true })
        const existe = await session.run('MATCH (n:Node {id: $id}) RETURN n', { id })
        if (existe.records.length > 0) {
          resultado.erros.push({ id, motivo: 'Xa existe' }); continue
        }
        const idiomas = await getIdiomasActivos(session)
        let createFields = `id: $id, label: $label_gl,
                            type: $type, status: $status,
                            relevance: $relevance, difficulty: $difficulty,
                            autor: $autor, centro: $centro`
        const params = {
          id,
          label_gl:   nodo.label_gl   || '',
          type:       TIPOS_NODO_VALIDOS.includes(nodo.type) ? nodo.type : 'concept',
          status:     STATUS_VALIDOS.includes(nodo.status)   ? nodo.status : 'draft',
          relevance:  RELEVANCIA_VALIDA.includes(nodo.relevance) ? nodo.relevance : 'medium',
          difficulty: DIFICULTADE_VALIDA.includes(nodo.difficulty) ? nodo.difficulty : 'primary',
          autor:      nodo.autor  || req.usuario.nome   || '',
          centro:     nodo.centro || req.usuario.centro || ''
        }
        idiomas.forEach(i => {
          createFields += `, label_${i}: $label_${i}`
          createFields += `, text_primary_${i}: $text_primary_${i}`
          createFields += `, text_secondary_${i}: $text_secondary_${i}`
          createFields += `, text_expert_${i}: $text_expert_${i}`
          params[`label_${i}`]          = nodo[`label_${i}`]          || ''
          params[`text_primary_${i}`]   = nodo[`text_primary_${i}`]   || ''
          params[`text_secondary_${i}`] = nodo[`text_secondary_${i}`] || ''
          params[`text_expert_${i}`]    = nodo[`text_expert_${i}`]    || ''
        })
        await session.run(`CREATE (n:Node { ${createFields} })`, params)
        resultado.creados.push(id)
      } catch (err) {
        resultado.erros.push({ nodo: nodo.label_gl, motivo: err.message })
      }
    }

    for (const rel of relacions) {
      if (!rel.source || !rel.target || !rel.tipo) {
        resultado.relacionsErros.push({ rel, motivo: 'Faltan campos' }); continue
      }
      if (!TIPOS_RELACION_VALIDOS.includes(rel.tipo)) {
        resultado.relacionsErros.push({ rel, motivo: 'Tipo relación inválido' }); continue
      }
      try {
        await session.run(
          `MATCH (a:Node {id: $source}), (b:Node {id: $target})
           CREATE (a)-[:${rel.tipo} {
             strength: $strength,
             context_gl: $context_gl, context_es: $context_es, context_en: $context_en
           }]->(b)`,
          {
            source: rel.source, target: rel.target,
            strength:   rel.strength   || 'medium',
            context_gl: rel.context_gl || '',
            context_es: rel.context_es || '',
            context_en: rel.context_en || ''
          }
        )
        resultado.relacionsCreadas++
      } catch (err) {
        resultado.relacionsErros.push({ rel, motivo: err.message })
      }
    }
    res.json({
      ok: true,
      creados:          resultado.creados.length,
      erros:            resultado.erros.length,
      relacionsCreadas: resultado.relacionsCreadas,
      relacionsErros:   resultado.relacionsErros.length,
      detalle:          resultado
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_import_bulk ────────────────────────────

// ── INICIO: ruta_lua ─────────────────────────────────
app.post('/lua', limitLua, [
  body('nodoId').optional({ nullable: true }).trim().isLength({ max: 150 }).escape(),
  body('idioma').optional().isIn(['gl', 'es', 'en']),
 body('mensaxes').isArray({ min: 1 })
  .withMessage('Mensaxes inválidas')
  .custom(val => {
    if (val.length > LIMITES_IA.lua_historial_max) {
      throw new Error(`Máximo ${LIMITES_IA.lua_historial_max} mensaxes`)
    }
    return true
  }),
  body('mensaxes.*.rol').isIn(['usuario', 'lua']),
  body('mensaxes.*.texto').trim().notEmpty().isLength({ max: 500 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { nodoId, mensaxes, idioma = 'gl' } = req.body

    // ── INICIO: control_limites_lua ──────────────────
const cabeceira = req.headers['authorization']
let userId      = null
let esExplorador = true

if (cabeceira && cabeceira.startsWith('Bearer ')) {
  try {
    const token  = cabeceira.split(' ')[1]
    const payload = jwt.verify(token, JWT_SECRET)
    userId       = payload.id
    esExplorador = false
  } catch (e) {
    // Token inválido — tratar como explorador
    userId       = null
    esExplorador = true
  }
}

if (!esExplorador && userId) {
  const limite = await verificarLimiteIA(session, userId, 'lua_mensaxes')
  if (!limite.permitido) {
    return res.status(429).json({
      error:     limite.motivo,
      code:      'LIMITE_LUA',
      restantes: 0
    })
  }
}
// ── FIN: control_limites_lua ─────────────────────

    // Contexto do nodo
    let contextoNodo = ''
    if (nodoId) {
      const result = await session.run(
        'MATCH (n:Node {id: $id}) RETURN n', { id: nodoId }
      )
      if (result.records.length > 0) {
        const n     = result.records[0].get('n').properties
        const nome  = n[`label_${idioma}`] || n.label_gl || nodoId
        const texto = n[`text_primary_${idioma}`] || n.text_primary_gl || ''
        contextoNodo = `Nodo: "${nome}" (${n.type || 'concept'})\n${texto.slice(0, 300)}`
      }
      const relResult = await session.run(
        `MATCH (n:Node {id: $id})-[r]-(b:Node)
         RETURN type(r) AS tipo, b.label_gl AS label LIMIT 5`,
        { id: nodoId }
      )
      if (relResult.records.length > 0) {
        const rels = relResult.records
          .map(r => `${r.get('tipo')}: ${r.get('label')}`).join(', ')
        contextoNodo += `\nRelacións: ${rels}`
      }
    }

    // ── INICIO: prompt_lua_optimizado ────────────────
    // Prompt reducido — menos tokens, mesmo carácter
    const systemPrompt = `Es LÚA, copiloto de GAIA.
Retranca galega suave. Máximo 2 frases. Non expliques, pregunta.
Sen markdown. Sen asteriscos.
Contexto: ${contextoNodo || 'Sen nodo'}
Fala en ${idioma === 'gl' ? 'galego' : idioma === 'es' ? 'castelán' : 'inglés'}.
"LÚA non che dá respostas. Axúdache a velas."`
    // ── FIN: prompt_lua_optimizado ───────────────────

    const bodyStr = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system:     systemPrompt,
      messages:   mensaxes
        .slice(-LIMITES_IA.lua_historial_max)
        .map(m => ({
          role:    m.rol === 'usuario' ? 'user' : 'assistant',
          content: m.texto
        }))
    })

    const resposta = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers:  {
          'Content-Type':      'application/json',
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length':    Buffer.byteLength(bodyStr)
        }
      }
      const request = https.request(options, (r) => {
        let data = ''
        r.on('data', chunk => data += chunk)
        r.on('end', () => resolve(JSON.parse(data)))
      })
      request.on('error', reject)
      request.write(bodyStr)
      request.end()
    })

    if (resposta.error) {
      return res.status(500).json({ error: resposta.error.message })
    }

    // Incrementar contador só se a chamada foi exitosa
    if (userId) {
      await incrementarContadorIA(session, userId, 'lua_mensaxes')
    }

    res.json({
      resposta:   resposta.content[0].text,
      restantes:  userId ? (await verificarLimiteIA(session, userId, 'lua_mensaxes')).restantes : null
    })

  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_lua ────────────────────────────────────

// ── INICIO: ruta_avaliar_reto ────────────────────────
app.post('/avaliar-reto', limitLua, [
  body('pregunta').trim().notEmpty().isLength({ max: 500 }).escape(),
  body('resposta').trim().notEmpty().isLength({ max: 2000 }).escape(),
  body('nivel').isIn(DIFICULTADE_VALIDA),
  body('idioma').isIn(['gl', 'es', 'en']),
  body('nodoLabel').trim().notEmpty().isLength({ max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    // ── INICIO: control_limites_retos ────────────────
    const cabeceira = req.headers['authorization']
    let userId      = null

    if (cabeceira?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(cabeceira.split(' ')[1], JWT_SECRET)
        userId = payload.id
      } catch (e) {}
    }

    // Exploradores non poden avaliar retos
    if (!userId) {
      return res.status(401).json({
        error: 'Necesitas unha conta para responder retos',
        code:  'AUTH_REQUIRED'
      })
    }

    const limite = await verificarLimiteIA(session, userId, 'retos')
    if (!limite.permitido) {
      return res.status(429).json({
        error: limite.motivo,
        code:  'LIMITE_RETOS',
        restantes: 0
      })
    }
    // ── FIN: control_limites_retos ───────────────────

    const { pregunta, resposta, nivel, idioma, nodoLabel } = req.body

  const promptAvaliacion = `Avalía en ${idioma} a resposta dun estudante.
Nodo: ${nodoLabel} | Nivel: ${nivel}
Pregunta: ${pregunta}
Resposta do estudante: ${resposta}

IMPORTANTE: Se a pregunta é de opción múltiple (A/B/C) e o estudante escribe a letra ou o texto correcto, puntúa entre 70-100.
Sé xeneroso na avaliación — premia o coñecemento, non a redacción.

JSON sen texto extra nin backticks: {"puntos":75,"acertou":"...","mellorar":"...","pista":"..."}`
    // ── FIN: prompt_avaliacion_optimizado ────────────

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages:   [{ role: 'user', content: promptAvaliacion }]
      })
    })

    const data    = await response.json()
    const texto   = data.content[0].text.trim()
    const clean   = texto.replace(/```json|```/g, '').trim()
    const resultado = JSON.parse(clean)

    // Incrementar contador só se a avaliación foi exitosa
    await incrementarContadorIA(session, userId, 'retos')

    res.json({
      ...resultado,
      restantes: limite.restantes
    })

  } catch (e) {
    res.status(500).json({ erro: true })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_avaliar_reto ───────────────────────────

// ── INICIO: ruta_reto_respondido ─────────────────────
app.post('/reto-respondido', verificarJWT, [
  body('nodoId').trim().notEmpty().isLength({ max: 150 }).escape(),
  body('nodoLabel').trim().notEmpty().isLength({ max: 150 }).escape(),
  body('pregunta').trim().notEmpty().isLength({ max: 500 }).escape(),
  body('resposta').trim().notEmpty().isLength({ max: 2000 }).escape(),
  body('puntos').isInt({ min: 0, max: 100 }),
  body('nivel').isIn(DIFICULTADE_VALIDA),
  body('idioma').isIn(['gl', 'es', 'en'])
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const {
      nodoId, nodoLabel, pregunta, resposta, puntos, nivel, idioma
    } = req.body
    const userId = req.usuario.id
    await session.run(
      `MATCH (u:Usuario {id: $userId})
       MATCH (n {id: $nodoId})
       CREATE (u)-[:RESPONDEU]->(r:RetoRespondido {
         nodoId: $nodoId, nodoLabel: $nodoLabel,
         pregunta: $pregunta, resposta: $resposta,
         puntos: $puntos, nivel: $nivel, idioma: $idioma,
         data: $data
       })-[:SOBRE]->(n)`,
      {
        userId, nodoId, nodoLabel, pregunta, resposta,
        puntos, nivel, idioma,
        data: new Date().toISOString()
      }
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_reto_respondido ────────────────────────

// ── INICIO: ruta_historial ───────────────────────────
app.get('/historial/:userId', verificarJWT, async (req, res) => {
  if (req.usuario.id !== req.params.userId && req.usuario.rol !== 'profesor') {
    return res.status(403).json({ error: 'Sen permiso' })
  }
  const session = driver.session()
  try {
    const result = await session.run(
      `MATCH (u:Usuario {id: $userId})-[:RESPONDEU]->(r:RetoRespondido)
       RETURN r ORDER BY r.data DESC LIMIT 50`,
      { userId: req.params.userId }
    )
    res.json({ retos: result.records.map(rec => rec.get('r').properties) })
  } catch (e) {
    res.status(500).json({ retos: [] })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_historial ──────────────────────────────

// ── INICIO: ruta_nodos_reto_constelacion ─────────────
app.get('/constelacion/:id/nodos-reto', [
  param('id').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const result = await session.run(
      `MATCH (c {id: $id})<-[:PERTENCE_A]-(n)
       WHERE n.reto_primary_gl IS NOT NULL AND n.reto_primary_gl <> ''
       RETURN n ORDER BY rand() LIMIT 5`,
      { id: req.params.id }
    )
    res.json({ nodos: result.records.map(r => r.get('n').properties) })
  } catch (e) {
    res.status(500).json({ nodos: [] })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_nodos_reto_constelacion ────────────────

// ── INICIO: rutas_envios ─────────────────────────────
app.post('/envio', verificarJWT, [
  body('nodo_existente').optional({ nullable: true }).trim().isLength({ max: 150 }).escape(),
  body('label_gl').optional().trim().isLength({ max: 120 }).escape(),
  body('tipo_nodo').optional().isIn(TIPOS_NODO_VALIDOS),
  body('explicacion_gl').optional().trim().isLength({ max: 2000 }).escape(),
  body('recurso_url').optional().isURL(),
  body('recurso_tipo').optional().isIn(['youtube', 'link', 'pdf', 'image']),
  body('relacions').optional().isArray()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const {
      nodo_existente, label_gl, tipo_nodo,
      explicacion_gl, recurso_url, recurso_tipo, relacions = []
    } = req.body

    // Autor e centro veñen do JWT — non do body
    const autor  = req.usuario.nome
    const centro = req.usuario.centro

    if (!nodo_existente && !label_gl) {
      return res.status(400).json({
        error: 'Necesitas seleccionar un nodo existente ou escribir un nome'
      })
    }

    const id = `envio_${Date.now()}_${req.usuario.id.slice(0, 8)}`
    await session.run(`
      CREATE (e:Submission {
        id: $id, autor: $autor, centro: $centro,
        nodo_existente: $nodo_existente, label_gl: $label_gl,
        tipo_nodo: $tipo_nodo, explicacion_gl: $explicacion_gl,
        recurso_url: $recurso_url, recurso_tipo: $recurso_tipo,
        relacions: $relacions, status: 'pending',
        created_at: datetime()
      })
    `, {
      id, autor, centro,
      nodo_existente:  nodo_existente  || '',
      label_gl:        label_gl        || '',
      tipo_nodo:       tipo_nodo       || 'concept',
      explicacion_gl:  explicacion_gl  || '',
      recurso_url:     recurso_url     || '',
      recurso_tipo:    recurso_tipo    || '',
      relacions:       JSON.stringify(relacions)
    })
    res.json({ ok: true, id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.get('/envios', verificarJWT, soProfesor, [
  query('status').optional().isIn(['pending', 'validado', 'rexeitado'])
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { status } = req.query
    let queryStr = 'MATCH (e:Submission)'
    if (status) queryStr += ' WHERE e.status = $status'
    queryStr += ' RETURN e ORDER BY e.created_at DESC'
    const result = await session.run(queryStr, status ? { status } : {})
    const envios = result.records.map(r => {
      const e = r.get('e').properties
      return {
        id:             e.id,
        autor:          e.autor,
        centro:         e.centro,
        nodo_existente: e.nodo_existente || '',
        label_gl:       e.label_gl       || '',
        tipo_nodo:      e.tipo_nodo      || 'concept',
        explicacion_gl: e.explicacion_gl || '',
        recurso_url:    e.recurso_url    || '',
        recurso_tipo:   e.recurso_tipo   || '',
        relacions:      e.relacions ? JSON.parse(e.relacions) : [],
        status:         e.status         || 'pending',
        created_at:     e.created_at,
        nota_profesor:  e.nota_profesor  || ''
        
      }
    })
    res.json({ total: envios.length, envios })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.put('/envio/:id/resolver', verificarJWT, soProfesor, [
  param('id').trim().isLength({ min: 1, max: 150 }).escape(),
  body('accion').isIn(['validar', 'rexeitar']),
  body('nota_profesor').optional().trim().isLength({ max: 500 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    const { accion, nota_profesor } = req.body
    await session.run(`
      MATCH (e:Submission {id: $id})
      SET e.status = $status, e.nota_profesor = $nota,
          e.resolved_at = datetime()
    `, {
      id:     req.params.id,
      status: accion === 'validar' ? 'validado' : 'rexeitado',
      nota:   nota_profesor || ''
    })

    if (accion === 'validar') {
      const envioResult = await session.run(
        'MATCH (e:Submission {id: $id}) RETURN e', { id: req.params.id }
      )
      if (envioResult.records.length > 0) {
        const e = envioResult.records[0].get('e').properties
        if (!e.nodo_existente && e.label_gl) {
          const nodoId = slugify(e.label_gl, {
            lower: true, strict: true, locale: 'es', replacement: '_'
          })
          const existe = await session.run(
            'MATCH (n:Node {id: $id}) RETURN n', { id: nodoId }
          )
          if (existe.records.length === 0) {
            await session.run(`
              CREATE (n:Node {
                id: $id, label: $label_gl, label_gl: $label_gl,
                type: $type, status: 'validated',
                relevance: 'medium', difficulty: 'primary',
                autor: $autor, centro: $centro,
                text_primary_gl: $explicacion
              })
            `, {
              id:         nodoId,
              label_gl:   e.label_gl,
              type:       e.tipo_nodo    || 'concept',
              autor:      e.autor,
              centro:     e.centro,
              explicacion: e.explicacion_gl || ''
            })
          }
        }
        if (e.nodo_existente) {
          await session.run(`
            MATCH (n:Node {id: $id})
            SET n.autor  = CASE WHEN n.autor  = '' THEN $autor  ELSE n.autor  END,
                n.centro = CASE WHEN n.centro = '' THEN $centro ELSE n.centro END
          `, { id: e.nodo_existente, autor: e.autor, centro: e.centro })
        }
      }
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})

app.delete('/envio/:id', verificarJWT, soProfesor, [
  param('id').trim().isLength({ min: 1, max: 150 }).escape()
], async (req, res) => {
  if (!validar(req, res)) return
  const session = driver.session()
  try {
    await session.run(
      'MATCH (e:Submission {id: $id}) DETACH DELETE e',
      { id: req.params.id }
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: rutas_envios ────────────────────────────────

// ── INICIO: ruta_ranking_centros ─────────────────────
app.get('/ranking/centros', async (req, res) => {
  const session = driver.session()
  try {
    const nodosResult = await session.run(`
      MATCH (n:Node)
      WHERE n.centro IS NOT NULL AND n.centro <> ''
      RETURN n.centro AS centro,
             count(n) AS totalNodos,
             count(CASE WHEN n.status = 'validated' THEN 1 END) AS validados,
             count(CASE WHEN n.status = 'draft'     THEN 1 END) AS drafts,
             collect(DISTINCT n.autor) AS autores
    `)
    const relResult = await session.run(`
      MATCH (n:Node)-[r]->(m:Node)
      WHERE n.centro IS NOT NULL AND n.centro <> ''
      RETURN n.centro AS centro, count(r) AS relacions
    `)
    const relPorCentro = {}
    relResult.records.forEach(r => {
      relPorCentro[r.get('centro')] = r.get('relacions').toNumber()
    })

    // XP total por centro (suma de todos os alumnos)
    const xpResult = await session.run(`
      MATCH (u:Usuario)
      WHERE u.centro IS NOT NULL AND u.centro <> ''
      RETURN u.centro AS centro, sum(u.xp_total) AS xpTotal,
             count(u) AS alumnos
    `)
    const xpPorCentro = {}
    xpResult.records.forEach(r => {
      xpPorCentro[r.get('centro')] = {
        xp:      r.get('xpTotal')?.toNumber?.() || 0,
        alumnos: r.get('alumnos')?.toNumber?.() || 0
      }
    })

    const centros = nodosResult.records.map(r => {
      const centro      = r.get('centro')
      const totalNodos  = r.get('totalNodos').toNumber()
      const validados   = r.get('validados').toNumber()
      const drafts      = r.get('drafts').toNumber()
      const autores     = r.get('autores').filter(a => a && a !== '')
      const relacions   = relPorCentro[centro]  || 0
      const xpData      = xpPorCentro[centro]   || { xp: 0, alumnos: 0 }

      const puntos =
        totalNodos       * 10 +
        validados        * 25 +
        autores.length   * 15 +
        relacions        *  5 +
        xpData.xp        *  1

      return {
        centro, totalNodos, validados, drafts,
        autores:  autores.length,
        relacions, puntos,
        xpTotal:  xpData.xp,
        alumnos:  xpData.alumnos
      }
    })
    centros.sort((a, b) => b.puntos - a.puntos)
    res.json({ ok: true, centros })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_ranking_centros ────────────────────────

// ── INICIO: ruta_dashboard_centro ────────────────────
app.get('/centro/:centro/dashboard', verificarJWT, soProfesor, [
  param('centro').trim().isLength({ min: 1, max: 100 })
], async (req, res) => {
  if (!validar(req, res)) return
  const centro = decodeURIComponent(req.params.centro)
  try {
    const s1 = driver.session()
    const s2 = driver.session()
    const s3 = driver.session()
    const [alumnosRes, retosRes, nodosRes] = await Promise.all([
      s1.run(
        `MATCH (u:Usuario {centro: $centro})
         RETURN u.id AS id, u.nome AS nome,
                u.xp_total AS xp, u.rol AS rol
         ORDER BY u.xp_total DESC`,
        { centro }
      ),
      s2.run(
        `MATCH (u:Usuario {centro: $centro})-[:RESPONDEU]->(r:RetoRespondido)
         RETURN u.nome AS nome, r.nodoLabel AS nodo,
                r.puntos AS puntos, r.nivel AS nivel, r.data AS data
         ORDER BY r.data DESC`,
        { centro }
      ),
      s3.run(
        `MATCH (n {centro: $centro}) WHERE n.status = 'validated'
         RETURN count(n) AS total`,
        { centro }
      )
    ])
    await Promise.all([s1.close(), s2.close(), s3.close()])

    const alumnos    = alumnosRes.records.map(r => ({
      id:  r.get('id'),
      nome: r.get('nome'),
      xp:  r.get('xp')?.toNumber?.() || 0,
      rol: r.get('rol')
    }))
    const retos      = retosRes.records.map(r => ({
      nome:   r.get('nome'),
      nodo:   r.get('nodo'),
      puntos: r.get('puntos'),
      nivel:  r.get('nivel'),
      data:   r.get('data')
    }))
    const totalNodos = nodosRes.records[0]?.get('total')?.toNumber() || 0
    const statsPorAlumno = alumnos.map(a => {
      const retosAlumno  = retos.filter(r => r.nome === a.nome)
      const media = retosAlumno.length > 0
        ? Math.round(retosAlumno.reduce((s, r) => s + (r.puntos || 0), 0) / retosAlumno.length)
        : 0
      return {
        ...a,
        nivel:        calcularNivel(a.xp),
        totalRetos:   retosAlumno.length,
        media,
        superados:    retosAlumno.filter(r => r.puntos >= 70).length
      }
    })

    res.json({
      centro,
      alumnos:     statsPorAlumno,
      retos:       retos.slice(0, 30),
      totalNodos,
      totalRetos:  retos.length,
      mediaGlobal: retos.length > 0
        ? Math.round(retos.reduce((s, r) => s + (r.puntos || 0), 0) / retos.length)
        : 0
    })
  } catch (e) {
    res.status(500).json({ erro: true })
  }
})
// ── FIN: ruta_dashboard_centro ───────────────────────
// ── INICIO: ruta_limites_usuario ─────────────────────
app.get('/limites', verificarJWT, async (req, res) => {
  const session = driver.session()
  try {
    const hoxe = new Date().toDateString()
    const result = await session.run(
      `MATCH (u:Usuario {id: $userId})
       RETURN u.ia_lua_mensaxes_count AS lua_count,
              u.ia_lua_mensaxes_reset AS lua_reset,
              u.ia_retos_count        AS retos_count,
              u.ia_retos_reset        AS retos_reset`,
      { userId: req.usuario.id }
    )

    if (result.records.length === 0) {
      return res.json({
        lua:   { usados: 0, limite: LIMITES_IA.lua_mensaxes_dia,   restantes: LIMITES_IA.lua_mensaxes_dia   },
        retos: { usados: 0, limite: LIMITES_IA.retos_dia,          restantes: LIMITES_IA.retos_dia          }
      })
    }

    const r          = result.records[0]
    const luaCount   = r.get('lua_count')?.toNumber?.()   || 0
    const retosCount = r.get('retos_count')?.toNumber?.() || 0
    const luaReset   = r.get('lua_reset')   || ''
    const retosReset = r.get('retos_reset') || ''

    res.json({
      lua: {
        usados:    luaReset   === hoxe ? luaCount   : 0,
        limite:    LIMITES_IA.lua_mensaxes_dia,
        restantes: luaReset   === hoxe ? Math.max(0, LIMITES_IA.lua_mensaxes_dia   - luaCount)   : LIMITES_IA.lua_mensaxes_dia
      },
      retos: {
        usados:    retosReset === hoxe ? retosCount : 0,
        limite:    LIMITES_IA.retos_dia,
        restantes: retosReset === hoxe ? Math.max(0, LIMITES_IA.retos_dia - retosCount) : LIMITES_IA.retos_dia
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: ruta_limites_usuario ────────────────────────
// ── INICIO: envios_pendentes ─────────────────────────
app.get('/envios-pendentes', verificarJWT, soProfesor, async (req, res) => {
  const session = driver.session()
  try {
    const result = await session.run(`
      MATCH (e:Submission {status: 'pending'})
      RETURN e ORDER BY e.created_at DESC
    `)
    const envios = result.records.map(r => {
      const e = r.get('e').properties
      return { ...e, relacions: e.relacions ? JSON.parse(e.relacions) : [] }
    })
    res.json({ envios })
  } catch(err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: envios_pendentes ────────────────────────────

// ── INICIO: historial_profesor ───────────────────────
app.get('/historial-profesor', verificarJWT, soProfesor, async (req, res) => {
  const session = driver.session()
  try {
    const result = await session.run(`
      MATCH (a:AccionProfesor {profesorId: $id})
      RETURN a ORDER BY a.data DESC LIMIT 20
    `, { id: req.usuario.id })
    res.json({ accions: result.records.map(r => r.get('a').properties) })
  } catch(err) {
    res.json({ accions: [] })
  } finally {
    await session.close()
  }
})
// ── FIN: historial_profesor ──────────────────────────

// ── INICIO: accion_envio ─────────────────────────────
app.post('/envio/:id/:accion', verificarJWT, soProfesor, async (req, res) => {
  const { id, accion } = req.params
  if (!['validar', 'rexeitar'].includes(accion)) {
    return res.status(400).json({ error: 'Acción non válida' })
  }
  const session = driver.session()
  try {
    if (accion === 'validar') {
      const envioRes = await session.run(
        'MATCH (e:Submission {id: $id}) RETURN e', { id }
      )
      if (envioRes.records.length === 0) {
        return res.status(404).json({ error: 'Envío non atopado' })
      }
      const e = envioRes.records[0].get('e').properties
      if (e.nodo_existente) {
        await session.run(`
          MATCH (n:Node {id: $nid})
          SET n.autor = $autor, n.centro = $centro, n.status = 'validated'
        `, { nid: e.nodo_existente, autor: e.autor || '', centro: e.centro || '' })
      } else {
        const nodoId = (e.label_gl || '').toLowerCase()
          .replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
        await session.run(`
          MERGE (n:Node {id: $nid})
          SET n.label = $label, n.label_gl = $label,
              n.type = $tipo, n.autor = $autor, n.centro = $centro,
              n.status = 'validated', n.text_primary_gl = $explicacion
        `, {
          nid:        nodoId,
          label:      e.label_gl      || '',
          tipo:       e.tipo_nodo     || 'concept',
          autor:      e.autor         || '',
          centro:     e.centro        || '',
          explicacion: e.explicacion_gl || ''
        })
      }
      await session.run(`
        CREATE (a:AccionProfesor {
          profesorId: $profesorId, tipo: 'validar',
          descriccion: $desc, data: datetime()
        })
      `, {
        profesorId: req.usuario.id,
        desc: `Validou: ${e.label_gl || e.nodo_existente}`
      })
    } else {
      await session.run(`
        CREATE (a:AccionProfesor {
          profesorId: $profesorId, tipo: 'rexeitar',
          descriccion: $desc, data: datetime()
        })
      `, {
        profesorId: req.usuario.id,
        desc: `Rexeitou envío ${id}`
      })
    }
    await session.run(
      'MATCH (e:Submission {id: $id}) SET e.status = $status',
      { id, status: accion === 'validar' ? 'validated' : 'rejected' }
    )
    res.json({ ok: true })
  } catch(err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: accion_envio ────────────────────────────────

// ── INICIO: alumnos_centro ───────────────────────────
app.get('/centro/:centro/alumnos', verificarJWT, soProfesor, async (req, res) => {
  const session = driver.session()
  try {
    const centro = decodeURIComponent(req.params.centro)
    const result = await session.run(
      `MATCH (u:Usuario {centro: $centro})
       WHERE u.rol = 'alumno'
       OPTIONAL MATCH (u)-[:RESPONDEU]->(r:RetoRespondido)
       RETURN u, count(r) AS totalRetos,
              sum(r.puntos) AS sumaPuntos
       ORDER BY u.curso, u.nome`,
      { centro }
    )
    const alumnos = result.records.map(rec => {
      const u = rec.get('u').properties
      const totalRetos = rec.get('totalRetos')?.toNumber?.() || 0
      const sumaPuntos = rec.get('sumaPuntos')?.toNumber?.() || 0
      return {
  id:                  u.id,
  nome:                u.nome,
  curso:               u.curso               || 'outro',
  rol_personaxe:       u.rol_personaxe       || '',
  bloque_personaxe:    u.bloque_personaxe    || '',
  profesion_personaxe: u.profesion_personaxe || '',
  xp_total:            u.xp_total?.toNumber?.()        || Number(u.xp_total)        || 0,
 xp_exploracion: n4num(u.xp_exploracion),
xp_conexion:    n4num(u.xp_conexion),
xp_comprension: n4num(u.xp_comprension),
  totalRetos,
  media: totalRetos > 0 ? Math.round(sumaPuntos / totalRetos) : 0
}
    })
    res.json({ alumnos })
  } catch(err) {
    res.status(500).json({ error: err.message })
  } finally {
    await session.close()
  }
})
// ── FIN: alumnos_centro ──────────────────────────────



// ── INICIO: arranque_servidor ────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GAIA API v0.8 iniciada en http://localhost:${PORT}`)
})
// ── FIN: arranque_servidor ───────────────────────────
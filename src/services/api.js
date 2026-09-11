// Central de HTTP do frontend (equivalente ao api.js com interceptor axios).
// Usa fetch nativo (axios não é dependência do projeto) com a mesma semântica:
// - baseURL via VITE_API_URL (fallback http://localhost:3001)
// - request interceptor: injeta `Authorization: Bearer <token>` em TODA chamada,
//   lendo as chaves 'token', 'authToken' e 'adminToken' (login salva nas 4,
//   incluindo 'en_token' como fallback legado)
// - sempre envia o cookie httpOnly (credentials: 'include') como segundo canal de auth

export const BASE_URL = (import.meta.env && import.meta.env.VITE_API_URL) || 'https://site-empresas-nick-backend.onrender.com'

export const TOKEN_KEYS = ['token', 'authToken', 'adminToken', 'en_token']

export function getToken() {
  try {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('adminToken');
    if (token) return token;
    return localStorage.getItem('en_token') || '';
  } catch {}
  return ''
}

// Salva o JWT nas 4 chaves para nunca haver divergência entre telas/abas.
export function persistToken(token) {
  if (!token) return
  try {
    for (const k of TOKEN_KEYS) localStorage.setItem(k, token)
  } catch {}
}

export function clearToken() {
  try {
    for (const k of TOKEN_KEYS) localStorage.removeItem(k)
  } catch {}
}

export function authHeaders(extra = {}) {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}`, ...extra } : { ...extra }
}

function joinUrl(path) {
  if (/^https?:\/\//i.test(path)) return path
  const base = String(BASE_URL).replace(/\/+$/, '')
  const p = String(path || '').startsWith('/') ? String(path) : `/${path || ''}`
  return base + p
}

// Interceptor de request: injeta Bearer + cookie em todo fetch do painel.
// Garante Authorization em TODAS as requisições (rotas admin incluídas).
export async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  try {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('adminToken');
    const t = token || getToken();
    if (t) {
      headers.Authorization = `Bearer ${t}`
    }
  } catch {}
  const res = await fetch(joinUrl(path), { ...options, headers, credentials: 'include' })
  return res
}

export const api = {
  get: (path, options = {}) => apiFetch(path, { ...options, method: 'GET' }),
  post: (path, body, options = {}) =>
    apiFetch(path, {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: (path, body, options = {}) =>
    apiFetch(path, {
      ...options,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  del: (path, options = {}) => apiFetch(path, { ...options, method: 'DELETE' }),
}

export default api

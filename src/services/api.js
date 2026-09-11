const BASE = "https://site-empresas-nick-backend.onrender.com/api";
export const BASE_URL = BASE;
export const API_URL = BASE;
export const getToken = () => localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
export const persistToken = (t) => { if(t){ localStorage.setItem('adminToken', t); localStorage.setItem('token', t);} };
export const clearToken = () => { localStorage.removeItem('adminToken'); localStorage.removeItem('token'); };
export const authHeaders = () => { const t=getToken(); return t?{Authorization:`Bearer ${t}`}:{}; };
export const getAuthHeader = authHeaders;
export async function apiFetch(path, opts={}){
  // Normaliza "/api" duplicado: BASE já termina com /api, então
  // chamadas legadas "/api/xxx" viram "/xxx" antes de juntar.
  // Ex: BASE(/api) + "/api/me" -> "/api/me" (não "/api/api/me").
  let p = String(path || '');
  if (p.startsWith('/api/')) p = p.slice(4);
  else if (p === '/api') p = '';
  // POST /cadastro existe no backend SEM prefixo /api (raiz).
  // BASE + "/cadastro" daria /api/cadastro (404), então usa a raiz.
  const ROOT = BASE.replace(/\/api$/, '');
  const url = (p === '/cadastro' || p.startsWith('/cadastro?'))
    ? `${ROOT}${p}`
    : `${BASE}${p}`;
  const h={'Content-Type':'application/json', ...(opts.headers||{}), ...authHeaders()};
  // Retorna o Response cru: chamadores usam res.ok / res.status / res.json().
  // NÃO faz throw em !ok (login/cadastro tratam erro via res.ok).
  const r=await fetch(url,{...opts, headers:h});
  return r;
}
export const api={ get:(p,o)=>apiFetch(p,{method:'GET',...o}), post:(p,b,o)=>apiFetch(p,{method:'POST',body:JSON.stringify(b),...o}), put:(p,b,o)=>apiFetch(p,{method:'PUT',body:JSON.stringify(b),...o}), delete:(p,o)=>apiFetch(p,{method:'DELETE',...o}), fetch:apiFetch };
export default api;

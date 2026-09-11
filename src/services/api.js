const BASE = "https://site-empresas-nick-backend.onrender.com/api";
export const BASE_URL = BASE;
export const API_URL = BASE;
export const getToken = () => localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
export const persistToken = (t) => { if(t){ localStorage.setItem('adminToken', t); localStorage.setItem('token', t);} };
export const clearToken = () => { localStorage.removeItem('adminToken'); localStorage.removeItem('token'); };
export const authHeaders = () => { const t=getToken(); return t?{Authorization:`Bearer ${t}`}:{}; };
export const getAuthHeader = authHeaders;
export async function apiFetch(path, opts={}){
  const h={'Content-Type':'application/json', ...(opts.headers||{}), ...authHeaders()};
  const r=await fetch(`${BASE}${path}`,{...opts, headers:h});
  if(!r.ok) throw new Error(await r.text());
  const ct=r.headers.get('content-type')||'';
  return ct.includes('json')?r.json():r.text();
}
export const api={ get:(p,o)=>apiFetch(p,{method:'GET',...o}), post:(p,b,o)=>apiFetch(p,{method:'POST',body:JSON.stringify(b),...o}), put:(p,b,o)=>apiFetch(p,{method:'PUT',body:JSON.stringify(b),...o}), delete:(p,o)=>apiFetch(p,{method:'DELETE',...o}), fetch:apiFetch };
export default api;

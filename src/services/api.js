const BASE = import.meta.env.VITE_API_URL || 'https://site-empresas-nick-backend.onrender.com';

export function getToken(){
  return localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
}
export function persistToken(token){
  if(token){
    localStorage.setItem('adminToken', token);
    localStorage.setItem('token', token);
  }
}
export function clearToken(){
  localStorage.removeItem('adminToken');
  localStorage.removeItem('token');
}
export function authHeaders(){
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
export function getAuthHeader(){ return authHeaders(); }

export async function apiFetch(path, options={}){
  const token = getToken();
  const headers = { 'Content-Type':'application/json', ...(options.headers||{}), ...authHeaders() };
  if(token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {...options, headers});
  if(!res.ok){
    const txt = await res.text();
    throw new Error(txt);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// compatibilidade com código antigo que usa `api`
export const api = {
  get: (path, opts) => apiFetch(path, { method:'GET', ...(opts||{}) }),
  post: (path, body, opts) => apiFetch(path, { method:'POST', body: JSON.stringify(body), ...(opts||{}) }),
  put: (path, body, opts) => apiFetch(path, { method:'PUT', body: JSON.stringify(body), ...(opts||{}) }),
  delete: (path, opts) => apiFetch(path, { method:'DELETE', ...(opts||{}) }),
  fetch: apiFetch
};

export default api;

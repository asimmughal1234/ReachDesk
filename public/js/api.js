let token = localStorage.getItem('rd.token') || '';
let onUnauthorized = () => {};

export const setToken = (t) => { token = t || ''; if (t) localStorage.setItem('rd.token', t); else localStorage.removeItem('rd.token'); };
export const handleUnauthorized = (fn) => { onUnauthorized = fn; };
export const withToken = (url) => (token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url);

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new Error('Could not reach the server. Check that it is running.');
  }
  if (res.status === 401 && !path.startsWith('/auth')) { onUnauthorized(); throw new Error('Sign in to continue.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

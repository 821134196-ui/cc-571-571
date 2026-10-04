import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  role: 'TELLER' | 'SUPERVISOR' | 'FINANCE';
}

export function getUser(): CurrentUser | null {
  const raw = localStorage.getItem('user');
  return raw ? (JSON.parse(raw) as CurrentUser) : null;
}

export function setUser(u: CurrentUser | null) {
  if (u) localStorage.setItem('user', JSON.stringify(u));
  else localStorage.removeItem('user');
}

api.interceptors.request.use((config) => {
  const u = getUser();
  if (u) config.headers['x-user-id'] = u.id;
  return config;
});

/** 提取后端错误信息（Nest 异常可能是 string 或 {message} 对象） */
export function errMsg(e: any): string {
  const data = e?.response?.data;
  if (!data) return e?.message ?? '请求失败';
  if (typeof data.message === 'string') return data.message;
  if (Array.isArray(data.message)) return data.message.join('；');
  if (data.message?.message) return data.message.message;
  return JSON.stringify(data);
}

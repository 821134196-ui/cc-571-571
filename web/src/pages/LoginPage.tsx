import { useEffect, useState } from 'react';
import { api, CurrentUser, errMsg } from '../api';

const ROLE_NAME: Record<string, string> = {
  TELLER: '柜员',
  SUPERVISOR: '主管',
  FINANCE: '财务',
};

export default function LoginPage({ onLogin }: { onLogin: (u: CurrentUser) => void }) {
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/users').then((r) => setUsers(r.data)).catch((e) => setError(errMsg(e)));
  }, []);

  return (
    <div className="login-page">
      <div className="card login-card">
        <h2>选择登录用户</h2>
        <p className="muted">本地演示环境，直接点选用户登录</p>
        {error && <div className="alert error">{error}</div>}
        <div className="user-list">
          {users.map((u) => (
            <button key={u.id} className="user-item" onClick={() => onLogin(u)}>
              <span className="user-name">{u.name}</span>
              <span className={`badge role-${u.role.toLowerCase()}`}>{ROLE_NAME[u.role]}</span>
              <span className="muted">{u.username}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

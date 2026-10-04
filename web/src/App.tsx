import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getUser, setUser, CurrentUser } from './api';
import LoginPage from './pages/LoginPage';
import TellerPage from './pages/TellerPage';
import SupervisorPage from './pages/SupervisorPage';
import FinancePage from './pages/FinancePage';

const ROLE_HOME: Record<string, string> = {
  TELLER: '/teller',
  SUPERVISOR: '/supervisor',
  FINANCE: '/finance',
};

const ROLE_NAME: Record<string, string> = {
  TELLER: '柜员',
  SUPERVISOR: '主管',
  FINANCE: '财务',
};

export default function App() {
  const [user, setUserState] = useState<CurrentUser | null>(getUser());
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  const logout = () => {
    setUser(null);
    setUserState(null);
    navigate('/login');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">柜面现金长短款复核与缴回系统</div>
        {user && (
          <nav>
            {user.role === 'TELLER' && <NavLink to="/teller">结柜盘点</NavLink>}
            {user.role === 'SUPERVISOR' && <NavLink to="/supervisor">复核与长短款</NavLink>}
            {user.role === 'FINANCE' && <NavLink to="/finance">财务确认与日结</NavLink>}
            <span className="user-chip">
              {user.name}（{ROLE_NAME[user.role]}）
            </span>
            <button className="link" onClick={logout}>
              退出
            </button>
          </nav>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/login" element={<LoginPage onLogin={(u) => { setUser(u); setUserState(u); navigate(ROLE_HOME[u.role]); }} />} />
          <Route path="/teller" element={user ? <TellerPage /> : <Navigate to="/login" />} />
          <Route path="/supervisor" element={user ? <SupervisorPage /> : <Navigate to="/login" />} />
          <Route path="/finance" element={user ? <FinancePage /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to={user ? ROLE_HOME[user.role] : '/login'} />} />
        </Routes>
      </main>
    </div>
  );
}

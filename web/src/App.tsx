import { useEffect, useState } from 'react';
import { api, getUserId, setUserId } from './api';
import { BusinessDay, User } from './types';
import ClosingPage from './pages/ClosingPage';
import ReviewPage from './pages/ReviewPage';
import FinancePage from './pages/FinancePage';

type Tab = 'closing' | 'review' | 'finance';

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [uid, setUid] = useState(getUserId());
  const [day, setDay] = useState<BusinessDay | null>(null);
  const [tab, setTab] = useState<Tab>('closing');
  const [error, setError] = useState('');

  const user = users.find((u) => u.id === uid) ?? null;

  async function loadDay() {
    try {
      setDay(await api<BusinessDay | null>('/days/current'));
    } catch {
      setDay(null);
    }
  }

  useEffect(() => {
    api<User[]>('/users').then((list) => {
      setUsers(list);
      if (!getUserId() && list.length > 0) {
        setUid(list[0].id);
        setUserId(list[0].id);
      }
    });
    loadDay();
  }, []);

  function switchUser(id: string) {
    setUid(id);
    setUserId(id);
    setTab(id && users.find((u) => u.id === id)?.role === 'SUPERVISOR' ? 'review' : 'closing');
  }

  return (
    <div className="app">
      <header>
        <h1>柜面现金长短款复核与缴回系统</h1>
        <div className="header-right">
          <span className={`day-badge ${day ? 'open' : 'closed'}`}>
            {day ? `营业日 ${day.date}（营业中）` : '当前无营业中的营业日'}
          </span>
          <label>
            当前用户：
            <select value={uid} onChange={(e) => switchUser(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'closing' ? 'active' : ''} onClick={() => setTab('closing')}>
          结柜盘点
        </button>
        <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
          主管复核
        </button>
        <button className={tab === 'finance' ? 'active' : ''} onClick={() => setTab('finance')}>
          财务与营业日
        </button>
      </nav>

      {error && (
        <div className="toast error" onClick={() => setError('')}>
          {error}（点击关闭）
        </div>
      )}

      <main>
        {tab === 'closing' && <ClosingPage user={user} day={day} onError={setError} />}
        {tab === 'review' && <ReviewPage user={user} onError={setError} />}
        {tab === 'finance' && <FinancePage user={user} day={day} onDayChange={loadDay} onError={setError} />}
      </main>
    </div>
  );
}

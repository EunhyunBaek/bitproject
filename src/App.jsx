import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:4000/api';

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login');

  const logout = () => {
    setUser(null);
    setView('login');
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>비트컴퓨터 사내 직원 관리 포털</h1>
        {user && (
          <div style={styles.userInfo}>
            <span><strong>{user.name}</strong> 님 ({user.role})</span>
            <button onClick={logout} style={styles.logoutBtn}>로그아웃</button>
          </div>
        )}
      </header>

      {view === 'login' && <Login setUser={setUser} setView={setView} />}
      {view === 'portal' && <UserPortal user={user} setUser={setUser} />}
      {view === 'admin' && <AdminDashboard user={user} />}
    </div>
  );
}

function Login({ setUser, setView }) {
  const handleLogin = async (email, password) => {
    try {
      const res = await axios.post(`${API_BASE}/login`, { email, password });
      setUser(res.data.user);
      if (res.data.user.role === 'ADMIN') setView('admin');
      else setView('portal');
    } catch (err) {
      alert(err.response?.data?.error || '로그인 실패');
    }
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>🔑 테스트 계정 퀵 선택 (면접관 안내용)</h3>
      <div style={styles.btnGrid}>
        <button style={{ ...styles.btn, ...styles.btnAdmin }} onClick={() => handleLogin('admin@bit.kr', 'admin123')}>관리자 계정</button>
        <button style={{ ...styles.btn, ...styles.btnUser }} onClick={() => handleLogin('user1@bit.kr', 'user123')}>일반 직원 1 (김민준)</button>
        <button style={{ ...styles.btn, ...styles.btnUser }} onClick={() => handleLogin('user2@bit.kr', 'user123')}>일반 직원 2 (이서연)</button>
        <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={() => handleLogin('retired@bit.kr', 'user123')}>퇴사 테스트 계정 (박퇴사)</button>
      </div>
    </div>
  );
}

function UserPortal({ user, setUser }) {
  const [name, setName] = useState(user.name);
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth);

  const handleUpdate = async () => {
    try {
      const res = await axios.put(`${API_BASE}/me`, { name, dateOfBirth }, {
        headers: { 'x-user-id': user.id }
      });
      setUser(res.data);
      alert('인적사항이 수정되었습니다.');
    } catch (err) {
      alert(err.response?.data?.message || '수정 실패');
    }
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>👤 개인 정보 수정</h3>
      <div style={styles.formGroup}>
        <label style={styles.label}>사번:</label>
        <input style={styles.inputDisabled} value={user.id} disabled />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>성명:</label>
        <input style={styles.input} value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>생년월일:</label>
        <input style={styles.input} type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
      </div>
      <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={handleUpdate}>수정 저장</button>
    </div>
  );
}

function AdminDashboard({ user }) {
  const [employees, setEmployees] = useState([]);
  const [checkResult, setCheckResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadEmployees = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/employees`, {
        headers: { 'x-user-id': user.id }
      });
      setEmployees(res.data);
    } catch (err) {
      alert('목록 로드 실패');
    }
  };

  useEffect(() => { loadEmployees(); }, []);

  const handleResign = async (id) => {
    if (!confirm('해당 직원을 퇴사 처리하시겠습니까? 즉시 접속이 차단됩니다.')) return;
    try {
      await axios.patch(`${API_BASE}/admin/employees/${id}/resign`, {}, {
        headers: { 'x-user-id': user.id }
      });
      loadEmployees();
    } catch (err) {
      alert('퇴사 처리 실패');
    }
  };

  const handleBackgroundCheck = async (employeeId) => {
    setLoading(true);
    setCheckResult(null);
    try {
      const res = await axios.post(`${API_BASE}/admin/background-check`, { employeeId }, {
        headers: { 'x-user-id': user.id }
      });
      setCheckResult(res.data);
    } catch (err) {
      alert('Background Check 연동 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>📊 임직원 관리 대시보드</h3>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>사번</th>
            <th style={styles.th}>성명</th>
            <th style={styles.th}>역할</th>
            <th style={styles.th}>상태</th>
            <th style={styles.th}>관리</th>
          </tr>
        </thead>
        <tbody>
          {employees.map(emp => (
            <tr key={emp.id} style={emp.status === 'RESIGNED' ? styles.trResigned : styles.tr}>
              <td style={styles.td}>{emp.id}</td>
              <td style={styles.td}><strong>{emp.name}</strong></td>
              <td style={styles.td}>{emp.role}</td>
              <td style={styles.td}>
                <span style={emp.status === 'ACTIVE' ? styles.badgeActive : styles.badgeResigned}>
                  {emp.status}
                </span>
              </td>
              <td style={styles.td}>
                {emp.status === 'ACTIVE' && emp.role !== 'ADMIN' && (
                  <button style={{ ...styles.btnSm, ...styles.btnDanger }} onClick={() => handleResign(emp.id)}>퇴사 처리</button>
                )}
                <button style={{ ...styles.btnSm, ...styles.btnInfo }} onClick={() => handleBackgroundCheck(emp.id)}>Background Check</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {loading && <div style={styles.loading}>🔍 External API 통신 및 신원 조사 진행 중...</div>}

      {checkResult && (
        <div style={styles.resultBox}>
          <h4>📋 Background Check 결과</h4>
          <pre style={styles.pre}>{JSON.stringify(checkResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: '900px', margin: '30px auto', fontFamily: "'Pretendard', sans-serif", color: '#333' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #2563eb', paddingBottom: '15px', marginBottom: '20px' },
  title: { fontSize: '22px', margin: 0, color: '#1e293b' },
  userInfo: { display: 'flex', alignItems: 'center', gap: '10px' },
  logoutBtn: { padding: '6px 12px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  card: { background: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' },
  cardTitle: { marginTop: 0, marginBottom: '20px', color: '#1e293b' },
  btnGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  btn: { padding: '12px', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' },
  btnAdmin: { background: '#2563eb', color: '#fff' },
  btnUser: { background: '#0891b2', color: '#fff' },
  btnDanger: { background: '#ef4444', color: '#fff' },
  btnPrimary: { background: '#10b981', color: '#fff' },
  btnInfo: { background: '#6366f1', color: '#fff', marginLeft: '6px' },
  btnSm: { padding: '6px 10px', fontSize: '12px', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  formGroup: { marginBottom: '15px' },
  label: { display: 'block', marginBottom: '5px', fontWeight: 'bold' },
  input: { width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' },
  inputDisabled: { width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f1f5f9', boxSizing: 'border-box' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '10px' },
  th: { padding: '12px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', fontSize: '14px' },
  td: { padding: '12px', borderBottom: '1px solid #f1f5f9', fontSize: '14px' },
  tr: { background: '#fff' },
  trResigned: { background: '#fef2f2' },
  badgeActive: { padding: '4px 8px', borderRadius: '12px', background: '#dcfce7', color: '#15803d', fontSize: '12px', fontWeight: 'bold' },
  badgeResigned: { padding: '4px 8px', borderRadius: '12px', background: '#fee2e2', color: '#b91c1c', fontSize: '12px', fontWeight: 'bold' },
  loading: { padding: '15px', background: '#eff6ff', borderRadius: '6px', color: '#1d4ed8', marginTop: '15px', fontWeight: 'bold' },
  resultBox: { marginTop: '20px', background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #cbd5e1' },
  pre: { background: '#1e293b', color: '#f8fafc', padding: '12px', borderRadius: '6px', overflowX: 'auto', fontSize: '12px' }
};
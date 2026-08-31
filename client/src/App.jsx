import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

// 백엔드 API 호스트 기본 URL
const API_BASE = 'http://localhost:5000/api';

export default function App() {
  // ---------------------------------------------------------------------------
  // [상태 관리 (State Variables)]
  // ---------------------------------------------------------------------------
  // 로컬 스토리지에 저장된 토큰 및 유저 세션 정보 로드
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));
  
  // 로그인 폼 입력값
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // 직원 본인 프로필 데이터 및 수정 폼 상태
  const [profile, setProfile] = useState({ name: '', birthDate: '', employeeId: '' });
  const [editName, setEditName] = useState('');
  const [editBirthDate, setEditBirthDate] = useState('');
  
  // 비밀번호 변경 폼 입력 상태
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');

  // 관리자 대시보드 데이터 목록
  const [employees, setEmployees] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('employees'); // 'employees' | 'logs'

  // Background Check 비동기 요청 처리 상태
  const [bgCheckResults, setBgCheckResults] = useState({});
  const [loadingStatus, setLoadingStatus] = useState({});
  const [sseNotifications, setSseNotifications] = useState([]); // SSE 실시간 알림 메시지 목록
  const [newEmp, setNewEmp] = useState({ username: '', password: '', name: '', employeeId: '', birthDate: '' });

  // 세션 타이머 객체 참값을 보존하기 위한 useRef
  const timeoutRef = useRef(null);

  // ---------------------------------------------------------------------------
  // [보안 기능 1] 10분 동안 미활동 시 자동 로그아웃 (Inactivity Session Timeout)
  // ---------------------------------------------------------------------------
  const handleLogout = () => {
    setToken('');
    setUser(null);
    localStorage.clear();
  };

  // 마우스 이동/키보드 입력 시 미활동 타이머를 리셋하는 함수
  const resetSessionTimer = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (token) {
      timeoutRef.current = setTimeout(() => {
        alert('보안을 위해 10분간 활동이 없어 자동 로그아웃되었습니다.');
        handleLogout();
      }, 10 * 60 * 1000); // 10분 (600,000ms)
    }
  };

  // 사용자 인터랙션 이벤트를 감지하여 자동 타이머 설정
  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click'];
    events.forEach(e => window.addEventListener(e, resetSessionTimer));
    resetSessionTimer();

    return () => {
      events.forEach(e => window.removeEventListener(e, resetSessionTimer));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [token]);

  // ---------------------------------------------------------------------------
  // [보안 기능 4] Server-Sent Events (SSE) 실시간 이벤트 알림 구독
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!token) return;

    // 백엔드의 /api/events SSE 연결 생성
    const eventSource = new EventSource(`${API_BASE}/events`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'BG_CHECK_STARTED') {
        setSseNotifications(prev => [`[알림] 사번 ${data.employeeId}의 Background Check 조회가 시작되었습니다.`, ...prev]);
      } else if (data.type === 'BG_CHECK_COMPLETED') {
        setSseNotifications(prev => [`[완료] Check ID (${data.checkId.substring(0, 8)}) 조회가 완료되었습니다.`, ...prev]);
      }
    };

    return () => eventSource.close(); // 컴포넌트 언마운트 시 SSE 연결 종료
  }, [token]);

  // 로그인 상태 및 권한(Role)에 따른 initial Data Fetching
  useEffect(() => {
    if (token) {
      if (user?.role === 'ADMIN') {
        fetchEmployees();
        fetchAuditLogs();
      } else {
        fetchProfile();
      }
    }
  }, [token]);

  // ---------------------------------------------------------------------------
  // [이벤트 핸들러] 로그인, 프로필 수정, 비밀번호 변경, CSV 다운로드
  // ---------------------------------------------------------------------------
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_BASE}/login`, { username, password });
      setToken(res.data.token);
      setUser(res.data.user);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
    } catch (err) {
      alert(err.response?.data?.message || '로그인 실패');
    }
  };

  // 비밀번호 변경 요청 핸들러
  const handleChangePassword = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.put(`${API_BASE}/change-password`, { currentPassword: currentPwd, newPassword: newPwd }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert(res.data.message);
      setCurrentPwd('');
      setNewPwd('');
    } catch (err) {
      alert(err.response?.data?.message || '비밀번호 변경 실패');
    }
  };

  // [보안 기능 3] 감사 로그 및 직원 목록 CSV 다운로드 유틸리티
  const exportToCSV = (dataList, filename) => {
    if (!dataList || !dataList.length) {
      alert('다운로드할 데이터가 없습니다.');
      return;
    }
    const keys = Object.keys(dataList[0]);
    const csvRows = [
      keys.join(','),
      ...dataList.map(row => keys.map(k => `"${row[k] !== undefined ? row[k] : ''}"`).join(','))
    ];

    // 한글 깨짐 방지를 위한 BOM (\uFEFF) 추가
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchProfile = async () => {
    try {
      const res = await axios.get(`${API_BASE}/profile`, { headers: { Authorization: `Bearer ${token}` } });
      setProfile(res.data);
      setEditName(res.data.name);
      setEditBirthDate(res.data.birthDate || '');
    } catch (err) {
      handleLogout();
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`${API_BASE}/profile`, { name: editName, birthDate: editBirthDate }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('프로필이 수정되었습니다.');
      fetchProfile();
    } catch (err) {
      alert('수정 실패');
    }
  };

  const fetchEmployees = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/employees`, { headers: { Authorization: `Bearer ${token}` } });
      setEmployees(res.data);
    } catch (err) {
      alert('목록 조회 실패');
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admin/audit-logs`, { headers: { Authorization: `Bearer ${token}` } });
      setAuditLogs(res.data);
    } catch (err) {
      console.error('감사 로그 조회 실패');
    }
  };

  const handleCreateEmployee = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/admin/employees`, newEmp, { headers: { Authorization: `Bearer ${token}` } });
      alert('직원 등록 완료');
      setNewEmp({ username: '', password: '', name: '', employeeId: '', birthDate: '' });
      fetchEmployees();
      fetchAuditLogs();
    } catch (err) {
      alert(err.response?.data?.message || '등록 실패');
    }
  };

  const handleRetire = async (id) => {
    if (!window.confirm('퇴사 처리하시겠습니까? 토큰이 무효화됩니다.')) return;
    try {
      await axios.patch(`${API_BASE}/admin/employees/${id}/retire`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchEmployees();
      fetchAuditLogs();
    } catch (err) {
      alert('퇴사 처리 실패');
    }
  };

  // Background Check 요청 실행
  const handleRequestBgCheck = async (emp) => {
    setLoadingStatus(prev => ({ ...prev, [emp.id]: '요청 중...' }));
    try {
      const res = await axios.post(`${API_BASE}/admin/background-checks`, {
        employeeId: emp.employeeId,
        name: emp.name,
        birthDate: emp.birthDate
      }, { headers: { Authorization: `Bearer ${token}` } });

      const checkId = res.data.checkId;
      setLoadingStatus(prev => ({ ...prev, [emp.id]: `진행 중 (${checkId.substring(0, 8)}...)` }));
      pollBgCheckResult(checkId, emp.id);
      fetchAuditLogs();
    } catch (err) {
      alert('요청 실패');
      setLoadingStatus(prev => ({ ...prev, [emp.id]: null }));
    }
  };

  // Background Check 비동기 상태 폴링(3초 간격)
  const pollBgCheckResult = (checkId, empId) => {
    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_BASE}/admin/background-checks/${checkId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data.status !== 'pending') {
          clearInterval(interval);
          setBgCheckResults(prev => ({ ...prev, [empId]: res.data }));
          setLoadingStatus(prev => ({ ...prev, [empId]: '완료' }));
        }
      } catch (err) {
        clearInterval(interval);
      }
    }, 3000);
  };

  // ---------------------------------------------------------------------------
  // [컴포넌트 렌더링] 로그인 전 뷰 vs 로그인 후 대시보드 뷰
  // ---------------------------------------------------------------------------
  if (!token) {
    return (
      <div style={{ maxWidth: '400px', margin: '80px auto', padding: '25px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h2>비트컴퓨터 사내 포털 로그인</h2>
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '10px' }}>
            <label>아이디</label>
            <input style={{ width: '100%', padding: '8px', marginTop: '4px' }} value={username} onChange={e => setUsername(e.target.value)} required />
          </div>
          <div style={{ marginBottom: '15px' }}>
            <label>비밀번호</label>
            <input type="password" style={{ width: '100%', padding: '8px', marginTop: '4px' }} value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button style={{ width: '100%', padding: '10px', backgroundColor: '#0056b3', color: '#fff', border: 'none', borderRadius: '4px' }} type="submit">안전 로그인</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #333', paddingBottom: '10px' }}>
        <h2>비트컴퓨터 사내 포털 [{user?.role === 'ADMIN' ? '보안 대시보드' : '직원 포털'}]</h2>
        <div>
          <span><b>{user?.name}</b> 님 (10분 미활동 시 자동로그아웃) </span>
          <button onClick={handleLogout} style={{ marginLeft: '10px' }}>로그아웃</button>
        </div>
      </header>

      {/* SSE 실시간 이벤트 배너 */}
      {sseNotifications.length > 0 && (
        <div style={{ backgroundColor: '#e2f0d9', padding: '10px', marginTop: '10px', borderRadius: '4px', border: '1px solid #b2d8b2' }}>
          <strong>📡 실시간 상태 알림 (SSE)</strong>
          <ul style={{ margin: '5px 0 0 20px', padding: 0 }}>
            {sseNotifications.slice(0, 3).map((note, idx) => <li key={idx}>{note}</li>)}
          </ul>
        </div>
      )}

      {/* 일반 직원 전용 포털 뷰 */}
      {user?.role === 'EMPLOYEE' && (
        <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
          <section style={{ flex: 1, background: '#f9f9f9', padding: '20px', borderRadius: '8px' }}>
            <h3>개인 인적사항 수정</h3>
            <form onSubmit={handleUpdateProfile}>
              <div style={{ marginBottom: '10px' }}>
                <label>사번: </label>
                <input value={profile.employeeId || ''} disabled style={{ width: '100%', padding: '8px', backgroundColor: '#eee' }} />
              </div>
              <div style={{ marginBottom: '10px' }}>
                <label>성명: </label>
                <input value={editName} onChange={e => setEditName(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label>생년월일: </label>
                <input type="date" value={editBirthDate} onChange={e => setEditBirthDate(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
              </div>
              <button type="submit" style={{ padding: '8px 16px', backgroundColor: '#28a745', color: '#fff', border: 'none' }}>저장</button>
            </form>
          </section>

          <section style={{ flex: 1, background: '#f9f9f9', padding: '20px', borderRadius: '8px' }}>
            <h3>비밀번호 변경</h3>
            <form onSubmit={handleChangePassword}>
              <div style={{ marginBottom: '10px' }}>
                <label>현재 비밀번호</label>
                <input type="password" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label>신규 비밀번호 (영문+숫자+특수문자 8자 이상)</label>
                <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
              </div>
              <button type="submit" style={{ padding: '8px 16px', backgroundColor: '#0056b3', color: '#fff', border: 'none' }}>비밀번호 변경</button>
            </form>
          </section>
        </div>
      )}

      {/* 관리자 전용 대시보드 뷰 */}
      {user?.role === 'ADMIN' && (
        <section style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setActiveTab('employees')} style={{ padding: '10px 20px', fontWeight: activeTab === 'employees' ? 'bold' : 'normal' }}>
                직원 및 Background Check 관리
              </button>
              <button onClick={() => { setActiveTab('logs'); fetchAuditLogs(); }} style={{ padding: '10px 20px', fontWeight: activeTab === 'logs' ? 'bold' : 'normal', backgroundColor: '#6c757d', color: '#fff' }}>
                🛡️ 보안 감사 로그 (Audit Logs)
              </button>
            </div>

            {/* CSV 추출 버튼 */}
            {activeTab === 'employees' ? (
              <button onClick={() => exportToCSV(employees, '직원_목록_리포트')} style={{ backgroundColor: '#17a2b8', color: '#fff', border: 'none', padding: '10px 15px', borderRadius: '4px' }}>
                📥 직원 목록 CSV 추출
              </button>
            ) : (
              <button onClick={() => exportToCSV(auditLogs, '보안_감사_로그')} style={{ backgroundColor: '#17a2b8', color: '#fff', border: 'none', padding: '10px 15px', borderRadius: '4px' }}>
                📥 감사 로그 CSV 추출
              </button>
            )}
          </div>

          {activeTab === 'employees' ? (
            <>
              <h3>신규 직원 등록</h3>
              <form onSubmit={handleCreateEmployee} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                <input placeholder="아이디" value={newEmp.username} onChange={e => setNewEmp({ ...newEmp, username: e.target.value })} required />
                <input placeholder="비밀번호" type="password" value={newEmp.password} onChange={e => setNewEmp({ ...newEmp, password: e.target.value })} required />
                <input placeholder="이름" value={newEmp.name} onChange={e => setNewEmp({ ...newEmp, name: e.target.value })} required />
                <input placeholder="사번" value={newEmp.employeeId} onChange={e => setNewEmp({ ...newEmp, employeeId: e.target.value })} required />
                <input type="date" value={newEmp.birthDate} onChange={e => setNewEmp({ ...newEmp, birthDate: e.target.value })} required />
                <button type="submit">등록</button>
              </form>

              <h3>직원 목록</h3>
              <table border="1" cellPadding="10" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f2f2f2' }}>
                    <th>사번</th>
                    <th>성명</th>
                    <th>권한</th>
                    <th>상태</th>
                    <th>Background Check</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id} style={{ backgroundColor: emp.is_retired ? '#ffeef0' : 'white' }}>
                      <td>{emp.employeeId}</td>
                      <td>{emp.name}</td>
                      <td>{emp.role}</td>
                      <td><b>{emp.is_retired ? '퇴사' : '재직'}</b></td>
                      <td>
                        <button onClick={() => handleRequestBgCheck(emp)} disabled={emp.is_retired}>신규 요청</button>
                        {loadingStatus[emp.id] && <div style={{ fontSize: '11px' }}>{loadingStatus[emp.id]}</div>}
                        {bgCheckResults[emp.id] && (
                          <div style={{ fontSize: '11px', color: 'green' }}>
                            결과: {bgCheckResults[emp.id].status} (신원: {bgCheckResults[emp.id].criminalRecord ? '경력있음' : '이상없음'})
                          </div>
                        )}
                      </td>
                      <td>
                        {!emp.is_retired && emp.role !== 'ADMIN' && (
                          <button onClick={() => handleRetire(emp.id)} style={{ backgroundColor: '#dc3545', color: '#fff', border: 'none' }}>퇴사 처리</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <>
              <h3>🛡️ 시스템 보안 감사 로그 (최신 50건)</h3>
              <table border="1" cellPadding="8" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead style={{ backgroundColor: '#e9ecef' }}>
                  <tr>
                    <th>일시</th>
                    <th>수행자 계정</th>
                    <th>수행 작업 (Action)</th>
                    <th>대상 사번</th>
                    <th>접속 IP</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(log => (
                    <tr key={log.id}>
                      <td>{new Date(log.timestamp).toLocaleString()}</td>
                      <td>{log.actor_username} (ID: {log.actor_id})</td>
                      <td><b>{log.action}</b></td>
                      <td>{log.target_employee_id}</td>
                      <td>{log.ip_address}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </div>
  );
}
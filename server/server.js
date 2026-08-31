// Express 웹 서버 모듈 불러오기
const express = require('express');
// SQLite3 데이터베이스 드라이버 불러오기 (verbose 모드로 에러 스택 디버깅 강화)
const sqlite3 = require('sqlite3').verbose();
// JSON Web Token 인증 토큰 생성 및 검증 모듈
const jwt = require('jsonwebtoken');
// 비밀번호 단방향 암호화(해시)용 모듈
const bcrypt = require('bcryptjs');
// Cross-Origin Resource Sharing(교차 출처 리소스 공유) 허용 미들웨어
const cors = require('cors');
// 외부 HTTP API 요청을 처리하기 위한 Axios 클라이언트
const axios = require('axios');
// HTTP 보안 헤더 설정을 위한 보안 미들웨어 (XSS, Clickjacking 방지)
const helmet = require('helmet');
// API 요청 횟수를 제한하여 Brute-force 및 DoS 공격을 방지하는 미들웨어
const rateLimit = require('express-rate-limit');

// Express 애플리케이션 객체 생성
const app = express();
// 서버 포트 설정 (기본값: 5000)
const PORT = process.env.PORT || 5000;
// JWT 비밀키 (운영 환경에서는 환경변수로 관리)
const JWT_SECRET = process.env.JWT_SECRET || 'MEDICAL_SECURE_BIT_SECRET_2026';
// 비트컴퓨터 외부 Background Check API 기본 URL
const EXTERNAL_API_URL = 'https://54capvm12g.execute-api.ap-northeast-2.amazonaws.com';

// -----------------------------------------------------------------------------
// [보안 설정] Helmet 및 CORS, Request Body 크기 제한 적용
// -----------------------------------------------------------------------------
app.use(helmet()); // 주요 HTTP 보안 헤더 자동 설정
app.use(cors({ origin: [
  'http://localhost:5173',
  'bitproject-j3120wu9s-bitproject1.vercel.app'
], 
  credentials: true })); // 지정된 프론트엔드 URL만 접근 허용
app.use(express.json({ limit: '10kb' })); // 악의적인 거대 JSON 페이로드 공격(DoS) 방지

// 로그인 API 전용 Rate Limiting (15분당 최대 10회 시도 허용)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: '보안을 위해 로그인 시도가 일시적으로 제한되었습니다. 15분 후 다시 시도하세요.' }
});

// SQLite 데이터베이스 파일 연결
const db = new sqlite3.Database('./database.sqlite');

// Server-Sent Events(SSE) 연결 클라이언트 객체 목록을 저장할 배열
let sseClients = [];

// -----------------------------------------------------------------------------
// [DB 초기화] 테이블 생성 및 초기 테스트 계정 데이터 삽입
// -----------------------------------------------------------------------------
db.serialize(() => {
  // 1. 사용자(직원 및 관리자) 테이블 생성
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      name TEXT,
      employeeId TEXT UNIQUE,
      role TEXT CHECK(role IN ('ADMIN', 'EMPLOYEE')),
      is_retired INTEGER DEFAULT 0,
      birthDate TEXT
    )
  `);

  // 2. 의료/인사 정보 접근 관리를 위한 보안 감사 로그(Audit Log) 테이블 생성
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_username TEXT,
      action TEXT,
      target_employee_id TEXT,
      ip_address TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 초기 테스트 데이터 생성을 위한 비동기 함수
  const seedUsers = async () => {
    const hash = await bcrypt.hash('password123', 10);
    const users = [
      ['admin', hash, '김영우', 'EMP-ADM-001', 'ADMIN', 0, '1985-01-01'],
      ['emp1', hash, '김민준', 'EMP-2026-001', 'EMPLOYEE', 0, '1992-05-12'],
      ['emp2', hash, '이서연', 'EMP-2026-002', 'EMPLOYEE', 0, '1995-08-23'],
      ['retired_user', hash, '박퇴사', 'EMP-2026-003', 'EMPLOYEE', 1, '1990-11-30']
    ];

    users.forEach(u => {
      db.run(`INSERT OR IGNORE INTO users (username, password, name, employeeId, role, is_retired, birthDate) VALUES (?, ?, ?, ?, ?, ?, ?)`, u);
    });
  };
  seedUsers();
});

// -----------------------------------------------------------------------------
// [유틸리티] 감사 로그 기록 및 SSE 알림 발송 함수
// -----------------------------------------------------------------------------
// 보안 작업 수행 시 DB에 로그를 기록하는 함수
const logAudit = (actorId, actorUsername, action, targetEmployeeId, ip) => {
  db.run(
    `INSERT INTO audit_logs (actor_id, actor_username, action, target_employee_id, ip_address) VALUES (?, ?, ?, ?, ?)`,
    [actorId, actorUsername, action, targetEmployeeId || 'N/A', ip || '127.0.0.1']
  );
};

// 연결된 모든 SSE 클라이언트에게 실시간 이벤트를 전송하는 함수
const sendSseEvent = (data) => {
  sseClients.forEach(client => client.res.write(`data: ${JSON.stringify(data)}\n\n`));
};

// -----------------------------------------------------------------------------
// [미들웨어] 토큰 인증 및 실시간 퇴사자 무효화 검증
// -----------------------------------------------------------------------------
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN" 포맷에서 토큰 추출
  if (!token) return res.status(401).json({ message: '인증 토큰이 필요합니다.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: '유효하지 않거나 만료된 토큰입니다.' });

    // 실시간 DB 재검증: 퇴사 처리된 계정은 토큰이 남아있어도 즉시 접근 차단
    db.get('SELECT * FROM users WHERE id = ?', [user.id], (err, dbUser) => {
      if (err || !dbUser) return res.status(403).json({ message: '사용자를 찾을 수 없습니다.' });
      if (dbUser.is_retired === 1) {
        logAudit(dbUser.id, dbUser.username, 'BLOCKED_RETIRED_ACCESS_ATTEMPT', dbUser.employeeId, req.ip);
        return res.status(403).json({ message: '퇴사 처리된 계정입니다.' });
      }
      req.user = dbUser; // 다음 미들웨어에서 인가된 사용자 정보 사용 가능하도록 저장
      next();
    });
  });
};

// 관리자 권한 검증 미들웨어
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    logAudit(req.user.id, req.user.username, 'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT', 'N/A', req.ip);
    return res.status(403).json({ message: '관리자 권한이 필요합니다.' });
  }
  next();
};

// -----------------------------------------------------------------------------
// [API 라우터] 인증, 사용자 관리, SSE 연결
// -----------------------------------------------------------------------------

// 실시간 이벤트 스트림(SSE) 연결 엔드포인트
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // 연결 종료 시 배열에서 클라이언트 제거
  req.on('close', () => {
    sseClients = sseClients.filter(client => client.id !== clientId);
  });
});

// 로그인 API
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ message: '인증 정보가 올바르지 않습니다.' });
    if (user.is_retired === 1) return res.status(403).json({ message: '퇴사 처리된 계정입니다.' });

    // bcrypt 해시 검증
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      logAudit(user.id, user.username, 'LOGIN_FAILED_BAD_PASSWORD', user.employeeId, req.ip);
      return res.status(400).json({ message: '인증 정보가 올바르지 않습니다.' });
    }

    // JWT 토큰 발급 (유효기간: 2시간)
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '2h' });
    logAudit(user.id, user.username, 'LOGIN_SUCCESS', user.employeeId, req.ip);

    res.json({
      token,
      user: { id: user.id, username: user.username, name: user.name, employeeId: user.employeeId, role: user.role, birthDate: user.birthDate }
    });
  });
});

// 비밀번호 변경 API (정규식을 활용한 강한 보안 정책 검증)
app.put('/api/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // 비밀번호 정규식: 영문, 숫자, 특수문자 조합 최소 8자 이상
  const pwdRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
  if (!pwdRegex.test(newPassword)) {
    return res.status(400).json({ message: '비밀번호는 영문, 숫자, 특수문자를 포함해 8자 이상이어야 합니다.' });
  }

  const validPassword = await bcrypt.compare(currentPassword, req.user.password);
  if (!validPassword) {
    return res.status(400).json({ message: '현재 비밀번호가 일치하지 않습니다.' });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  db.run('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id], function(err) {
    if (err) return res.status(500).json({ message: '비밀번호 변경 실패' });
    logAudit(req.user.id, req.user.username, 'CHANGE_PASSWORD_SUCCESS', req.user.employeeId, req.ip);
    res.json({ message: '비밀번호가 성공적으로 변경되었습니다.' });
  });
});

// 본인 프로필 조회 API
app.get('/api/profile', authenticateToken, (req, res) => {
  const { password, ...userProfile } = req.user;
  res.json(userProfile);
});

// 본인 프로필 수정 API
app.put('/api/profile', authenticateToken, (req, res) => {
  const { name, birthDate } = req.body;
  db.run('UPDATE users SET name = ?, birthDate = ? WHERE id = ?', [name, birthDate, req.user.id], function(err) {
    if (err) return res.status(500).json({ message: '수정 실패' });
    logAudit(req.user.id, req.user.username, 'PROFILE_UPDATE', req.user.employeeId, req.ip);
    res.json({ message: '프로필 수정 완료' });
  });
});

// [관리자 전용] 전체 직원 목록 조회 API
app.get('/api/admin/employees', authenticateToken, isAdmin, (req, res) => {
  db.all('SELECT id, username, name, employeeId, role, is_retired, birthDate FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ message: '조회 실패' });
    res.json(rows);
  });
});

// [관리자 전용] 신규 직원 생성 API
app.post('/api/admin/employees', authenticateToken, isAdmin, async (req, res) => {
  const { username, password, name, employeeId, role, birthDate } = req.body;
  const hash = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (username, password, name, employeeId, role, birthDate) VALUES (?, ?, ?, ?, ?, ?)`,
    [username, hash, name, employeeId, role || 'EMPLOYEE', birthDate],
    function(err) {
      if (err) return res.status(400).json({ message: '중복된 계정 정보입니다.' });
      logAudit(req.user.id, req.user.username, 'CREATE_EMPLOYEE', employeeId, req.ip);
      res.status(201).json({ id: this.lastID, message: '직원 등록 완료' });
    }
  );
});

// [관리자 전용] 직원 퇴사 처리 API
app.patch('/api/admin/employees/:id/retire', authenticateToken, isAdmin, (req, res) => {
  db.run('UPDATE users SET is_retired = 1 WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ message: '퇴사 처리 실패' });
    logAudit(req.user.id, req.user.username, 'RETIRE_EMPLOYEE', `USER_ID:${req.params.id}`, req.ip);
    res.json({ message: '퇴사 처리 완료' });
  });
});

// [관리자 전용] 보안 감사 로그 목록 조회 API
app.get('/api/admin/audit-logs', authenticateToken, isAdmin, (req, res) => {
  db.all('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50', [], (err, rows) => {
    if (err) return res.status(500).json({ message: '감사 로그 조회 실패' });
    res.json(rows);
  });
});

// -----------------------------------------------------------------------------
// [외부 Background Check API 연동]
// -----------------------------------------------------------------------------
// 한글 성명을 외부 API용 영문 firstName / lastName으로 파싱하는 유틸리티
const parseKoreanName = (fullName) => {
  if (!fullName) return { firstName: 'GilDong', lastName: 'Hong' };
  const trimmed = fullName.trim();
  if (trimmed.length === 2) return { lastName: trimmed[0], firstName: trimmed[1] };
  if (trimmed.length >= 3) return { lastName: trimmed[0], firstName: trimmed.substring(1) };
  return { lastName: 'Kim', firstName: trimmed };
};

// 외부 API의 503(Service Unavailable) 발생 시 지연 재시도(Exponential Backoff) 함수
const callExternalApiWithRetry = async (config, retries = 3, delay = 1000) => {
  try {
    return await axios(config);
  } catch (error) {
    const status = error.response?.status;
    if ((status === 503 || status === 500) && retries > 0) {
      const retryAfter = error.response?.data?.retryAfter || error.response?.headers['retry-after'];
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
      await new Promise(res => setTimeout(res, waitTime));
      return callExternalApiWithRetry(config, retries - 1, delay * 2);
    }
    throw error;
  }
};

// Background Check 신규 요청 생성 API (POST /background-checks)
app.post('/api/admin/background-checks', authenticateToken, isAdmin, async (req, res) => {
  const { employeeId, name, birthDate } = req.body;
  const { firstName, lastName } = parseKoreanName(name);

  try {
    const response = await callExternalApiWithRetry({
      method: 'post',
      url: `${EXTERNAL_API_URL}/background-checks`,
      data: { employeeId, firstName, lastName, dateOfBirth: birthDate || '1990-01-01' }
    });
    logAudit(req.user.id, req.user.username, 'REQUEST_BACKGROUND_CHECK', employeeId, req.ip);

    // SSE 이벤트 브로드캐스트: 백그라운드 조회가 시작됨을 프론트엔드에 실시간 통보
    sendSseEvent({ type: 'BG_CHECK_STARTED', employeeId, checkId: response.data.checkId });

    res.status(201).json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ message: 'API 요청 실패', error: error.response?.data });
  }
});

// Background Check 단건 결과 상세 조회 API (GET /background-checks/{checkId})
app.get('/api/admin/background-checks/:checkId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const response = await callExternalApiWithRetry({
      method: 'get',
      url: `${EXTERNAL_API_URL}/background-checks/${req.params.checkId}`
    });
    logAudit(req.user.id, req.user.username, 'VIEW_BACKGROUND_CHECK_DETAIL', req.params.checkId, req.ip);

    // 조회가 완료 상태(pending이 아님)일 경우 SSE 실시간 이벤트 발송
    if (response.data.status !== 'pending') {
      sendSseEvent({ type: 'BG_CHECK_COMPLETED', checkId: req.params.checkId, result: response.data });
    }

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ message: '조회 실패' });
  }
});

// Background Check 직원의 이전 히스토리 목록 조회 API (GET /background-checks?employeeId={id})
app.get('/api/admin/background-checks', authenticateToken, isAdmin, async (req, res) => {
  const { employeeId } = req.query;
  try {
    const response = await callExternalApiWithRetry({
      method: 'get',
      url: `${EXTERNAL_API_URL}/background-checks`,
      params: { employeeId }
    });
    logAudit(req.user.id, req.user.username, 'VIEW_BACKGROUND_CHECK_HISTORY', employeeId, req.ip);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ message: '조회 실패' });
  }
});

// 서버 바인딩 및 실행
app.listen(PORT, () => console.log(`Secure Enterprise Medical Server running on port ${PORT}`));
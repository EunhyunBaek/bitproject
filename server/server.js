require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const EXTERNAL_API_URL = process.env.EXTERNAL_API_URL || 'https://54capvm12g.execute-api.ap-northeast-2.amazonaws.com';

// --- SQLite DB 초기화 ---
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('SQLite 연결 실패:', err.message);
  else console.log('SQLite DB 연결 성공');
});

// 테이블 생성 및 초기 데이터 삽입 (SQL 실행)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      name TEXT,
      dateOfBirth TEXT,
      role TEXT,
      status TEXT
    )
  `);

  // 초기 테스트 데이터 체크 및 추가
  db.get('SELECT COUNT(*) as count FROM employees', (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare(`
        INSERT INTO employees (id, email, password, name, dateOfBirth, role, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run('EMP-2026-001', 'admin@bit.kr', 'admin123', '관리자', '1985-05-20', 'ADMIN', 'ACTIVE');
      stmt.run('EMP-2026-002', 'user1@bit.kr', 'user123', '김민준', '1992-03-15', 'EMPLOYEE', 'ACTIVE');
      stmt.run('EMP-2026-003', 'user2@bit.kr', 'user123', '이서연', '1995-08-22', 'EMPLOYEE', 'ACTIVE');
      stmt.run('EMP-2026-004', 'retired@bit.kr', 'user123', '박퇴사', '1990-01-01', 'EMPLOYEE', 'RESIGNED');
      stmt.finalize();
      console.log('초기 SQL 데이터 생성 완료');
    }
  });
});

// 유틸리티: 한글 이름 분리
function parseKoreanName(fullName) {
  if (!fullName || fullName.length < 2) return { firstName: fullName || 'Unknown', lastName: 'Noname' };
  return { lastName: fullName.substring(0, 1), firstName: fullName.substring(1) };
}

// [미들웨어] SQL 조회 기반 인증 및 퇴사자 접근 차단
const authCheck = (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  // SQL: 사용자 조회
  db.get('SELECT * FROM employees WHERE id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Not Found', message: '사용자를 찾을 수 없습니다.' });

    if (user.status === 'RESIGNED') {
      return res.status(403).json({ error: 'Forbidden', message: '퇴사 처리된 계정입니다. 접근이 즉시 차단됩니다.' });
    }

    req.user = user;
    next();
  });
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden', message: '관리자 전용 기능입니다.' });
  }
  next();
};

// --- API 라우트 (SQL 적용) ---

// 로그인 (SELECT)
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const sql = 'SELECT * FROM employees WHERE email = ? AND password = ?';
  
  db.get(sql, [email, password], (err, user) => {
    if (err) return res.status(500).json({ error: 'DB 오류 발생' });
    if (!user) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    if (user.status === 'RESIGNED') return res.status(403).json({ error: '퇴사 처리된 계정입니다.' });

    res.json({ user });
  });
});

app.get('/api/me', authCheck, (req, res) => res.json(req.user));

// 내 정보 수정 (UPDATE)
app.put('/api/me', authCheck, (req, res) => {
  const { name, dateOfBirth } = req.body;
  const newName = name || req.user.name;
  const newDob = dateOfBirth || req.user.dateOfBirth;

  const sql = 'UPDATE employees SET name = ?, dateOfBirth = ? WHERE id = ?';
  db.run(sql, [newName, newDob, req.user.id], function (err) {
    if (err) return res.status(500).json({ error: '수정 실패' });
    res.json({ ...req.user, name: newName, dateOfBirth: newDob });
  });
});

// 전체 사원 조회 (SELECT)
app.get('/api/admin/employees', authCheck, adminOnly, (req, res) => {
  db.all('SELECT id, email, name, dateOfBirth, role, status FROM employees', [], (err, rows) => {
    if (err) return res.status(500).json({ error: '목록 조회 실패' });
    res.json(rows);
  });
});

// 퇴사 처리 (UPDATE)
app.patch('/api/admin/employees/:id/resign', authCheck, adminOnly, (req, res) => {
  const targetId = req.params.id;
  const sql = "UPDATE employees SET status = 'RESIGNED' WHERE id = ?";

  db.run(sql, [targetId], function (err) {
    if (err) return res.status(500).json({ error: '퇴사 처리 실패' });
    res.json({ message: '퇴사 처리가 완료되었습니다.' });
  });
});

// External Background Check API
app.post('/api/admin/background-check', authCheck, adminOnly, (req, res) => {
  const { employeeId } = req.body;

  db.get('SELECT * FROM employees WHERE id = ?', [employeeId], async (err, emp) => {
    if (err || !emp) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' });

    const { firstName, lastName } = parseKoreanName(emp.name);

    const requestWithRetry = async (retries = 3) => {
      try {
        const response = await axios.post(`${EXTERNAL_API_URL}/background-checks`, {
          employeeId: emp.id, firstName, lastName, dateOfBirth: emp.dateOfBirth
        });
        return response.data;
      } catch (err) {
        if (err.response && (err.response.status === 503 || err.response.status === 500) && retries > 0) {
          const waitTime = err.response.data?.retryAfter || 2;
          await new Promise(r => setTimeout(r, waitTime * 1000));
          return requestWithRetry(retries - 1);
        }
        throw err;
      }
    };

    try {
      const data = await requestWithRetry();
      res.status(201).json(data);
    } catch (err) {
      res.status(err.response?.status || 500).json({ error: '외부 API 연동 실패', message: err.message });
    }
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT} with SQLite DB`));
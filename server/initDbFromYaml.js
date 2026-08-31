// server/initDbFromYaml.js
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('./database.sqlite');

async function initDatabase() {
  try {
    // 1. YAML 파일 읽기 및 파싱
    const yamlPath = path.join(__dirname, 'schema.yaml');
    const fileContents = fs.readFileSync(yamlPath, 'utf8');
    const schema = yaml.load(fileContents);

    db.serialize(async () => {
      // 2. YAML 정의에 맞춰 테이블 자동 생성
      schema.tables.forEach((table) => {
        const columnDefs = table.columns
          .map((col) => `${col.name} ${col.type}`)
          .join(', ');

        const createTableSql = `CREATE TABLE IF NOT EXISTS ${table.name} (${columnDefs})`;
        db.run(createTableSql);
        console.log(`[DB] Table created or exists: ${table.name}`);
      });

      // 3. 초기 테스트 계정 시딩
      const hash = await bcrypt.hash('password123', 10);
      const seedUsers = [
        ['admin', hash, '김영우', 'EMP-ADM-001', 'ADMIN', 0, '1985-01-01'],
        ['emp1', hash, '김민준', 'EMP-2026-001', 'EMPLOYEE', 0, '1992-05-12'],
        ['emp2', hash, '이서연', 'EMP-2026-002', 'EMPLOYEE', 0, '1995-08-23'],
        ['retired_user', hash, '박퇴사', 'EMP-2026-003', 'EMPLOYEE', 1, '1990-11-30']
      ];

      seedUsers.forEach((user) => {
        db.run(
          `INSERT OR IGNORE INTO users (username, password, name, employeeId, role, is_retired, birthDate) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          user
        );
      });
      console.log('[DB] Seed data initialized successfully.');
    });
  } catch (e) {
    console.error('[DB Error] Failed to initialize database from YAML:', e);
  }
}

initDatabase();
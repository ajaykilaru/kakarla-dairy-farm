require("dotenv").config();
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

async function main() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error("Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in your environment before running npm run create-admin.");
  }
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "smart_dairy",
    ssl: process.env.DB_SSL === "true" ? { ca: process.env.DB_SSL_CA ? process.env.DB_SSL_CA.replace(/\\n/g, "\n") : undefined, rejectUnauthorized: true } : undefined
  });
  try {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await db.execute(
      `INSERT INTO users (name,email,password_hash,role,active)
       VALUES (?,?,?,'super_admin',TRUE)
       ON DUPLICATE KEY UPDATE name=VALUES(name), password_hash=VALUES(password_hash), role='super_admin', active=TRUE`,
      [ADMIN_NAME, ADMIN_EMAIL.toLowerCase(), hash]
    );
    console.log(`Super Admin account is ready for ${ADMIN_EMAIL.toLowerCase()}.`);
  } finally { await db.end(); }
}
main().catch(err => { console.error(err.message); process.exit(1); });

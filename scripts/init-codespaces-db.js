require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "db",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    ssl: process.env.DB_SSL === "true"
      ? {
          ca: process.env.DB_SSL_CA ? process.env.DB_SSL_CA.replace(/\\n/g, "\n") : undefined,
          rejectUnauthorized: true
        }
      : undefined,
    multipleStatements: true
  });

  try {
    const databaseName = process.env.DB_NAME || "smart_dairy";
    const [schemas] = await connection.query(
      "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?",
      [databaseName]
    );
    if (schemas.length) {
      const [tables] = await connection.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customers'",
        [databaseName]
      );
      if (tables.length) return;
      throw new Error(`Database ${databaseName} already exists but its schema is incomplete; refusing to modify it automatically.`);
    }

    const schema = fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8");
    await connection.query(schema);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Codespaces database initialization failed:", error.message);
  process.exitCode = 1;
});

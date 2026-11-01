const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const QRCode = require("qrcode");
const { randomUUID, randomInt } = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
const frontendDist = path.resolve(__dirname, "../frontend/dist");
app.use(express.static(frontendDist));

const dbConfigHint = "Copy .env.example to .env and set valid DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME values before starting the app.";
const dbErrorMessage = (err) => {
  if (!err) return dbConfigHint;
  const code = err.code || "";
  if (code === "ER_ACCESS_DENIED_ERROR") return `MySQL authentication failed. Check DB_USER and DB_PASSWORD in .env. ${dbConfigHint}`;
  if (code === "ECONNREFUSED") return `MySQL server is not reachable at the configured host/port. ${dbConfigHint}`;
  if (code === "ER_BAD_DB_ERROR") return `The configured MySQL database does not exist. ${dbConfigHint}`;
  if (code === "ER_DUP_ENTRY") return "That phone number or email address is already registered. Use different contact details or update the existing account.";
  if (code === "ER_BAD_FIELD_ERROR" || code === "ER_NO_SUCH_TABLE") return "The database schema is out of date. Run the pending SQL migrations in database/migrations and restart the app.";
  return "The database request failed. Check the backend log for details.";
};

if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
  console.warn("Warning: MySQL credentials are not configured. The backend will still start, but requests will fail until .env is populated.");
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "smart_dairy",
  // Managed MySQL providers commonly require TLS. Keep certificate validation enabled.
  ssl: process.env.DB_SSL === "true"
    ? {
        ca: process.env.DB_SSL_CA ? process.env.DB_SSL_CA.replace(/\\n/g, "\n") : undefined,
        rejectUnauthorized: true
      }
    : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
async function ensureUserContactAvailable(phone, email = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const [users] = await pool.execute(
    `SELECT CASE WHEN phone=? THEN 'phone number' ELSE 'email address' END AS contact
     FROM users
     WHERE phone=? OR (? IS NOT NULL AND LOWER(email)=?)
     LIMIT 1`,
    [phone, phone, normalizedEmail || null, normalizedEmail || null]
  );
  if (users.length) {
    throw Object.assign(
      new Error(`This ${users[0].contact} is already linked to an account. Use a different one or update the existing account.`),
      { status: 409 }
    );
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (process.env.NODE_ENV === "production" && (!JWT_SECRET || JWT_SECRET.length < 32)) {
  throw new Error("Set JWT_SECRET to a random value of at least 32 characters in production.");
}
async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sign in required." });
  let verified;
  try {
    verified = jwt.verify(token, JWT_SECRET || "development-only-change-this-secret");
  } catch (_) { return res.status(401).json({ error: "Session expired or invalid. Please sign in again." }); }
  try {
    const [users] = await pool.execute(
      `SELECT u.id,u.name,u.email,u.role,u.customer_id
       FROM users u
       LEFT JOIN customers c ON c.id=u.customer_id
       WHERE u.id=? AND u.active=TRUE
         AND (u.role<>'customer' OR c.active=TRUE)
       LIMIT 1`,
      [verified.id]
    );
    if (!users.length || users[0].role !== verified.role) {
      return res.status(401).json({ error: "This account is inactive or no longer available. Please sign in again." });
    }
    req.user = { ...verified, id: users[0].id, name: users[0].name, email: users[0].email, role: users[0].role, customer_id: users[0].customer_id || null };
    next();
  } catch (err) {
    next(err);
  }
}
function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next() : res.status(403).json({ error: "You do not have permission to perform this action." });
}


async function getRate(connection, milkType, date = new Date()) {
  const dateString = new Date(date).toISOString().slice(0, 10);
  const [rows] = await connection.execute(
    `SELECT rate_per_litre FROM milk_rates
     WHERE milk_type = ? AND effective_from <= ?
     ORDER BY effective_from DESC LIMIT 1`, [milkType, dateString]
  );
  if (!rows.length) throw Object.assign(new Error(`No rate configured for ${milkType} milk`), { status: 400 });
  return Number(rows[0].rate_per_litre);
}

async function addDeliveryBillNotification(connection, delivery, customer) {
  const [[totals]] = await connection.execute(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM deliveries WHERE customer_id=? AND delivered_at >= DATE_FORMAT(CURRENT_DATE,'%Y-%m-01') AND delivered_at < DATE_ADD(DATE_FORMAT(CURRENT_DATE,'%Y-%m-01'), INTERVAL 1 MONTH)),0) AS month_billed,
       COALESCE((SELECT SUM(amount) FROM deliveries WHERE customer_id=?),0) -
       COALESCE((SELECT SUM(amount) FROM payments WHERE customer_id=?),0) AS outstanding,
       DATE_FORMAT(?, '%d-%m-%Y %h:%i %p') AS delivered_at_label`,
    [customer.id, customer.id, customer.id, delivery.delivered_at]
  );
  const expectedQuantity = Number(customer.quantity_litres || 0);
  const shortQuantity = Math.max(0, expectedQuantity - delivery.quantity);
  const message = [
    "Delivery bill",
    `Date and time: ${totals.delivered_at_label}`,
    `Schedule: ${delivery.routine}`,
    `Milk: ${delivery.milk_type}`,
    `Scheduled quantity: ${expectedQuantity.toFixed(2)} L`,
    `Delivered quantity: ${delivery.quantity.toFixed(2)} L`,
    ...(shortQuantity > 0 ? [`Short delivery: ${shortQuantity.toFixed(2)} L`] : []),
    `Price: ₹${delivery.rate.toFixed(2)} per litre`,
    `Today's delivery charge: ₹${delivery.amount.toFixed(2)}`,
    `Month-to-date bill: ₹${Number(totals.month_billed).toFixed(2)}`,
    `Outstanding balance: ₹${Number(totals.outstanding).toFixed(2)}`
  ].join("\n");
  await connection.execute(
    "INSERT INTO notification_logs (customer_id,delivery_id,channel,direction,status,message) VALUES (?,?, 'in_app','outbound','sent',?)",
    [customer.id, delivery.id, message]
  );
}

async function getDueMonthCounts() {
  const [rows] = await pool.query(`
    SELECT monthly_bills.customer_id, monthly_bills.billing_month,
           monthly_bills.billed, COALESCE(monthly_payments.paid,0) AS paid
    FROM (
      SELECT customer_id, DATE_FORMAT(delivered_at,'%Y-%m') AS billing_month, SUM(amount) AS billed
      FROM deliveries
      WHERE delivered_at < DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')
      GROUP BY customer_id, DATE_FORMAT(delivered_at,'%Y-%m')
    ) monthly_bills
    LEFT JOIN (
      SELECT customer_id, SUM(amount) AS paid
      FROM payments
      WHERE paid_at <= CURRENT_TIMESTAMP
      GROUP BY customer_id
    ) monthly_payments
      ON monthly_payments.customer_id=monthly_bills.customer_id
    ORDER BY monthly_bills.customer_id, monthly_bills.billing_month
  `);
  const remainingByCustomer = new Map();
  const dueCounts = new Map();
  for (const row of rows) {
    const customerId = Number(row.customer_id);
    const remainingPayment = remainingByCustomer.has(customerId)
      ? remainingByCustomer.get(customerId)
      : Number(row.paid);
    const billed = Number(row.billed);
    if (remainingPayment >= billed) {
      remainingByCustomer.set(customerId, remainingPayment - billed);
    } else {
      remainingByCustomer.set(customerId, 0);
      dueCounts.set(customerId, (dueCounts.get(customerId) || 0) + 1);
    }
  }
  return dueCounts;
}

async function sendTelegram(chatId, message) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) {
    return { status: "skipped", error: !chatId ? "Customer has no Telegram chat ID" : "Telegram bot is not configured" };
  }
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || "Telegram request failed");
  return { status: "sent" };
}

async function sendSms(phone, message) {
  const gatewayUrl = process.env.SMS_GATEWAY_URL;
  if (!gatewayUrl) throw Object.assign(new Error("Password reset SMS is not configured. Contact your dairy administrator."), { status: 503 });
  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SMS_GATEWAY_API_KEY ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_API_KEY}` } : {})
    },
    body: JSON.stringify({ to: phone, message })
  });
  if (!response.ok) throw Object.assign(new Error("The SMS gateway could not send your message. Try again later."), { status: 502 });
}

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const identifier = String(req.body.phone || req.body.email || "").trim();
  const phone = identifier.replace(/\D/g, "");
  const email = identifier.toLowerCase();
  const password = String(req.body.password || "");
  if (!identifier || !password) return res.status(400).json({ error: "Phone number and password are required." });
  const [rows] = await pool.execute(
    `SELECT u.id,u.name,u.email,u.password_hash,u.role,u.active,u.customer_id
     FROM users u
     LEFT JOIN customers c ON c.id=u.customer_id
     WHERE LOWER(u.email)=? OR u.phone=? OR
       (c.phone=? AND u.role='customer')
     LIMIT 1`, [email, phone, phone]
  );
  const user = rows[0];
  if (!user || !user.active || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role, customer_id: user.customer_id || null },
    JWT_SECRET || "development-only-change-this-secret", { expiresIn: "8h", issuer: "smart-dairy" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, customer_id: user.customer_id || null } });
}));

app.post("/api/auth/password-reset/request", asyncRoute(async (req, res) => {
  const phone = String(req.body.phone || "").replace(/\D/g, "");
  if (phone.length < 7 || phone.length > 15) return res.status(400).json({ error: "Enter a valid phone number." });
  const [users] = await pool.execute(
    `SELECT u.id,c.phone FROM users u
     JOIN customers c ON c.id=u.customer_id
     WHERE u.active=TRUE AND c.phone=? LIMIT 1`, [phone]
  );
  if (!users.length) return res.json({ ok: true, message: "If an active account matches that phone number, a reset code will be sent." });
  const [recent] = await pool.execute(
    "SELECT id FROM password_reset_tokens WHERE user_id=? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND) LIMIT 1",
    [users[0].id]
  );
  if (recent.length) return res.status(429).json({ error: "Please wait before requesting another reset code." });
  const otp = String(randomInt(100000, 1000000));
  const otpHash = await bcrypt.hash(otp, 12);
  await pool.execute("DELETE FROM password_reset_tokens WHERE user_id=?", [users[0].id]);
  await pool.execute(
    "INSERT INTO password_reset_tokens (user_id,otp_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
    [users[0].id, otpHash]
  );
  await sendSms(users[0].phone, `Your Kakarla Dairy Farm password reset code is ${otp}. It expires in 10 minutes.`);
  res.json({ ok: true, message: "If an active account matches that phone number, a reset code will be sent." });
}));

app.post("/api/auth/password-reset/confirm", asyncRoute(async (req, res) => {
  const phone = String(req.body.phone || "").replace(/\D/g, "");
  const otp = String(req.body.otp || "").trim();
  const password = String(req.body.password || "");
  if (phone.length < 7 || !/^\d{6}$/.test(otp) || password.length < 8) {
    return res.status(400).json({ error: "Enter the phone number, six-digit code and a password of at least 8 characters." });
  }
  const [users] = await pool.execute(
    `SELECT u.id FROM users u JOIN customers c ON c.id=u.customer_id
     WHERE u.active=TRUE AND c.phone=? LIMIT 1`, [phone]
  );
  if (!users.length) return res.status(400).json({ error: "The reset code is invalid or expired." });
  const [tokens] = await pool.execute(
    "SELECT id,otp_hash FROM password_reset_tokens WHERE user_id=? AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1",
    [users[0].id]
  );
  if (!tokens.length || !(await bcrypt.compare(otp, tokens[0].otp_hash))) {
    return res.status(400).json({ error: "The reset code is invalid or expired." });
  }
  const hash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE users SET password_hash=? WHERE id=?", [hash, users[0].id]);
    await connection.execute("DELETE FROM password_reset_tokens WHERE user_id=?", [users[0].id]);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  res.json({ ok: true, message: "Password updated. Sign in with your new password." });
}));

app.get("/api/auth/me", authenticate, (req, res) => res.json({ user: req.user }));

app.get("/api/health", asyncRoute(async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (err) {
    console.error("Database health check failed:", err.message);
    res.status(503).json({ ok: false, database: "disconnected", error: dbErrorMessage(err) });
  }
}));

// Every API route below this point requires a valid signed-in session.
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path === "/auth/login" || req.path === "/auth/me" || req.path === "/auth/password-reset/request" || req.path === "/auth/password-reset/confirm") return next();
  return authenticate(req, res, next);
});

// Role boundaries: only the Super Admin can use the legacy global-management/reporting APIs.
// Delivery Boy and Customer accounts receive access only through explicitly scoped endpoints.
app.use("/api/dashboard", requireRoles("super_admin"));
app.use("/api/customers", requireRoles("super_admin"));
app.use("/api/reports", requireRoles("super_admin"));
app.use("/api/deliveries", requireRoles("super_admin"));
app.use("/api/billing", requireRoles("super_admin"));

app.get("/api/dashboard", asyncRoute(async (req, res) => {
  const [[customers]] = await pool.query("SELECT COUNT(*) AS total, COALESCE(SUM(morning_enabled + evening_enabled),0) AS scheduled_routines FROM customers WHERE active = TRUE");
  const [[completed]] = await pool.query("SELECT COUNT(DISTINCT customer_id) AS total FROM deliveries WHERE DATE(delivered_at)=CURRENT_DATE");
  const [[today]] = await pool.query(
    "SELECT COUNT(*) AS deliveries, COALESCE(SUM(amount),0) AS sales, COALESCE(SUM(quantity_litres),0) AS litres FROM deliveries WHERE DATE(delivered_at)=CURRENT_DATE"
  );
  const [[earnings]] = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE DATE(paid_at)=CURRENT_DATE");
  const [[balance]] = await pool.query(`
    SELECT COALESCE((SELECT SUM(amount) FROM deliveries),0) -
           COALESCE((SELECT SUM(amount) FROM payments),0) AS outstanding
  `);
  const [recent] = await pool.query(`
    SELECT d.id, c.name AS customer_name, d.milk_type, d.quantity_litres,
           d.amount, d.delivered_at
    FROM deliveries d JOIN customers c ON c.id=d.customer_id
    ORDER BY d.delivered_at DESC LIMIT 8
  `);
  res.json({ customers: customers.total, scheduled_routines: Number(customers.scheduled_routines), completed_houses: Number(completed.total), today, earnings: Number(earnings.total), outstanding: balance.outstanding, recent });
}));

app.get("/api/customers", asyncRoute(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const [rows] = await pool.execute(
    `SELECT c.id, c.customer_code, c.name, c.phone, c.address, c.telegram_chat_id, c.assigned_to, c.active, c.created_at,
            c.milk_type, c.quantity_litres, c.morning_enabled, c.evening_enabled,
            EXISTS(SELECT 1 FROM users u WHERE u.customer_id=c.id AND u.role='customer' AND u.active=TRUE AND u.password_hash IS NOT NULL) AS login_enabled
     FROM customers c WHERE c.active=TRUE AND (c.name LIKE ? OR c.phone LIKE ?)
     ORDER BY name LIMIT 250`, [`%${q}%`, `%${q}%`]
  );
  const dueCounts = await getDueMonthCounts();
  res.json(rows.map(row => ({ ...row, due_count: dueCounts.get(Number(row.id)) || 0 })));
}));

app.put("/api/customers/:id/login", asyncRoute(async (req, res) => {
  const customerId = Number(req.params.id);
  const password = String(req.body.password || "");
  if (!Number.isSafeInteger(customerId) || customerId < 1) return res.status(400).json({ error: "Invalid customer ID." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Set a customer password between 8 and 128 characters." });
  const [[customer]] = await pool.execute("SELECT id,name,phone FROM customers WHERE id=? AND active=TRUE", [customerId]);
  if (!customer) return res.status(404).json({ error: "Active customer not found." });
  const phone = String(customer.phone || "").replace(/\D/g, "");
  if (phone.length < 7) return res.status(400).json({ error: "Add a valid phone number to this customer before setting up sign-in." });
  const [conflicts] = await pool.execute(
    "SELECT id,customer_id FROM users WHERE phone=? AND (customer_id IS NULL OR customer_id<>?) LIMIT 1",
    [phone, customerId]
  );
  if (conflicts.length) return res.status(409).json({ error: "This phone number belongs to another account. Update the contact number before setting up customer sign-in." });
  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [accounts] = await connection.execute(
      "SELECT id FROM users WHERE customer_id=? AND role='customer' LIMIT 1 FOR UPDATE",
      [customerId]
    );
    if (accounts.length) {
      await connection.execute(
        "UPDATE users SET name=?,phone=?,password_hash=?,active=TRUE WHERE id=?",
        [customer.name, phone, passwordHash, accounts[0].id]
      );
    } else {
      await connection.execute(
        "INSERT INTO users (name,phone,password_hash,role,customer_id,active) VALUES (?,?,?,'customer',?,TRUE)",
        [customer.name, phone, passwordHash, customerId]
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  res.json({ ok: true, login_enabled: true, username: phone });
}));

app.post("/api/customers", asyncRoute(async (req, res) => {
  const { name, phone = "", address = "", telegram_chat_id = "", assigned_to = null, email = "", password = "", milk_type = "cow", quantity_litres = 1, morning_enabled = true, evening_enabled = false } = req.body;
  const cleanPhone = String(phone).replace(/\D/g, "");
  const quantity = Number(quantity_litres);
  if (!String(name || "").trim() || cleanPhone.length < 7) return res.status(400).json({ error: "Customer name and a valid phone number are required." });
  if (String(password).length < 8) return res.status(400).json({ error: "Customer password must be at least 8 characters." });
  if (!["cow", "buffalo"].includes(milk_type) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100) return res.status(400).json({ error: "Choose a valid milk type and a quantity from 0.1 to 100 litres." });
  if (!morning_enabled && !evening_enabled) return res.status(400).json({ error: "Select at least one delivery routine." });
  await ensureUserContactAvailable(cleanPhone, email);
  if (assigned_to) {
    const [assignees] = await pool.execute("SELECT id FROM users WHERE id=? AND role='delivery_boy' AND active=TRUE", [assigned_to]);
    if (!assignees.length) return res.status(400).json({ error: "Selected delivery boy is not active." });
  }
  const code = randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO customers
       (customer_code,name,phone,address,telegram_chat_id,assigned_to,milk_type,quantity_litres,morning_enabled,evening_enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [code, String(name).trim(), cleanPhone, address, telegram_chat_id || null, assigned_to || null, milk_type, quantity, Boolean(morning_enabled), Boolean(evening_enabled)]
    );
    const hash = await bcrypt.hash(String(password), 12);
    await connection.execute(
      "INSERT INTO users (name,email,phone,password_hash,role,customer_id) VALUES (?,?,?,?,'customer',?)",
      [String(name).trim(), email ? String(email).trim().toLowerCase() : null, cleanPhone, hash, result.insertId]
    );
    await connection.commit();
    res.status(201).json({ id: result.insertId, customer_code: code, name: String(name).trim() });
  } catch (err) { await connection.rollback(); throw err; } finally { connection.release(); }
}));

app.get("/api/customers/:id", asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id,customer_code,name,phone,address,telegram_chat_id,active FROM customers WHERE id=? AND active=TRUE",
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Customer not found" });
  res.json(rows[0]);
}));

app.get("/api/customers/:id/qr", asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id,customer_code,name FROM customers WHERE id=? AND active=TRUE", [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Customer not found" });
  const payload = JSON.stringify({ customerCode: rows[0].customer_code });
  const dataUrl = await QRCode.toDataURL(payload, { width: 320, margin: 2 });
  res.json({ dataUrl, customer: rows[0] });
}));

app.get("/api/qr/:code", asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id,customer_code,name,phone,address,assigned_to,milk_type,quantity_litres,morning_enabled,evening_enabled FROM customers WHERE customer_code=? AND active=TRUE",
    [req.params.code]
  );
  if (!rows.length) return res.status(404).json({ error: "QR code does not match an active customer" });
  const customer = rows[0];
  if (req.user.role === "delivery_boy" && Number(customer.assigned_to) !== Number(req.user.id)) return res.status(403).json({ error: "This customer is not assigned to your account." });
  if (req.user.role === "customer" && Number(req.user.customer_id) !== Number(customer.id)) return res.status(403).json({ error: "You can only access your own customer QR." });
  if (req.user.role === "customer") delete customer.assigned_to;
  res.json(customer);
}));

app.put("/api/customers/:id", asyncRoute(async (req, res) => {
  const { name, phone = "", address = "", telegram_chat_id = "" } = req.body;
  if (!String(name || "").trim()) return res.status(400).json({ error: "Customer name is required" });
  const [result] = await pool.execute(
    "UPDATE customers SET name=?,phone=?,address=?,telegram_chat_id=? WHERE id=? AND active=TRUE",
    [String(name).trim(), phone, address, telegram_chat_id || null, req.params.id]
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Customer not found" });
  res.json({ ok: true });
}));

app.delete("/api/customers/:id", asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid customer ID." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute("SELECT id FROM customers WHERE id=? AND active=TRUE FOR UPDATE", [id]);
    if (!customers.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Active customer not found." });
    }
    await connection.execute("UPDATE customers SET active=FALSE,assigned_to=NULL WHERE id=?", [id]);
    await connection.execute("UPDATE users SET active=FALSE WHERE customer_id=? AND role='customer'", [id]);
    await connection.commit();
    res.json({ ok: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}));

app.get("/api/rates", asyncRoute(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT r.milk_type, r.rate_per_litre, r.effective_from
    FROM milk_rates r
    JOIN (SELECT milk_type, MAX(effective_from) AS latest FROM milk_rates
          WHERE effective_from <= CURRENT_DATE GROUP BY milk_type) x
      ON x.milk_type=r.milk_type AND x.latest=r.effective_from
    ORDER BY r.milk_type
  `);
  res.json(rows);
}));

app.put("/api/rates", authenticate, requireRoles("super_admin"), asyncRoute(async (req, res) => {
  const { milk_type, rate_per_litre, effective_from } = req.body;
  const rate = Number(rate_per_litre);
  if (!["cow", "buffalo"].includes(milk_type) || !Number.isFinite(rate) || rate <= 0 || !effective_from) {
    return res.status(400).json({ error: "Valid milk type, positive rate, and effective date are required" });
  }
  await pool.execute(
    "INSERT INTO milk_rates (milk_type,rate_per_litre,effective_from) VALUES (?,?,?) ON DUPLICATE KEY UPDATE rate_per_litre=VALUES(rate_per_litre)",
    [milk_type, rate, effective_from]
  );
  res.json({ ok: true });
}));

app.post("/api/deliveries", asyncRoute(async (req, res) => {
  const { customer_id, milk_type, quantity_litres, delivered_at, routine = "other", notes = "" } = req.body;
  const quantity = Number(quantity_litres);
  if (!customer_id || !["cow", "buffalo"].includes(milk_type) || !["morning", "evening", "other"].includes(routine) || !Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Customer, milk type, routine, and positive quantity are required" });
  }

  const connection = await pool.getConnection();
  let delivery;
  let customer;
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute(
      "SELECT id,name,telegram_chat_id,quantity_litres FROM customers WHERE id=? AND active=TRUE FOR UPDATE", [customer_id]
    );
    if (!customers.length) throw Object.assign(new Error("Customer not found"), { status: 404 });
    customer = customers[0];
    const date = delivered_at ? new Date(delivered_at) : new Date();
    if (Number.isNaN(date.getTime())) throw Object.assign(new Error("Invalid delivery date"), { status: 400 });
    const rate = await getRate(connection, milk_type, date);
    const amount = Number((quantity * rate).toFixed(2));
    const [result] = await connection.execute(
      "INSERT INTO deliveries (customer_id,milk_type,quantity_litres,rate_per_litre,amount,delivered_at,routine,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?,?)",
      [customer_id, milk_type, quantity, rate, amount, date, routine, notes, req.user.id]
    );
    delivery = { id: result.insertId, quantity, milk_type, routine, rate, amount, delivered_at: date };
    await addDeliveryBillNotification(connection, delivery, customer);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  let notice = { status: "skipped", error: "Not attempted" };
  try {
    const [[total]] = await pool.execute(
      "SELECT COALESCE(SUM(amount),0) AS total FROM deliveries WHERE customer_id=?", [customer_id]
    );
    const [[paid]] = await pool.execute(
      "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE customer_id=?", [customer_id]
    );
    const balance = Number((Number(total.total) - Number(paid.total)).toFixed(2));
    const message = `Milk delivery recorded\nCustomer: ${customer.name}\nMilk: ${milk_type}\nQuantity: ${quantity} L\nRate: ₹${delivery.rate.toFixed(2)}/L\nAmount: ₹${delivery.amount.toFixed(2)}\nOutstanding balance: ₹${balance.toFixed(2)}`;
    notice = await sendTelegram(customer.telegram_chat_id, message);
    await pool.execute(
      "INSERT INTO notification_logs (customer_id,delivery_id,status,message,error_text) VALUES (?,?,?,?,?)",
      [customer_id, delivery.id, notice.status, message, notice.error || null]
    );
  } catch (err) {
    notice = { status: "failed", error: err.message };
    await pool.execute(
      "INSERT INTO notification_logs (customer_id,delivery_id,status,error_text) VALUES (?,?,?,?)",
      [customer_id, delivery.id, "failed", err.message]
    ).catch(() => {});
  }
  res.status(201).json({ ...delivery, notification: notice });
}));

app.get("/api/deliveries", asyncRoute(async (req, res) => {
  const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
  const to = req.query.to || new Date().toISOString().slice(0,10);
  const [rows] = await pool.execute(`
    SELECT d.id,c.name AS customer_name,c.id AS customer_id,d.milk_type,d.routine,
           d.quantity_litres,d.rate_per_litre,d.amount,d.delivered_at,d.notes
    FROM deliveries d JOIN customers c ON c.id=d.customer_id
    WHERE d.delivered_at >= ? AND d.delivered_at < DATE_ADD(?, INTERVAL 1 DAY)
    ORDER BY d.delivered_at DESC LIMIT 1000
  `, [from, to]);
  res.json(rows);
}));

app.get("/api/billing/:customerId", asyncRoute(async (req, res) => {
  const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
  const to = req.query.to || new Date().toISOString().slice(0,10);
  const [[customer]] = await pool.execute(
    "SELECT id,name,phone,address FROM customers WHERE id=? AND active=TRUE", [req.params.customerId]
  );
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  const [[delivered]] = await pool.execute(`
    SELECT COUNT(*) AS delivery_count, COALESCE(SUM(quantity_litres),0) AS litres,
           COALESCE(SUM(amount),0) AS total
    FROM deliveries WHERE customer_id=? AND delivered_at >= ? AND delivered_at < DATE_ADD(?, INTERVAL 1 DAY)
  `, [req.params.customerId, from, to]);
  const [[paid]] = await pool.execute(
    "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE customer_id=? AND paid_at >= ? AND paid_at < DATE_ADD(?, INTERVAL 1 DAY)",
    [req.params.customerId, from, to]
  );
  const [items] = await pool.execute(
    "SELECT milk_type,quantity_litres,rate_per_litre,amount,delivered_at FROM deliveries WHERE customer_id=? AND delivered_at >= ? AND delivered_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY delivered_at DESC",
    [req.params.customerId, from, to]
  );
  res.json({ customer, from, to, summary: { ...delivered, paid: paid.total, balance: Number((delivered.total - paid.total).toFixed(2)) }, items });
}));

app.post("/api/payments", asyncRoute(async (req, res) => {
  const { customer_id, amount, payment_method = "cash", reference_note = "" } = req.body;
  if (!(["super_admin", "delivery_boy"].includes(req.user.role))) return res.status(403).json({ error: "Only authorized staff can record payments." });
  if (req.user.role === "delivery_boy") {
    const [assigned] = await pool.execute("SELECT id FROM customers WHERE id=? AND assigned_to=? AND active=TRUE", [customer_id, req.user.id]);
    if (!assigned.length) return res.status(403).json({ error: "You can collect payment only from your assigned customers." });
  }
  const value = Number(amount);
  if (!customer_id || !Number.isFinite(value) || value <= 0 ||
      !["cash", "upi", "bank_transfer", "other"].includes(payment_method)) {
    return res.status(400).json({ error: "Valid customer, positive amount, and payment method are required" });
  }
  const [result] = await pool.execute(
    "INSERT INTO payments (customer_id,amount,payment_method,reference_note,recorded_by) VALUES (?,?,?,?,?)",
    [customer_id, value, payment_method, reference_note, req.user.id]
  );
  res.status(201).json({ id: result.insertId, ok: true });
}));

app.get("/api/reports/monthly", asyncRoute(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : new Date().toISOString().slice(0,7);
  const [rows] = await pool.execute(`
    SELECT c.id AS customer_id,c.name,c.phone,
      COALESCE(d.total,0) AS billed, COALESCE(p.total,0) AS paid,
      COALESCE(d.total,0)-COALESCE(p.total,0) AS balance
    FROM customers c
    LEFT JOIN (
      SELECT customer_id,SUM(amount) AS total FROM deliveries
      WHERE DATE_FORMAT(delivered_at,'%Y-%m')=? GROUP BY customer_id
    ) d ON d.customer_id=c.id
    LEFT JOIN (
      SELECT customer_id,SUM(amount) AS total FROM payments
      WHERE DATE_FORMAT(paid_at,'%Y-%m')=? GROUP BY customer_id
    ) p ON p.customer_id=c.id
    WHERE c.active=TRUE ORDER BY c.name
  `, [month, month]);
  const [[summary]] = await pool.execute(
    `SELECT COALESCE(SUM(d.quantity_litres),0) AS milk_litres,
            COALESCE(SUM(d.amount),0) AS billed,
            COALESCE((SELECT SUM(amount) FROM payments WHERE DATE_FORMAT(paid_at,'%Y-%m')=?),0) AS received
     FROM deliveries d WHERE DATE_FORMAT(d.delivered_at,'%Y-%m')=?`,
    [month, month]
  );
  const dueCounts = await getDueMonthCounts();
  const dueCustomers = [...dueCounts.values()].filter(count => count > 0).length;
  res.json({
    month,
    rows,
    summary: {
      milk_litres: Number(summary.milk_litres),
      billed: Number(summary.billed),
      received: Number(summary.received),
      paid_customers: rows.filter(row => Number(row.billed) > 0 && Number(row.balance) <= 0).length,
      unpaid_customers: rows.filter(row => Number(row.balance) > 0).length,
      due_customers: dueCustomers
    }
  });
}));


// Delivery Boy endpoints: every query is scoped to the signed-in delivery partner.
app.get("/api/delivery/overview", requireRoles("delivery_boy"), asyncRoute(async (req, res) => {
  const [[assigned]] = await pool.execute("SELECT COUNT(*) AS total, COALESCE(SUM(morning_enabled + evening_enabled),0) AS scheduled_routines FROM customers WHERE active=TRUE AND assigned_to=?", [req.user.id]);
  const [[today]] = await pool.execute("SELECT COUNT(DISTINCT d.customer_id) AS completed_today, COALESCE(SUM(d.quantity_litres),0) AS litres_today FROM deliveries d JOIN customers c ON c.id=d.customer_id WHERE c.assigned_to=? AND DATE(d.delivered_at)=CURRENT_DATE", [req.user.id]);
  res.json({ assigned_customers: Number(assigned.total), completed_today: Number(today.completed_today), pending_today: Math.max(0, Number(assigned.total)-Number(today.completed_today)), scheduled_routines: Number(assigned.scheduled_routines), litres_today: Number(today.litres_today) });
}));
app.get("/api/delivery/customers", requireRoles("delivery_boy"), asyncRoute(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const [rows] = await pool.execute("SELECT id,customer_code,name,phone,address,assigned_to,active,created_at,milk_type,quantity_litres,morning_enabled,evening_enabled FROM customers WHERE active=TRUE AND assigned_to=? AND (name LIKE ? OR phone LIKE ? OR customer_code LIKE ?) ORDER BY name LIMIT 500", [req.user.id, `%${q}%`, `%${q}%`, `%${q}%`]);
  const dueCounts = await getDueMonthCounts();
  res.json(rows.map(row => ({ ...row, due_count: dueCounts.get(Number(row.id)) || 0 })));
}));
app.get("/api/delivery/customers/:id/qr", requireRoles("delivery_boy"), asyncRoute(async(req,res)=>{
  const [rows]=await pool.execute("SELECT id,customer_code,name FROM customers WHERE id=? AND assigned_to=? AND active=TRUE",[req.params.id,req.user.id]);
  if(!rows.length)return res.status(404).json({error:"Assigned customer not found."});
  const dataUrl=await QRCode.toDataURL(JSON.stringify({customerCode:rows[0].customer_code}),{width:320,margin:2});res.json({dataUrl,customer:rows[0]});
}));
app.post("/api/delivery/customers", requireRoles("delivery_boy"), asyncRoute(async (req, res) => {
  const { name, phone = "", address = "", email = "", password = "", milk_type = "cow", quantity_litres = 1, morning_enabled = true, evening_enabled = false } = req.body;
  const cleanPhone = String(phone).replace(/\D/g, "");
  const quantity = Number(quantity_litres);
  if (!String(name || "").trim() || !String(address || "").trim() || cleanPhone.length < 7) return res.status(400).json({ error: "Customer name, valid phone number and full address are required." });
  if (String(password).length < 8) return res.status(400).json({ error: "Customer password must be at least 8 characters." });
  if (!["cow", "buffalo"].includes(milk_type) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100) return res.status(400).json({ error: "Choose a valid milk type and a quantity from 0.1 to 100 litres." });
  if (!morning_enabled && !evening_enabled) return res.status(400).json({ error: "Select at least one delivery routine." });
  await ensureUserContactAvailable(cleanPhone, email);
  const connection = await pool.getConnection(); const code = randomUUID();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      "INSERT INTO customers (customer_code,name,phone,address,assigned_to,milk_type,quantity_litres,morning_enabled,evening_enabled) VALUES (?,?,?,?,?,?,?,?,?)",
      [code, String(name).trim(), cleanPhone, address, req.user.id, milk_type, quantity, Boolean(morning_enabled), Boolean(evening_enabled)]
    );
    const hash = await bcrypt.hash(String(password), 12);
    await connection.execute("INSERT INTO users (name,email,phone,password_hash,role,customer_id) VALUES (?,?,?,?,'customer',?)", [String(name).trim(), email ? String(email).trim().toLowerCase() : null, cleanPhone, hash, result.insertId]);
    await connection.commit(); res.status(201).json({ id: result.insertId, customer_code: code, name: String(name).trim(), assigned_to: req.user.id });
  } catch(err) { await connection.rollback(); throw err; } finally { connection.release(); }
}));
app.get("/api/delivery/deliveries", requireRoles("delivery_boy"), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute("SELECT d.id,d.customer_id,c.name AS customer_name,d.milk_type,d.routine,d.quantity_litres,d.rate_per_litre,d.amount,d.delivered_at,d.notes FROM deliveries d JOIN customers c ON c.id=d.customer_id WHERE c.assigned_to=? ORDER BY d.delivered_at DESC LIMIT 1000", [req.user.id]); res.json(rows);
}));
app.post("/api/delivery/complete", requireRoles("delivery_boy"), asyncRoute(async (req, res) => {
  const { customer_id, milk_type, quantity_litres, routine = "other", notes = "" } = req.body; const qty = Number(quantity_litres);
  if (!customer_id || !["cow","buffalo"].includes(milk_type) || !["morning","evening","other"].includes(routine) || !Number.isFinite(qty) || qty <= 0 || qty > 100) return res.status(400).json({ error: "Choose an assigned customer, valid milk type, routine and quantity (up to 100 L)." });
  const conn = await pool.getConnection(); let resultData; let deliveryCustomer;
  try { await conn.beginTransaction();
    const [cs] = await conn.execute("SELECT id,name,telegram_chat_id,quantity_litres FROM customers WHERE id=? AND assigned_to=? AND active=TRUE FOR UPDATE", [customer_id, req.user.id]);
    if (!cs.length) throw Object.assign(new Error("This customer is not assigned to you."), {status:403});
    deliveryCustomer = cs[0];
    const rate = await getRate(conn, milk_type, new Date()); const amount = Number((qty*rate).toFixed(2));
    const [result] = await conn.execute("INSERT INTO deliveries (customer_id,milk_type,quantity_litres,rate_per_litre,amount,delivered_at,routine,notes,recorded_by) VALUES (?,?,?,?,?,NOW(),?,?,?)", [customer_id,milk_type,qty,rate,amount,routine,notes,req.user.id]);
    resultData = { id:result.insertId, customer_id:Number(customer_id), customer_name:cs[0].name, milk_type, routine, quantity_litres:qty, rate_per_litre:rate, amount, delivered_at:new Date() };
    await addDeliveryBillNotification(conn, { id: result.insertId, quantity: qty, milk_type, routine, rate, amount, delivered_at: resultData.delivered_at }, deliveryCustomer);
    await conn.commit();
  } catch(err) { await conn.rollback(); throw err; } finally { conn.release(); }
  // Notification failures must never roll back a committed delivery.
  let notification = { status: "skipped", error: "Notification not attempted" };
  try {
    const [[total]] = await pool.execute("SELECT COALESCE(SUM(amount),0) AS total FROM deliveries WHERE customer_id=?", [customer_id]);
    const [[paid]] = await pool.execute("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE customer_id=?", [customer_id]);
    const message = `Milk delivery recorded\nCustomer: ${deliveryCustomer.name}\nMilk: ${milk_type}\nQuantity: ${qty} L\nRate: ₹${resultData.rate_per_litre.toFixed(2)}/L\nAmount: ₹${resultData.amount.toFixed(2)}\nOutstanding: ₹${(Number(total.total)-Number(paid.total)).toFixed(2)}`;
    notification = await sendTelegram(deliveryCustomer.telegram_chat_id, message);
    await pool.execute("INSERT INTO notification_logs (customer_id,delivery_id,status,message,error_text) VALUES (?,?,?,?,?)", [customer_id, resultData.id, notification.status, message, notification.error || null]);
  } catch (err) {
    notification = { status: "failed", error: err.message };
    await pool.execute("INSERT INTO notification_logs (customer_id,delivery_id,status,error_text) VALUES (?,?,?,?)", [customer_id, resultData.id, "failed", err.message]).catch(()=>{});
  }
  res.status(201).json({ ...resultData, notification });
}));

app.post("/api/delivery/temporary", requireRoles("delivery_boy"), asyncRoute(async (req, res) => {
  const phone = String(req.body.phone || "").replace(/\D/g, "");
  const milkType = req.body.milk_type;
  const routine = req.body.routine;
  const quantity = Number(req.body.quantity_litres);
  if (phone.length < 7 || !["cow", "buffalo"].includes(milkType) ||
      !["morning", "evening", "other"].includes(routine) ||
      !Number.isFinite(quantity) || quantity <= 0 || quantity > 100) {
    return res.status(400).json({ error: "Enter a valid phone number, milk type, routine and quantity up to 100 litres." });
  }
  const connection = await pool.getConnection();
  const code = randomUUID();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute(
      "INSERT INTO customers (customer_code,name,phone,assigned_to,active) VALUES (?,? ,?,?,FALSE)",
      [code, `Temporary delivery ${phone.slice(-4)}`, phone, req.user.id]
    );
    const rate = await getRate(connection, milkType, new Date());
    const amount = Number((quantity * rate).toFixed(2));
    const [deliveries] = await connection.execute(
      "INSERT INTO deliveries (customer_id,milk_type,quantity_litres,rate_per_litre,amount,routine,recorded_by) VALUES (?,?,?,?,?,?,?)",
      [customers.insertId, milkType, quantity, rate, amount, routine, req.user.id]
    );
    await connection.commit();
    res.status(201).json({ id: deliveries.insertId, amount, rate_per_litre: rate });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}));

// Customer self-service endpoints. Never accept a customer id from the client for these routes.
app.get("/api/customer/summary", requireRoles("customer"), asyncRoute(async (req, res) => {
  if (!req.user.customer_id) return res.status(403).json({error:"Customer account is not linked to a customer profile."});
  const id=req.user.customer_id; const [[customer]]=await pool.execute("SELECT id,name,phone,address,customer_code,assigned_to FROM customers WHERE id=? AND active=TRUE",[id]);
  if(!customer)return res.status(404).json({error:"Customer profile not found."});
  const [[delivered]]=await pool.execute("SELECT COUNT(*) delivery_count,COALESCE(SUM(quantity_litres),0) litres,COALESCE(SUM(amount),0) total FROM deliveries WHERE customer_id=? AND DATE_FORMAT(delivered_at,'%Y-%m')=DATE_FORMAT(CURRENT_DATE,'%Y-%m')",[id]);
  const [[paid]]=await pool.execute("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE customer_id=? AND DATE_FORMAT(paid_at,'%Y-%m')=DATE_FORMAT(CURRENT_DATE,'%Y-%m')",[id]);
  const [[allD]]=await pool.execute("SELECT COALESCE(SUM(amount),0) total FROM deliveries WHERE customer_id=?",[id]); const [[allP]]=await pool.execute("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE customer_id=?",[id]);
  res.json({customer,summary:{...delivered,paid:Number(paid.total),balance:Number((Number(allD.total)-Number(allP.total)).toFixed(2))}});
}));
app.get("/api/customer/deliveries", requireRoles("customer"), asyncRoute(async (req,res)=>{const [rows]=await pool.execute("SELECT d.id,d.customer_id,c.name AS customer_name,d.milk_type,d.routine,d.quantity_litres,d.rate_per_litre,d.amount,d.delivered_at,d.notes FROM deliveries d JOIN customers c ON c.id=d.customer_id WHERE d.customer_id=? ORDER BY d.delivered_at DESC LIMIT 500",[req.user.customer_id]);res.json(rows)}));
app.get("/api/customer/billing", requireRoles("customer"), asyncRoute(async (req, res) => {
  const id = req.user.customer_id;
  const [[customer]] = await pool.execute("SELECT id,name,phone FROM customers WHERE id=? AND active=TRUE", [id]);
  if (!customer) return res.status(404).json({ error: "Customer profile not found" });
  const [[delivered]] = await pool.execute(
    `SELECT COUNT(*) AS delivery_count,COALESCE(SUM(quantity_litres),0) AS litres,
            COALESCE(SUM(amount),0) AS total
     FROM deliveries
     WHERE customer_id=? AND delivered_at >= DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')
       AND delivered_at < DATE_ADD(DATE_FORMAT(CURRENT_DATE,'%Y-%m-01'), INTERVAL 1 MONTH)`,
    [id]
  );
  const [[paid]] = await pool.execute(
    `SELECT COALESCE(SUM(amount),0) AS total FROM payments
     WHERE customer_id=? AND paid_at >= DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')
       AND paid_at < DATE_ADD(DATE_FORMAT(CURRENT_DATE,'%Y-%m-01'), INTERVAL 1 MONTH)`,
    [id]
  );
  const [[history]] = await pool.execute(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM deliveries WHERE customer_id=? AND delivered_at < DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')),0) AS billed,
       COALESCE((SELECT SUM(amount) FROM payments WHERE customer_id=? AND paid_at < DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')),0) AS received`,
    [id, id]
  );
  const advance = Math.max(0, Number(history.received) - Number(history.billed));
  const monthCharges = Number(delivered.total);
  const monthPayments = Number(paid.total);
  const applied = Math.min(monthCharges, monthPayments + advance);
  const [items] = await pool.execute(
    `SELECT milk_type,quantity_litres,rate_per_litre,amount,delivered_at
     FROM deliveries WHERE customer_id=? AND delivered_at >= DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')
       AND delivered_at < DATE_ADD(DATE_FORMAT(CURRENT_DATE,'%Y-%m-01'), INTERVAL 1 MONTH)
     ORDER BY delivered_at DESC`,
    [id]
  );
  res.json({
    customer,
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    summary: {
      ...delivered,
      paid: monthPayments,
      advance_credit: advance,
      applied_payments: applied,
      balance: Number(Math.max(0, monthCharges - applied).toFixed(2)),
      due_balance: Number(Math.max(0, Number(history.billed) - Number(history.received)).toFixed(2)),
      billing_cycle_days: 30,
      daily_consumption: Number((Number(delivered.litres) / Math.max(1, new Date().getDate())).toFixed(2)),
      average_rate: Number(delivered.litres ? (monthCharges / Number(delivered.litres)).toFixed(2) : 0)
    },
    items
  });
}));
app.get("/api/customer/payments", requireRoles("customer"), asyncRoute(async (req,res)=>{const [rows]=await pool.execute("SELECT id,amount,payment_method,paid_at,reference_note FROM payments WHERE customer_id=? ORDER BY paid_at DESC LIMIT 500",[req.user.customer_id]);res.json(rows)}));
app.get("/api/customer/qr", requireRoles("customer"), asyncRoute(async (req,res)=>{const [rows]=await pool.execute("SELECT id,customer_code,name FROM customers WHERE id=? AND active=TRUE",[req.user.customer_id]);if(!rows.length)return res.status(404).json({error:"Customer profile not found"});const dataUrl=await QRCode.toDataURL(JSON.stringify({customerCode:rows[0].customer_code}),{width:360,margin:2});res.json({dataUrl,customer:rows[0]})}));

// Payment and notification history are returned only within the caller's role boundary.
app.get("/api/payments", asyncRoute(async (req,res)=>{
  if (req.user.role === "super_admin") {
    const [rows]=await pool.query("SELECT p.id,p.customer_id,c.name AS customer_name,p.amount,p.payment_method,p.paid_at,p.reference_note,u.name AS recorded_by FROM payments p JOIN customers c ON c.id=p.customer_id LEFT JOIN users u ON u.id=p.recorded_by ORDER BY p.paid_at DESC LIMIT 1000");
    return res.json(rows);
  }
  if (req.user.role === "delivery_boy") {
    const [rows]=await pool.execute("SELECT p.id,p.customer_id,c.name AS customer_name,p.amount,p.payment_method,p.paid_at,p.reference_note FROM payments p JOIN customers c ON c.id=p.customer_id WHERE c.assigned_to=? ORDER BY p.paid_at DESC LIMIT 500",[req.user.id]);
    return res.json(rows);
  }
  return res.status(403).json({error:"Payment history is not available for this role."});
}));
app.get("/api/notifications", requireRoles("super_admin"), asyncRoute(async(req,res)=>{
  const [rows]=await pool.query(
    `SELECT n.id,n.customer_id,n.delivery_boy_id,
            COALESCE(c.name,recipient.name) AS customer_name,
            CASE WHEN n.delivery_boy_id IS NOT NULL THEN 'delivery_boy' ELSE 'customer' END AS recipient_type,
            n.delivery_id,n.channel,n.direction,n.status,n.message,n.error_text,n.created_at
     FROM notification_logs n
     LEFT JOIN customers c ON c.id=n.customer_id
     LEFT JOIN users recipient ON recipient.id=n.delivery_boy_id
     ORDER BY n.created_at DESC LIMIT 300`
  );
  res.json(rows);
}));
app.get("/api/customer/notifications", requireRoles("customer"), asyncRoute(async(req,res)=>{
  const [rows]=await pool.execute("SELECT id,delivery_id,channel,direction,status,message,created_at FROM notification_logs WHERE customer_id=? ORDER BY created_at DESC LIMIT 100",[req.user.customer_id]);res.json(rows);
}));
app.get("/api/delivery/notifications", requireRoles("delivery_boy"), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT n.id,n.customer_id,n.delivery_boy_id,
            COALESCE(c.name,recipient.name) AS customer_name,
            CASE WHEN n.delivery_boy_id IS NOT NULL THEN 'delivery_boy' ELSE 'customer' END AS recipient_type,
            n.delivery_id,n.channel,n.direction,n.status,n.message,n.error_text,n.created_at
     FROM notification_logs n
     LEFT JOIN customers c ON c.id=n.customer_id
     LEFT JOIN users recipient ON recipient.id=n.delivery_boy_id
     WHERE c.assigned_to=? OR n.delivery_boy_id=?
     ORDER BY n.created_at DESC LIMIT 300`,
    [req.user.id, req.user.id]
  );
  res.json(rows);
}));
app.delete("/api/delivery/notifications/:id", requireRoles("delivery_boy"), asyncRoute(async (req, res) => {
  const [result] = await pool.execute(
    `DELETE n FROM notification_logs n
     LEFT JOIN customers c ON c.id=n.customer_id
     WHERE n.id=? AND (c.assigned_to=? OR n.delivery_boy_id=?)`,
    [req.params.id, req.user.id, req.user.id]
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Notification not found." });
  res.json({ ok: true });
}));
app.post("/api/notifications", requireRoles("super_admin"), asyncRoute(async (req, res) => {
  const message = String(req.body.message || "").trim();
  const recipientType = String(req.body.recipient_type || (
    req.body.delivery_boy_id ? "delivery_boy" : req.body.customer_id ? "customer" : "all_customers"
  ));
  const customerId = req.body.customer_id ? Number(req.body.customer_id) : null;
  const deliveryBoyId = req.body.delivery_boy_id ? Number(req.body.delivery_boy_id) : null;
  if (!message || message.length > 2000) return res.status(400).json({ error: "Enter a message up to 2,000 characters." });
  if (!["all_customers", "customer", "delivery_boy"].includes(recipientType)) {
    return res.status(400).json({ error: "Choose a valid recipient group." });
  }
  if (recipientType === "customer" && (!Number.isSafeInteger(customerId) || customerId <= 0)) {
    return res.status(400).json({ error: "Choose a valid customer." });
  }
  if (recipientType === "delivery_boy" && (!Number.isSafeInteger(deliveryBoyId) || deliveryBoyId <= 0)) {
    return res.status(400).json({ error: "Choose a valid delivery partner." });
  }
  let recipients;
  if (recipientType === "delivery_boy") {
    const [deliveryBoys] = await pool.execute(
      "SELECT id FROM users WHERE id=? AND role='delivery_boy' AND active=TRUE",
      [deliveryBoyId]
    );
    recipients = deliveryBoys;
  } else {
    const [customers] = await pool.execute(
      `SELECT id FROM customers WHERE active=TRUE ${recipientType === "customer" ? "AND id=?" : ""} ORDER BY id`,
      recipientType === "customer" ? [customerId] : []
    );
    recipients = customers;
  }
  if (!recipients.length) return res.status(404).json({ error: "No active recipient was found." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const recipient of recipients) {
      if (recipientType === "delivery_boy") {
        await connection.execute(
          "INSERT INTO notification_logs (delivery_boy_id,channel,direction,status,message) VALUES (?,'in_app','outbound','sent',?)",
          [recipient.id, message]
        );
      } else {
        await connection.execute(
          "INSERT INTO notification_logs (customer_id,channel,direction,status,message) VALUES (?,'in_app','outbound','sent',?)",
          [recipient.id, message]
        );
      }
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  res.status(201).json({ sent: recipients.length });
}));
app.delete("/api/notifications/:id", requireRoles("super_admin"), asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM notification_logs WHERE id=?", [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: "Notification not found." });
  res.json({ ok: true });
}));
app.get("/api/support-tickets", asyncRoute(async (req, res) => {
  let condition;
  let parameters;
  if (req.user.role === "super_admin") {
    condition = "1=1";
    parameters = [];
  } else if (req.user.role === "customer" && req.user.customer_id) {
    condition = "t.customer_id=?";
    parameters = [req.user.customer_id];
  } else if (req.user.role === "delivery_boy") {
    condition = "t.delivery_boy_id=?";
    parameters = [req.user.id];
  } else {
    return res.status(403).json({ error: "You do not have permission to view support tickets." });
  }
  const [tickets] = await pool.execute(
    `SELECT t.id,t.customer_id,c.name AS customer_name,c.phone AS customer_phone,
            t.delivery_boy_id,COALESCE(d.name,'Dairy owner') AS recipient_name,
            t.recipient_type,t.status,t.created_at,t.updated_at
     FROM support_tickets t
     JOIN customers c ON c.id=t.customer_id
     LEFT JOIN users d ON d.id=t.delivery_boy_id
     WHERE ${condition}
     ORDER BY t.updated_at DESC LIMIT 200`,
    parameters
  );
  if (!tickets.length) return res.json([]);
  const ticketIds = tickets.map(ticket => ticket.id);
  const [messages] = await pool.query(
    `SELECT m.id,m.ticket_id,m.sender_user_id,m.sender_role,u.name AS sender_name,m.message,m.created_at
     FROM support_ticket_messages m
     JOIN users u ON u.id=m.sender_user_id
     WHERE m.ticket_id IN (?) ORDER BY m.created_at,m.id`,
    [ticketIds]
  );
  const messagesByTicket = new Map();
  for (const message of messages) {
    const ticketMessages = messagesByTicket.get(Number(message.ticket_id)) || [];
    ticketMessages.push(message);
    messagesByTicket.set(Number(message.ticket_id), ticketMessages);
  }
  res.json(tickets.map(ticket => ({ ...ticket, messages: messagesByTicket.get(Number(ticket.id)) || [] })));
}));
app.post("/api/customer/support-tickets", requireRoles("customer"), asyncRoute(async (req, res) => {
  const message = String(req.body.message || "").trim();
  const recipientType = String(req.body.recipient_type || "owner");
  if (!message || message.length > 2000) return res.status(400).json({ error: "Enter a message up to 2,000 characters." });
  if (!["owner", "delivery_boy"].includes(recipientType)) return res.status(400).json({ error: "Choose the owner or your assigned delivery partner." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute(
      "SELECT id,assigned_to FROM customers WHERE id=? AND active=TRUE FOR UPDATE",
      [req.user.customer_id]
    );
    if (!customers.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Active customer profile not found." });
    }
    const deliveryBoyId = recipientType === "delivery_boy" ? customers[0].assigned_to : null;
    if (recipientType === "delivery_boy" && !deliveryBoyId) {
      await connection.rollback();
      return res.status(400).json({ error: "This customer does not have an assigned active delivery partner. Send the request to the owner instead." });
    }
    if (deliveryBoyId) {
      const [deliveryBoys] = await connection.execute("SELECT id FROM users WHERE id=? AND role='delivery_boy' AND active=TRUE", [deliveryBoyId]);
      if (!deliveryBoys.length) {
        await connection.rollback();
        return res.status(400).json({ error: "The assigned delivery partner is unavailable. Send the request to the owner instead." });
      }
    }
    const [ticket] = await connection.execute(
      "INSERT INTO support_tickets (customer_id,delivery_boy_id,recipient_type) VALUES (?,?,?)",
      [req.user.customer_id, deliveryBoyId, recipientType]
    );
    await connection.execute(
      "INSERT INTO support_ticket_messages (ticket_id,sender_user_id,sender_role,message) VALUES (?,?, 'customer',?)",
      [ticket.insertId, req.user.id, message]
    );
    await connection.commit();
    res.status(201).json({ id: ticket.insertId, status: "open" });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}));
app.post("/api/support-tickets/:id/messages", asyncRoute(async (req, res) => {
  const ticketId = Number(req.params.id);
  const message = String(req.body.message || "").trim();
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) return res.status(400).json({ error: "Invalid support ticket ID." });
  if (!message || message.length > 2000) return res.status(400).json({ error: "Enter a message up to 2,000 characters." });
  if (!["customer", "delivery_boy", "super_admin"].includes(req.user.role)) return res.status(403).json({ error: "You do not have permission to reply to support tickets." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let condition = "t.id=?";
    const parameters = [ticketId];
    if (req.user.role === "customer") {
      condition += " AND t.customer_id=?";
      parameters.push(req.user.customer_id);
    } else if (req.user.role === "delivery_boy") {
      condition += " AND t.delivery_boy_id=?";
      parameters.push(req.user.id);
    }
    const [tickets] = await connection.execute(`SELECT t.id,t.status FROM support_tickets t WHERE ${condition} FOR UPDATE`, parameters);
    if (!tickets.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Support ticket not found." });
    }
    if (tickets[0].status !== "open") {
      await connection.rollback();
      return res.status(409).json({ error: "This ticket is closed. Ask the owner to reopen it before replying." });
    }
    const [result] = await connection.execute(
      "INSERT INTO support_ticket_messages (ticket_id,sender_user_id,sender_role,message) VALUES (?,?,?,?)",
      [ticketId, req.user.id, req.user.role, message]
    );
    await connection.execute("UPDATE support_tickets SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [ticketId]);
    await connection.commit();
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}));
app.patch("/api/support-tickets/:id/status", requireRoles("super_admin"), asyncRoute(async (req, res) => {
  const ticketId = Number(req.params.id);
  const status = String(req.body.status || "");
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) return res.status(400).json({ error: "Invalid support ticket ID." });
  if (!["open", "closed"].includes(status)) return res.status(400).json({ error: "Choose open or closed status." });
  const [result] = await pool.execute("UPDATE support_tickets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [status, ticketId]);
  if (!result.affectedRows) return res.status(404).json({ error: "Support ticket not found." });
  res.json({ ok: true });
}));
app.post("/api/customer/notifications", requireRoles("customer"), asyncRoute(async (req, res) => {
  const message = String(req.body.message || "").trim();
  if (!message || message.length > 2000) return res.status(400).json({ error: "Enter a message up to 2,000 characters." });
  const [result] = await pool.execute(
    "INSERT INTO notification_logs (customer_id,channel,direction,status,message) VALUES (?,'in_app','inbound','sent',?)",
    [req.user.customer_id, message]
  );
  res.status(201).json({ id: result.insertId, ok: true });
}));
app.delete("/api/customer/notifications/:id", requireRoles("customer"), asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM notification_logs WHERE id=? AND customer_id=?", [req.params.id, req.user.customer_id]);
  if (!result.affectedRows) return res.status(404).json({ error: "Notification not found." });
  res.json({ ok: true });
}));

// Admin team and assignment endpoints.
app.get("/api/delivery-boys", requireRoles("super_admin"), asyncRoute(async(req,res)=>{const [rows]=await pool.query("SELECT id,name,email,phone,active,(email IS NOT NULL AND password_hash IS NOT NULL) AS login_enabled FROM users WHERE role='delivery_boy' AND active=TRUE ORDER BY name");res.json(rows)}));
app.post("/api/delivery-boys", requireRoles("super_admin"), asyncRoute(async(req,res)=>{const {name,email,password,phone}=req.body;const cleanPhone=String(phone||'').replace(/\D/g,'');if(!String(name||'').trim()||!String(email||'').trim()||cleanPhone.length<7||String(password||'').length<8)return res.status(400).json({error:"Name, email, valid phone number and password of at least 8 characters are required."});await ensureUserContactAvailable(cleanPhone,email);const hash=await bcrypt.hash(String(password),12);const [r]=await pool.execute("INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,'delivery_boy')",[String(name).trim(),String(email).trim().toLowerCase(),cleanPhone,hash]);res.status(201).json({id:r.insertId,name,email,phone:cleanPhone,role:'delivery_boy'})}));
app.delete("/api/delivery-boys/:id", requireRoles("super_admin"), asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid delivery partner ID." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute("SELECT id FROM users WHERE id=? AND role='delivery_boy' AND active=TRUE FOR UPDATE", [id]);
    if (!users.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Active delivery partner not found." });
    }
    const [assignments] = await connection.execute("UPDATE customers SET assigned_to=NULL WHERE assigned_to=? AND active=TRUE", [id]);
    await connection.execute("UPDATE users SET active=FALSE WHERE id=?", [id]);
    await connection.commit();
    res.json({ ok: true, unassigned_customers: assignments.affectedRows });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}));
app.put("/api/delivery-boys/:id/login", requireRoles("super_admin"), asyncRoute(async(req,res)=>{
  const id=Number(req.params.id);
  const email=String(req.body.email||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  if(!Number.isSafeInteger(id)||id<1||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8)return res.status(400).json({error:"Enter a valid email and a password of at least 8 characters."});
  const [users]=await pool.execute("SELECT id FROM users WHERE id=? AND role='delivery_boy' AND active=TRUE",[id]);
  if(!users.length)return res.status(404).json({error:"Active delivery partner not found."});
  const [emailMatches]=await pool.execute("SELECT id FROM users WHERE LOWER(email)=? AND id<>? LIMIT 1",[email,id]);
  if(emailMatches.length)return res.status(409).json({error:"That email address is already used by another account."});
  const passwordHash=await bcrypt.hash(password,12);
  await pool.execute("UPDATE users SET email=?,password_hash=? WHERE id=?",[email,passwordHash,id]);
  res.json({ok:true,login_enabled:true});
}));
app.put("/api/customers/:id/assignment", requireRoles("super_admin"), asyncRoute(async(req,res)=>{const boyId=req.body.delivery_boy_id||null;if(boyId){const [users]=await pool.execute("SELECT id FROM users WHERE id=? AND role='delivery_boy' AND active=TRUE",[boyId]);if(!users.length)return res.status(400).json({error:"Select an active delivery boy."});}const [r]=await pool.execute("UPDATE customers SET assigned_to=? WHERE id=? AND active=TRUE",[boyId,req.params.id]);if(!r.affectedRows)return res.status(404).json({error:"Customer not found"});res.json({ok:true})}));


app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API endpoint not found." });
  res.sendFile(path.join(frontendDist, "index.html"), err => { if (err) next(err); });
});

app.use((err, req, res, next) => {
  console.error(err);
  const friendlyError = err && err.code ? dbErrorMessage(err) : (err.status ? err.message : "Unexpected server error");
  const status = err.status || (err.code === "ER_DUP_ENTRY" ? 409 : 500);
  res.status(status).json({
    error: friendlyError,
    ...(process.env.NODE_ENV === "development" ? { detail: err.message } : {})
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Kakarla Dairy Farm server listening on 0.0.0.0:${port}`);
});

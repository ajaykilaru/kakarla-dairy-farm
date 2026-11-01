CREATE DATABASE IF NOT EXISTS smart_dairy
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_dairy;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) UNIQUE,
  phone VARCHAR(25) UNIQUE,
  password_hash VARCHAR(255),
  role ENUM('super_admin','delivery_boy','customer') NOT NULL DEFAULT 'customer',
  customer_id BIGINT UNSIGNED NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_code CHAR(36) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(25),
  address VARCHAR(500),
  milk_type ENUM('cow','buffalo') NOT NULL DEFAULT 'cow',
  quantity_litres DECIMAL(8,3) NOT NULL DEFAULT 1,
  morning_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  evening_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id VARCHAR(80),
  assigned_to BIGINT UNSIGNED NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customers_name (name),
  INDEX idx_customers_phone (phone),
  INDEX idx_customers_assigned_to (assigned_to)
);

ALTER TABLE users
  ADD CONSTRAINT fk_user_customer FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE TABLE IF NOT EXISTS milk_rates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  milk_type ENUM('cow','buffalo') NOT NULL,
  rate_per_litre DECIMAL(10,2) NOT NULL,
  effective_from DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rate_effective (milk_type, effective_from)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  milk_type ENUM('cow','buffalo') NOT NULL,
  quantity_litres DECIMAL(8,3) NOT NULL,
  rate_per_litre DECIMAL(10,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  delivered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  routine ENUM('morning','evening','other') NOT NULL DEFAULT 'other',
  recorded_by BIGINT UNSIGNED NULL,
  notes VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_delivery_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_delivery_user FOREIGN KEY (recorded_by) REFERENCES users(id),
  INDEX idx_delivery_date (delivered_at),
  INDEX idx_delivery_customer_date (customer_id, delivered_at)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_method ENUM('cash','upi','bank_transfer','other') NOT NULL DEFAULT 'cash',
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reference_note VARCHAR(255),
  recorded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_payment_user FOREIGN KEY (recorded_by) REFERENCES users(id),
  INDEX idx_payment_customer_date (customer_id, paid_at)
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NULL,
  delivery_boy_id BIGINT UNSIGNED NULL,
  delivery_id BIGINT UNSIGNED NULL,
  channel ENUM('telegram','in_app') NOT NULL DEFAULT 'telegram',
  direction ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound',
  status ENUM('sent','failed','skipped') NOT NULL,
  message TEXT,
  error_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_notification_delivery_boy FOREIGN KEY (delivery_boy_id) REFERENCES users(id),
  CONSTRAINT fk_notification_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_password_reset_user_expiry (user_id, expires_at)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  delivery_boy_id BIGINT UNSIGNED NULL,
  recipient_type ENUM('owner','delivery_boy') NOT NULL DEFAULT 'owner',
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_support_ticket_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_support_ticket_delivery_boy FOREIGN KEY (delivery_boy_id) REFERENCES users(id),
  INDEX idx_support_ticket_customer_status (customer_id, status, updated_at),
  INDEX idx_support_ticket_delivery_boy_status (delivery_boy_id, status, updated_at)
);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED NOT NULL,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  sender_role ENUM('customer','delivery_boy','super_admin') NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_support_message_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id),
  CONSTRAINT fk_support_message_sender FOREIGN KEY (sender_user_id) REFERENCES users(id),
  INDEX idx_support_message_ticket_created (ticket_id, created_at)
);

INSERT IGNORE INTO milk_rates (milk_type, rate_per_litre, effective_from)
VALUES ('cow', 60.00, CURRENT_DATE), ('buffalo', 75.00, CURRENT_DATE);

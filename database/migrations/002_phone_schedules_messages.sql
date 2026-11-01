-- Run once against an existing Smart Dairy database after taking a backup.
ALTER TABLE users
  ADD COLUMN phone VARCHAR(25) NULL UNIQUE;

ALTER TABLE customers
  ADD COLUMN milk_type ENUM('cow','buffalo') NOT NULL DEFAULT 'cow',
  ADD COLUMN quantity_litres DECIMAL(8,3) NOT NULL DEFAULT 1,
  ADD COLUMN morning_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN evening_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE deliveries
  ADD COLUMN routine ENUM('morning','evening','other') NOT NULL DEFAULT 'other';

ALTER TABLE notification_logs
  MODIFY COLUMN channel ENUM('telegram','in_app') NOT NULL DEFAULT 'telegram',
  ADD COLUMN direction ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound';

CREATE TABLE password_reset_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_password_reset_user_expiry (user_id, expires_at)
);

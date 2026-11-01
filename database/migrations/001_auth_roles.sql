-- Run once against an EXISTING Smart Dairy database.
-- Take a database backup first. This migration intentionally does not create user accounts.
ALTER TABLE users
  MODIFY COLUMN role ENUM('super_admin','delivery_boy','customer') NOT NULL DEFAULT 'customer',
  ADD COLUMN customer_id BIGINT UNSIGNED NULL;

ALTER TABLE customers
  ADD COLUMN assigned_to BIGINT UNSIGNED NULL,
  ADD INDEX idx_customers_assigned_to (assigned_to);

ALTER TABLE users
  ADD CONSTRAINT fk_user_customer FOREIGN KEY (customer_id) REFERENCES customers(id);

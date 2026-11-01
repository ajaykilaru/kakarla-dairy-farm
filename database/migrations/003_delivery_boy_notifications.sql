-- Run once against an existing Smart Dairy database after taking a backup.
ALTER TABLE notification_logs
  MODIFY COLUMN customer_id BIGINT UNSIGNED NULL,
  ADD COLUMN delivery_boy_id BIGINT UNSIGNED NULL AFTER customer_id,
  ADD CONSTRAINT fk_notification_delivery_boy
    FOREIGN KEY (delivery_boy_id) REFERENCES users(id),
  ADD INDEX idx_notification_delivery_boy (delivery_boy_id);

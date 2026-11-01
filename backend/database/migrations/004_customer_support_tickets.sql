CREATE TABLE support_tickets (
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

CREATE TABLE support_ticket_messages (
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

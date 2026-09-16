CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile_number VARCHAR(20) UNIQUE NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES menu_categories(id),
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_paise INT NOT NULL CHECK (price_paise >= 0),
  image_url TEXT,
  available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number BIGSERIAL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('DINE_IN','TAKEAWAY')),
  table_number VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACCEPTED','PREPARING','READY','COMPLETED','CANCELLED')),
  total_paise INT NOT NULL CHECK (total_paise >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  item_name VARCHAR(120) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price_paise INT NOT NULL CHECK (unit_price_paise >= 0)
);

INSERT INTO menu_categories (name, sort_order)
VALUES ('Coffee', 1), ('Snacks', 2), ('Meals', 3)
ON CONFLICT (name) DO NOTHING;

INSERT INTO menu_items (category_id, name, description, price_paise)
SELECT id, 'Cappuccino', 'Fresh espresso with steamed milk', 12000
FROM menu_categories WHERE name='Coffee'
AND NOT EXISTS (SELECT 1 FROM menu_items WHERE name='Cappuccino');

INSERT INTO menu_items (category_id, name, description, price_paise)
SELECT id, 'Cold Coffee', 'Chilled creamy coffee', 15000
FROM menu_categories WHERE name='Coffee'
AND NOT EXISTS (SELECT 1 FROM menu_items WHERE name='Cold Coffee');

INSERT INTO menu_items (category_id, name, description, price_paise)
SELECT id, 'Veg Sandwich', 'Grilled vegetable sandwich', 14000
FROM menu_categories WHERE name='Snacks'
AND NOT EXISTS (SELECT 1 FROM menu_items WHERE name='Veg Sandwich');

INSERT INTO menu_items (category_id, name, description, price_paise)
SELECT id, 'French Fries', 'Crispy salted fries', 10000
FROM menu_categories WHERE name='Snacks'
AND NOT EXISTS (SELECT 1 FROM menu_items WHERE name='French Fries');

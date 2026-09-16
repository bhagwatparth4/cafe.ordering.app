import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Pool } from "pg";
import { createClient } from "redis";
import { z } from "zod";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });

redis.on("error", (e) => console.error("Redis error", e));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true });
app.use("/api", apiLimiter);

function normalizeMobile(input: string) {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return "+91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  throw new Error("Enter a valid Indian mobile number");
}

function otpHash(otp: string) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function signCustomer(customerId: string) {
  return jwt.sign({ sub: customerId, role: "customer" }, JWT_SECRET, { expiresIn: "30d" });
}

function signAdmin() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
}

function auth(requiredRole: "customer" | "admin") {
  return (req: any, res: any, next: any) => {
    try {
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      const payload: any = jwt.verify(token, JWT_SECRET);
      if (payload.role !== requiredRole) return res.status(403).json({ error: "Forbidden" });
      req.auth = payload;
      next();
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    await redis.ping();
    res.json({ ok: true, service: "cafe-api" });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get("/api/menu", async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT m.id, m.name, m.description, m.price_paise, m.image_url,
           c.name AS category
    FROM menu_items m
    LEFT JOIN menu_categories c ON c.id=m.category_id
    WHERE m.available=true
    ORDER BY c.sort_order, m.name
  `);
  res.json(rows);
});

app.post("/api/auth/send-otp", async (req, res) => {
  try {
    const mobile = normalizeMobile(z.string().parse(req.body.mobile));
    const key = `otp:${mobile}`;
    if (await redis.exists(`otp-cooldown:${mobile}`))
      return res.status(429).json({ error: "Please wait before requesting another OTP" });

    const otp = String(crypto.randomInt(100000, 1000000));
    await redis.set(key, otpHash(otp), { EX: Number(process.env.OTP_TTL_SECONDS || 300) });
    await redis.set(`otp-attempts:${mobile}`, "0", { EX: Number(process.env.OTP_TTL_SECONDS || 300) });
    await redis.set(`otp-cooldown:${mobile}`, "1", { EX: Number(process.env.OTP_RESEND_SECONDS || 60) });

    // Replace this block with the chosen SMS provider in production.
    if (process.env.OTP_DEV_MODE === "true") console.log(`[DEV OTP] ${mobile}: ${otp}`);

    res.json({ ok: true, message: "OTP sent" });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Invalid request" });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const mobile = normalizeMobile(z.string().parse(req.body.mobile));
    const otp = z.string().regex(/^\d{6}$/).parse(req.body.otp);
    const key = `otp:${mobile}`;
    const stored = await redis.get(key);
    if (!stored) return res.status(400).json({ error: "OTP expired or not requested" });

    const attempts = Number(await redis.get(`otp-attempts:${mobile}`) || 0);
    if (attempts >= 5) return res.status(429).json({ error: "Too many attempts" });

    if (stored !== otpHash(otp)) {
      await redis.incr(`otp-attempts:${mobile}`);
      return res.status(400).json({ error: "Invalid OTP" });
    }

    await redis.del(key);
    const result = await pool.query(
      `INSERT INTO customers(mobile_number) VALUES($1)
       ON CONFLICT(mobile_number) DO UPDATE SET verified_at=now()
       RETURNING id, mobile_number`, [mobile]
    );
    res.json({ token: signCustomer(result.rows[0].id), customer: result.rows[0] });
  } catch {
    res.status(400).json({ error: "Invalid OTP request" });
  }
});

const orderSchema = z.object({
  orderType: z.enum(["DINE_IN", "TAKEAWAY"]),
  tableNumber: z.string().max(20).optional().nullable(),
  notes: z.string().max(500).optional().default(""),
  items: z.array(z.object({ menuItemId: z.string().uuid(), quantity: z.number().int().min(1).max(50) })).min(1)
});

app.post("/api/orders", auth("customer"), async (req: any, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (parsed.data.orderType === "DINE_IN" && !parsed.data.tableNumber)
      return res.status(400).json({ error: "Table number required for dine-in" });

    const ids = parsed.data.items.map(x => x.menuItemId);
    const { rows: menu } = await client.query(
      `SELECT id,name,price_paise FROM menu_items WHERE available=true AND id=ANY($1::uuid[]) FOR SHARE`, [ids]
    );
    const byId = new Map(menu.map(x => [x.id, x]));
    if (byId.size !== ids.length) throw new Error("One or more items are unavailable");

    let total = 0;
    const normalized = parsed.data.items.map(x => {
      const item = byId.get(x.menuItemId)!;
      total += item.price_paise * x.quantity;
      return { ...x, name: item.name, price: item.price_paise };
    });

    const order = await client.query(
      `INSERT INTO orders(customer_id,order_type,table_number,total_paise,notes)
       VALUES($1,$2,$3,$4,$5) RETURNING id,order_number,status,total_paise,created_at`,
      [req.auth.sub, parsed.data.orderType, parsed.data.tableNumber || null, total, parsed.data.notes]
    );

    for (const x of normalized) {
      await client.query(
        `INSERT INTO order_items(order_id,menu_item_id,item_name,quantity,unit_price_paise)
         VALUES($1,$2,$3,$4,$5)`, [order.rows[0].id, x.menuItemId, x.name, x.quantity, x.price]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(order.rows[0]);
  } catch (e: any) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: e.message || "Could not create order" });
  } finally {
    client.release();
  }
});

app.get("/api/admin/orders", auth("admin"), async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT o.id,o.order_number,o.order_type,o.table_number,o.status,o.total_paise,
           o.notes,o.created_at,c.mobile_number,
           COALESCE(json_agg(json_build_object('name',oi.item_name,'quantity',oi.quantity,'price',oi.unit_price_paise))
           FILTER (WHERE oi.id IS NOT NULL),'[]') items
    FROM orders o
    JOIN customers c ON c.id=o.customer_id
    LEFT JOIN order_items oi ON oi.order_id=o.id
    GROUP BY o.id,c.mobile_number
    ORDER BY o.created_at DESC LIMIT 100
  `);
  res.json(rows);
});

app.patch("/api/admin/orders/:id/status", auth("admin"), async (req, res) => {
  const status = z.enum(["PENDING","ACCEPTED","PREPARING","READY","COMPLETED","CANCELLED"]).safeParse(req.body.status);
  if (!status.success) return res.status(400).json({ error: "Invalid status" });
  const result = await pool.query(
    `UPDATE orders SET status=$1 WHERE id=$2 RETURNING id,order_number,status`, [status.data, req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Order not found" });
  res.json(result.rows[0]);
});

app.post("/api/admin/login", async (req, res) => {
  const email = z.string().email().safeParse(req.body.email);
  const password = z.string().min(8).safeParse(req.body.password);
  if (!email.success || !password.success) return res.status(400).json({ error: "Invalid credentials" });

  const configuredEmail = process.env.ADMIN_EMAIL || "";
  const configuredPassword = process.env.ADMIN_PASSWORD || "";
  if (email.data !== configuredEmail || password.data !== configuredPassword)
    return res.status(401).json({ error: "Invalid credentials" });

  res.json({ token: signAdmin() });
});

async function main() {
  await redis.connect();
  await pool.query("SELECT 1");
  app.listen(PORT, () => console.log(`API listening on ${PORT}`));
}
main().catch(e => { console.error(e); process.exit(1); });

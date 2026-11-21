const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const BOOT_VERSION = 'BOOT_VERSION_2026_V13';

const baseDir = __dirname;
const publicDir = path.join(baseDir, 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const jsonDbPath = path.join(baseDir, 'data.json');

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

let mode = 'json';
let betterDb = null;
let sqlite3Db = null;

try {
  const BetterSqlite3 = require('better-sqlite3');
  const sqlitePath = process.env.SQLITE_PATH || path.join(baseDir, 'data.sqlite');
  betterDb = new BetterSqlite3(sqlitePath);
  betterDb.pragma('journal_mode = WAL');
  betterDb.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      description TEXT DEFAULT '',
      image TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      carton_qty INTEGER NOT NULL DEFAULT 1,
      stock INTEGER NOT NULL DEFAULT 0,
      image TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      location TEXT DEFAULT '',
      wilaya TEXT DEFAULT '',
      items_json TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS custom_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      notes TEXT DEFAULT '',
      image TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  mode = 'better-sqlite3';
} catch (e1) {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const sqlitePath = process.env.SQLITE_PATH || path.join(baseDir, 'data.sqlite');
    sqlite3Db = new sqlite3.Database(sqlitePath);
    mode = 'sqlite3';
  } catch (e2) {
    mode = 'json';
  }
}

function readJsonStore() {
  if (!fs.existsSync(jsonDbPath)) {
    const initial = { nextId: 1, stores: [], products: [], orders: [], custom_requests: [] };
    fs.writeFileSync(jsonDbPath, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
    return {
      nextId: parsed.nextId || 1,
      stores: Array.isArray(parsed.stores) ? parsed.stores : [],
      products: Array.isArray(parsed.products) ? parsed.products : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      custom_requests: Array.isArray(parsed.custom_requests) ? parsed.custom_requests : []
    };
  } catch (e) {
    return { nextId: 1, stores: [], products: [], orders: [], custom_requests: [] };
  }
}

function writeJsonStore(data) {
  fs.writeFileSync(jsonDbPath, JSON.stringify(data, null, 2));
}

function runSqlite3(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqlite3Db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getSqlite3(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqlite3Db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allSqlite3(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqlite3Db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function initSqlite3Tables() {
  if (mode !== 'sqlite3') return;
  await runSqlite3(CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT, description TEXT DEFAULT '', image TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP));
  await runSqlite3(CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, carton_qty INTEGER NOT NULL DEFAULT 1, stock INTEGER NOT NULL DEFAULT 0, image TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP));
  await runSqlite3(CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, phone TEXT NOT NULL, location TEXT DEFAULT '', wilaya TEXT DEFAULT '', items_json TEXT NOT NULL, total REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP));
  await runSqlite3(CREATE TABLE IF NOT EXISTS custom_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT DEFAULT '', image TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP));
}

function makeSlug(name) {
  const base = String(name || 'store')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'store';
  return ${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)};
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, ${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt});
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

app.get('/admin.html', function (req, res) {
  const preferredAdmin = path.join(publicDir, 'admin.html');
  if (fs.existsSync(preferredAdmin)) {
    return res.sendFile(preferredAdmin);
  }
  return res.status(404).send('admin.html not found in public/');
});

app.get('/', function (req, res) {
  const preferredIndex = path.join(publicDir, 'index.html');
  if (fs.existsSync(preferredIndex)) {
    return res.sendFile(preferredIndex);
  }
  return res.status(404).send('index.html not found in public/');
});

app.get('/api/health', function (req, res) {
  let publicFiles = [];
  try {
    publicFiles = fs.readdirSync(publicDir);
  } catch (e) {
    publicFiles = [];
  }
  res.json({
    ok: true,
    boot_version: BOOT_VERSION,
    db_mode: mode,
    public_files: publicFiles,
    admin_exists: fs.existsSync(path.join(publicDir, 'admin.html'))
  });
});

// المتاجر
app.get('/api/stores', async function (req, res) {
  try {
    if (mode === 'better-sqlite3') {
      return res.json(betterDb.prepare('SELECT * FROM stores ORDER BY id DESC').all());
    }
    if (mode === 'sqlite3') {
      return res.json(await allSqlite3('SELECT * FROM stores ORDER BY id DESC'));
    }
    const dbJson = readJsonStore();
    return res.json([...dbJson.stores].sort((a, b) => b.id - a.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stores', upload.single('image'), async function (req, res) {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    const description = String((req.body && req.body.description) || '').trim();
    if (!name) return res.status(400).json({ error: 'اسم المتجر مطلوب' });
    const image = req.file ? /uploads/${req.file.filename} : '';
    const slug = makeSlug(name);

    if (mode === 'better-sqlite3') {
      const info = betterDb
        .prepare('INSERT INTO stores (name, slug, description, image) VALUES (?, ?, ?, ?)')
        .run(name, slug, description, image);
      return res.status(201).json(betterDb.prepare('SELECT * FROM stores WHERE id = ?').get(info.lastInsertRowid));
    }
    if (mode === 'sqlite3') {
      const info = await runSqlite3(
        'INSERT INTO stores (name, slug, description, image) VALUES (?, ?, ?, ?)',
        [name, slug, description, image]
      );
      return res.status(201).json(await getSqlite3('SELECT * FROM stores WHERE id = ?', [info.lastID]));
    }
    const dbJson = readJsonStore();
    const created = {
      id: dbJson.nextId++,
      name,
      slug,
      description,
      image,
      created_at: new Date().toISOString()
    };
    dbJson.stores.push(created);
    writeJsonStore(dbJson);
    return res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/stores/:id', upload.single('image'), async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (mode === 'better-sqlite3') {
      const existing = betterDb.prepare('SELECT * FROM stores WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'المتجر غير موجود' });
      const name = String((req.body && req.body.name) || existing.name).trim();
      const description = req.body && typeof req.body.description !== 'undefined' ? String(req.body.description).trim() : (existing.description || '');
      const image = req.file ? /uploads/${req.file.filename} : (existing.image || '');
      betterDb.prepare('UPDATE stores SET name = ?, description = ?, image = ? WHERE id = ?').run(name, description, image, id);
      return res.json(betterDb.prepare('SELECT * FROM stores WHERE id = ?').get(id));
    }
    if (mode === 'sqlite3') {
      const existing = await getSqlite3('SELECT * FROM stores WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'المتجر غير موجود' });
      const name = String((req.body && req.body.name) || existing.name).trim();
      const description = req.body && typeof req.body.description !== 'undefined' ? String(req.body.description).trim() : (existing.description || '');
      const image = req.file ? /uploads/${req.file.filename} : (existing.image || '');
      await runSqlite3('UPDATE stores SET name = ?, description = ?, image = ? WHERE id = ?', [name, description, image, id]);
      return res.json(await getSqlite3('SELECT * FROM stores WHERE id = ?', [id]));
    }
    const dbJson = readJsonStore();
    const idx = dbJson.stores.findIndex((s) => Number(s.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'المتجر غير موجود' });
    const existing = dbJson.stores[idx];
    existing.name = String((req.body && req.body.name) || existing.name).trim();
    if (req.body && typeof req.body.description !== 'undefined') existing.description = String(req.body.description).trim();
    if (req.file) existing.image = /uploads/${req.file.filename};
    writeJsonStore(dbJson);
    return res.json(existing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/stores/:id', async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (mode === 'better-sqlite3') {
      const info = betterDb.prepare('DELETE FROM stores WHERE id = ?').run(id);
      return res.json({ deleted: info.changes > 0 });
    }
    if (mode === 'sqlite3') {
      const info = await runSqlite3('DELETE FROM stores WHERE id = ?', [id]);
      return res.json({ deleted: info.changes > 0 });
    }
    const dbJson = readJsonStore();
    const before = dbJson.stores.length;
    dbJson.stores = dbJson.stores.filter((s) => Number(s.id) !== id);
    dbJson.products = dbJson.products.filter((p) => Number(p.store_id) !== id);
    writeJsonStore(dbJson);
    return res.json({ deleted: dbJson.stores.length < before });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// المنتجات
app.get('/api/products', async function (req, res) {
  try {
    const storeId = req.query.store_id ? Number(req.query.store_id) : null;
    if (mode === 'better-sqlite3') {
      const rows = storeId
        ? betterDb.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY id DESC').all(storeId)
        : betterDb.prepare('SELECT * FROM products ORDER BY id DESC').all();
      return res.json(rows);
    }
    if (mode === 'sqlite3') {
      const rows = storeId
        ? await allSqlite3('SELECT * FROM products WHERE store_id = ? ORDER BY id DESC', [storeId])
        : await allSqlite3('SELECT * FROM products ORDER BY id DESC');
      return res.json(rows);
    }
    const dbJson = readJsonStore();
    const list = storeId ? dbJson.products.filter((p) => Number(p.store_id) === storeId) : dbJson.products;
    return res.json([...list].sort((a, b) => b.id - a.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', upload.single('image'), async function (req, res) {
  try {
    const storeId = Number(req.body && req.body.store_id);
    const name = String((req.body && req.body.name) || '').trim();
    const price = Number((req.body && req.body.price) || 0);
    const cartonQty = Math.max(1, Number((req.body && req.body.carton_qty) || 1));
    const stock = Math.max(0, Number((req.body && req.body.stock) || 0));
    if (!storeId || !name) return res.status(400).json({ error: 'المتجر واسم المنتج مطلوبان' });
    const image = req.file ? /uploads/${req.file.filename} : '';

    if (mode === 'better-sqlite3') {
      const info = betterDb
        .prepare('INSERT INTO products (store_id, name, price, carton_qty, stock, image) VALUES (?, ?, ?, ?, ?, ?)')
        .run(storeId, name, price, cartonQty, stock, image);
      return res.status(201).json(betterDb.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
    }
    if (mode === 'sqlite3') {
      const info = await runSqlite3(
        'INSERT INTO products (store_id, name, price, carton_qty, stock, image) VALUES (?, ?, ?, ?, ?, ?)',
        [storeId, name, price, cartonQty, stock, image]
      );
      return res.status(201).json(await getSqlite3('SELECT * FROM products WHERE id = ?', [info.lastID]));
    }
    const dbJson = readJsonStore();
    const created = {
      id: dbJson.nextId++,
      store_id: storeId,
      name,
      price,
      carton_qty: cartonQty,
      stock,
      image,
      created_at: new Date().toISOString()
    };
    dbJson.products.push(created);
    writeJsonStore(dbJson);
    return res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', upload.single('image'), async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (mode === 'better-sqlite3') {
      const existing = betterDb.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });
      const storeId = Number((req.body && req.body.store_id) || existing.store_id);
      const name = String((req.body && req.body.name) || existing.name).trim();
      const price = req.body && req.body.price !== '' && typeof req.body.price !== 'undefined' ? Number(req.body.price) : existing.price;
      const cartonQty = req.body && req.body.carton_qty !== '' && typeof req.body.carton_qty !== 'undefined' ? Math.max(1, Number(req.body.carton_qty)) : (existing.carton_qty || 1);
      const stock = req.body && req.body.stock !== '' && typeof req.body.stock !== 'undefined' ? Math.max(0, Number(req.body.stock)) : (existing.stock || 0);
      const image = req.file ? /uploads/${req.file.filename} : (existing.image || '');
      betterDb.prepare('UPDATE products SET store_id = ?, name = ?, price = ?, carton_qty = ?, stock = ?, image = ? WHERE id = ?').run(storeId, name, price, cartonQty, stock, image, id);
      return res.json(betterDb.prepare('SELECT * FROM products WHERE id = ?').get(id));
    }
    if (mode === 'sqlite3') {
      const existing = await getSqlite3('SELECT * FROM products WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'المنتج غير موجود' });
      const storeId = Number((req.body && req.body.store_id) || existing.store_id);
      const name = String((req.body && req.body.name) || existing.name).trim();
      const price = req.body && req.body.price !== '' && typeof req.body.price !== 'undefined' ? Number(req.body.price) : existing.price;
      const cartonQty = req.body && req.body.carton_qty !== '' && typeof req.body.carton_qty !== 'undefined' ? Math.max(1, Number(req.body.carton_qty)) : (existing.carton_qty || 1);
      const stock = req.body && req.body.stock !== '' && typeof req.body.stock !== 'undefined' ? Math.max(0, Number(req.body.stock)) : (existing.stock || 0);
      const image = req.file ? /uploads/${req.file.filename} : (existing.image || '');
      await runSqlite3('UPDATE products SET store_id = ?, name = ?, price = ?, carton_qty = ?, stock = ?, image = ? WHERE id = ?', [storeId, name, price, cartonQty, stock, image, id]);
      return res.json(await getSqlite3('SELECT * FROM products WHERE id = ?', [id]));
    }
    const dbJson = readJsonStore();
    const idx = dbJson.products.findIndex((p) => Number(p.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'المنتج غير موجود' });
    const existing = dbJson.products[idx];
    if (req.body && req.body.store_id) existing.store_id = Number(req.body.store_id);
    if (req.body && req.body.name) existing.name = String(req.body.name).trim();
    if (req.body && req.body.price !== '') existing.price = Number(req.body.price);
    if (req.body && req.body.carton_qty !== '') existing.carton_qty = Math.max(1, Number(req.body.carton_qty));
    if (req.body && req.body.stock !== '') existing.stock = Math.max(0, Number(req.body.stock));
    if (req.file) existing.image = /uploads/${req.file.filename};
    writeJsonStore(dbJson);
    return res.json(existing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (mode === 'better-sqlite3') {
      const info = betterDb.prepare('DELETE FROM products WHERE id = ?').run(id);
      return res.json({ deleted: info.changes > 0 });
    }
    if (mode === 'sqlite3') {
      const info = await runSqlite3('DELETE FROM products WHERE id = ?', [id]);
      return res.json({ deleted: info.changes > 0 });
    }
    const dbJson = readJsonStore();
    const before = dbJson.products.length;
    dbJson.products = dbJson.products.filter((p) => Number(p.id) !== id);
    writeJsonStore(dbJson);
    return res.json({ deleted: dbJson.products.length < before });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// الطلبيات
app.get('/api/orders', async function (req, res) {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    if (mode === 'better-sqlite3') {
      const rows = status
        ? betterDb.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC').all(status)
        : betterDb.prepare('SELECT * FROM orders ORDER BY id DESC').all();
      return res.json(rows);
    }
    if (mode === 'sqlite3') {
      const rows = status
        ? await allSqlite3('SELECT * FROM orders WHERE status = ? ORDER BY id DESC', [status])
        : await allSqlite3('SELECT * FROM orders ORDER BY id DESC');
      return res.json(rows);
    }
    const dbJson = readJsonStore();
    const list = status ? dbJson.orders.filter((o) => o.status === status) : dbJson.orders;
    return res.json([...list].sort((a, b) => b.id - a.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async function (req, res) {
  try {
    const customerName = String((req.body && req.body.customer_name) || '').trim();
    const phone = String((req.body && req.body.phone) || '').trim();
    const location = String((req.body && (req.body.location || req.body.wilaya)) || '').trim();
    const wilaya = String((req.body && (req.body.wilaya || req.body.location)) || '').trim();
    const rawItems = req.body && req.body.items ? req.body.items : [];
    const itemsJson = typeof rawItems === 'string' ? rawItems : JSON.stringify(rawItems);
    const total = Number((req.body && req.body.total) || 0);
    if (!customerName || !phone) return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبان' });

    if (mode === 'better-sqlite3') {
      const info = betterDb
        .prepare('INSERT INTO orders (customer_name, phone, location, wilaya, items_json, total, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(customerName, phone, location, wilaya, itemsJson, total, 'pending');
      return res.status(201).json(betterDb.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid));
    }
    if (mode === 'sqlite3') {
      const info = await runSqlite3(
        'INSERT INTO orders (customer_name, phone, location, wilaya, items_json, total, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [customerName, phone, location, wilaya, itemsJson, total, 'pending']
      );
      return res.status(201).json(await getSqlite3('SELECT * FROM orders WHERE id = ?', [info.lastID]));
    }
    const dbJson = readJsonStore();
    const created = {
      id: dbJson.nextId++,
      customer_name: customerName,
      phone,
      location,
      wilaya,
      items_json: itemsJson,
      total,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    dbJson.orders.push(created);
    writeJsonStore(dbJson);
    return res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/orders/:id/confirm', async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (mode === 'better-sqlite3') {
      const existing = betterDb.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'الطلبية غير موجودة' });
      if (existing.status !== 'confirmed') {
        const items = JSON.parse(existing.items_json || '[]');
        for (const item of items) {
          const prodId = Number(item.product_id || item.id);
          const qty = Number(item.qty || 1);
          if (prodId && qty > 0) {
            betterDb.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?').run(qty, prodId);
          }
        }
        betterDb.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").run(id);
      }
      return res.json(betterDb.prepare('SELECT * FROM orders WHERE id = ?').get(id));
    }
    if (mode === 'sqlite3') {
      const existing = await getSqlite3('SELECT * FROM orders WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'الطلبية غير موجودة' });
      if (existing.status !== 'confirmed') {
        const items = JSON.parse(existing.items_json || '[]');
        for (const item of items) {
          const prodId = Number(item.product_id || item.id);
          const qty = Number(item.qty || 1);
          if (prodId && qty > 0) {
            await runSqlite3('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?', [qty, prodId]);
          }
        }
        await runSqlite3("UPDATE orders SET status = 'confirmed' WHERE id = ?", [id]);
      }
      return res.json(await getSqlite3('SELECT * FROM orders WHERE id = ?', [id]));
    }
    const dbJson = readJsonStore();
    const order = dbJson.orders.find((o) => Number(o.id) === id);
    if (!order) return res.status(404).json({ error: 'الطلبية غير موجودة' });
    if (order.status !== 'confirmed') {
      const items = JSON.parse(order.items_json || '[]');
      for (const item of items) {
        const prodId = Number(item.product_id || item.id);
        const qty = Number(item.qty || 1);
        const prod = dbJson.products.find((p) => Number(p.id) === prodId);
        if (prod && qty > 0) prod.stock = Math.max(0, (prod.stock || 0) - qty);
      }
      order.status = 'confirmed';
      writeJsonStore(dbJson);
    }
    return res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// طلبات المنتجات الخاصة
app.get('/api/custom-requests', async function (req, res) {
  try {
    if (mode === 'better-sqlite3') {
      return res.json(betterDb.prepare('SELECT * FROM custom_requests ORDER BY id DESC').all());
    }
    if (mode === 'sqlite3') {
      return res.json(await allSqlite3('SELECT * FROM custom_requests ORDER BY id DESC'));
    }
    const dbJson = readJsonStore();
    return res.json([...dbJson.custom_requests].sort((a, b) => b.id - a.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/custom-requests', upload.single('image'), async function (req, res) {
  try {
    const customerName = String((req.body && req.body.customer_name) || '').trim();
    const phone = String((req.body && req.body.phone) || '').trim();
    const notes = String((req.body && req.body.notes) || '').trim();
    const image = req.file ? /uploads/${req.file.filename} : '';
    if (!customerName || !phone) return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبان' });

    if (mode === 'better-sqlite3') {
      const info = betterDb
        .prepare('INSERT INTO custom_requests (customer_name, phone, notes, image) VALUES (?, ?, ?, ?)')
        .run(customerName, phone, notes, image);
      return res.status(201).json(betterDb.prepare('SELECT * FROM custom_requests WHERE id = ?').get(info.lastInsertRowid));
    }
    if (mode === 'sqlite3') {
      const info = await runSqlite3(
        'INSERT INTO custom_requests (customer_name, phone, notes, image) VALUES (?, ?, ?, ?)',
        [customerName, phone, notes, image]
      );
      return res.status(201).json(await getSqlite3('SELECT * FROM custom_requests WHERE id = ?', [info.lastID]));
    }
    const dbJson = readJsonStore();
    const created = {
      id: dbJson.nextId++,
      customer_name: customerName,
      phone,
      notes,
      image,
      created_at: new Date().toISOString()
    };
    dbJson.custom_requests.push(created);
    writeJsonStore(dbJson);
    return res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/custom-requests/:id', async function (req, res) {
  try {
    const id = Number(req.params.id);
    if (mode === 'better-sqlite3') {
      const info = betterDb.prepare('DELETE FROM custom_requests WHERE id = ?').run(id);
      return res.json({ deleted: info.changes > 0 });
    }
    if (mode === 'sqlite3') {
      const info = await runSqlite3('DELETE FROM custom_requests WHERE id = ?', [id]);
      return res.json({ deleted: info.changes > 0 });
    }
    const dbJson = readJsonStore();
    const before = dbJson.custom_requests.length;
    dbJson.custom_requests = dbJson.custom_requests.filter((r) => Number(r.id) !== id);
    writeJsonStore(dbJson);
    return res.json({ deleted: dbJson.custom_requests.length < before });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(function (err, req, res, next) {
  if (err) {
    return res.status(400).json({ error: err.message || 'خطأ في معالجة الطلب' });
  }
  next();
});

async function startServer() {
  if (mode === 'sqlite3') {
    await initSqlite3Tables();
  }
  app.listen(PORT, '0.0.0.0', function () {
    console.log(${BOOT_VERSION} (${mode}) running on port ${PORT});
  });
}

startServer();

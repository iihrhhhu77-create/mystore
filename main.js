const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const BOOT_VERSION = 'BOOT_VERSION_2026_V14';

const baseDir = __dirname;
const publicDir = path.join(baseDir, 'public');
const uploadsDir = path.join(publicDir, 'uploads');

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const dbPath = process.env.SQLITE_PATH || path.join(baseDir, 'data.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
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

function ensureColumn(table, column, definition) {
  const cols = db.prepare(PRAGMA table_info(${table})).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(ALTER TABLE ${table} ADD COLUMN ${column} ${definition});
  }
}

ensureColumn('stores', 'slug', 'TEXT');
ensureColumn('stores', 'description', "TEXT DEFAULT ''");
ensureColumn('stores', 'image', "TEXT DEFAULT ''");
ensureColumn('products', 'carton_qty', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('products', 'stock', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('products', 'image', "TEXT DEFAULT ''");
ensureColumn('orders', 'location', "TEXT DEFAULT ''");
ensureColumn('orders', 'wilaya', "TEXT DEFAULT ''");
ensureColumn('orders', 'status', "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('custom_requests', 'image', "TEXT DEFAULT ''");

function makeSlug(name) {
  const base =
    String(name || 'store')
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
    public_dir: publicDir,
    public_files: publicFiles,
    admin_exists: fs.existsSync(path.join(publicDir, 'admin.html'))
  });
});

// المتاجر
app.get('/api/stores', function (req, res) {
  try {
    const rows = db.prepare('SELECT * FROM stores ORDER BY id DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stores', upload.single('image'), function (req, res) {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    const description = String((req.body && req.body.description) || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'اسم المتجر مطلوب' });
    }
    const image = req.file ? /uploads/${req.file.filename} : '';
    const slug = makeSlug(name);

    const info = db
      .prepare('INSERT INTO stores (name, slug, description, image) VALUES (?, ?, ?, ?)')
      .run(name, slug, description, image);

    const created = db.prepare('SELECT * FROM stores WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/stores/:id', upload.single('image'), function (req, res) {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'المتجر غير موجود' });
    }

    const name = String((req.body && req.body.name) || existing.name).trim();
    const description =
      req.body && typeof req.body.description !== 'undefined'
        ? String(req.body.description).trim()
        : existing.description || '';
    const image = req.file ? /uploads/${req.file.filename} : existing.image || '';

    db.prepare('UPDATE stores SET name = ?, description = ?, image = ? WHERE id = ?').run(
      name,
      description,
      image,
      id
    );

    const updated = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/stores/:id', function (req, res) {
  try {
    const id = Number(req.params.id);
    const info = db.prepare('DELETE FROM stores WHERE id = ?').run(id);
    res.json({ deleted: info.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// المنتجات
app.get('/api/products', function (req, res) {
  try {
    const storeId = req.query.store_id ? Number(req.query.store_id) : null;
    if (storeId) {
      const rows = db
        .prepare('SELECT * FROM products WHERE store_id = ? ORDER BY id DESC')
        .all(storeId);
      return res.json(rows);
    }
    const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', upload.single('image'), function (req, res) {
  try {
    const storeId = Number(req.body && req.body.store_id);
    const name = String((req.body && req.body.name) || '').trim();
    const price = Number((req.body && req.body.price) || 0);
    const cartonQty = Math.max(1, Number((req.body && req.body.carton_qty) || 1));
    const stock = Math.max(0, Number((req.body && req.body.stock) || 0));

    if (!storeId || !name) {
      return res.status(400).json({ error: 'المتجر واسم المنتج مطلوبان' });
    }

    const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(storeId);
    if (!store) {
      return res.status(400).json({ error: 'المتجر المحدد غير موجود' });
    }

    const image = req.file ? /uploads/${req.file.filename} : '';
    const info = db
      .prepare(
        'INSERT INTO products (store_id, name, price, carton_qty, stock, image) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(storeId, name, price, cartonQty, stock, image);

    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', upload.single('image'), function (req, res) {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'المنتج غير موجود' });
    }

    const storeId = Number((req.body && req.body.store_id) || existing.store_id);
    const name = String((req.body && req.body.name) || existing.name).trim();
    const price =
      req.body && typeof req.body.price !== 'undefined' && req.body.price !== ''
        ? Number(req.body.price)
        : existing.price;
    const cartonQty =
      req.body && typeof req.body.carton_qty !== 'undefined' && req.body.carton_qty !== ''
        ? Math.max(1, Number(req.body.carton_qty))
        : existing.carton_qty || 1;
    const stock =
      req.body && typeof req.body.stock !== 'undefined' && req.body.stock !== ''
        ? Math.max(0, Number(req.body.stock))
        : existing.stock || 0;
    const image = req.file ? /uploads/${req.file.filename} : existing.image || '';

    db.prepare(
      'UPDATE products SET store_id = ?, name = ?, price = ?, carton_qty = ?, stock = ?, image = ? WHERE id = ?'
    ).run(storeId, name, price, cartonQty, stock, image, id);

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', function (req, res) {
  try {
    const id = Number(req.params.id);
    const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ deleted: info.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// الطلبيات
app.get('/api/orders', function (req, res) {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    if (status) {
      const rows = db
        .prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC')
        .all(status);
      return res.json(rows);
    }
    const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', function (req, res) {
  try {
    const customerName = String((req.body && req.body.customer_name) || '').trim();
    const phone = String((req.body && req.body.phone) || '').trim();
    const location = String((req.body && (req.body.location || req.body.wilaya)) || '').trim();
    const wilaya = String((req.body && (req.body.wilaya || req.body.location)) || '').trim();
    const rawItems = req.body && req.body.items ? req.body.items : [];
    const itemsJson = typeof rawItems === 'string' ? rawItems : JSON.stringify(rawItems);
    const total = Number((req.body && req.body.total) || 0);

    if (!customerName || !phone) {
      return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبان' });
    }

    const info = db
      .prepare(
        'INSERT INTO orders (customer_name, phone, location, wilaya, items_json, total, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(customerName, phone, location, wilaya, itemsJson, total, 'pending');

    const created = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/orders/:id/confirm', function (req, res) {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'الطلبية غير موجودة' });
    }

    if (existing.status !== 'confirmed') {
      let items = [];
      try {
        items = JSON.parse(existing.items_json || '[]');
      } catch (e) {
        items = [];
      }

      const deductStmt = db.prepare(
        'UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?'
      );
      for (const item of items) {
        const prodId = Number(item.product_id || item.id);
        const qty = Number(item.qty || 1);
        if (prodId && qty > 0) {
          deductStmt.run(qty, prodId);
        }
      }

      db.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").run(id);
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// طلبات المنتجات الخاصة
app.get('/api/custom-requests', function (req, res) {
  try {
    const rows = db.prepare('SELECT * FROM custom_requests ORDER BY id DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/custom-requests', upload.single('image'), function (req, res) {
  try {
    const customerName = String((req.body && req.body.customer_name) || '').trim();
    const phone = String((req.body && req.body.phone) || '').trim();
    const notes = String((req.body && req.body.notes) || '').trim();
    const image = req.file ? /uploads/${req.file.filename} : '';

    if (!customerName || !phone) {
      return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبان' });
    }

    const info = db
      .prepare('INSERT INTO custom_requests (customer_name, phone, notes, image) VALUES (?, ?, ?, ?)')
      .run(customerName, phone, notes, image);

    const created = db.prepare('SELECT * FROM custom_requests WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/custom-requests/:id', function (req, res) {
  try {
    const id = Number(req.params.id);
    const info = db.prepare('DELETE FROM custom_requests WHERE id = ?').run(id);
    res.json({ deleted: info.changes > 0 });
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

app.listen(PORT, '0.0.0.0', function () {
  console.log(${BOOT_VERSION} running on port ${PORT});
  console.log('Connected to SQLite database.');
});

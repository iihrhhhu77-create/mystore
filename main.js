console.log('BOOT_VERSION_2026_V10');

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

const baseDir = __dirname;
const publicDir = path.join(baseDir, 'public');

try {
  fs.mkdirSync(publicDir, { recursive: true });
} catch (e) {}

app.use(express.static(publicDir));

const uploadsDir = path.join(publicDir, 'uploads');
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch (e) {}
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const randomPart = Math.floor(Math.random() * 1000000000);
    const ext = path.extname(file.originalname || '') || '.jpg';
    cb(null, Date.now() + '-' + randomPart + ext);
  }
});

const upload = multer({ storage: storage });

const dbPath = path.join(baseDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, function (err) {
  if (err) {
    console.error('SQLite connection error:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

db.serialize(function () {
  db.run(
    'CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, min_order INTEGER DEFAULT 0, image TEXT)'
  );
  db.run('ALTER TABLE stores ADD COLUMN image TEXT', function () {});

  db.run(
    'CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, name TEXT NOT NULL, price REAL NOT NULL, carton_qty INTEGER DEFAULT 1, image TEXT, stock INTEGER DEFAULT 0, FOREIGN KEY (store_id) REFERENCES stores(id))'
  );

  db.run(
    'CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, phone TEXT NOT NULL, location TEXT, wilaya TEXT, items_json TEXT NOT NULL, total REAL NOT NULL, status TEXT DEFAULT "pending", created_at DATETIME DEFAULT CURRENT_TIMESTAMP)'
  );
  db.run('ALTER TABLE orders ADD COLUMN location TEXT', function () {});

  db.run(
    'CREATE TABLE IF NOT EXISTS custom_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT, image TEXT, status TEXT DEFAULT "new", created_at DATETIME DEFAULT CURRENT_TIMESTAMP)'
  );
});

function findPageFileRecursive(startDir, basePageName, depth) {
  if (depth > 3) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(startDir, { withFileTypes: true });
  } catch (e) {
    return null;
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(startDir, entry.name);
    const lower = entry.name.toLowerCase();
    const targetLower = basePageName.toLowerCase();

    if (entry.isFile() && (lower === targetLower || lower.startsWith(targetLower + '.'))) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findPageFileRecursive(fullPath, basePageName, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function listAllFiles(startDir, depth) {
  if (depth > 2) return [];
  let result = [];
  let entries = [];
  try {
    entries = fs.readdirSync(startDir, { withFileTypes: true });
  } catch (e) {
    return [];
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(startDir, entry.name);
    result.push(fullPath.replace(baseDir, ''));
    if (entry.isDirectory()) {
      result = result.concat(listAllFiles(fullPath, depth + 1));
    }
  }
  return result;
}

app.get('/', function (req, res) {
  const foundPath = findPageFileRecursive(baseDir, 'index.html', 0);
  if (foundPath) {
    try {
      const html = fs.readFileSync(foundPath, 'utf8');
      return res.status(200).type('html').send(html);
    } catch (err) {
      return res.status(500).send('Read error at ' + foundPath + ': ' + err.message);
    }
  }
  return res.status(404).type('text').send('index.html not found');
});

app.get('/admin.html', function (req, res) {
  const foundPath = findPageFileRecursive(baseDir, 'admin.html', 0);
  if (foundPath) {
    try {
      const html = fs.readFileSync(foundPath, 'utf8');
      return res.status(200).type('html').send(html);
    } catch (err) {
      return res.status(500).send('Read error at ' + foundPath + ': ' + err.message);
    }
  }
  return res.status(404).send('admin.html not found');
});

app.get('/api/health', function (req, res) {
  res.json({ ok: true, baseDir: baseDir, files: listAllFiles(baseDir, 0) });
});

// ================= المتاجر =================
app.get('/api/stores', function (req, res) {
  db.all('SELECT * FROM stores ORDER BY id DESC', [], function (err, rows) {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/stores', upload.single('image'), function (req, res) {
  const body = req.body || {};
  const name = (body.name || body.store_name || body.title || '').trim();
  const description = body.description || '';
  const minOrder = Number(body.min_order) || 0;
  const rawSlug = (body.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const slug = (rawSlug || 'store') + '-' + Date.now();
  const imagePath = req.file ? '/uploads/' + req.file.filename : body.image || '';

  if (!name) {
    return res.status(400).json({ error: 'اسم المتجر مطلوب' });
  }

  db.run(
    'INSERT INTO stores (name, slug, description, min_order, image) VALUES (?, ?, ?, ?, ?)',
    [name, slug, description, minOrder, imagePath],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({
        id: this.lastID,
        name: name,
        slug: slug,
        description: description,
        min_order: minOrder,
        image: imagePath
      });
    }
  );
});

app.put('/api/stores/:id', upload.single('image'), function (req, res) {
  const id = Number(req.params.id);
  const body = req.body || {};

  db.get('SELECT * FROM stores WHERE id = ?', [id], function (err, store) {
    if (err) return res.status(500).json({ error: err.message });
    if (!store) return res.status(404).json({ error: 'المتجر غير موجود' });

    const name = (body.name || store.name).trim();
    const description = body.description !== undefined ? body.description : store.description;
    const minOrder = body.min_order !== undefined ? Number(body.min_order) || 0 : store.min_order;
    const imagePath = req.file ? '/uploads/' + req.file.filename : (body.image !== undefined ? body.image : store.image);

    db.run(
      'UPDATE stores SET name = ?, description = ?, min_order = ?, image = ? WHERE id = ?',
      [name, description, minOrder, imagePath, id],
      function (updateErr) {
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        res.json({ id: id, name: name, description: description, min_order: minOrder, image: imagePath });
      }
    );
  });
});

app.delete('/api/stores/:id', function (req, res) {
  const id = Number(req.params.id);
  db.serialize(function () {
    db.run('DELETE FROM products WHERE store_id = ?', [id], function () {});
    db.run('DELETE FROM stores WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ deleted: true, id: id });
    });
  });
});

// ================= المنتجات =================
app.get('/api/products', function (req, res) {
  const storeId = req.query.store_id;
  const q = req.query.q;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];

  if (storeId) {
    sql += ' AND store_id = ?';
    params.push(Number(storeId));
  }
  if (q) {
    sql += ' AND name LIKE ?';
    params.push('%' + q + '%');
  }
  sql += ' ORDER BY id DESC';

  db.all(sql, params, function (err, rows) {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/products', upload.single('image'), function (req, res) {
  const body = req.body || {};
  const storeId = Number(body.store_id);
  const name = (body.name || '').trim();
  const price = Number(body.price);
  const cartonQty = Number(body.carton_qty) || 1;
  const stock = Number(body.stock) || 0;

  if (!storeId || !name || isNaN(price)) {
    return res.status(400).json({ error: 'المتجر واسم المنتج والسعر مطلوبة' });
  }

  const imagePath = req.file ? '/uploads/' + req.file.filename : body.image || '';

  db.run(
    'INSERT INTO products (store_id, name, price, carton_qty, image, stock) VALUES (?, ?, ?, ?, ?, ?)',
    [storeId, name, price, cartonQty, imagePath, stock],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({
        id: this.lastID,
        store_id: storeId,
        name: name,
        price: price,
        carton_qty: cartonQty,
        image: imagePath,
        stock: stock
      });
    }
  );
});

app.put('/api/products/:id', upload.single('image'), function (req, res) {
  const id = Number(req.params.id);
  const body = req.body || {};

  db.get('SELECT * FROM products WHERE id = ?', [id], function (err, prod) {
    if (err) return res.status(500).json({ error: err.message });
    if (!prod) return res.status(404).json({ error: 'المنتج غير موجود' });

    const storeId = body.store_id ? Number(body.store_id) : prod.store_id;
    const name = (body.name || prod.name).trim();
    const price = body.price !== undefined && body.price !== '' ? Number(body.price) : prod.price;
    const cartonQty = body.carton_qty !== undefined && body.carton_qty !== '' ? (Number(body.carton_qty) || 1) : prod.carton_qty;
    const stock = body.stock !== undefined && body.stock !== '' ? (Number(body.stock) || 0) : prod.stock;
    const imagePath = req.file ? '/uploads/' + req.file.filename : (body.image !== undefined ? body.image : prod.image);

    db.run(
      'UPDATE products SET store_id = ?, name = ?, price = ?, carton_qty = ?, image = ?, stock = ? WHERE id = ?',
      [storeId, name, price, cartonQty, imagePath, stock, id],
      function (updateErr) {
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        res.json({ id: id, store_id: storeId, name: name, price: price, carton_qty: cartonQty, image: imagePath, stock: stock });
      }
    );
  });
});

app.delete('/api/products/:id', function (req, res) {
  const id = Number(req.params.id);
  db.run('DELETE FROM products WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: true, id: id });
  });
});

// ================= الطلبيات =================
app.post('/api/orders', function (req, res) {
  const body = req.body || {};
  const customerName = (body.customer_name || body.name || '').trim();
  const phone = (body.phone || '').trim();
  const location = (body.location || body.address || body.wilaya || '').trim();
  const items = body.items;
  const total = Number(body.total) || 0;

  if (!customerName || !phone || !items) {
    return res.status(400).json({ error: 'الاسم ورقم الهاتف والمنتجات مطلوبة' });
  }

  const itemsJson = typeof items === 'string' ? items : JSON.stringify(items);

  db.run(
    'INSERT INTO orders (customer_name, phone, location, wilaya, items_json, total, status) VALUES (?, ?, ?, ?, ?, ?, "pending")',
    [customerName, phone, location, location, itemsJson, total],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, status: 'pending', location: location });
    }
  );
});

app.get('/api/orders', function (req, res) {
  const status = req.query.status;
  let sql = 'SELECT * FROM orders';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY id DESC';

  db.all(sql, params, function (err, rows) {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.patch('/api/orders/:id/confirm', function (req, res) {
  const id = Number(req.params.id);
  db.run('UPDATE orders SET status = "confirmed" WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ confirmed: true, id: id });
  });
});

app.delete('/api/orders/:id', function (req, res) {
  const id = Number(req.params.id);
  db.run('DELETE FROM orders WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: true, id: id });
  });
});

// ================= طلبات المنتجات الخاصة =================
app.post('/api/custom-requests', upload.single('image'), function (req, res) {
  const body = req.body || {};
  const customerName = (body.customer_name || body.name || 'زبون').trim();
  const phone = (body.phone || '').trim();
  const notes = (body.notes || body.product_name || body.description || '').trim();

  if (!phone) {
    return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
  }

  const imagePath = req.file ? '/uploads/' + req.file.filename : body.image || '';

  db.run(
    'INSERT INTO custom_requests (customer_name, phone, notes, image, status) VALUES (?, ?, ?, ?, "new")',
    [customerName, phone, notes, imagePath],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, status: 'new', image: imagePath, notes: notes });
    }
  );
});

app.get('/api/custom-requests', function (req, res) {
  db.all('SELECT * FROM custom_requests ORDER BY id DESC', [], function (err, rows) {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.delete('/api/custom-requests/:id', function (req, res) {
  const id = Number(req.params.id);
  db.run('DELETE FROM custom_requests WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: true, id: id });
  });
});

app.listen(PORT, function () {
  console.log('Server running on port ' + PORT);
});

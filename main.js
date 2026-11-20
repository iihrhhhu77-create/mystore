const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const publicDir = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : __dirname;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));
if (publicDir !== __dirname) {
  app.use(express.static(__dirname));
}
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), function (err) {
  if (err) {
    console.error('خطأ في قاعدة البيانات:', err.message);
  } else {
    console.log('قاعدة البيانات جاهزة');
  }
});

db.serialize(function () {
  db.run(`CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    image TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT,
    is_carton INTEGER DEFAULT 0,
    step INTEGER DEFAULT 1,
    fixed_note TEXT,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    location TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS custom_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER,
    description TEXT NOT NULL,
    image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function resolvePageFile(fileName) {
  const inPublic = path.join(__dirname, 'public', fileName);
  if (fs.existsSync(inPublic)) {
    return inPublic;
  }
  const inRoot = path.join(__dirname, fileName);
  if (fs.existsSync(inRoot)) {
    return inRoot;
  }
  return null;
}

// الصفحات الرئيسية
app.get('/', function (req, res) {
  const indexFile = resolvePageFile('index.html');
  if (indexFile) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send('index.html not found');
  }
});

app.get('/admin.html', function (req, res) {
  const adminFile = resolvePageFile('admin.html');
  if (adminFile) {
    res.sendFile(adminFile);
  } else {
    res.status(404).send('admin.html not found');
  }
});

// المتاجر
app.get('/api/stores', function (req, res) {
  db.all('SELECT * FROM stores ORDER BY id DESC', [], function (err, rows) {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/stores', upload.single('image'), function (req, res) {
  const name = req.body.name;
  const image = req.file ? '/uploads/' + req.file.filename : null;
  db.run('INSERT INTO stores (name, image) VALUES (?, ?)', [name, image], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name: name, image: image });
  });
});

app.put('/api/stores/:id', upload.single('image'), function (req, res) {
  const id = req.params.id;
  const name = req.body.name;
  db.get('SELECT * FROM stores WHERE id = ?', [id], function (err, store) {
    if (err) return res.status(500).json({ error: err.message });
    if (!store) return res.status(404).json({ error: 'المتجر غير موجود' });
    const newImage = req.file ? '/uploads/' + req.file.filename : store.image;
    const newName = name || store.name;
    db.run('UPDATE stores SET name = ?, image = ? WHERE id = ?', [newName, newImage, id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: id, name: newName, image: newImage });
    });
  });
});

app.delete('/api/stores/:id', function (req, res) {
  db.run('DELETE FROM stores WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// المنتجات
app.get('/api/products', function (req, res) {
  const storeId = req.query.storeId;
  const q = req.query.q;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];

  if (storeId) {
    sql += ' AND store_id = ?';
    params.push(storeId);
  }
  if (q) {
    sql += ' AND name LIKE ?';
    params.push('%' + q + '%');
  }
  sql += ' ORDER BY id DESC';

  db.all(sql, params, function (err, rows) {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/products', upload.single('image'), function (req, res) {
  const store_id = req.body.store_id;
  const name = req.body.name;
  const price = req.body.price;
  const is_carton = req.body.is_carton;
  const step = req.body.step;
  const fixed_note = req.body.fixed_note;
  const image = req.file ? '/uploads/' + req.file.filename : null;

  const cartonFlag = (is_carton === '1' || is_carton === 'true' || is_carton === true) ? 1 : 0;
  const stepNum = cartonFlag ? Math.max(1, parseInt(step, 10) || 1) : 1;

  db.run(
    'INSERT INTO products (store_id, name, price, image, is_carton, step, fixed_note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [store_id, name, parseFloat(price), image, cartonFlag, stepNum, fixed_note],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        store_id: store_id,
        name: name,
        price: price,
        image: image,
        is_carton: cartonFlag,
        step: stepNum,
        fixed_note: fixed_note
      });
    }
  );
});

app.delete('/api/products/:id', function (req, res) {
  db.run('DELETE FROM products WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// الطلبيات
app.post('/api/orders', function (req, res) {
  const customer_name = req.body.customer_name;
  const phone = req.body.phone;
  const location = req.body.location;
  const items = req.body.items;
  const total = req.body.total;

  db.run(
    'INSERT INTO orders (customer_name, phone, location, items_json, total) VALUES (?, ?, ?, ?, ?)',
    [customer_name, phone, location, JSON.stringify(items), total],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, orderId: this.lastID });
    }
  );
});

app.get('/api/orders', function (req, res) {
  db.all('SELECT * FROM orders ORDER BY id DESC', [], function (err, rows) {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// طلب منتج غير موجود مع صورة
app.post('/api/custom-requests', upload.single('image'), function (req, res) {
  const store_id = req.body.store_id;
  const description = req.body.description;
  const image = req.file ? '/uploads/' + req.file.filename : null;

  db.run(
    'INSERT INTO custom_requests (store_id, description, image) VALUES (?, ?, ?)',
    [store_id || null, description, image],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.get('/api/custom-requests', function (req, res) {
  db.all('SELECT * FROM custom_requests ORDER BY id DESC', [], function (err, rows) {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.listen(PORT, function () {
  console.log('Server running on http://localhost:' + PORT);
});

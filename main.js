const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function findStaticDir() {
  const candidates = [
    path.join(__dirname, 'public'),
    path.join(process.cwd(), 'public'),
    path.join(__dirname, '..', 'public')
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return path.join(__dirname, 'public');
}

function findStaticFile(filename) {
  const candidates = [
    path.join(__dirname, 'public', filename),
    path.join(process.cwd(), 'public', filename),
    path.join(__dirname, filename),
    path.join(process.cwd(), filename),
    path.join(__dirname, '..', 'public', filename)
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

const publicDir = findStaticDir();
app.use(express.static(publicDir));

const uploadsDir = path.join(publicDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const randomPart = Math.floor(Math.random() * 1000000000);
    const ext = path.extname(file.originalname || '');
    cb(null, Date.now() + '-' + randomPart + ext);
  }
});

const upload = multer({ storage: storage });

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, function (err) {
  if (err) {
    console.error('SQLite connection error:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

db.serialize(function () {
  db.run(
    'CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, min_order INTEGER DEFAULT 0)'
  );

  db.run(
    'CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, name TEXT NOT NULL, price REAL NOT NULL, carton_qty INTEGER DEFAULT 1, image TEXT, stock INTEGER DEFAULT 0, FOREIGN KEY (store_id) REFERENCES stores(id))'
  );

  db.run(
    'CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, phone TEXT NOT NULL, wilaya TEXT, items_json TEXT NOT NULL, total REAL NOT NULL, status TEXT DEFAULT "pending", created_at DATETIME DEFAULT CURRENT_TIMESTAMP)'
  );

  db.run(
    'CREATE TABLE IF NOT EXISTS custom_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT, image TEXT, status TEXT DEFAULT "new", created_at DATETIME DEFAULT CURRENT_TIMESTAMP)'
  );
});

app.get('/', function (req, res) {
  const indexPath = findStaticFile('index.html');
  if (indexPath) {
    return res.sendFile(indexPath);
  }

  const rootFiles = fs.existsSync(process.cwd()) ? fs.readdirSync(process.cwd()) : [];
  const dirFiles = fs.existsSync(publicDir) ? fs.readdirSync(publicDir) : [];

  return res.status(404).send(
    'index.html not found\ncwd: ' +
      process.cwd() +
      '\n__dirname: ' +
      __dirname +
      '\npublicDir: ' +
      publicDir +
      '\nrootFiles: ' +
      JSON.stringify(rootFiles) +
      '\npublicFiles: ' +
      JSON.stringify(dirFiles)
  );
});

app.get('/admin.html', function (req, res) {
  const adminPath = findStaticFile('admin.html');
  if (adminPath) {
    return res.sendFile(adminPath);
  }
  return res.status(404).send('admin.html not found');
});

app.get('/api/health', function (req, res) {
  res.json({ ok: true, publicDir: publicDir, cwd: process.cwd(), dirname: __dirname });
});

app.get('/api/stores', function (req, res) {
  db.all('SELECT * FROM stores ORDER BY id DESC', [], function (err, rows) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/stores', function (req, res) {
  const name = req.body.name;
  const slug = req.body.slug;
  const description = req.body.description || '';
  const minOrder = Number(req.body.min_order) || 0;

  if (!name || !slug) {
    return res.status(400).json({ error: 'name and slug are required' });
  }

  db.run(
    'INSERT INTO stores (name, slug, description, min_order) VALUES (?, ?, ?, ?)',
    [name, slug, description, minOrder],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        id: this.lastID,
        name: name,
        slug: slug,
        description: description,
        min_order: minOrder
      });
    }
  );
});

app.get('/api/products', function (req, res) {
  const storeId = req.query.store_id;
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
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/products', upload.single('image'), function (req, res) {
  const storeId = req.body.store_id;
  const name = req.body.name;
  const price = req.body.price;
  const cartonQty = Number(req.body.carton_qty) || 1;
  const stock = Number(req.body.stock) || 0;

  if (!storeId || !name || price === undefined) {
    return res.status(400).json({ error: 'store_id, name, and price are required' });
  }

  const imagePath = req.file ? '/uploads/' + req.file.filename : req.body.image || '';

  db.run(
    'INSERT INTO products (store_id, name, price, carton_qty, image, stock) VALUES (?, ?, ?, ?, ?, ?)',
    [Number(storeId), name, Number(price), cartonQty, imagePath, stock],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        id: this.lastID,
        store_id: Number(storeId),
        name: name,
        price: Number(price),
        carton_qty: cartonQty,
        image: imagePath,
        stock: stock
      });
    }
  );
});

app.post('/api/orders', function (req, res) {
  const customerName = req.body.customer_name;
  const phone = req.body.phone;
  const wilaya = req.body.wilaya || '';
  const items = req.body.items;
  const total = Number(req.body.total) || 0;

  if (!customerName || !phone || !items) {
    return res.status(400).json({ error: 'customer_name, phone, and items are required' });
  }

  const itemsJson = typeof items === 'string' ? items : JSON.stringify(items);

  db.run(
    'INSERT INTO orders (customer_name, phone, wilaya, items_json, total) VALUES (?, ?, ?, ?, ?)',
    [customerName, phone, wilaya, itemsJson, total],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ id: this.lastID, status: 'pending' });
    }
  );
});

app.get('/api/orders', function (req, res) {
  db.all('SELECT * FROM orders ORDER BY id DESC', [], function (err, rows) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/custom-requests', upload.single('image'), function (req, res) {
  const customerName = req.body.customer_name;
  const phone = req.body.phone;
  const notes = req.body.notes || '';

  if (!customerName || !phone) {
    return res.status(400).json({ error: 'customer_name and phone are required' });
  }

  const imagePath = req.file ? '/uploads/' + req.file.filename : '';

  db.run(
    'INSERT INTO custom_requests (customer_name, phone, notes, image) VALUES (?, ?, ?, ?)',
    [customerName, phone, notes, imagePath],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ id: this.lastID, status: 'new', image: imagePath });
    }
  );
});

app.get('/api/custom-requests', function (req, res) {
  db.all('SELECT * FROM custom_requests ORDER BY id DESC', [], function (err, rows) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.listen(PORT, function () {
  console.log('Server running on port ' + PORT);
});

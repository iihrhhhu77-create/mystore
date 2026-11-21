const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BOOT_VERSION = 'BOOT_VERSION_2026_V16';

const baseDir = __dirname;
const publicDir = path.join(baseDir, 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const dbFile = path.join(baseDir, 'data.json');

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

function loadData() {
  if (!fs.existsSync(dbFile)) {
    const initial = { nextId: 1, stores: [], products: [], orders: [], custom_requests: [] };
    fs.writeFileSync(dbFile, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const d = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    return {
      nextId: d.nextId || 1,
      stores: Array.isArray(d.stores) ? d.stores : [],
      products: Array.isArray(d.products) ? d.products : [],
      orders: Array.isArray(d.orders) ? d.orders : [],
      custom_requests: Array.isArray(d.custom_requests) ? d.custom_requests : []
    };
  } catch (e) {
    return { nextId: 1, stores: [], products: [], orders: [], custom_requests: [] };
  }
}

function saveData(d) {
  fs.writeFileSync(dbFile, JSON.stringify(d, null, 2), 'utf8');
}

function makeSlug(name) {
  const base =
    String(name || 'store')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'store';
  return base + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on('data', function (chunk) {
      chunks.push(chunk);
    });
    req.on('end', function () {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function parseMultipart(buffer, contentType) {
  const fields = {};
  let uploadedFile = null;
  const match = /boundary=([^;]+)/i.exec(contentType || '');
  if (!match) {
    return { fields: fields, file: null };
  }
  const boundary = '--' + match[1].trim().replace(/^"|"$/g, '');
  const rawStr = buffer.toString('latin1');
  const parts = rawStr.split(boundary);

  for (let i = 1; i < parts.length; i++) {
    let part = parts[i];
    if (part === '--' || part === '--\r\n') continue;
    if (part.indexOf('\r\n') === 0) part = part.slice(2);
    if (part.slice(-2) === '\r\n') part = part.slice(0, -2);
    if (part.slice(-2) === '--') part = part.slice(0, -2);

    const sepIndex = part.indexOf('\r\n\r\n');
    if (sepIndex === -1) continue;

    const headerBlock = part.slice(0, sepIndex);
    let bodyStr = part.slice(sepIndex + 4);
    if (bodyStr.slice(-2) === '\r\n') bodyStr = bodyStr.slice(0, -2);

    const nameMatch = /name="([^"]+)"/i.exec(headerBlock);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];

    const fileMatch = /filename="([^"]*)"/i.exec(headerBlock);
    if (fileMatch && fileMatch[1]) {
      const origName = path.basename(fileMatch[1]);
      const ext = path.extname(origName).toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      const fileName = Date.now() + '-' + Math.round(Math.random() * 1e9) + safeExt;
      const fileBuf = Buffer.from(bodyStr, 'latin1');
      if (fileBuf.length > 0) {
        fs.writeFileSync(path.join(uploadsDir, fileName), fileBuf);
        uploadedFile = { filename: fileName, url: '/uploads/' + fileName };
      }
    } else {
      fields[fieldName] = Buffer.from(bodyStr, 'latin1').toString('utf8');
    }
  }

  return { fields: fields, file: uploadedFile };
}

async function parseRequestBody(req) {
  const buf = await readRawBody(req);
  const ct = String(req.headers['content-type'] || '');
  if (ct.indexOf('multipart/form-data') !== -1) {
    return parseMultipart(buf, ct);
  }
  const text = buf.toString('utf8').trim();
  if (!text) return { fields: {}, file: null };
  if (ct.indexOf('application/json') !== -1) {
    try {
      return { fields: JSON.parse(text), file: null };
    } catch (e) {
      return { fields: {}, file: null };
    }
  }
  const params = new URLSearchParams(text);
  const fields = {};
  params.forEach(function (v, k) {
    fields[k] = v;
  });
  return { fields: fields, file: null };
}

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  res.writeHead(200, { 'Content-Type': getContentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async function (req, res) {
  try {
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = reqUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (pathname === '/api/health' && method === 'GET') {
      let publicFiles = [];
      try {
        publicFiles = fs.readdirSync(publicDir);
      } catch (e) {
        publicFiles = [];
      }
      return sendJson(res, 200, {
        ok: true,
        boot_version: BOOT_VERSION,
        public_files: publicFiles,
        admin_exists: fs.existsSync(path.join(publicDir, 'admin.html'))
      });
    }

    // المتاجر
    if (pathname === '/api/stores' && method === 'GET') {
      const d = loadData();
      return sendJson(res, 200, [...d.stores].sort(function (a, b) { return b.id - a.id; }));
    }

    if (pathname === '/api/stores' && method === 'POST') {
      const parsed = await parseRequestBody(req);
      const name = String((parsed.fields && parsed.fields.name) || '').trim();
      const description = String((parsed.fields && parsed.fields.description) || '').trim();
      if (!name) {
        return sendJson(res, 400, { error: 'اسم المتجر مطلوب' });
      }
      const d = loadData();
      const created = {
        id: d.nextId++,
        name: name,
        slug: makeSlug(name),
        description: description,
        image: parsed.file ? parsed.file.url : '',
        created_at: new Date().toISOString()
      };
      d.stores.push(created);
      saveData(d);
      return sendJson(res, 201, created);
    }

    const storeMatch = /^\/api\/stores\/(\d+)$/.exec(pathname);
    if (storeMatch) {
      const id = Number(storeMatch[1]);
      if (method === 'PUT') {
        const parsed = await parseRequestBody(req);
        const d = loadData();
        const st = d.stores.find(function (x) { return Number(x.id) === id; });
        if (!st) return sendJson(res, 404, { error: 'المتجر غير موجود' });
        if (parsed.fields && parsed.fields.name) st.name = String(parsed.fields.name).trim();
        if (parsed.fields && typeof parsed.fields.description !== 'undefined') {
          st.description = String(parsed.fields.description).trim();
        }
        if (parsed.file) st.image = parsed.file.url;
        saveData(d);
        return sendJson(res, 200, st);
      }
      if (method === 'DELETE') {
        const d = loadData();
        const before = d.stores.length;
        d.stores = d.stores.filter(function (x) { return Number(x.id) !== id; });
        d.products = d.products.filter(function (p) { return Number(p.store_id) !== id; });
        saveData(d);
        return sendJson(res, 200, { deleted: d.stores.length < before });
      }
    }

    // المنتجات
    if (pathname === '/api/products' && method === 'GET') {
      const d = loadData();
      const storeIdParam = reqUrl.searchParams.get('store_id');
      const storeId = storeIdParam ? Number(storeIdParam) : null;
      const list = storeId
        ? d.products.filter(function (p) { return Number(p.store_id) === storeId; })
        : d.products;
      return sendJson(res, 200, [...list].sort(function (a, b) { return b.id - a.id; }));
    }

    if (pathname === '/api/products' && method === 'POST') {
      const parsed = await parseRequestBody(req);
      const f = parsed.fields || {};
      const storeId = Number(f.store_id);
      const name = String(f.name || '').trim();
      const price = Number(f.price || 0);
      const cartonQty = Math.max(1, Number(f.carton_qty || 1));
      const stock = Math.max(0, Number(f.stock || 0));
      if (!storeId || !name) {
        return sendJson(res, 400, { error: 'المتجر واسم المنتج مطلوبان' });
      }
      const d = loadData();
      const created = {
        id: d.nextId++,
        store_id: storeId,
        name: name,
        price: price,
        carton_qty: cartonQty,
        stock: stock,
        image: parsed.file ? parsed.file.url : '',
        created_at: new Date().toISOString()
      };
      d.products.push(created);
      saveData(d);
      return sendJson(res, 201, created);
    }

    const prodMatch = /^\/api\/products\/(\d+)$/.exec(pathname);
    if (prodMatch) {
      const id = Number(prodMatch[1]);
      if (method === 'PUT') {
        const parsed = await parseRequestBody(req);
        const f = parsed.fields || {};
        const d = loadData();
        const prod = d.products.find(function (x) { return Number(x.id) === id; });
        if (!prod) return sendJson(res, 404, { error: 'المنتج غير موجود' });
        if (f.store_id) prod.store_id = Number(f.store_id);
        if (f.name) prod.name = String(f.name).trim();
        if (typeof f.price !== 'undefined' && f.price !== '') prod.price = Number(f.price);
        if (typeof f.carton_qty !== 'undefined' && f.carton_qty !== '') {
          prod.carton_qty = Math.max(1, Number(f.carton_qty));
        }
        if (typeof f.stock !== 'undefined' && f.stock !== '') {
          prod.stock = Math.max(0, Number(f.stock));
        }
        if (parsed.file) prod.image = parsed.file.url;
        saveData(d);
        return sendJson(res, 200, prod);
      }
      if (method === 'DELETE') {
        const d = loadData();
        const before = d.products.length;
        d.products = d.products.filter(function (x) { return Number(x.id) !== id; });
        saveData(d);
        return sendJson(res, 200, { deleted: d.products.length < before });
      }
    }

    // الطلبيات
    if (pathname === '/api/orders' && method === 'GET') {
      const d = loadData();
      const status = reqUrl.searchParams.get('status');
      const list = status
        ? d.orders.filter(function (o) { return o.status === status; })
        : d.orders;
      return sendJson(res, 200, [...list].sort(function (a, b) { return b.id - a.id; }));
    }

    if (pathname === '/api/orders' && method === 'POST') {
      const parsed = await parseRequestBody(req);
      const f = parsed.fields || {};
      const customerName = String(f.customer_name || '').trim();
      const phone = String(f.phone || '').trim();
      const location = String(f.location || f.wilaya || '').trim();
      const wilaya = String(f.wilaya || f.location || '').trim();
      const itemsJson = typeof f.items === 'string' ? f.items : JSON.stringify(f.items || []);
      const total = Number(f.total || 0);
      if (!customerName || !phone) {
        return sendJson(res, 400, { error: 'الاسم ورقم الهاتف مطلوبان' });
      }
      const d = loadData();
      const created = {
        id: d.nextId++,
        customer_name: customerName,
        phone: phone,
        location: location,
        wilaya: wilaya,
        items_json: itemsJson,
        total: total,
        status: 'pending',
        created_at: new Date().toISOString()
      };
      d.orders.push(created);
      saveData(d);
      return sendJson(res, 201, created);
    }

    const confirmMatch = /^\/api\/orders\/(\d+)\/confirm$/.exec(pathname);
    if (confirmMatch && method === 'PATCH') {
      const id = Number(confirmMatch[1]);
      const d = loadData();
      const order = d.orders.find(function (o) { return Number(o.id) === id; });
      if (!order) return sendJson(res, 404, { error: 'الطلبية غير موجودة' });
      if (order.status !== 'confirmed') {
        let items = [];
        try {
          items = JSON.parse(order.items_json || '[]');
        } catch (e) {
          items = [];
        }
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const prodId = Number(item.product_id || item.id);
          const qty = Number(item.qty || 1);
          const prod = d.products.find(function (p) { return Number(p.id) === prodId; });
          if (prod && qty > 0) {
            prod.stock = Math.max(0, Number(prod.stock || 0) - qty);
          }
        }
        order.status = 'confirmed';
        saveData(d);
      }
      return sendJson(res, 200, order);
    }

    // طلبات المنتجات الخاصة
    if (pathname === '/api/custom-requests' && method === 'GET') {
      const d = loadData();
      return sendJson(res, 200, [...d.custom_requests].sort(function (a, b) { return b.id - a.id; }));
    }

    if (pathname === '/api/custom-requests' && method === 'POST') {
      const parsed = await parseRequestBody(req);
      const f = parsed.fields || {};
      const customerName = String(f.customer_name || '').trim();
      const phone = String(f.phone || '').trim();
      const notes = String(f.notes || '').trim();
      if (!customerName || !phone) {
        return sendJson(res, 400, { error: 'الاسم ورقم الهاتف مطلوبان' });
      }
      const d = loadData();
      const created = {
        id: d.nextId++,
        customer_name: customerName,
        phone: phone,
        notes: notes,
        image: parsed.file ? parsed.file.url : '',
        created_at: new Date().toISOString()
      };
      d.custom_requests.push(created);
      saveData(d);
      return sendJson(res, 201, created);
    }

    const customMatch = /^\/api\/custom-requests\/(\d+)$/.exec(pathname);
    if (customMatch && method === 'DELETE') {
      const id = Number(customMatch[1]);
      const d = loadData();
      const before = d.custom_requests.length;
      d.custom_requests = d.custom_requests.filter(function (r) { return Number(r.id) !== id; });
      saveData(d);
      return sendJson(res, 200, { deleted: d.custom_requests.length < before });
    }

    // الملفات الثابتة والصفحات
    if (pathname === '/' || pathname === '/index.html') {
      if (serveStaticFile(res, path.join(publicDir, 'index.html'))) return;
    }

    if (pathname === '/admin.html') {
      if (serveStaticFile(res, path.join(publicDir, 'admin.html'))) return;
    }

    const safeRelPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const publicCandidate = path.join(publicDir, safeRelPath);
    if (publicCandidate.indexOf(publicDir) === 0 && serveStaticFile(res, publicCandidate)) {
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server Error' });
  }
});

server.listen(PORT, '0.0.0.0', function () {
  console.log(BOOT_VERSION + ' running on port ' + PORT);
});

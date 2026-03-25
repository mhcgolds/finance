const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

let mainWindow;

const DEFAULT_CATEGORY_COLORS = {
  'Food & Dining':    '#f97316',
  'Groceries':        '#84cc16',
  'Transportation':   '#06b6d4',
  'Fuel':             '#f59e0b',
  'Entertainment':    '#a855f7',
  'Shopping':         '#ec4899',
  'Health & Medical': '#10b981',
  'Utilities':        '#64748b',
  'Travel':           '#3b82f6',
  'Subscriptions':    '#8b5cf6',
  'Education':        '#0ea5e9',
  'Personal Care':    '#f43f5e',
  'Home':             '#78716c',
  'Insurance':        '#6366f1',
  'Other':            '#6b7280',
};

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      is_default BOOLEAN NOT NULL DEFAULT false
    )
  `);

  // Migrations for existing installs
  await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#6b7280'`);
  await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id SERIAL PRIMARY KEY,
      hash TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT DEFAULT ''
    )
  `);

  const { rows } = await pool.query('SELECT COUNT(*) FROM categories');
  if (parseInt(rows[0].count) === 0) {
    for (const [name, color] of Object.entries(DEFAULT_CATEGORY_COLORS)) {
      await pool.query(
        'INSERT INTO categories (name, color) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [name, color]
      );
    }
  } else {
    // Apply nice colors to any category still using the default gray (migration)
    for (const [name, color] of Object.entries(DEFAULT_CATEGORY_COLORS)) {
      await pool.query(
        "UPDATE categories SET color = $1 WHERE name = $2 AND color = '#6b7280'",
        [color, name]
      );
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function buildMenu() {
  const template = [
    {
      label: 'Management',
      submenu: [
        {
          label: 'Categories',
          click: () => mainWindow.webContents.send('menu-action', 'manage-categories')
        }
      ]
    },
    {
      label: 'Credit Card',
      submenu: [
        {
          label: 'Entries',
          click: () => mainWindow.webContents.send('menu-action', 'show-entries')
        },
        {
          label: 'Import CSV',
          click: () => mainWindow.webContents.send('menu-action', 'import-csv')
        },
        { type: 'separator' },
        {
          label: 'Monthly Summary',
          click: () => mainWindow.webContents.send('menu-action', 'monthly-summary')
        },
        {
          label: 'Monthly Graph',
          click: () => mainWindow.webContents.send('menu-action', 'monthly-graph')
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  await initDb();
  createWindow();
  buildMenu();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ──────────────────────────────────

ipcMain.handle('get-categories-full', async () => {
  const { rows } = await pool.query(
    'SELECT id, name, color, is_default FROM categories ORDER BY name'
  );
  return rows;
});

ipcMain.handle('update-category', async (_, { id, name, color, is_default }) => {
  const trimmed = name.trim();
  if (!trimmed) return { error: 'Category name cannot be empty' };

  try {
    if (is_default) {
      await pool.query('UPDATE categories SET is_default = false');
    }

    if (id) {
      const { rows } = await pool.query('SELECT name FROM categories WHERE id = $1', [id]);
      if (!rows.length) return { error: 'Category not found' };
      const oldName = rows[0].name;

      await pool.query(
        'UPDATE categories SET name = $1, color = $2, is_default = $3 WHERE id = $4',
        [trimmed, color, is_default, id]
      );

      if (oldName !== trimmed) {
        await pool.query('UPDATE entries SET category = $1 WHERE category = $2', [trimmed, oldName]);
      }
    } else {
      await pool.query(
        'INSERT INTO categories (name, color, is_default) VALUES ($1, $2, $3)',
        [trimmed, color, is_default]
      );
    }

    return { success: true };
  } catch {
    return { error: 'Category name already exists' };
  }
});

ipcMain.handle('delete-category', async (_, id) => {
  const { rows } = await pool.query('SELECT name FROM categories WHERE id = $1', [id]);
  if (!rows.length) return { error: 'Category not found' };
  const name = rows[0].name;

  await pool.query("UPDATE entries SET category = '' WHERE category = $1", [name]);
  await pool.query('DELETE FROM categories WHERE id = $1', [id]);
  return { success: true };
});

ipcMain.handle('get-entries', async (_, filters) => {
  const safeCols = ['date', 'description', 'amount', 'category'];
  const orderCol = safeCols.includes(filters.sortCol) ? filters.sortCol : 'date';
  const orderDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

  let sql = 'SELECT * FROM entries WHERE 1=1';
  const params = [];
  let idx = 1;

  if (filters.category)    { sql += ` AND category = $${idx++}`;              params.push(filters.category); }
  if (filters.dateFrom)    { sql += ` AND date >= $${idx++}`;                params.push(filters.dateFrom); }
  if (filters.dateTo)      { sql += ` AND date <= $${idx++}`;                params.push(filters.dateTo); }
  if (filters.description) { sql += ` AND description ILIKE $${idx++}`;      params.push(`%${filters.description}%`); }

  sql += ` ORDER BY ${orderCol} ${orderDir}`;
  const { rows } = await pool.query(sql, params);
  return rows;
});

ipcMain.handle('import-csv', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select CSV File',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { canceled: true };
  const content = fs.readFileSync(filePaths[0], 'utf-8');
  return { content };
});

ipcMain.handle('save-entries', async (_, rows) => {
  const { rows: defRows } = await pool.query(
    'SELECT name FROM categories WHERE is_default = true LIMIT 1'
  );
  const defaultCategory = defRows.length ? defRows[0].name : '';

  let imported = 0;
  let skipped = 0;

  for (const item of rows) {
    const raw = `${item.date}|${item.description}|${item.amount}`;
    const hash = crypto.createHash('md5').update(raw).digest('hex');
    const existing = await pool.query('SELECT 1 FROM entries WHERE hash = $1', [hash]);
    if (existing.rows.length) { skipped++; continue; }

    await pool.query(
      'INSERT INTO entries (hash, date, description, amount, category) VALUES ($1, $2, $3, $4, $5)',
      [hash, item.date, item.description, item.amount, item.category || defaultCategory]
    );
    imported++;
  }

  return { imported, skipped };
});

ipcMain.handle('save-categories', async (_, updates) => {
  for (const { hash, category } of updates) {
    await pool.query('UPDATE entries SET category = $1 WHERE hash = $2', [category, hash]);
  }
  return { success: true };
});

ipcMain.handle('get-entry-months', async () => {
  const { rows } = await pool.query(`
    SELECT DISTINCT SUBSTRING(date, 1, 7) AS month
    FROM entries
    WHERE date IS NOT NULL AND date <> ''
    ORDER BY month DESC
  `);
  return rows.map(r => r.month);
});

ipcMain.handle('get-monthly-summary', async () => {
  const { rows } = await pool.query(`
    SELECT
      SUBSTRING(e.date, 1, 4)  AS year,
      SUBSTRING(e.date, 6, 2)  AS month,
      e.category,
      COALESCE(c.color, '#6b7280') AS color,
      SUM(e.amount)            AS total
    FROM entries e
    LEFT JOIN categories c ON c.name = e.category
    WHERE e.date IS NOT NULL AND e.date <> ''
    GROUP BY
      SUBSTRING(e.date, 1, 4),
      SUBSTRING(e.date, 6, 2),
      e.category,
      c.color
    ORDER BY year DESC, month DESC, total DESC
  `);

  const months = [];
  const monthMap = new Map();

  for (const row of rows) {
    const key = `${row.year}-${row.month}`;
    if (!monthMap.has(key)) {
      const entry = { year: row.year, month: row.month, total: 0, categories: [] };
      monthMap.set(key, entry);
      months.push(entry);
    }
    const m = monthMap.get(key);
    const catTotal = parseFloat(row.total);
    m.total += catTotal;
    m.categories.push({ name: row.category || '', color: row.color, total: catTotal });
  }

  // Ensure descending sort within each month (query orders globally, this is a safeguard)
  months.forEach(m => m.categories.sort((a, b) => b.total - a.total));

  return months;
});

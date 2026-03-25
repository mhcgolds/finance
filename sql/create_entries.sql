CREATE TABLE IF NOT EXISTS entries (
    id          SERIAL PRIMARY KEY,
    hash        TEXT UNIQUE NOT NULL,
    date        TEXT NOT NULL,
    description TEXT NOT NULL,
    amount      REAL NOT NULL,
    category    TEXT DEFAULT ''
);

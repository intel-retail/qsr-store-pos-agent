const { Pool } = require('pg');

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

const groceryPool = new Pool({
  ...poolConfig,
  database: process.env.GROCERY_DB_NAME || process.env.DB_NAME || 'pos_grocery',
});

const cafePool = new Pool({
  ...poolConfig,
  database: process.env.CAFE_DB_NAME || 'pos_cafe',
});

groceryPool.on('error', (err) => {
  console.error('Unexpected error on grocery pool idle client', err);
});

cafePool.on('error', (err) => {
  console.error('Unexpected error on cafe pool idle client', err);
});

function getPool(experience) {
  return experience === 'cafe' ? cafePool : groceryPool;
}

module.exports = {
  query: (text, params, experience) => getPool(experience).query(text, params),
  getClient: (experience) => getPool(experience).connect(),
  getPool,
  groceryPool,
  cafePool,
};

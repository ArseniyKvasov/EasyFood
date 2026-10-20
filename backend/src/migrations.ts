import { pool } from './db.js';

type Migration = { id: string; sql: string };

const migrations: Migration[] = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE IF NOT EXISTS products (
        id          BIGSERIAL PRIMARY KEY,
        source      TEXT NOT NULL DEFAULT 'own',
        name        TEXT NOT NULL,
        kcal        NUMERIC(8,2) NOT NULL DEFAULT 0,
        protein     NUMERIC(8,2) NOT NULL DEFAULT 0,
        fat         NUMERIC(8,2) NOT NULL DEFAULT 0,
        carbs       NUMERIC(8,2) NOT NULL DEFAULT 0,
        serving_g   NUMERIC(8,2) NOT NULL DEFAULT 100,
        barcode     TEXT NOT NULL DEFAULT '',
        use_count   INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS products_name_idx ON products (lower(name));
      CREATE INDEX IF NOT EXISTS products_barcode_idx ON products (barcode);
      CREATE INDEX IF NOT EXISTS products_use_count_idx ON products (use_count DESC);

      CREATE TABLE IF NOT EXISTS entries (
        id          BIGSERIAL PRIMARY KEY,
        day         DATE NOT NULL,
        meal        TEXT NOT NULL,
        product_id  BIGINT REFERENCES products(id) ON DELETE SET NULL,
        name        TEXT NOT NULL,
        grams       NUMERIC(8,2) NOT NULL,
        kcal100     NUMERIC(8,2) NOT NULL DEFAULT 0,
        protein100  NUMERIC(8,2) NOT NULL DEFAULT 0,
        fat100      NUMERIC(8,2) NOT NULL DEFAULT 0,
        carbs100    NUMERIC(8,2) NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS entries_day_idx ON entries (day);
      CREATE INDEX IF NOT EXISTS entries_product_idx ON entries (product_id);

      CREATE TABLE IF NOT EXISTS settings (
        id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        kcal_target     INTEGER NOT NULL DEFAULT 2100,
        protein_target  INTEGER NOT NULL DEFAULT 95,
        fat_target      INTEGER NOT NULL DEFAULT 65,
        carbs_target    INTEGER NOT NULL DEFAULT 210,
        theme           TEXT NOT NULL DEFAULT 'auto',
        onboarded       BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;
    `,
  },
  {
    id: '002_seed_catalog',
    sql: `
      INSERT INTO products (source, name, kcal, protein, fat, carbs, serving_g, barcode, use_count)
      VALUES
        ('off', 'Овсяные хлопья', 370, 13, 7, 62, 40, '4600000000001', 0),
        ('off', 'Банан', 89, 1.1, 0.3, 23, 120, '', 0),
        ('off', 'Куриная грудка, варёная', 165, 31, 3.6, 0, 150, '', 0),
        ('off', 'Рис белый отварной', 130, 2.7, 0.3, 28, 180, '', 0),
        ('off', 'Творог 5%', 121, 17, 5, 3, 150, '4607000000005', 0),
        ('off', 'Кофе с молоком', 45, 3, 1.6, 4.5, 200, '', 0),
        ('off', 'Гречка варёная', 110, 4.2, 1.1, 21.3, 180, '', 0),
        ('off', 'Яйцо куриное', 155, 13, 11, 1.1, 55, '', 0),
        ('off', 'Яблоко', 52, 0.3, 0.2, 13.8, 180, '', 0),
        ('off', 'Молоко 2.5%', 54, 3, 2.5, 4.7, 200, '', 0),
        ('off', 'Хлеб ржаной', 210, 6.6, 1.2, 41, 40, '', 0),
        ('off', 'Салат огуречный', 15, 0.8, 0.2, 3.6, 150, '', 0)
      ON CONFLICT DO NOTHING;
    `,
  },
];

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ id: string }>('SELECT id FROM _migrations');
  const applied = new Set(rows.map((r) => r.id));

  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.sql);
      await client.query('INSERT INTO _migrations (id) VALUES ($1)', [m.id]);
      await client.query('COMMIT');
      console.log(`[db] applied migration ${m.id}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

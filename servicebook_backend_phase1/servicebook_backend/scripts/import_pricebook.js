/*
 * Price book import script
 *
 * This Node.js script reads the provided CSV file (all_services.csv) and
 * populates the pricebook_categories and pricebook_items tables in the
 * ServiceBook Pros database.  It assumes the CSV columns are:
 *
 *   Category1,Category2,Category4,Category5,Category6,Service Name,
 *   Description,Managed by,Task code,Price
 *
 * The script creates categories hierarchically based on Category4–6 and
 * inserts each service as a pricebook item.  The `labour_rate` field is
 * currently set to 0 and `parts_cost` is derived from the Price column.
 * Modify the logic as needed to map your pricing model.
 *
 * Usage:
 *   node scripts/import_pricebook.js path/to/all_services.csv
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Helper to parse a CSV line respecting quoted fields
function parseCSVLine(line) {
  const result = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // toggle inQuotes or escape double quotes
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  result.push(field);
  return result;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node import_pricebook.js path/to/all_services.csv');
    process.exit(1);
  }
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCSVLine(lines[0]);
  const idx = (name) => header.indexOf(name);
  const category4Idx = idx('Category4');
  const category5Idx = idx('Category5');
  const category6Idx = idx('Category6');
  const nameIdx = idx('Service Name');
  const descIdx = idx('Description');
  const priceIdx = idx('Price');

  // Connect to database
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // Cache to store category names -> IDs
  const categoryMap = new Map();

  async function getOrCreateCategory(name, parentId) {
    const key = parentId ? `${parentId}:${name}` : name;
    if (categoryMap.has(key)) {
      return categoryMap.get(key);
    }
    // Check if category exists in DB
    const res = await pool.query('SELECT id FROM pricebook_categories WHERE name = $1 AND parent_id IS NOT DISTINCT FROM $2', [name, parentId]);
    let id;
    if (res.rowCount > 0) {
      id = res.rows[0].id;
    } else {
      const insert = await pool.query('INSERT INTO pricebook_categories (name, parent_id) VALUES ($1,$2) RETURNING id', [name, parentId]);
      id = insert.rows[0].id;
      console.log(`Created category ${name} (id=${id}, parent=${parentId || 'null'})`);
    }
    categoryMap.set(key, id);
    return id;
  }

  try {
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      const cat4 = row[category4Idx];
      const cat5 = row[category5Idx];
      const cat6 = row[category6Idx];
      const serviceName = row[nameIdx];
      const description = row[descIdx];
      const priceStr = row[priceIdx].replace(/[^0-9.]/g, '');
      const priceVal = parseFloat(priceStr);
      // Build category hierarchy
      let parentId = null;
      let catId;
      if (cat4) {
        parentId = await getOrCreateCategory(cat4.trim(), null);
      }
      if (cat5) {
        parentId = await getOrCreateCategory(cat5.trim(), parentId);
      }
      if (cat6) {
        parentId = await getOrCreateCategory(cat6.trim(), parentId);
      }
      catId = parentId;
      // Insert item
      const itemRes = await pool.query(
        'INSERT INTO pricebook_items (category_id, name, description, labour_rate, parts_cost) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [catId, serviceName.trim(), description || null, 0, priceVal]
      );
      console.log(`Inserted item ${serviceName} (id=${itemRes.rows[0].id})`);
    }
    console.log('Import complete');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
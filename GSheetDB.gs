/*
  
  GSheetDB - DB-style CRUD for Google Sheets (Apps Script)

  Documentation: https://github.com/codewithmark/GSheetDB

  Website: https://codewithmark.com/

*/
class GSheetDB {
  constructor() {
    this.ss = null;
    this.sheetObj = null;
    this.a1Range = null;
    this.headers = [];
    this.data = [];
    this._raw = [];
    this._dirty = false;
    this._cacheSeconds = 0;
    this._cacheKey = null;
    this._autoGet = true; // << default: auto-get ON
  }

  // ==== Config / Setup ====
  connect(spreadsheetId = null) {
    this.ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId)
                            : SpreadsheetApp.getActiveSpreadsheet();
    return this;
  }

  sheet(name) {
    if (!this.ss) throw new Error('Call .connect() first.');
    this.sheetObj = this.ss.getSheetByName(name);
    if (!this.sheetObj) throw new Error(`Sheet "${name}" not found.`);
    return this;
  }

  range(a1) {
    if (!a1) { this.a1Range = null; return this; }
    let s = String(a1).trim();
    if (/^[A-Z]+:[A-Z]+$/i.test(s)) { // "A:Z" -> "A1:Z"
      const parts = s.split(':');
      s = `${parts[0].toUpperCase()}1:${parts[1].toUpperCase()}`;
    }
    this.a1Range = s;
    return this;
  }

  enableCache(seconds = 60) {
    this._cacheSeconds = Math.max(0, seconds | 0);
    return this;
  }

  clearCache() {
    if (!this._cacheKey) return this;
    try { CacheService.getScriptCache().remove(this._cacheKey); } catch (e) {}
    return this;
  }

  /** Turn auto-get on/off. When OFF, use chain style and call .get() */
  autoGet(on = true) { this._autoGet = !!on; return this; }

  /** Start an explicit chain (ignores autoGet for this entry point) */
  query(initialRows = null) {
    this._ensureLoaded();
    const seed = initialRows ? initialRows.slice() : this.data.slice();
    // Return a query object; its methods will obey this._autoGet internally
    return new GSheetDBQuery(this, seed);
  }

  // ==== NEW: Table-wide Select & OrderBy (auto-get aware) ====

  select(columns) {
    this._ensureLoaded();
    const cols = Array.isArray(columns) ? columns : [columns];
    const mapped = this.data.map(row => {
      const out = {};
      cols.forEach(k => { out[k] = row[k]; });
      return out;
    });
    return this._autoGet ? mapped : new GSheetDBQuery(this, mapped);
  }

  orderBy(field, direction = 'asc') {
    this._ensureLoaded();
    const dir = String(direction).toLowerCase() === 'desc' ? -1 : 1;
    const rows = this.data.slice();
    rows.sort((a, b) => {
      const va = a[field], vb = b[field];
      const isNilA = va === null || va === undefined || va === '';
      const isNilB = vb === null || vb === undefined || vb === '';
      if (isNilA && isNilB) return 0;
      if (isNilA) return 1;
      if (isNilB) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb);
      return dir * String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    });
    return this._autoGet ? rows : new GSheetDBQuery(this, rows);
  }

  /**
   * Join with another GSheetDB instance or data array
   * @param {GSheetDB|Array} other - Other database or array to join with
   * @param {Object} options - Join configuration
   * @param {string} options.leftKey - Key field in current dataset
   * @param {string} options.rightKey - Key field in other dataset
   * @param {string} options.how - Join type: 'inner', 'left', 'right'
   * @param {Object} options.select - Column selection {left: [...], right: [...]}
   * @returns {Array|GSheetDBQuery} Joined results
   */
  join(other, options = {}) {
    this._ensureLoaded();
    
    const {
      leftKey,
      rightKey,
      how = 'inner',
      select = {}
    } = options;

    if (!leftKey || !rightKey) {
      throw new Error('Both leftKey and rightKey are required for join');
    }

    // Get other dataset
    let otherData;
    if (other instanceof GSheetDB) {
      other._ensureLoaded();
      otherData = other.data;
    } else if (Array.isArray(other)) {
      otherData = other;
    } else {
      throw new Error('Join target must be GSheetDB instance or array');
    }

    const joined = [];
    const joinType = how.toLowerCase();

    // Process column selection
    const leftCols = select.left || Object.keys(this.data[0] || {});
    const rightCols = select.right || Object.keys(otherData[0] || {});

    // Helper to select and alias columns
    const selectColumns = (row, columns, isRight = false) => {
      const result = {};
      columns.forEach(col => {
        if (typeof col === 'string') {
          if (col.includes(' as ')) {
            const [original, alias] = col.split(' as ').map(s => s.trim());
            result[alias] = row[original];
          } else {
            result[col] = row[col];
          }
        }
      });
      return result;
    };

    // Create lookup map for better performance
    const rightLookup = new Map();
    otherData.forEach(rightRow => {
      const key = this._coerce(rightRow[rightKey]);
      if (!rightLookup.has(key)) {
        rightLookup.set(key, []);
      }
      rightLookup.get(key).push(rightRow);
    });

    // Inner and Left joins
    if (joinType === 'inner' || joinType === 'left') {
      this.data.forEach(leftRow => {
        const key = this._coerce(leftRow[leftKey]);
        const matches = rightLookup.get(key) || [];
        
        if (matches.length > 0) {
          matches.forEach(rightRow => {
            const leftSelected = selectColumns(leftRow, leftCols);
            const rightSelected = selectColumns(rightRow, rightCols, true);
            joined.push({ ...leftSelected, ...rightSelected });
          });
        } else if (joinType === 'left') {
          // Add null values for missing right side data
          const leftSelected = selectColumns(leftRow, leftCols);
          const nullRightRow = {};
          rightCols.forEach(col => {
            const finalCol = col.includes(' as ') ? col.split(' as ')[1].trim() : col;
            nullRightRow[finalCol] = null;
          });
          joined.push({ ...leftSelected, ...nullRightRow });
        }
      });
    }

    // Right join
    if (joinType === 'right') {
      // Create lookup for left side
      const leftLookup = new Map();
      this.data.forEach(leftRow => {
        const key = this._coerce(leftRow[leftKey]);
        if (!leftLookup.has(key)) {
          leftLookup.set(key, []);
        }
        leftLookup.get(key).push(leftRow);
      });

      otherData.forEach(rightRow => {
        const key = this._coerce(rightRow[rightKey]);
        const matches = leftLookup.get(key) || [];
        
        if (matches.length > 0) {
          matches.forEach(leftRow => {
            const leftSelected = selectColumns(leftRow, leftCols);
            const rightSelected = selectColumns(rightRow, rightCols, true);
            joined.push({ ...leftSelected, ...rightSelected });
          });
        } else {
          // Add null values for missing left side data
          const nullLeftRow = {};
          leftCols.forEach(col => {
            const finalCol = col.includes(' as ') ? col.split(' as ')[1].trim() : col;
            nullLeftRow[finalCol] = null;
          });
          const rightSelected = selectColumns(rightRow, rightCols, true);
          joined.push({ ...nullLeftRow, ...rightSelected });
        }
      });
    }

    return this._autoGet ? joined : new GSheetDBQuery(this, joined);
  }

  /**
   * Execute a SQL-like raw query
   * @param {string} sqlString - SQL-like query string
   * @param {Array} params - Parameters to substitute for ? placeholders
   * @returns {Array|GSheetDBQuery|Object} Query results or operation result
   */
  raw(sqlString, params = []) {
    this._ensureLoaded();
    
    try {
      // Substitute parameters
      const processedSQL = this._substituteParams(sqlString.trim(), params);
      const parsed = this._parseSQL(processedSQL);
      
      // Handle different SQL operations
      if (parsed.operation === 'SELECT') {
        return this._executeSelect(parsed);
      } else if (parsed.operation === 'UPDATE') {
        return this._executeUpdate(parsed);
      } else if (parsed.operation === 'DELETE') {
        return this._executeDelete(parsed);
      } else if (parsed.operation === 'INSERT') {
        return this._executeInsert(parsed, params);
      }
      
      throw new Error(`Unsupported SQL operation: ${parsed.operation}`);
    } catch (error) {
      console.error('Error in raw():', error);
      console.error('SQL:', sqlString);
      console.error('Params:', params);
      throw error;
    }
  }

  // ==== CRUD / Query ====

  getAll() {
    this._ensureLoaded();
    return this.data.slice();
  }

  where(filters) {
    this._ensureLoaded();
    const fns = this._buildPredicates(filters);
    const out = this.data.filter(row => fns.every(fn => fn(row)));
    return this._autoGet ? out : new GSheetDBQuery(this, out);
  }

  insert(rows) {
    this._ensureLoaded(true);
    const list = Array.isArray(rows) ? rows : [rows];
    const normalized = list.map(r => this._normalizeRow(r));
    this.data.push(...normalized);
    this._dirty = true;
    this._commit();
    return { inserted: normalized.length, total: this.data.length };
  }

  update(whereFilter, updates) {
    this._ensureLoaded(true);
    const fns = this._buildPredicates(whereFilter);
    let count = 0;
    this.data.forEach((row, i) => {
      if (fns.every(fn => fn(row))) {
        if (typeof updates === 'function') {
          const next = updates({ ...row });
          this.data[i] = this._normalizeRow(next ?? row);
        } else {
          this.data[i] = this._normalizeRow({ ...row, ...updates });
        }
        count++; this._dirty = true;
      }
    });
    this._commit();
    return { updated: count };
  }

  upsert(keys, rowObj) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    const whereObj = {};
    keyList.forEach(k => { whereObj[k] = rowObj[k]; });
    const found = this.where(whereObj); // auto-get may return array
    const exists = Array.isArray(found) ? found.length : found.get().length;
    return exists ? this.update(whereObj, rowObj) : this.insert(rowObj);
  }

  delete(whereFilter) {
    this._ensureLoaded(true);
    const fns = this._buildPredicates(whereFilter);
    const before = this.data.length;
    this.data = this.data.filter(row => !fns.every(fn => fn(row)));
    const removed = before - this.data.length;
    if (removed > 0) this._dirty = true;
    this._commit();
    return { deleted: removed, remaining: this.data.length };
  }

  clearValues() {
    this._ensureLoaded(true);
    this.data = [];
    this._dirty = true;
    this._commit();
    return { cleared: true };
  }

  // ==== Internals ====

  _ensureLoaded(invalidateCache = false) {
    if (!this.sheetObj) throw new Error('Call .sheet() first.');
    if (!this.a1Range) {
      const lr = Math.max(1, this.sheetObj.getLastRow());
      const lc = Math.max(1, this.sheetObj.getLastColumn());
      this.a1Range = `A1:${this._colToA1(lc)}${lr}`;
    }
    const cacheKey = this._makeCacheKey();
    this._cacheKey = cacheKey;

    if (!invalidateCache && this._cacheSeconds > 0) {
      try {
        const hit = CacheService.getScriptCache().get(cacheKey);
        if (hit) { this._hydrateFromRaw(JSON.parse(hit)); return; }
      } catch (e) {}
    }

    const values = this.sheetObj.getRange(this.a1Range).getValues();
    this._hydrateFromRaw(values);

    if (this._cacheSeconds > 0) {
      try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(values), this._cacheSeconds); } catch (e) {}
    }
  }

  _hydrateFromRaw(values2D) {
    const arr = values2D && values2D.length ? values2D : [[]];
    this._raw = arr;
    this.headers = (arr[0] || []).map(h => String(h || '').trim());
    const rows = arr.slice(1);
    const compact = this._trimEmptyRows(rows);
    this.data = compact.map(r => this._zip(this.headers, r));
    this._dirty = false;
  }

  _commit() {
    if (!this._dirty) return;

    const body = [this.headers].concat(
      this.data.map(obj => this.headers.map(h => obj[h] ?? ''))
    );

    const originalRng = this.sheetObj.getRange(this.a1Range);
    const targetRows  = Math.max(body.length, 1);
    const targetCols  = Math.max(this.headers.length, 1);

    const start = originalRng.getA1Notation().match(/^([A-Z]+)(\d+):/i);
    if (!start) throw new Error('Invalid starting range; use e.g. "A1:Z" or "A1:D100".');
    const startCol = this._a1ToCol(start[1]);
    const startRow = parseInt(start[2], 10);

    const endCol = startCol + targetCols - 1;
    const endRow = startRow + targetRows - 1;
    const newA1  = `${this._colToA1(startCol)}${startRow}:${this._colToA1(endCol)}${endRow}`;

    originalRng.clearContent(); // wipe tail to avoid leftovers
    this.sheetObj.getRange(newA1)
      .setValues(this._padRect(body, targetRows, targetCols));

    this.a1Range = newA1;
    this.clearCache();
    this._dirty = false;
  }

  _normalizeRow(obj) {
    Object.keys(obj || {}).forEach(k => {
      if (!this.headers.includes(k)) this.headers.push(k);
    });
    const out = {};
    this.headers.forEach(h => { out[h] = (obj && obj[h] !== undefined) ? obj[h] : ''; });
    return out;
  }

  _buildPredicates(filters) {
    if (typeof filters === 'function') return [filters];
    if (!filters || typeof filters !== 'object') return [() => true];
    const preds = [];
    for (const key of Object.keys(filters)) {
      const val = filters[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const ops = val;
        if (ops.eq !== undefined)  preds.push(row => this._coerce(row[key]) == ops.eq);
        if (ops.ne !== undefined)  preds.push(row => this._coerce(row[key]) != ops.ne);
        if (ops.gt !== undefined)  preds.push(row => this._num(row[key]) >  this._num(ops.gt));
        if (ops.gte !== undefined) preds.push(row => this._num(row[key]) >= this._num(ops.gte));
        if (ops.lt !== undefined)  preds.push(row => this._num(row[key]) <  this._num(ops.lt));
        if (ops.lte !== undefined) preds.push(row => this._num(row[key]) <= this._num(ops.lte));
        if (ops.contains !== undefined) {
          preds.push(row => String(row[key] ?? '').toLowerCase()
            .indexOf(String(ops.contains).toLowerCase()) !== -1);
        }
        if (ops.in !== undefined && Array.isArray(ops.in)) {
          const set = new Set(ops.in.map(v => this._coerce(v)));
          preds.push(row => set.has(this._coerce(row[key])));
        }
      } else {
        preds.push(row => this._coerce(row[key]) == val);
      }
    }
    return preds;
  }

  _zip(keys, arr) {
    const obj = {};
    keys.forEach((k, i) => obj[k] = arr[i] !== undefined ? arr[i] : '');
    return obj;
  }

  _trimEmptyRows(rows) {
    let last = rows.length - 1;
    const isEmpty = r => !r || r.every(v => v === '' || v === null || v === undefined);
    while (last >= 0 && isEmpty(rows[last])) last--;
    return rows.slice(0, last + 1);
  }

  _padRect(arr, rows, cols) {
    const out = new Array(rows);
    for (let r = 0; r < rows; r++) {
      out[r] = new Array(cols);
      for (let c = 0; c < cols; c++) {
        out[r][c] = (arr[r] && arr[r][c] !== undefined) ? arr[r][c] : '';
      }
    }
    return out;
  }

  _makeCacheKey() {
    const ssId = this.ss ? this.ss.getId() : 'active';
    const sheetName = this.sheetObj ? this.sheetObj.getName() : 'unknown';
    const a1 = this.a1Range || 'auto';
    return `GSheetDB::${ssId}::${sheetName}::${a1}`;
  }

  _colToA1(col) {
    let s = '', n = col;
    while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  _a1ToCol(a1) {
    const s = String(a1).trim().toUpperCase();
    let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n;
  }

  _num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
  _coerce(v) { return v; }

  /**
   * Parse a basic SQL-like string into query components
   * @param {string} sql - SQL string to parse
   * @returns {Object} Parsed query components
   */
  _parseSQL(sql) {
    const result = {
      operation: null,
      select: null,
      set: null,
      where: null,
      orderBy: null,
      limit: null,
      insert: null
    };

    // Remove extra whitespace and split into clauses
    const normalized = sql.replace(/\s+/g, ' ').trim();
    
    // Determine operation type
    if (normalized.match(/^SELECT\s+/i)) {
      result.operation = 'SELECT';
      
      // Parse SELECT clause
      const selectMatch = normalized.match(/SELECT\s+(.+?)(?:\s+FROM|\s+WHERE|\s+ORDER|\s+LIMIT|$)/i);
      if (selectMatch) {
        result.select = this._parseSelectClause(selectMatch[1]);
      }
      
    } else if (normalized.match(/^UPDATE\s+/i)) {
      result.operation = 'UPDATE';
      
      // Parse SET clause
      const setMatch = normalized.match(/UPDATE\s+SET\s+(.+?)(?:\s+WHERE|$)/i);
      if (setMatch) {
        result.set = this._parseSetClause(setMatch[1]);
      }
      
    } else if (normalized.match(/^DELETE\s*/i)) {
      result.operation = 'DELETE';
      
    } else if (normalized.match(/^INSERT\s*/i)) {
      result.operation = 'INSERT';
      
      // Parse INSERT clause - handle both VALUES syntax and parameter-based
      const insertMatch = normalized.match(/INSERT\s+(?:INTO\s+\w+\s+)?(?:\(([^)]+)\)\s+)?VALUES\s*\((.+)\)/i);
      if (insertMatch) {
        const columns = insertMatch[1] ? insertMatch[1].split(',').map(c => c.trim()) : null;
        const valuesStr = insertMatch[2];
        result.insert = this._parseInsertValues(valuesStr, columns);
      }
    }

    // Parse WHERE clause (common to all operations)
    const whereMatch = normalized.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i);
    if (whereMatch) {
      result.where = this._parseWhereClause(whereMatch[1]);
    }

    // Parse ORDER BY clause (for SELECT)
    const orderMatch = normalized.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
    if (orderMatch) {
      result.orderBy = {
        field: orderMatch[1],
        direction: (orderMatch[2] || 'ASC').toLowerCase()
      };
    }

    // Parse LIMIT clause (for SELECT)
    const limitMatch = normalized.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      result.limit = parseInt(limitMatch[1], 10);
    }

    return result;
  }

  /**
   * Substitute ? parameters in SQL string
   * @param {string} sql - SQL with ? placeholders
   * @param {Array} params - Parameters to substitute
   * @returns {string} SQL with substituted parameters
   */
  _substituteParams(sql, params) {
    let paramIndex = 0;
    return sql.replace(/\?/g, () => {
      if (paramIndex >= params.length) {
        throw new Error(`Not enough parameters provided. Expected at least ${paramIndex + 1}`);
      }
      const param = params[paramIndex++];
      
      // Handle different parameter types
      if (typeof param === 'string') {
        return `'${param.replace(/'/g, "''")}'`; // Escape single quotes
      } else if (typeof param === 'number') {
        return param.toString();
      } else if (param === null || param === undefined) {
        return 'NULL';
      } else if (Array.isArray(param)) {
        return `(${param.map(p => typeof p === 'string' ? `'${p}'` : p).join(', ')})`;
      }
      return `'${param}'`;
    });
  }

  /**
   * Execute SELECT operation
   * @param {Object} parsed - Parsed SQL components
   * @returns {Array|GSheetDBQuery} Query results
   */
  _executeSelect(parsed) {
    // Start with a query in chain mode (disable auto-get)
    let query = this.query();
    
    // Apply WHERE conditions
    if (parsed.where) {
      query = query.where(parsed.where);
    }
    
    // Apply ORDER BY
    if (parsed.orderBy) {
      query = query.orderBy(parsed.orderBy.field, parsed.orderBy.direction);
    }
    
    // Get results - ensure we always get an array
    let results = Array.isArray(query) ? query : query.get();
    
    // Apply LIMIT
    if (parsed.limit) {
      results = results.slice(0, parsed.limit);
    }
    
    // Apply SELECT (including computed columns)
    if (parsed.select) {
      const mapped = results.map(row => {
        const newRow = {};
        parsed.select.forEach(col => {
          if (typeof col === 'string') {
            // Simple column name
            newRow[col] = row[col];
          } else if (col.column) {
            // Simple column with alias
            newRow[col.as] = row[col.column];
          } else if (col.expr) {
            // Handle computed expressions
            try {
              newRow[col.as] = this._evaluateExpression(col.expr, row);
            } catch (e) {
              newRow[col.as] = null;
            }
          } else if (col.value !== undefined) {
            // String literal
            newRow[col.as] = col.value;
          }
        });
        return newRow;
      });
      return this._autoGet ? mapped : new GSheetDBQuery(this, mapped);
    }
    
    // If no SELECT clause, return results with LIMIT applied
    return this._autoGet ? results : new GSheetDBQuery(this, results);
  }

  /**
   * Execute UPDATE operation
   * @param {Object} parsed - Parsed SQL components
   * @returns {Object} Update result
   */
  _executeUpdate(parsed) {
    if (!parsed.set) {
      throw new Error('UPDATE requires SET clause');
    }
    
    const whereFilter = parsed.where || {};
    return this.update(whereFilter, parsed.set);
  }

  /**
   * Execute DELETE operation
   * @param {Object} parsed - Parsed SQL components
   * @returns {Object} Delete result
   */
  _executeDelete(parsed) {
    const whereFilter = parsed.where || {};
    return this.delete(whereFilter);
  }

  /**
   * Execute INSERT operation
   * @param {Object} parsed - Parsed SQL components
   * @param {Array} params - Optional parameters for INSERT ?
   * @returns {Object} Insert result
   */
  _executeInsert(parsed, params = []) {
    if (parsed.insert && parsed.insert.data) {
      // SQL-style INSERT with VALUES
      return this.insert(parsed.insert.data);
    } else if (params.length > 0) {
      // Parameter-style INSERT for backward compatibility
      
      // Special handling: if we have multiple objects as separate parameters,
      // treat them as an array of objects to insert
      if (params.length > 1 && params.every(p => typeof p === 'object' && p !== null && !Array.isArray(p))) {
        // Multiple individual objects passed as separate parameters
        return this.insert(params);
      }
      
      const data = params[0];
      
      // Handle single object or array of objects
      if (Array.isArray(data)) {
        return this.insert(data);
      } else if (typeof data === 'object' && data !== null) {
        return this.insert(data);
      }
      
      throw new Error('INSERT parameter must be an object or array of objects');
    }
    
    throw new Error('INSERT requires VALUES clause or data parameter');
  }

  /**
   * Parse SET clause for UPDATE statements
   * @param {string} setClause - The SET part
   * @returns {Object} Update object
   */
  _parseSetClause(setClause) {
    const updates = {};
    const assignments = setClause.split(',');
    
    assignments.forEach(assignment => {
      const trimmed = assignment.trim();
      const match = trimmed.match(/(\w+)\s*=\s*(.+)/);
      
      if (match) {
        const field = match[1];
        let value = match[2].trim();
        
        // Handle different value types
        if (value.startsWith("'") && value.endsWith("'")) {
          // String literal
          updates[field] = value.slice(1, -1);
        } else if (/^\d+(\.\d+)?$/.test(value)) {
          // Number
          updates[field] = parseFloat(value);
        } else if (value.toLowerCase() === 'null') {
          // NULL
          updates[field] = null;
        } else {
          // Expression or other
          updates[field] = value;
        }
      }
    });
    
    return updates;
  }

  /**
   * Parse SELECT clause with expressions and aliases
   * @param {string} selectClause - The SELECT part
   * @returns {Array} Array of column definitions
   */
  _parseSelectClause(selectClause) {
    if (selectClause.trim() === '*') return null; // Select all

    const columns = [];
    const parts = selectClause.split(',');

    parts.forEach(part => {
      const trimmed = part.trim();
      
      // Check for alias (AS keyword)
      const aliasMatch = trimmed.match(/^(.+?)\s+as\s+(\w+)$/i);
      if (aliasMatch) {
        const expr = aliasMatch[1].trim();
        const alias = aliasMatch[2];
        
        // Check if it's a simple column or expression
        if (/^[a-zA-Z_]\w*$/.test(expr)) {
          // Simple column with alias - return as string, aliasing will be handled in select
          columns.push({ column: expr, as: alias });
        } else if (/^'[^']*'$/.test(expr)) {
          // String literal
          columns.push({ value: expr.slice(1, -1), as: alias });
        } else {
          // Expression
          columns.push({ expr: expr, as: alias });
        }
      } else {
        // No alias, simple column
        columns.push(trimmed);
      }
    });

    return columns;
  }

  /**
   * Parse WHERE clause into filter object
   * @param {string} whereClause - The WHERE part
   * @returns {Object} Filter conditions
   */
  _parseWhereClause(whereClause) {
    const conditions = {};
    
    // Split by AND (simple parsing, doesn't handle OR or parentheses yet)
    const andParts = whereClause.split(/\s+AND\s+/i);
    
    andParts.forEach(part => {
      const trimmed = part.trim();
      
      // Handle different operators
      let match;
      
      // Equality: field = 'value'
      if ((match = trimmed.match(/(\w+)\s*=\s*'([^']*)'$/))) {
        conditions[match[1]] = match[2];
      }
      // Equality: field = value (number)
      else if ((match = trimmed.match(/(\w+)\s*=\s*(\d+(?:\.\d+)?)$/))) {
        conditions[match[1]] = parseFloat(match[2]);
      }
      // Equality: field = NULL
      else if ((match = trimmed.match(/(\w+)\s*=\s*NULL$/i))) {
        conditions[match[1]] = null;
      }
      // Greater than: field > value
      else if ((match = trimmed.match(/(\w+)\s*>\s*'([^']*)'$/))) {
        conditions[match[1]] = { gt: match[2] };
      }
      else if ((match = trimmed.match(/(\w+)\s*>\s*(\d+(?:\.\d+)?)$/))) {
        conditions[match[1]] = { gt: parseFloat(match[2]) };
      }
      // Greater than or equal: field >= value
      else if ((match = trimmed.match(/(\w+)\s*>=\s*'([^']*)'$/))) {
        conditions[match[1]] = { gte: match[2] };
      }
      else if ((match = trimmed.match(/(\w+)\s*>=\s*(\d+(?:\.\d+)?)$/))) {
        conditions[match[1]] = { gte: parseFloat(match[2]) };
      }
      // Less than: field < value
      else if ((match = trimmed.match(/(\w+)\s*<\s*'([^']*)'$/))) {
        conditions[match[1]] = { lt: match[2] };
      }
      else if ((match = trimmed.match(/(\w+)\s*<\s*(\d+(?:\.\d+)?)$/))) {
        conditions[match[1]] = { lt: parseFloat(match[2]) };
      }
      // Less than or equal: field <= value
      else if ((match = trimmed.match(/(\w+)\s*<=\s*'([^']*)'$/))) {
        conditions[match[1]] = { lte: match[2] };
      }
      else if ((match = trimmed.match(/(\w+)\s*<=\s*(\d+(?:\.\d+)?)$/))) {
        conditions[match[1]] = { lte: parseFloat(match[2]) };
      }
      // Not equal: field != 'value'
      else if ((match = trimmed.match(/(\w+)\s*!=\s*'([^']*)'$/))) {
        conditions[match[1]] = { ne: match[2] };
      }
      else if ((match = trimmed.match(/(\w+)\s*!=\s*(\d+(?:\.\d+)?)$/))) {
        conditions[match[1]] = { ne: parseFloat(match[2]) };
      }
    });

    return conditions;
  }

  /**
   * Parse INSERT VALUES clause
   * @param {string} valuesStr - The VALUES part
   * @param {Array} columns - Column names (optional)
   * @returns {Object} Insert data structure
   */
  _parseInsertValues(valuesStr, columns = null) {
    const data = [];
    
    // Handle multiple value sets: (val1, val2), (val3, val4)
    // Improved regex to handle nested parentheses and complex values
    const valueSetMatches = [];
    let depth = 0;
    let start = 0;
    
    for (let i = 0; i < valuesStr.length; i++) {
      if (valuesStr[i] === '(') {
        if (depth === 0) start = i;
        depth++;
      } else if (valuesStr[i] === ')') {
        depth--;
        if (depth === 0) {
          valueSetMatches.push(valuesStr.substring(start, i + 1));
        }
      }
    }
    
    if (valueSetMatches.length > 0) {
      valueSetMatches.forEach(valueSet => {
        // Remove outer parentheses and split by comma (handling nested commas)
        const innerContent = valueSet.slice(1, -1);
        const values = this._parseCommaDelimited(innerContent);
        
        const row = {};
        values.forEach((value, index) => {
          let parsedValue;
          
          // Parse value based on type
          if (value.startsWith("'") && value.endsWith("'")) {
            // String literal
            parsedValue = value.slice(1, -1);
          } else if (/^\d+(\.\d+)?$/.test(value)) {
            // Number
            parsedValue = parseFloat(value);
          } else if (value.toLowerCase() === 'null') {
            // NULL
            parsedValue = null;
          } else if (value.toLowerCase() === 'true') {
            // Boolean true
            parsedValue = true;
          } else if (value.toLowerCase() === 'false') {
            // Boolean false
            parsedValue = false;
          } else {
            // Default to string (remove quotes if present)
            parsedValue = value.replace(/^['"]|['"]$/g, '');
          }
          
          // Use column name if provided, otherwise use index
          const columnName = columns && columns[index] ? columns[index] : `col_${index}`;
          row[columnName] = parsedValue;
        });
        
        data.push(row);
      });
    }
    
    return { data };
  }

  /**
   * Parse comma-delimited values, respecting quotes
   * @param {string} str - String to parse
   * @returns {Array} Array of values
   */
  _parseCommaDelimited(str) {
    const values = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
        current += char;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      values.push(current.trim());
    }
    
    return values;
  }

  /**
   * Evaluate a simple expression against a row
   * @param {string} expr - Expression to evaluate
   * @param {Object} row - Data row
   * @returns {*} Evaluated result
   */
  _evaluateExpression(expr, row) {
    // Simple expression evaluator for basic math
    // This is a basic implementation - could be expanded
    
    // Replace column names with values
    let evaluated = expr;
    
    // Find all column references (simple word characters)
    const columnMatches = expr.match(/\b[a-zA-Z_]\w*\b/g) || [];
    columnMatches.forEach(col => {
      if (row.hasOwnProperty(col)) {
        const value = row[col];
        const numValue = Number(value);
        evaluated = evaluated.replace(new RegExp(`\\b${col}\\b`, 'g'), 
          isNaN(numValue) ? `"${value}"` : numValue);
      }
    });

    // Evaluate the expression (basic math only)
    try {
      // Only allow safe math operations
      if (/^[0-9+\-*/.() "]+$/.test(evaluated)) {
        return Function(`"use strict"; return (${evaluated})`)();
      }
    } catch (e) {
      // Fall back to null if evaluation fails
    }
    
    return null;
  }

  // --- Optional: physically remove sheet rows (affects entire sheet) ---
  deletePhysical(whereFilter) {
    this._ensureLoaded(true);
    const fns = this._buildPredicates(whereFilter);
    const toDelete = [];
    for (let i = 0; i < this.data.length; i++) {
      if (fns.every(fn => fn(this.data[i]))) toDelete.push(i + 1);
    }
    if (!toDelete.length) return { deleted: 0, remaining: this.data.length };

    const start = this.a1Range.match(/^([A-Z]+)(\d+):/i);
    const startRow = parseInt(start[2], 10);
    for (let j = toDelete.length - 1; j >= 0; j--) {
      const rowInSheet = startRow + toDelete[j];
      this.sheetObj.deleteRow(rowInSheet);
    }
    this.clearCache();
    this._ensureLoaded(true);
    return { deleted: toDelete.length, remaining: this.data.length };
  }
}

/** Query view (honors parent autoGet setting for returns) */
class GSheetDBQuery {
  constructor(dbRef, rows) {
    this._db = dbRef;
    this._rows = rows || [];
  }

  get()   { return this._rows.slice(); }
  first() { return this._rows.length ? this._rows[0] : null; }
  count() { return this._rows.length; }

  update(updates) {
    const sigs = new Set(this._rows.map(r => JSON.stringify(r)));
    return this._db.update((row) => sigs.has(JSON.stringify(row)), updates);
  }

  delete() {
    const sigs = new Set(this._rows.map(r => JSON.stringify(r)));
    return this._db.delete((row) => sigs.has(JSON.stringify(row)));
  }

  where(filters) {
    const fns = this._db._buildPredicates(filters);
    const out = this._rows.filter(row => fns.every(fn => fn(row)));
    return this._db._autoGet ? out : new GSheetDBQuery(this._db, out);
  }

  select(columns) {
    const cols = Array.isArray(columns) ? columns : [columns];
    const mapped = this._rows.map(row => {
      const out = {}; cols.forEach(k => { out[k] = row[k]; }); return out;
    });
    return this._db._autoGet ? mapped : new GSheetDBQuery(this._db, mapped);
  }

  orderBy(field, direction = 'asc') {
    const dir = String(direction).toLowerCase() === 'desc' ? -1 : 1;
    const rows = this._rows.slice();
    rows.sort((a, b) => {
      const va = a[field], vb = b[field];
      const isNilA = va === null || va === undefined || va === '';
      const isNilB = vb === null || vb === undefined || vb === '';
      if (isNilA && isNilB) return 0;
      if (isNilA) return 1;
      if (isNilB) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb);
      return dir * String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    });
    return this._db._autoGet ? rows : new GSheetDBQuery(this._db, rows);
  }

  /**
   * Join with another dataset from query results
   * @param {GSheetDB|Array} other - Other database or array to join with
   * @param {Object} options - Join configuration (same as main join method)
   * @returns {Array|GSheetDBQuery} Joined results
   */
  join(other, options = {}) {
    // Create a temporary GSheetDB-like object with current query results
    const tempDB = {
      data: this._rows,
      _ensureLoaded: () => {},
      _coerce: this._db._coerce.bind(this._db),
      _autoGet: this._db._autoGet
    };
    
    // Use the main join logic
    return this._db.join.call(tempDB, other, options);
  }
}

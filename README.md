# GSheetDB

A powerful Google Apps Script library that provides database-style CRUD operations for Google Sheets with both chainable API and SQL-like query support.

## Features

- 🔗 **Chainable API** - Fluent interface for building complex queries
- 🗃️ **SQL-like Syntax** - Familiar SQL commands for data manipulation
- 🚀 **Smart Caching** - Built-in caching system for improved performance
- 🔄 **Auto-sync** - Automatic data synchronization with Google Sheets
- 🎯 **Type-aware** - Intelligent handling of different data types
- 📊 **Joins** - Support for joining data from multiple sources
- 🎛️ **Flexible Modes** - Auto-get mode or explicit chain mode

## Installation

1. Open your Google Apps Script project
2. Add the `sheetdb.js` file to your project
3. Start using GSheetDB in your code

## Quick Start

```javascript
// Initialize and connect to a spreadsheet
const db = new GSheetDB()
  .connect('your-spreadsheet-id')  // or leave empty for active spreadsheet
  .sheet('Sheet1')                 // specify sheet name
  .range('A:Z');                   // optional: specify range

// Enable caching (optional)
db.enableCache(300); // Cache for 5 minutes
```

## Table of Contents

- [Basic Configuration](#basic-configuration)
- [Chainable API](#chainable-api)
  - [Simple Operations](#simple-operations)
  - [Filtering and Querying](#filtering-and-querying)
  - [Advanced Filtering](#advanced-filtering)
  - [Sorting and Selection](#sorting-and-selection)
  - [Data Modification](#data-modification)
  - [Complex Chaining](#complex-chaining)
  - [Joins](#joins)
- [SQL-like Syntax](#sql-like-syntax)
  - [SELECT Statements](#select-statements)
  - [INSERT Statements](#insert-statements)
  - [UPDATE Statements](#update-statements)
  - [DELETE Statements](#delete-statements)
  - [Advanced SQL Features](#advanced-sql-features)
- [Modes](#modes)
- [Caching](#caching)
- [API Reference](#api-reference)

## Basic Configuration

### Syntax
```javascript
const db = new GSheetDB()
  .connect(spreadsheetId)    // Connect to spreadsheet
  .sheet(sheetName)          // Select sheet
  .range(a1Notation)         // Set data range (optional)
  .enableCache(seconds);     // Enable caching (optional)
```

### Examples

```javascript
// Connect to active spreadsheet
const db = new GSheetDB()
  .connect()
  .sheet('Users');

// Connect to specific spreadsheet
const db = new GSheetDB()
  .connect('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')
  .sheet('Sales Data')
  .range('A1:F100');

// With caching enabled
const db = new GSheetDB()
  .connect()
  .sheet('Products')
  .enableCache(600); // Cache for 10 minutes
```

## Chainable API

### Simple Operations

#### Get All Data

**Syntax:**
```javascript
db.getAll()
```

**Example:**
```javascript
const allUsers = db.getAll();
console.log(allUsers);
// Returns: [{id: 1, name: 'John', email: 'john@example.com'}, ...]
```

#### Count Records

**Syntax:**
```javascript
db.query().count()
```

**Example:**
```javascript
const totalUsers = db.query().count();
console.log(`Total users: ${totalUsers}`);
```

### Filtering and Querying

#### Basic Where Clause

**Syntax:**
```javascript
db.where(filterObject)
```

**Examples:**
```javascript
// Simple equality filter
const activeUsers = db.where({status: 'active'});

// Multiple conditions (AND logic)
const premiumActiveUsers = db.where({
  status: 'active',
  plan: 'premium'
});

// Get first matching record
const user = db.where({id: 123}).first();
```

### Advanced Filtering

#### Comparison Operators

**Syntax:**
```javascript
db.where({
  field: {
    eq: value,       // Equal
    ne: value,       // Not equal
    gt: value,       // Greater than
    gte: value,      // Greater than or equal
    lt: value,       // Less than
    lte: value,      // Less than or equal
    contains: text,  // Contains text
    in: [values]     // In array
  }
})
```

**Examples:**
```javascript
// Age-based filtering
const adults = db.where({
  age: {gte: 18}
});

// Price range filtering
const affordableProducts = db.where({
  price: {gte: 10, lte: 100}
});

// Text search
const searchResults = db.where({
  description: {contains: 'smartphone'}
});

// Multiple choice filter
const validStatuses = db.where({
  status: {in: ['active', 'pending', 'trial']}
});

// Complex combination
const targetCustomers = db.where({
  age: {gte: 25, lte: 65},
  city: {in: ['New York', 'San Francisco']},
  plan: {ne: 'free'}
});
```

### Sorting and Selection

#### Order By

**Syntax:**
```javascript
db.orderBy(field, direction)  // direction: 'asc' or 'desc'
```

**Examples:**
```javascript
// Sort by single field
const usersByName = db.orderBy('name');
const usersByAgeDesc = db.orderBy('age', 'desc');

// Sort filtered results
const topEarners = db
  .where({department: 'sales'})
  .orderBy('salary', 'desc');
```

#### Select Specific Columns

**Syntax:**
```javascript
db.select(columns)  // columns: string or array
```

**Examples:**
```javascript
// Select single column
const names = db.select('name');

// Select multiple columns
const contacts = db.select(['name', 'email', 'phone']);

// Combined with filtering
const activeUserContacts = db
  .where({status: 'active'})
  .select(['name', 'email']);
```

### Data Modification

#### Insert Data

**Syntax:**
```javascript
db.insert(data)  // data: object or array of objects
```

**Examples:**
```javascript
// Insert single record
const result = db.insert({
  name: 'Alice Johnson',
  email: 'alice@example.com',
  status: 'active'
});

// Insert multiple records
const result = db.insert([
  {name: 'Bob Smith', email: 'bob@example.com'},
  {name: 'Carol White', email: 'carol@example.com'}
]);

console.log(result);
// Returns: {inserted: 2, total: 150}
```

#### Update Data

**Syntax:**
```javascript
db.update(whereFilter, updates)
```

**Examples:**
```javascript
// Update with object
const result = db.update(
  {status: 'trial'},
  {status: 'active', upgraded_at: new Date()}
);

// Update with function
const result = db.update(
  {plan: 'basic'},
  (user) => ({
    ...user,
    plan: 'premium',
    price: user.price * 1.5
  })
);

console.log(result);
// Returns: {updated: 5}
```

#### Upsert (Insert or Update)

**Syntax:**
```javascript
db.upsert(keyFields, data)
```

**Examples:**
```javascript
// Upsert by single key
const result = db.upsert('email', {
  email: 'john@example.com',
  name: 'John Updated',
  last_login: new Date()
});

// Upsert by multiple keys
const result = db.upsert(['department', 'employee_id'], {
  department: 'IT',
  employee_id: 'E123',
  name: 'Tech Lead',
  salary: 85000
});
```

#### Delete Data

**Syntax:**
```javascript
db.delete(whereFilter)
```

**Examples:**
```javascript
// Delete by condition
const result = db.delete({status: 'inactive'});

// Delete with complex filter
const result = db.delete({
  last_login: {lt: '2024-01-01'},
  status: {ne: 'premium'}
});

console.log(result);
// Returns: {deleted: 10, remaining: 140}
```

### Complex Chaining

#### Chain Mode

**Syntax:**
```javascript
db.autoGet(false)           // Disable auto-get
  .where(filter)
  .orderBy(field, direction)
  .select(columns)
  .get();                   // Execute query

// Or start with query()
db.query()
  .where(filter)
  .orderBy(field, direction)
  .select(columns)
  .get();
```

**Examples:**
```javascript
// Complex query with chaining
const results = db.autoGet(false)
  .where({status: 'active'})
  .orderBy('created_at', 'desc')
  .select(['id', 'name', 'email'])
  .get();

// Alternative syntax
const results = db.query()
  .where({
    age: {gte: 21},
    city: {in: ['NYC', 'LA', 'Chicago']}
  })
  .orderBy('salary', 'desc')
  .select(['name', 'position', 'salary'])
  .get();

// Get first result
const topPerformer = db.query()
  .where({department: 'sales'})
  .orderBy('revenue', 'desc')
  .first();

// Count filtered results
const seniorCount = db.query()
  .where({
    experience: {gte: 5},
    level: 'senior'
  })
  .count();
```

### Joins

#### Basic Join

**Syntax:**
```javascript
db.join(otherData, {
  leftKey: 'field1',
  rightKey: 'field2',
  how: 'inner|left|right',
  select: {
    left: ['col1', 'col2'],
    right: ['col3', 'col4']
  }
})
```

**Examples:**
```javascript
// Join with another GSheetDB instance
const ordersDB = new GSheetDB()
  .connect()
  .sheet('Orders');

const usersWithOrders = db.join(ordersDB, {
  leftKey: 'user_id',
  rightKey: 'customer_id',
  how: 'inner'
});

// Join with array data
const departments = [
  {dept_id: 1, dept_name: 'Engineering'},
  {dept_id: 2, dept_name: 'Marketing'}
];

const employeesWithDepts = db.join(departments, {
  leftKey: 'department_id',
  rightKey: 'dept_id',
  how: 'left',
  select: {
    left: ['name', 'email', 'salary'],
    right: ['dept_name']
  }
});

// Join with column aliasing
const enrichedData = db.join(ordersDB, {
  leftKey: 'id',
  rightKey: 'user_id',
  how: 'left',
  select: {
    left: ['name as customer_name', 'email'],
    right: ['order_date', 'total as order_total']
  }
});
```

## SQL-like Syntax

### SELECT Statements

#### Basic SELECT

**Syntax:**
```sql
db.raw('SELECT columns FROM table WHERE conditions ORDER BY field LIMIT count', [params])
```

**Examples:**
```javascript
// Select all columns
const allUsers = db.raw('SELECT * FROM users');

// Select specific columns
const contacts = db.raw('SELECT name, email FROM users');

// With parameters
const activeUsers = db.raw(
  'SELECT name, email FROM users WHERE status = ?',
  ['active']
);

// With multiple conditions
const results = db.raw(`
  SELECT name, email, age 
  FROM users 
  WHERE age >= ? AND city = ?
`, [21, 'New York']);
```

#### SELECT with ORDER BY and LIMIT

**Examples:**
```javascript
// Order by single field
const newest = db.raw(`
  SELECT * FROM users 
  ORDER BY created_at DESC 
  LIMIT 10
`);

// Complex query with filtering, ordering, and limiting
const topSales = db.raw(`
  SELECT name, total_sales, region
  FROM salespeople 
  WHERE region = ? AND total_sales > ?
  ORDER BY total_sales DESC 
  LIMIT 5
`, ['West', 50000]);
```

#### SELECT with Computed Columns

**Examples:**
```javascript
// String literals and expressions
const report = db.raw(`
  SELECT 
    name,
    salary,
    'Employee' as type,
    salary * 12 as annual_salary
  FROM employees 
  WHERE department = ?
`, ['Engineering']);

// Column aliasing
const summary = db.raw(`
  SELECT 
    name as full_name,
    email as contact_email,
    status as account_status
  FROM users 
  WHERE status != 'deleted'
`);
```

### INSERT Statements

#### Basic INSERT

**Syntax:**
```sql
db.raw('INSERT INTO table VALUES (values)', [dataObject])
db.raw('INSERT INTO table (columns) VALUES (values)')
```

**Examples:**
```javascript
// Insert with object parameter
const result = db.raw(
  'INSERT INTO users VALUES (?)',
  [{name: 'John Doe', email: 'john@example.com', status: 'active'}]
);

// Insert multiple records
const result = db.raw(
  'INSERT INTO users VALUES (?)',
  [
    {name: 'Alice', email: 'alice@example.com'},
    {name: 'Bob', email: 'bob@example.com'}
  ]
);

// SQL-style INSERT with VALUES
const result = db.raw(`
  INSERT INTO users (name, email, status) 
  VALUES ('Charlie Brown', 'charlie@example.com', 'active')
`);

// Multiple rows with SQL syntax
const result = db.raw(`
  INSERT INTO products (name, price, category) 
  VALUES 
    ('Laptop', 999.99, 'Electronics'),
    ('Mouse', 29.99, 'Electronics'),
    ('Desk', 299.99, 'Furniture')
`);
```

### UPDATE Statements

#### Basic UPDATE

**Syntax:**
```sql
db.raw('UPDATE table SET field=value WHERE conditions', [params])
```

**Examples:**
```javascript
// Simple update
const result = db.raw(`
  UPDATE users 
  SET status = 'inactive' 
  WHERE last_login < '2024-01-01'
`);

// Update with parameters
const result = db.raw(`
  UPDATE products 
  SET price = ?, category = ?
  WHERE id = ?
`, [29.99, 'Electronics', 123]);

// Multiple field update
const result = db.raw(`
  UPDATE employees 
  SET salary = 75000, position = 'Senior Developer', updated_at = NULL
  WHERE department = 'Engineering' AND experience >= 5
`);

// Conditional update with complex WHERE
const result = db.raw(`
  UPDATE orders 
  SET status = 'shipped', shipped_date = '2024-03-15'
  WHERE status = 'processing' AND order_date >= '2024-03-01'
`);
```

### DELETE Statements

#### Basic DELETE

**Syntax:**
```sql
db.raw('DELETE FROM table WHERE conditions', [params])
```

**Examples:**
```javascript
// Simple delete
const result = db.raw(`
  DELETE FROM users 
  WHERE status = 'deleted'
`);

// Delete with parameters
const result = db.raw(`
  DELETE FROM logs 
  WHERE created_at < ? AND level = ?
`, ['2024-01-01', 'debug']);

// Complex delete conditions
const result = db.raw(`
  DELETE FROM sessions 
  WHERE expires_at < '2024-03-15' AND user_id != 1
`);
```

### Advanced SQL Features

#### Complex WHERE Clauses

**Examples:**
```javascript
// Multiple conditions
const results = db.raw(`
  SELECT * FROM orders 
  WHERE total > 100 
    AND status = 'completed' 
    AND order_date >= '2024-01-01'
`);

// Comparison operators
const products = db.raw(`
  SELECT name, price FROM products 
  WHERE price >= 50 
    AND price <= 200 
    AND category != 'discontinued'
`);

// NULL checks
const incomplete = db.raw(`
  SELECT * FROM profiles 
  WHERE phone = NULL AND email != NULL
`);
```

#### Parameterized Queries

**Examples:**
```javascript
// Single parameter
const userOrders = db.raw(`
  SELECT * FROM orders 
  WHERE user_id = ? AND status = ?
`, [123, 'active']);

// Multiple parameters with different types
const filtered = db.raw(`
  SELECT name, age, salary FROM employees 
  WHERE age >= ? AND department = ? AND salary > ?
`, [25, 'Engineering', 60000]);

// Array parameter for IN clause
const categories = db.raw(`
  SELECT * FROM products 
  WHERE category = ?
`, [['Electronics', 'Software', 'Hardware']]);
```

## Modes

### Auto-Get Mode (Default)

In auto-get mode, queries automatically execute and return results:

```javascript
// These return data immediately
const users = db.where({status: 'active'});
const sorted = db.orderBy('name');
const selected = db.select(['name', 'email']);
```

### Chain Mode

Disable auto-get for building complex queries:

```javascript
// Method 1: Disable auto-get
const results = db.autoGet(false)
  .where({status: 'active'})
  .orderBy('name')
  .select(['name', 'email'])
  .get(); // Execute query

// Method 2: Start with query()
const results = db.query()
  .where({status: 'active'})
  .orderBy('name')
  .select(['name', 'email'])
  .get(); // Execute query
```

## Caching

### Enable Caching

**Syntax:**
```javascript
db.enableCache(seconds)
```

**Examples:**
```javascript
// Cache for 5 minutes
db.enableCache(300);

// Cache for 1 hour
db.enableCache(3600);

// Clear cache manually
db.clearCache();

// Check cache key
console.log(db._cacheKey);
```

### Best Practices

```javascript
// For frequently accessed, relatively static data
const configDB = new GSheetDB()
  .connect()
  .sheet('Configuration')
  .enableCache(1800); // 30 minutes

// For real-time data, use shorter cache or no cache
const ordersDB = new GSheetDB()
  .connect()
  .sheet('Orders')
  .enableCache(60); // 1 minute
```

## API Reference

### Main Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `connect(id?)` | Connect to spreadsheet | GSheetDB |
| `sheet(name)` | Select sheet | GSheetDB |
| `range(a1)` | Set data range | GSheetDB |
| `enableCache(seconds)` | Enable caching | GSheetDB |
| `clearCache()` | Clear cache | GSheetDB |
| `autoGet(on)` | Toggle auto-get mode | GSheetDB |
| `query(rows?)` | Start explicit chain | GSheetDBQuery |

### Query Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getAll()` | Get all data | Array |
| `where(filter)` | Filter data | Array/Query |
| `select(columns)` | Select columns | Array/Query |
| `orderBy(field, dir)` | Sort data | Array/Query |
| `join(other, options)` | Join datasets | Array/Query |
| `first()` | Get first result | Object |
| `count()` | Count results | Number |
| `get()` | Execute query | Array |

### CRUD Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `insert(data)` | Insert records | Object |
| `update(where, updates)` | Update records | Object |
| `upsert(keys, data)` | Insert or update | Object |
| `delete(where)` | Delete records | Object |
| `clearValues()` | Clear all data | Object |

### SQL Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `raw(sql, params)` | Execute SQL-like query | Array/Object |

## Error Handling

```javascript
try {
  const db = new GSheetDB()
    .connect('invalid-id')
    .sheet('NonExistentSheet');
  
  const data = db.getAll();
} catch (error) {
  console.error('Database error:', error.message);
}
```

## Performance Tips

1. **Use caching** for data that doesn't change frequently
2. **Specify ranges** to limit data loading: `.range('A1:F1000')`
3. **Use chain mode** for complex queries to avoid multiple executions
4. **Batch operations** when inserting/updating multiple records
5. **Index your data** by keeping key fields in the first columns

## License

MIT License - feel free to use in your Google Apps Script projects!

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

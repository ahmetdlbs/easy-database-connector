# Easy Database Connector

A flexible and robust database connector service with built-in support for MSSQL, pagination, caching, encryption, and transactions.

## Features

- 🔒 Built-in encryption support for sensitive data
- 🚀 Connection pooling for optimal performance
- 📄 Pagination support with cache
- 💾 Redis caching integration
- 🔄 Transaction support
- 🔌 Bulk operations
- 📦 TypeScript support
- 🛡️ Type safety

## Installation

```bash
npm install easy-database-connector
```

## Quick Start

```typescript
import { query, execute, queryWithPagination, transaction } from 'easy-database-connector';

// Basic query
const users = await query<User>({
    sql: 'SELECT * FROM users WHERE active = @p0',
    parameters: [true]
});

// Paginated query with caching
const pagedUsers = await queryWithPagination<User>({
    sql: 'SELECT * FROM users',
    parameters: [],
    page: 1,
    pageSize: 10,
    orderBy: 'name ASC',
    cache: {
        key: 'users:page1',
        ttl: 300 // 5 minutes
    }
});

// Encrypted data
await execute({
    sql: 'INSERT INTO secure_data (data) VALUES (@p0)',
    parameters: ['sensitive information'],
    encryption: {
        open: true,
        data: ['0']
    }
});

// Transaction example
await transaction(async (trx) => {
    await execute({
        sql: 'INSERT INTO users (name) VALUES (@p0)',
        parameters: ['John'],
        transaction: trx
    });

    await execute({
        sql: 'INSERT INTO logs (action) VALUES (@p0)',
        parameters: ['user_created'],
        transaction: trx
    });
});
```

## Configuration

Create a `.env` file:

```env
# Database Configuration
DB_TYPE=mssql
DB_HOST=localhost
DB_USER=your_user
DB_PASSWORD=your_password
DB_DATABASE=your_database
DB_PORT=1433
DB_ENCRYPT=true

# For Encrypted Columns
MSSQL_SYNNETRIC_KEY_NAME=your_key_name
MSSQL_CERTIFICATE_NAME=your_cert_name

# Redis Configuration
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_TTL=3600
```

## API Reference

### Query Functions

#### `query<T>(input: ExecuteInput): Promise<T[]>`
Execute a SELECT query with optional caching.

```typescript
const users = await query<User>({
    sql: 'SELECT * FROM users',
    parameters: [],
    cache: {
        key: 'all-users',
        ttl: 3600
    }
});
```

#### `queryWithPagination<T>(input: ExecuteInput): Promise<QueryResult<T>>`
Execute a paginated query with total count.

```typescript
const result = await queryWithPagination<User>({
    sql: 'SELECT * FROM users',
    page: 1,
    pageSize: 10,
    orderBy: 'created_at DESC'
});
```

#### `execute(input: ExecuteInput): Promise<unknown[]>`
Execute INSERT, UPDATE, DELETE queries or bulk operations.

```typescript
// Bulk insert
await execute({
    sql: 'INSERT INTO users',
    parameters: users,
    bulk: {
        columns: [
            ['name', mssql.NVarChar(100)],
            ['email', mssql.NVarChar(100)]
        ],
        batchSize: 1000
    }
});
```

#### `transaction<T>(callback: (trx: Transaction) => Promise<T>): Promise<T>`
Execute multiple queries in a transaction.

```typescript
await transaction(async (trx) => {
    await execute({
        sql: 'DELETE FROM users WHERE id = @p0',
        parameters: [1],
        transaction: trx
    });
});
```

## Types

### ExecuteInput
```typescript
interface ExecuteOptions {
    sql: string;
    parameters?: SqlValue[];
    encryption?: {
        open: boolean;
        data: string[];
    };
    bulk?: {
        columns: ColumnType[];
        batchSize?: number;
    };
    page?: number;
    pageSize?: number;
    orderBy?: string;
    cache?: {
        key: string;
        ttl?: number;
    };
    transaction?: mssql.Transaction;
}
```

### QueryResult
```typescript
interface QueryResult<T> {
    data: T[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License

## Support

For support, please open an issue in the GitHub repository.
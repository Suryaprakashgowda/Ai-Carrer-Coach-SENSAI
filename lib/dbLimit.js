import pLimit from "p-limit";

// Limit concurrent DB operations to avoid exhausting the connection pool.
// Default to 10 concurrent DB calls; override with DB_CONCURRENCY_LIMIT env var.
const limit = pLimit(parseInt(process.env.DB_CONCURRENCY_LIMIT || "10", 10));

export const dbLimit = (fn) => limit(fn);

export default dbLimit;

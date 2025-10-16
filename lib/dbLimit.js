import pLimit from "p-limit";

// Limit concurrent DB operations to avoid exhausting the connection pool.
// Default to 10 concurrent DB calls; override with DB_CONCURRENCY_LIMIT env var.
const limit = pLimit(parseInt(process.env.DB_CONCURRENCY_LIMIT || "10", 10));

/**
 * dbLimit executes a database operation under the concurrency limiter.
 * Accepts either a function that returns a Promise, or a Promise directly.
 * Returns the underlying Promise result.
 */
export const dbLimit = (operation) => {
	if (typeof operation === "function") {
		// p-limit expects a function that returns a Promise
		return limit(() => operation());
	}
	// If a Promise was passed, wrap it in a function for p-limit
	return limit(() => operation);
};

export default dbLimit;

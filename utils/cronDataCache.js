const axios = require("axios");

/**
 * CronDataCache - Manages 24-hour data caching for cron jobs
 *
 * Fetches data once and caches it for 24 hours.
 * After 24 hours, automatically refetches fresh data.
 *
 * @class CronDataCache
 * @param {string} jobName - Identifier for the cron job
 * @param {string} apiEndpoint - API endpoint to fetch data from
 * @param {object} options - Configuration options
 * @param {number} options.cacheDuration - Cache duration in milliseconds (default: 24 hours)
 */
class CronDataCache {
  constructor(jobName, apiEndpoint, options = {}) {
    this.jobName = jobName;
    this.apiEndpoint = apiEndpoint;
    this.cacheDuration = options.cacheDuration || 24 * 60 * 60 * 1000; // 24 hours default

    this.cache = {
      data: null,
      timestamp: null,
      fetchAttempts: 0,
      lastError: null,
    };
  }

  /**
   * Check if cached data is still valid (within 24 hours)
   * @returns {boolean} true if cache is valid, false otherwise
   */
  isCacheValid() {
    if (!this.cache.data || !this.cache.timestamp) {
      return false;
    }

    const now = Date.now();
    const cacheAge = now - this.cache.timestamp;
    return cacheAge < this.cacheDuration;
  }

  /**
   * Calculate remaining cache time in milliseconds
   * @returns {number} milliseconds remaining, or 0 if cache is expired
   */
  getRemainingCacheTime() {
    if (!this.isCacheValid()) {
      return 0;
    }

    const now = Date.now();
    const elapsed = now - this.cache.timestamp;
    return Math.max(0, this.cacheDuration - elapsed);
  }

  /**
   * Get cache expiry timestamp
   * @returns {Date|null} expiry datetime or null if no cache
   */
  getCacheExpiryTime() {
    if (!this.cache.timestamp) {
      return null;
    }

    return new Date(this.cache.timestamp + this.cacheDuration);
  }

  /**
   * Fetch data from API endpoint
   * @private
   * @returns {Promise<object|null>} fetched data or null on failure
   */
  async fetchFreshData() {
    try {
      this.cache.fetchAttempts++;
      console.log(
        `[${this.jobName}] Fetching fresh data (attempt ${this.cache.fetchAttempts})...`,
      );

      const response = await axios.post(this.apiEndpoint);

      if (response.status === 200) {
        console.log(`[${this.jobName}] Successfully fetched fresh data`);
        this.cache.lastError = null;
        return response.data;
      }

      throw new Error(`API returned status ${response.status}`);
    } catch (error) {
      this.cache.lastError = error.message;
      console.error(
        `[${this.jobName}] Error fetching fresh data: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Get cached data or fetch fresh data if cache expired
   *
   * Flow:
   * 1. If cache is valid -> return cached data
   * 2. If cache is invalid -> fetch fresh data and update cache
   * 3. If fetch fails but cache exists -> return stale cache with warning
   * 4. If both fail -> return null
   *
   * @returns {Promise<object|null>} data (fresh or cached)
   */
  async getOrFetchData() {
    // Check if cache is still valid
    if (this.isCacheValid()) {
      const remaining = this.getRemainingCacheTime();
      const expiryTime = this.getCacheExpiryTime();
      console.log(
        `[${this.jobName}] Using cached data (expires at ${expiryTime.toISOString()})`,
      );
      return this.cache.data;
    }

    // Cache expired or doesn't exist, fetch fresh data
    const freshData = await this.fetchFreshData();

    if (freshData) {
      // Update cache with new data and timestamp
      this.cache.data = freshData;
      this.cache.timestamp = Date.now();
      const expiryTime = this.getCacheExpiryTime();

      console.log(
        `[${this.jobName}] Data cached successfully. Will refetch at: ${expiryTime.toISOString()}`,
      );

      return freshData;
    }

    // Fresh data fetch failed - try to use stale cache as fallback
    if (this.cache.data) {
      console.warn(
        `[${this.jobName}] Using stale cached data due to fetch failure`,
      );
      return this.cache.data;
    }

    // No data available at all
    console.error(
      `[${this.jobName}] No data available (cache empty and fetch failed)`,
    );
    return null;
  }

  /**
   * Force clear the cache and reset state
   */
  clearCache() {
    this.cache = {
      data: null,
      timestamp: null,
      fetchAttempts: 0,
      lastError: null,
    };
    console.log(`[${this.jobName}] Cache cleared`);
  }

  /**
   * Force refetch data immediately (regardless of cache validity)
   * @returns {Promise<object|null>} fresh data
   */
  async forceRefresh() {
    console.log(`[${this.jobName}] Force refreshing cache...`);
    const freshData = await this.fetchFreshData();

    if (freshData) {
      this.cache.data = freshData;
      this.cache.timestamp = Date.now();
      console.log(`[${this.jobName}] Cache force refreshed`);
      return freshData;
    }

    return null;
  }

  /**
   * Get detailed cache metadata and statistics
   * @returns {object} cache metadata
   */
  getCacheMetadata() {
    const isValid = this.isCacheValid();
    const remaining = this.getRemainingCacheTime();
    const expiry = this.getCacheExpiryTime();

    return {
      jobName: this.jobName,
      cacheValid: isValid,
      cacheStatus: isValid
        ? `valid (expires in ${Math.round(remaining / 1000 / 60)} minutes)`
        : "expired or empty",
      lastFetchedAt: this.cache.timestamp
        ? new Date(this.cache.timestamp).toISOString()
        : null,
      expiresAt: expiry ? expiry.toISOString() : null,
      hasData: Boolean(this.cache.data),
      fetchAttempts: this.cache.fetchAttempts,
      lastError: this.cache.lastError,
      cacheDurationHours: this.cacheDuration / (1000 * 60 * 60),
    };
  }

  /**
   * Get current cached data without fetching (synchronous)
   * @returns {object|null} cached data or null
   */
  getDataSync() {
    return this.cache.data;
  }

  /**
   * Check if cache needs refresh (async check without fetching)
   * @returns {boolean} true if refresh is needed
   */
  needsRefresh() {
    return !this.isCacheValid();
  }
}

module.exports = CronDataCache;

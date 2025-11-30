/**
 * API Version Management
 *
 * This module manages API versioning for the Microfinex API.
 * Currently supports v1, but designed to easily add future versions.
 */

export const API_VERSIONS = {
  V1: 'v1',
  // Future versions can be added here
  // V2: 'v2',
} as const;

export type ApiVersion = (typeof API_VERSIONS)[keyof typeof API_VERSIONS];

export const CURRENT_VERSION = API_VERSIONS.V1;
export const SUPPORTED_VERSIONS = [API_VERSIONS.V1];

/**
 * Get the API prefix for a specific version
 */
export const getVersionPrefix = (
  version: ApiVersion = CURRENT_VERSION
): string => {
  return `/${version}`;
};

/**
 * Check if a version is supported
 */
export const isVersionSupported = (version: string): version is ApiVersion => {
  return SUPPORTED_VERSIONS.includes(version as ApiVersion);
};

/**
 * Get version info for API responses
 */
export const getVersionInfo = () => ({
  current_version: CURRENT_VERSION,
  supported_versions: SUPPORTED_VERSIONS,
  latest_version: CURRENT_VERSION,
});

/**
 * Middleware to validate API version
 */
export const validateApiVersion = (req: any, res: any, next: any) => {
  const version = req.params.version || req.query.version;

  if (version && !isVersionSupported(version)) {
    return res.status(400).json({
      success: false,
      error: 'UNSUPPORTED_API_VERSION',
      message: `API version '${version}' is not supported`,
      supported_versions: SUPPORTED_VERSIONS,
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

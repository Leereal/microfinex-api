/**
 * The product name, kept in memory for code that cannot wait on the database -
 * message templates are compiled synchronously. The branding service keeps it
 * current; until it has loaded, the default name is used.
 */

import { DEFAULT_BRANDING } from './branding.logic';

let currentName = DEFAULT_BRANDING.productName;

export const brandName = () => currentName;

export const setBrandName = (name: string) => {
  if (name.trim()) currentName = name.trim();
};

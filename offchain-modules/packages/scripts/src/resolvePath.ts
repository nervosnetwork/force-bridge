import path from 'path';
import { lookupPackageJsonFolder } from '@force-bridge/internal';

export { resolveOffChainModulesPath } from '@force-bridge/internal';

/**
 * resolve the @force-bridge/scripts path
 * @param subPath
 */
export function resolveCurrentPackagePath(...subPath: string[]): string {
  const currentPackagePath = lookupPackageJsonFolder(__dirname);
  return path.join(currentPackagePath, ...subPath);
}

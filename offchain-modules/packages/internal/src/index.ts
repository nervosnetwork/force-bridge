import fs from 'fs';
import path from 'path';

/**
 * resolve the offchain-modules path
 * @param subPath
 */
export function resolveOffChainModulesPath(...subPath: string[]): string {
  return path.join(lookupPackageJsonFolder(__dirname), '../..', ...subPath);
}

export function lookupPackageJsonFolder(fromPath: string): string {
  if (!fromPath) throw new Error('Cannot find a package.json');
  const foundPackageJson = fs.readdirSync(fromPath).some((name) => name === 'package.json');
  if (foundPackageJson) return fromPath;

  return lookupPackageJsonFolder(path.join(fromPath, '..'));
}

/**
 * @deprecated do NOT use the method, it is likely to be replaced in the future
 */
export function pathOfRootConfig(): string {
  return resolveOffChainModulesPath('./config.json');
}

import * as path from 'path';
import * as fs from 'fs';

/**
 * Validates if a path resolves to a location within the allowed root directory.
 * It checks against path traversal (..) and symlinks pointing outside the root.
 *
 * @param inputPath The path to validate (relative or absolute).
 * @param root The allowed root directory (default: process.cwd()).
 * @returns true if the path is safe, false otherwise.
 */
export function isSafePath(inputPath: string, root: string = process.cwd()): boolean {
    const resolvedPath = path.resolve(inputPath);
    const allowedRoot = path.resolve(root);

    // 1. Basic check: Ensure the resolved path starts with the allowed root
    // We add path.sep to ensure partial matches are avoided (e.g. /app vs /app_secret)
    if (!resolvedPath.startsWith(allowedRoot + path.sep) && resolvedPath !== allowedRoot) {
        return false;
    }

    // 2. Symlink check: Resolve the real path (if file exists)
    if (fs.existsSync(resolvedPath)) {
        try {
            const realPath = fs.realpathSync(resolvedPath);
            if (!realPath.startsWith(allowedRoot + path.sep) && realPath !== allowedRoot) {
                return false;
            }
        } catch (e) {
            // If realpath fails (e.g. permissions), deny access.
            return false;
        }
    }

    return true;
}

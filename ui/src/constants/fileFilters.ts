/**
 * File filtering constants for CLT UI
 * 
 * These extensions are filtered out from:
 * - File tree display in FileExplorer
 * - Fuzzy search results (Cmd+K)
 */

export const IGNORED_FILE_EXTENSIONS = [
  '.rep',
  '.cmp'
] as const;

/**
 * Check if a file should be ignored based on its extension
 * @param filePath - The file path to check
 * @returns true if the file should be ignored, false otherwise
 */
export function shouldIgnoreFile(filePath: string): boolean {
  const extension = getFileExtension(filePath);
  return IGNORED_FILE_EXTENSIONS.includes(extension as any);
}

/**
 * Get the file extension from a file path
 * @param filePath - The file path
 * @returns the file extension including the dot (e.g., '.rep', '.cmp')
 */
function getFileExtension(filePath: string): string {
  const lastDotIndex = filePath.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === filePath.length - 1) {
    return '';
  }
  return filePath.substring(lastDotIndex);
}

/**
 * Filter an array of file paths, removing ignored files
 * @param filePaths - Array of file paths to filter
 * @returns filtered array with ignored files removed
 */
export function filterIgnoredFiles(filePaths: string[]): string[] {
  return filePaths.filter(filePath => !shouldIgnoreFile(filePath));
}
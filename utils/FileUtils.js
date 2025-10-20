const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const logger = require('./Logger');

class FileUtils {
  /**
   * Hash file contents using SHA256
   * Useful for comparing file changes
   */
  static async hashFile(filePath, algorithm = 'sha256') {
    try {
      const data = await fs.readFile(filePath);
      const hash = crypto.createHash(algorithm).update(data).digest('hex');
      
      logger.debug('File hashed', { 
        file: path.basename(filePath),
        algorithm,
        hash: hash.substring(0, 8) + '...'
      });
      
      return hash;
    } catch (error) {
      logger.error('Failed to hash file', { 
        file: filePath, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Hash a buffer directly
   */
  static hashBuffer(buffer, algorithm = 'sha256') {
    try {
      const hash = crypto.createHash(algorithm).update(buffer).digest('hex');
      
      logger.debug('Buffer hashed', { 
        algorithm,
        size: buffer.length,
        hash: hash.substring(0, 8) + '...'
      });
      
      return hash;
    } catch (error) {
      logger.error('Failed to hash buffer', { 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Compare two files by hash
   */
  static async filesAreIdentical(filePath1, filePath2) {
    try {
      const [hash1, hash2] = await Promise.all([
        this.hashFile(filePath1),
        this.hashFile(filePath2)
      ]);

      if (!hash1 || !hash2) {
        return false;
      }

      const identical = hash1 === hash2;
      
      logger.debug('File comparison', {
        file1: path.basename(filePath1),
        file2: path.basename(filePath2),
        identical
      });

      return identical;
    } catch (error) {
      logger.error('Failed to compare files', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Check if file exists
   */
  static async exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure directory exists, create if not
   */
  static async ensureDir(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      logger.debug('Directory ensured', { path: dirPath });
      return true;
    } catch (error) {
      logger.error('Failed to create directory', {
        path: dirPath,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Safe file copy with validation
   */
  static async safeCopy(source, destination) {
    try {
      // Ensure destination directory exists
      const destDir = path.dirname(destination);
      await this.ensureDir(destDir);

      // Copy file
      await fs.copyFile(source, destination);
      
      logger.debug('File copied', {
        from: path.basename(source),
        to: path.basename(destination)
      });

      return true;
    } catch (error) {
      logger.error('Failed to copy file', {
        source,
        destination,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Safe file move/rename
   */
  static async safeMove(source, destination) {
    try {
      const destDir = path.dirname(destination);
      await this.ensureDir(destDir);

      await fs.rename(source, destination);
      
      logger.debug('File moved', {
        from: path.basename(source),
        to: path.basename(destination)
      });

      return true;
    } catch (error) {
      logger.error('Failed to move file', {
        source,
        destination,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get file size in bytes
   */
  static async getSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      logger.error('Failed to get file size', {
        file: filePath,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Format file size to human-readable format
   */
  static formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    if (bytes === null) return 'Unknown';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}

module.exports = FileUtils;
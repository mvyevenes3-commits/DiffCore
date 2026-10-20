/**
 * DiffCore Java Bytecode Decompiler
 * Powered by Vineflower / Fernflower Wasm engine (@run-slicer/vf)
 * Decompiles Java .class files to clean, modern Java source code
 * with ZERO external Java runtime / JDK dependencies.
 */

const fs = require('fs');
const path = require('path');
const vf = require('@run-slicer/vf');

/**
 * Checks if a buffer represents Java bytecode (Magic 0xCAFEBABE)
 */
function isJavaClassBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return buffer[0] === 0xCA && buffer[1] === 0xFE && buffer[2] === 0xBA && buffer[3] === 0xBE;
}

/**
 * Checks if a file path is a Java .class file
 */
function isJavaClassPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  return /\.class$/i.test(filePath.trim());
}

/**
 * Decompiles Java bytecode buffer to Java source code
 * @param {Buffer|Uint8Array} bytes 
 * @param {string} className 
 * @returns {Promise<string>}
 */
async function decompileClassBytes(bytes, className = 'DecompiledClass') {
  try {
    const cleanName = path.basename(className, path.extname(className)).replace(/[^a-zA-Z0-9_$\.]/g, '_') || 'DecompiledClass';
    const baseSimpleName = cleanName.split('.').pop() || cleanName;

    const result = await vf.decompile(baseSimpleName, {
      source: async (requestedName) => {
        // Return class bytes when the target or its simple/inner name is requested
        if (
          requestedName === baseSimpleName || 
          requestedName === baseSimpleName + '.class' ||
          requestedName.endsWith('/' + baseSimpleName) ||
          requestedName.endsWith('/' + baseSimpleName + '.class') ||
          requestedName.includes(baseSimpleName)
        ) {
          return bytes;
        }
        return null;
      }
    });

    const decompiledSource = result[baseSimpleName] || Object.values(result)[0];
    if (decompiledSource && typeof decompiledSource === 'string' && decompiledSource.trim().length > 0) {
      return decompiledSource;
    }

    return `// DiffCore Decompiler (Fernflower / Vineflower)\n// Unable to decompile ${baseSimpleName}.class\n\npublic class ${baseSimpleName} {\n    // [Bytecode extraction yielded no source statements]\n}\n`;
  } catch (err) {
    console.warn(`[JavaDecompiler] Error decompiling ${className}:`, err);
    return `// DiffCore Decompiler: Decompilation error for ${className}\n// ${err.message}\n`;
  }
}

/**
 * Decompiles a .class file from disk
 * @param {string} filePath 
 * @returns {Promise<{success: boolean, content?: string, error?: string}>}
 */
async function decompileClassFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'Class file does not exist' };
    }
    const bytes = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const content = await decompileClassBytes(bytes, fileName);
    return {
      success: true,
      content,
      isDecompiled: true,
      originalPath: filePath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  isJavaClassBuffer,
  isJavaClassPath,
  decompileClassBytes,
  decompileClassFile
};

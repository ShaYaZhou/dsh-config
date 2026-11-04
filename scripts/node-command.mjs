import fs from 'node:fs';
import path from 'node:path';

// Keep symlink spelling in persisted commands; resolving it would pin a Cellar version.
export function stableNodeCommand(executable = process.execPath, env = process.env) {
  const resolved = fs.realpathSync(executable);
  const cellar = /^(.*)\/Cellar\/node(?:@[^/]+)?\/[^/]+\/bin\/node$/.exec(resolved);
  const candidates = [
    ...(cellar ? [path.join(cellar[1], 'bin', 'node')] : []),
    ...(env.PATH || '').split(path.delimiter)
      .filter(directory => path.isAbsolute(directory))
      .map(directory => path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node')),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.realpathSync(candidate) === resolved) return candidate;
    } catch { /* Skip missing aliases; never choose a different executable. */ }
  }
  return executable;
}

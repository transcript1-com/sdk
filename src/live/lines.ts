import type { LiveLine } from './types.js';

// lines arrive as the full current state, so a known id replaces its line in place
export const upsertLine = (lines: LiveLine[], line: LiveLine): void => {
  for (let index = lines.length - 1; index >= 0; index--) {
    const current = lines[index];
    if (!current || current.id < line.id) {
      lines.splice(index + 1, 0, line);
      return;
    }

    if (current.id === line.id) {
      lines[index] = line;
      return;
    }
  }

  lines.unshift(line);
};

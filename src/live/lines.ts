import type { LiveLine } from './types.js';

// lines arrive as the full current state, so a known id replaces its line in place
export const upsertLine = (lines: LiveLine[], line: LiveLine): void => {
  // an empty provisional line retracts its id; ids may leave gaps
  if (!line.final && line.text === '') {
    const index = lines.findIndex(current => current.id === line.id);
    if (index !== -1) {
      lines.splice(index, 1);
    }

    return;
  }

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

import type { Input } from '../types.js';
import { classifyData } from './classify-data.js';
import { classifyLink } from './classify-link.js';
import { classifyPath } from './classify-path.js';
import type { ClassifyOptionsType, FileInputType, LinkInputType } from './types.js';

export const classify = async (input: Input, options: ClassifyOptionsType = {}): Promise<LinkInputType | FileInputType> => {
  if (typeof input !== 'string') {
    return classifyData(input, options);
  }

  if (/^https?:\/\//i.test(input)) {
    return classifyLink(input);
  }

  return classifyPath(input, options);
};

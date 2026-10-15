const startsWithSegments = (path: string, prefix: string): boolean => {
  if (path === prefix) {
    return true;
  }

  return path.startsWith(`${prefix}/`);
};

const addLeadingSlash = (path: string): string => {
  if (path.startsWith('/')) {
    return path;
  }

  return `/${path}`;
};

// the chunk template already carries the base prefix
export const resolveUrl = (baseUrl: string, pathOrUrl: string): string => {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  const path = addLeadingSlash(pathOrUrl);
  if (!prefix) {
    return `${base.origin}${path}`;
  }

  if (startsWithSegments(path, prefix)) {
    return `${base.origin}${path}`;
  }

  return `${base.origin}${prefix}${path}`;
};

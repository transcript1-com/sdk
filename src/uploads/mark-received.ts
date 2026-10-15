import type { UploadType } from './types.js';

export const markReceived = (upload: UploadType, index: number) => {
  const chunk = upload.chunks.find(planned => planned.index === index);
  if (!chunk) {
    return;
  }

  upload.received.add(index);
  if (upload.counted.has(index)) {
    return;
  }

  upload.counted.add(index);
  upload.sent += chunk.size;
  upload.options.onProgress?.({ type: 'upload', sent: upload.sent, total: upload.file.size });
};

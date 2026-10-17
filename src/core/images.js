'use strict';

const fs = require('fs');
const path = require('path');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function extractImages(workspaceRoot, text) {
  const images = [];
  const seen = new Set();
  const re = /(?:[A-Za-z]:)?[^\s"']+\.(?:png|jpe?g|gif|webp)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    try {
      const abs = path.resolve(workspaceRoot, match[0]);
      if (seen.has(abs)) continue;
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) continue;
      seen.add(abs);
      const ext = path.extname(abs).slice(1).toLowerCase();
      const mime =
        ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'webp'
              ? 'image/webp'
              : 'image/png';
      images.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}` },
      });
    } catch {
      // not a readable file; leave it as plain text
    }
  }
  return images;
}

module.exports = { extractImages };

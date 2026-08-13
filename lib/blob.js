// Public access + a random suffix. There is no accounts/auth system yet
// (Milestone 4), so an unguessable URL is the same access boundary a
// private-blob-plus-signed-url scheme would give right now anyway. Revisit
// once auth exists, and add the 12-month retention deletion job called for
// in the brief's privacy section — neither is built yet.
const { put } = require('@vercel/blob');

async function uploadAudio(buffer, filename, contentType) {
  const blob = await put(`recordings/${filename}`, buffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: contentType || 'application/octet-stream',
  });
  return blob.url;
}

module.exports = { uploadAudio };

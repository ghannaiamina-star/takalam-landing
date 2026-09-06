// Classic event-based body read, not `for await (const chunk of req)` or
// Readable.toWeb(req): Vercel's dev server (and reportedly some production
// runtimes) pre-buffers the request body for its own req.body helper, then
// "restores" it onto req by patching req.read()/req.on('data'|'end') to
// replay from a fresh internal stream. That patch does not cover the
// Symbol.asyncIterator protocol underlying `for await`, so iterating `req`
// silently yields nothing post-restore. Plain 'data'/'end' listeners hit the
// patched path correctly and work in both vercel dev and real production.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseMultipart(req) {
  const bodyBuffer = await readRawBody(req);
  const contentType = req.headers['content-type'] || '';
  const request = new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: bodyBuffer,
  });
  return request.formData();
}

module.exports = { parseMultipart, readRawBody };

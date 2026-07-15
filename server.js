const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 1. Load environment variables from .env
if (fs.existsSync('.env')) {
  const envText = fs.readFileSync('.env', 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

const PORT = 3000;

// Helper to determine content type
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 2. Route APIs
  if (pathname.startsWith('/api/')) {
    const apiName = pathname.substring(5); // e.g. "aviator-stream"
    const apiPath = path.join(__dirname, 'api', `${apiName}.js`);

    if (!fs.existsSync(apiPath)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'API Not Found' }));
    }

    // Mock res helper methods typical to Vercel/Express
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (obj) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };

    req.query = parsedUrl.query;

    // Parse body if any
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', async () => {
      if (body) {
        try {
          req.body = JSON.parse(body);
        } catch (e) {
          req.body = body;
        }
      } else {
        req.body = {};
      }

      try {
        // Dynamically import the ES module API handler
        const handlerModule = await import(url.pathToFileURL(apiPath).href);
        await handlerModule.default(req, res);
      } catch (err) {
        console.error(`Error executing API ${apiName}:`, err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
      }
    });
    return;
  }

  // 3. Serve Static Files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  // Clean query strings/hash from filename for safety
  const cleanPath = filePath.split('?')[0];
  const ext = path.extname(cleanPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(cleanPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('404 Not Found');
      } else {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('500 Internal Error');
      }
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Local Dev Server running at http://localhost:${PORT}`);
});



export function loginPage(error, { nonce = '' } = {}) {
  const errHtml = error
    ? `<div style="background:#fdecea;color:#b71c1c;padding:12px 16px;border-radius:6px;margin-bottom:20px;font-size:14px;">${error}</div>`
    : '';

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login — socai.my.id</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #e8edf5 0%, #dce3ee 100%);
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #172033;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,.08);
      padding: 40px 36px;
      width: 100%;
      max-width: 400px;
    }
    .card h1 {
      font-size: 24px;
      text-align: center;
      margin-bottom: 8px;
    }
    .card .sub {
      text-align: center;
      color: #6b7280;
      font-size: 14px;
      margin-bottom: 28px;
    }
    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 6px;
      color: #374151;
    }
    input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 15px;
      margin-bottom: 18px;
      transition: border-color .2s;
    }
    input:focus {
      outline: none;
      border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79,70,229,.15);
    }
    button {
      width: 100%;
      padding: 12px;
      background: #4f46e5;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background .2s;
    }
    button:hover { background: #4338ca; }
    @media (prefers-color-scheme: dark) {
      body { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f2f5f8; }
      .card { background: #1e293b; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
      input { background: #334155; border-color: #475569; color: #f2f5f8; }
      input:focus { border-color: #818cf8; }
      label { color: #cbd5e1; }
      .card .sub { color: #94a3b8; }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 Login</h1>
    <p class="sub">socai.my.id</p>
    ${errHtml}
    <form method="POST" action="/login">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" placeholder="Username" required autocomplete="username">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" placeholder="Password" required autocomplete="current-password">
      <button type="submit">Masuk</button>
    </form>
  </div>
</body>
</html>`;
}

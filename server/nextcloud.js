export class LoginExpiredError extends Error {
  constructor(message = 'Login flow expired') {
    super(message);
    this.name = 'LoginExpiredError';
  }
}

export class NextcloudClient {
  constructor({ baseUrl, fetch = globalThis.fetch, now = () => Date.now() }) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.fetch = fetch;
    this.now = now;
  }

  async initLogin() {
    const res = await this.fetch(`${this.baseUrl}/index.php/login/v2`, { method: 'POST' });
    if (!res.ok) throw new Error(`Nextcloud login flow failed with HTTP ${res.status}`);
    const body = await res.json();
    if (!body?.login || !body?.poll?.token) throw new Error('Nextcloud login flow returned a malformed body');
    return { loginUrl: body.login, pollToken: body.poll.token };
  }

  async poll(token, { createdAt = this.now() } = {}) {
    if (this.now() - createdAt > 20 * 60 * 1000) throw new LoginExpiredError();
    const body = new URLSearchParams({ token });
    const res = await this.fetch(`${this.baseUrl}/login/v2/poll`, { method: 'POST', body });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Nextcloud login poll failed with HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload?.appPassword || !payload?.loginName) throw new Error('Nextcloud login poll returned a malformed body');
    return { appPassword: payload.appPassword, loginName: payload.loginName };
  }

  async revoke(appPassword, loginName = '') {
    const auth = Buffer.from(`${loginName}:${appPassword}`).toString('base64');
    const res = await this.fetch(`${this.baseUrl}/ocs/v2.php/core/apppassword`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${auth}`, 'OCS-APIRequest': 'true' },
    });
    if (!res.ok) throw new Error(`Nextcloud app password revocation failed with HTTP ${res.status}`);
  }
}

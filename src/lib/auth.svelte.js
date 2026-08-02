const DEFAULT_POLL_DELAYS = [1000, 1000, 2000, 3000, 5000];
const EXPIRY_MESSAGE = 'Sign-in expired. Please try again.';

export function createAuthStore({ fetch = globalThis.fetch, pollDelays = DEFAULT_POLL_DELAYS, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const s = $state({
    status: 'checking',
    user: null,
    error: null,
    loginUrl: null,
    expired: false,
  });

  let pollToken = 0;
  let controller = null;

  const samePoll = (token) => token === pollToken;
  const messageOf = (e, fallback) => e?.message ?? fallback;
  const delayFor = (attempt) => {
    if (typeof pollDelays === 'function') return pollDelays(attempt);
    return pollDelays[Math.min(attempt, pollDelays.length - 1)];
  };

  function clearPoll() {
    controller?.abort();
    controller = null;
    pollToken += 1;
  }

  function clearAuthState() {
    s.user = null;
    s.loginUrl = null;
    s.expired = false;
  }

  async function check() {
    s.status = 'checking';
    s.error = null;
    s.expired = false;
    try {
      const response = await fetch('/auth/me', { credentials: 'same-origin' });
      if (response.status === 200) {
        const body = await response.json();
        s.status = 'authenticated';
        s.user = body.user;
        s.error = null;
        s.loginUrl = null;
        return body.user;
      }
      s.status = 'anonymous';
      clearAuthState();
      return null;
    } catch (e) {
      s.status = 'anonymous';
      clearAuthState();
      s.error = messageOf(e, 'Could not check sign-in status.');
      return null;
    }
  }

  async function signIn() {
    if (s.status === 'pending' && s.loginUrl) return s.loginUrl;

    clearPoll();
    s.error = null;
    s.expired = false;
    const response = await fetch('/auth/login', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) {
      s.status = 'anonymous';
      s.user = null;
      s.loginUrl = null;
      s.error = 'Could not start sign-in.';
      return null;
    }
    const body = await response.json();
    s.status = 'pending';
    s.user = null;
    s.loginUrl = body.loginUrl;
    controller = new AbortController();
    const token = pollToken;
    poll(token, controller.signal);
    return body.loginUrl;
  }

  async function poll(token, signal) {
    let attempt = 0;
    while (samePoll(token)) {
      try {
        const response = await fetch('/auth/poll', { credentials: 'same-origin', signal });
        if (!samePoll(token)) return;
        if (response.status === 204) {
          await wait(delayFor(attempt));
          attempt += 1;
          continue;
        }
        if (response.status === 200) {
          const body = await response.json();
          if (!samePoll(token)) return;
          s.status = 'authenticated';
          s.user = body.user;
          s.error = null;
          s.loginUrl = null;
          s.expired = false;
          return;
        }
        s.status = 'anonymous';
        s.user = null;
        s.loginUrl = null;
        if (response.status === 410) {
          s.error = EXPIRY_MESSAGE;
          s.expired = true;
        } else {
          s.error = 'Sign-in failed. Please try again.';
          s.expired = false;
        }
        return;
      } catch (e) {
        if (!samePoll(token) || e?.name === 'AbortError') return;
        s.status = 'anonymous';
        s.user = null;
        s.loginUrl = null;
        s.expired = false;
        s.error = messageOf(e, 'Sign-in failed. Please try again.');
        return;
      }
    }
  }

  function cancel() {
    clearPoll();
    s.status = 'anonymous';
    s.user = null;
    s.error = null;
    s.loginUrl = null;
    s.expired = false;
  }

  async function signOut() {
    clearPoll();
    let error = null;
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) {
      error = messageOf(e, 'Could not sign out.');
    }
    s.status = 'anonymous';
    s.user = null;
    s.loginUrl = null;
    s.expired = false;
    s.error = error;
  }

  return { state: s, check, signIn, signOut, cancel };
}

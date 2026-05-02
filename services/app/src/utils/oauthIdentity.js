const UNKNOWN_EMAIL_OWNER = 'unknowEmail';

function normalizeEmailOwner(value) {
  return String(value || '').trim();
}

function remoteNameFromEmail(provider, email) {
  const username = normalizeEmailOwner(email).split('@')[0] || 'owner';
  return `${provider}-${username.replace(/[^a-z0-9]+/ig, '_')}`;
}

function isAutoRemoteName(provider, remoteName, emailOwner) {
  const remote = String(remoteName || '').trim();
  if (!remote) return true;

  const candidates = [
    remoteNameFromEmail(provider, emailOwner),
    remoteNameFromEmail(provider, UNKNOWN_EMAIL_OWNER),
    remoteNameFromEmail(provider, ''),
  ].filter(Boolean);

  return candidates.includes(remote);
}

function resolveOAuthIdentity(cfg, fetchedEmailOwner) {
  const provider = String(cfg?.provider || '').trim();
  const providedEmailOwner = normalizeEmailOwner(cfg?.emailOwner || cfg?.email_owner);
  const resolvedEmailOwner = normalizeEmailOwner(fetchedEmailOwner)
    || providedEmailOwner
    || UNKNOWN_EMAIL_OWNER;
  const shouldGenerateRemote = isAutoRemoteName(provider, cfg?.remoteName, providedEmailOwner);

  return {
    ...cfg,
    emailOwner: resolvedEmailOwner,
    remoteName: shouldGenerateRemote
      ? remoteNameFromEmail(provider, resolvedEmailOwner)
      : String(cfg?.remoteName || '').trim(),
  };
}

module.exports = {
  UNKNOWN_EMAIL_OWNER,
  isAutoRemoteName,
  normalizeEmailOwner,
  remoteNameFromEmail,
  resolveOAuthIdentity,
};

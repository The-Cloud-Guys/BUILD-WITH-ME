const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const buildAdminInvitationEmail = ({
  firstName,
  invitedByName,
  role,
  invitedEmail,
  invitationUrl,
  expiresAt,
}) => {
  const safe = {
    firstName: escapeHtml(firstName || 'there'),
    invitedByName: escapeHtml(invitedByName || 'A Build With Me administrator'),
    role: escapeHtml(String(role || 'administrator').replace(/_/g, ' ')),
    invitedEmail: escapeHtml(invitedEmail),
    invitationUrl: escapeHtml(invitationUrl),
    expiresAt: escapeHtml(expiresAt.toUTCString()),
  };
  return {
    subject: "You've been invited to the Build With Me admin dashboard",
    html: `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f7ece1;color:#242038;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;margin:auto;background:#fff;border-radius:12px;overflow:hidden"><tr><td style="background:#242038;padding:28px 36px;text-align:center;color:#f7ece1;font-size:22px;font-weight:700">Build With Me</td></tr><tr><td style="padding:36px"><h1 style="font-size:21px;margin:0 0 20px">You've been invited as an administrator</h1><p>Hi ${safe.firstName},</p><p>${safe.invitedByName} invited you to join the admin dashboard as <strong>${safe.role}</strong>.</p><p>Activate access using the Firebase account registered as <strong>${safe.invitedEmail}</strong>.</p><p style="margin:28px 0"><a href="${safe.invitationUrl}" style="background:#725ac1;color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:700">Activate Admin Access</a></p><p style="font-size:13px;color:#666">This one-time invitation expires at ${safe.expiresAt}.</p><hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#777">If you were not expecting this invitation, ignore this email. No administrator access will be created.</p></td></tr></table></td></tr></table></body></html>`,
    text: `You've been invited to the Build With Me admin dashboard.\n\nHi ${firstName || 'there'},\n\n${invitedByName || 'A Build With Me administrator'} invited you as ${String(role || 'administrator').replace(/_/g, ' ')}.\n\nActivate access with ${invitedEmail}:\n${invitationUrl}\n\nThis one-time invitation expires at ${expiresAt.toUTCString()}. If you were not expecting it, ignore this email.`,
  };
};

module.exports = { buildAdminInvitationEmail };

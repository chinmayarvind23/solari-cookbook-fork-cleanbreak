// Fixed client-facing copy only. Never show raw server/SDK errors.
export function cancellationStartError(status: number, code?: string): string {
  if (code === "NEW_ATTEMPT_NOT_ALLOWED")
    return "A new attempt is not allowed for this job or the configuration has changed. No new cancellation was started. Review the existing job; do not clear its history to retry."
  if (status === 401 || code === "OPERATOR_AUTH_REQUIRED")
    return "Operator login required. Reload this page and sign in as cleanbreak with the password used to start the web server."
  if (code === "APP_ORIGIN_MISMATCH")
    return "This address does not match CLEANBREAK_APP_ORIGIN. Open the exact address printed by npm run dev:live; localhost and 127.0.0.1 are different origins."
  if (status === 403)
    return "Request not authorized. Reload and sign in on the exact app address printed by the server."
  if (status === 409)
    return "Cancellation was not started. Stop the old web server and run npm run dev:live to validate the live configuration."
  return "Cancellation request was not confirmed. Do not submit a new cancellation; refresh to reconnect with the same request key."
}

# Security Hardening Checklist

## P0 - Must pass before release

- [ ] `AIRTABLE_API_KEY` and `AIRTABLE_BASE_ID` exist only on backend runtime.
- [ ] No runtime server code references `VITE_AIRTABLE_API_KEY` / `VITE_AIRTABLE_BASE_ID`.
- [ ] `JWT_SECRET` length is at least 48 random chars.
- [ ] `ADMIN_PASSWORD` length is at least 12 chars.
- [ ] Airtable proxy only allows approved table IDs.
- [ ] Airtable proxy enforces path validation and method policy.
- [ ] All JSON POST routes enforce `application/json` content-type.
- [ ] Body size limit returns `413` for oversized requests.
- [ ] `teacherId` / record-id parameters are validated via strict `rec...` regex.
- [ ] Login rate limiting cannot be bypassed by untrusted `X-Forwarded-For`.

## P1 - Should pass in same sprint

- [ ] Global 401 handling logs out expired sessions without page hard-reload.
- [ ] Login UI shows explicit session-expired message.
- [ ] CSP does not allow `script-src 'unsafe-inline'`.
- [ ] Deprecated `X-XSS-Protection` handling removed/disabled.
- [ ] Vercel headers align with backend security-header policy.
- [ ] Security tests pass: `server/auth.test.ts`, `server/httpSecurity.test.ts`.

## CI / Automation

- [ ] `npm run security:check-env` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.

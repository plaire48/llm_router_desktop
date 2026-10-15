// Compatibility entry point. Inline credentials/hidden form submission were
// retired by the user's 2026-10-15 rollback. Validate the current in-app portal
// login, POST/opener, persistent session and logout recovery contract instead.
import './check-mail-portal-login.mjs';

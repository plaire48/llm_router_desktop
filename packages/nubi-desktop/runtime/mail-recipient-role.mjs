// Product categorization: previously unclassified recipients belong to Bcc.
// Original To/Cc/Bcc header addresses remain source facts and are never filled in.
export const MAIL_RECIPIENT_ROLES=Object.freeze(['to','cc','bcc','sent']);
export const MAIL_RECIPIENT_ROLE_POLICY='bcc-fallback-v1';
export const mailRoleValue=value=>MAIL_RECIPIENT_ROLES.includes(value)?value:'bcc';
export const mailRoleFilters=values=>[...new Set((Array.isArray(values)?values:[]).filter(value=>value==='unknown'||MAIL_RECIPIENT_ROLES.includes(value)).map(mailRoleValue))];
// Both metadata paging and private full-text search use the same legacy-row projection.
export const MAIL_RECIPIENT_ROLE_SQL="CASE WHEN json_extract(m.metadata,'$.row.recipientRole') IN ('to','cc','sent') THEN json_extract(m.metadata,'$.row.recipientRole') ELSE 'bcc' END";

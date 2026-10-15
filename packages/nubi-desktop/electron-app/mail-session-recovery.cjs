function loginRedirect(target,configured){
 if(!target||target.username||target.password||!['http:','https:'].includes(target.protocol))return false;
 const company=/(^|\.)samsung\.(net|com)$/.test(target.hostname)||target.origin===new URL(configured).origin;
 return company&&/^\/(?:loginapp\/login|login|signin|sso)(?:\/|$)/i.test(target.pathname);
}
module.exports={loginRedirect};

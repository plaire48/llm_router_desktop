/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. See ../vendor/calculation-reference/libreoffice/COPYING.MPL.
 * Portions incorporate work licensed to the Apache Software Foundation under
 * Apache License 2.0. See ../vendor/calculation-reference/libreoffice/LICENSE.Apache-2.0.
 * The original ASF notice is preserved in analysishelper.cxx.
 * Adapted from LibreOffice GetAmordegrc, analysishelper.cxx, revision
 * 9d375606275c5e71391d905e68d2e59a51d9833f. Date fractions use the existing
 * Univer YEARFRAC implementation. Validation follows Excel's documented basis.
 */
export function decliningDepreciation(cost, salvage, period, rate, fraction) {
 const life=1/rate,coefficient=life<3?1:life<5?1.5:life<=6?2:2.5;
 rate*=coefficient;
 let depreciation=Math.round(fraction*rate*cost);
 cost-=depreciation;
 let remaining=cost-salvage;
 for(let i=0;i<period;i++){
  depreciation=Math.round(rate*cost);
  remaining-=depreciation;
  if(remaining<0)return period-i<=1?Math.round(cost*0.5):0;
  cost-=depreciation;
 }
 return depreciation;
}

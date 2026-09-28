// Mirrors native Nubi.Office.Core.OfficeFault: a coded, expected rejection.
// Other exceptions mean the simulated host itself failed.
export class OfficeFault extends Error{
  constructor(code){super(code);this.name='OfficeFault';this.code=code;}
}
export const fault=code=>{throw new OfficeFault(code);};

// Owner-approved Milestone 5.7 resources. No credentials or writable defaults.
const staging = Object.freeze({
  teamId: 'team_Czf2GmSPOjNPQh8cBrmyBBX3',
  frontendProjectId: 'prj_XXZkiz3lq2ZPyJAKSczFcCKTZkBe',
  backendProjectId: 'prj_jzlWNa71F4DWjqsma4JbxPLsUM4c',
  frontendOrigin: 'https://moveout-e2e-clarkswift1-9306s-projects.vercel.app',
  apiOrigin: 'https://fullstack-capstone-project-vkwm.vercel.app',
  productionFrontendOrigin: 'https://fullstack-capstone-project-flax.vercel.app',
  database: 'moveout_e2e_staging',
  fingerprint: '8ea1ee6b3396707c1c838e0ae254401c0c58c980993cb6988c0071c7def91acf'
});
function testOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Configure an approved exact HTTPS staging frontend origin'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.port ||
      /(?:^|\.)localhost$/.test(url.hostname) || ['127.0.0.1', '[::1]'].includes(url.hostname) ||
      [staging.productionFrontendOrigin, staging.apiOrigin].includes(url.origin)) {
    throw Error('Use a separate exact HTTPS staging frontend origin; production and the direct API are forbidden');
  }
  return url.origin;
}
module.exports = { staging, testOrigin };
